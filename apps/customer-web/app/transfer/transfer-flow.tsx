"use client";

import { Alert, Badge, Button, Card, Checkbox } from "@waflo/ui";
import { Camera, ImageUp, MailCheck, QrCode, ShieldAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { customerApi, CustomerApiError, customerCommandId } from "../client-api";

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
}

interface BarcodeDetectorConstructor {
  new (options: { formats: string[] }): BarcodeDetectorLike;
}

interface Inspection {
  merchant: { name: string };
  program: { name: string };
  maskedEmail: string | null;
  emailConfirmationRequired: boolean;
  cardStatus: "ACTIVE";
}

interface TransferRequestResult {
  transferPublicId: string;
  status: string;
  method: "EMAIL_CONFIRMED" | "QR_WITHOUT_EMAIL";
  expiresAt: string;
  challenge: string | null;
  emailSent: boolean;
  warning: string | null;
}

export function TransferFlow() {
  const [qrPayload, setQrPayload] = useState("");
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [transfer, setTransfer] = useState<TransferRequestResult | null>(null);
  const [riskAccepted, setRiskAccepted] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const idempotencyKey = useRef(customerCommandId("transfer"));

  // biome-ignore lint/correctness/useExhaustiveDependencies: bootstrap and cleanup run once per mounted transfer flow.
  useEffect(() => {
    // Existing-card entry: use the credential already authorized in the HttpOnly session.
    void customerApi<{ membershipQr: { payload: string } | null }>("/v1/customer/card")
      .then((card) => {
        if (card.membershipQr?.payload) {
          setQrPayload(card.membershipQr.payload);
          void inspect(card.membershipQr.payload);
        }
      })
      .catch(() => undefined);
    return () => stopCamera();
  }, []);

  async function inspect(payload = qrPayload) {
    if (!payload) return;
    setBusy(true);
    setError("");
    try {
      const result = await customerApi<Inspection>("/v1/public/transfers/inspect", {
        method: "POST",
        body: JSON.stringify({ qrPayload: payload }),
      });
      setQrPayload(payload);
      setInspection(result);
    } catch (caught) {
      setInspection(null);
      setError(caught instanceof Error ? caught.message : "This card QR is unavailable.");
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError("");
    const form = new FormData();
    form.set("image", file);
    try {
      const decoded = await customerApi<{ qrPayload: string }>(
        "/v1/public/transfers/decode-qr-image",
        { method: "POST", body: form },
      );
      await inspect(decoded.qrPayload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No Waflo QR was found.");
    } finally {
      setBusy(false);
    }
  }

  async function startCamera() {
    setError("");
    const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor })
      .BarcodeDetector;
    if (!Detector) {
      setError("Live QR scanning is not supported by this browser. Upload a QR image instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOpen(true);
      await new Promise((resolve) => window.setTimeout(resolve, 20));
      if (!videoRef.current) return;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      const detector = new Detector({ formats: ["qr_code"] });
      const scan = async () => {
        if (!streamRef.current || !videoRef.current) return;
        const found = await detector.detect(videoRef.current).catch(() => []);
        if (found[0]?.rawValue) {
          stopCamera();
          await inspect(found[0].rawValue);
          return;
        }
        window.requestAnimationFrame(() => void scan());
      };
      void scan();
    } catch {
      setError("Camera access was not granted. Upload a QR image instead.");
      stopCamera();
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => {
      track.stop();
    });
    streamRef.current = null;
    setCameraOpen(false);
  }

  async function requestTransfer() {
    setBusy(true);
    setError("");
    try {
      const result = await customerApi<TransferRequestResult>("/v1/public/transfers/request", {
        method: "POST",
        headers: { "x-idempotency-key": idempotencyKey.current },
        body: JSON.stringify({ qrPayload, preferredLocale: "en" }),
      });
      setTransfer(result);
    } catch (caught) {
      setError(
        caught instanceof CustomerApiError ? caught.message : "Transfer could not be started.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function confirmWithoutEmail() {
    if (!transfer?.challenge || !riskAccepted) return;
    setBusy(true);
    setError("");
    try {
      const result = await customerApi<{ publicMembershipId: string }>(
        "/v1/public/transfers/confirm-without-email",
        {
          method: "POST",
          body: JSON.stringify({
            transferPublicId: transfer.transferPublicId,
            challenge: transfer.challenge,
            explicitRiskAccepted: true,
          }),
        },
      );
      const tenant = new URLSearchParams(window.location.search).get("tenant");
      const tenantQuery = tenant ? `?tenant=${encodeURIComponent(tenant)}` : "";
      window.location.assign(`/card/${result.publicMembershipId}${tenantQuery}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Transfer could not be confirmed.");
    } finally {
      setBusy(false);
    }
  }

  if (transfer?.method === "EMAIL_CONFIRMED") {
    return (
      <main className="customer-page customer-centered">
        <Card className="transfer-result">
          <MailCheck />
          <Badge tone="success">Confirmation sent</Badge>
          <h1>Check {inspection?.maskedEmail ?? "your email"}</h1>
          <p>
            Open the message on the device that should receive this card. The secure token remains
            in the browser fragment and is removed before confirmation.
          </p>
          <small>Expires {new Date(transfer.expiresAt).toLocaleString()}</small>
        </Card>
      </main>
    );
  }

  if (transfer?.method === "QR_WITHOUT_EMAIL") {
    return (
      <main className="customer-page customer-centered">
        <Card className="transfer-result transfer-result--warning">
          <ShieldAlert />
          <Badge tone="warning">Lower-security transfer</Badge>
          <h1>No email is stored for this card</h1>
          <Alert tone="warning" title="A screenshot may be enough to transfer this card">
            Anyone holding a valid copy of the current QR could attempt this transfer. Continue only
            on a private device you control.
          </Alert>
          <Checkbox
            checked={riskAccepted}
            onChange={(event) => setRiskAccepted(event.target.checked)}
            label="I understand the risk and want to rotate the card credential now."
          />
          {error ? <Alert tone="danger" title={error} /> : null}
          <Button
            disabled={!riskAccepted}
            loading={busy}
            onClick={() => void confirmWithoutEmail()}
          >
            Transfer and invalidate old card
          </Button>
        </Card>
      </main>
    );
  }

  return (
    <main className="customer-page transfer-page">
      <header className="transfer-header">
        <span className="waflo-wordmark">waflo</span>
        <Badge tone="brand">CARD TRANSFER</Badge>
      </header>
      <section className="transfer-intro">
        <h1>Move your loyalty card safely</h1>
        <p>
          Scan the QR from the current card or upload a screenshot. Identity remains hidden until
          authorization.
        </p>
      </section>
      {error ? <Alert tone="danger" title={error} /> : null}
      {!inspection ? (
        <section className="transfer-methods">
          <Card>
            <Camera />
            <h2>Scan with camera</h2>
            <p>Point this device at the QR shown on the current card.</p>
            <Button onClick={() => void startCamera()} loading={busy}>
              Open camera
            </Button>
          </Card>
          <Card>
            <ImageUp />
            <h2>Upload QR image</h2>
            <p>PNG, JPEG, or WebP. The image is decoded in memory and is never saved.</p>
            <label className="wf-button wf-button--secondary transfer-upload">
              Choose image
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => void upload(event.target.files?.[0])}
              />
            </label>
          </Card>
          {cameraOpen ? (
            <div className="camera-sheet">
              <video ref={videoRef} muted playsInline aria-label="QR camera preview" />
              <Button variant="secondary" onClick={stopCamera}>
                Close camera
              </Button>
            </div>
          ) : null}
        </section>
      ) : (
        <Card className="transfer-inspection">
          <QrCode />
          <Badge tone="success">Active card found</Badge>
          <h2>{inspection.program.name}</h2>
          <p>{inspection.merchant.name}</p>
          <dl>
            <div>
              <dt>Confirmation</dt>
              <dd>{inspection.emailConfirmationRequired ? "Email" : "Card QR challenge"}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{inspection.maskedEmail ?? "Not stored"}</dd>
            </div>
          </dl>
          {inspection.emailConfirmationRequired ? (
            <Alert tone="info" title="Email control will be verified">
              Waflo will send a short-lived confirmation to the masked address above.
            </Alert>
          ) : (
            <Alert tone="warning" title="This path has less protection">
              Without email, possession of this QR is the transfer proof.
            </Alert>
          )}
          <Button loading={busy} onClick={() => void requestTransfer()}>
            Continue transfer
          </Button>
          <Button variant="ghost" onClick={() => setInspection(null)}>
            Use another QR
          </Button>
        </Card>
      )}
    </main>
  );
}
