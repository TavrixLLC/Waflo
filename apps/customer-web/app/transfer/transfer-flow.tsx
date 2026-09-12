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
  preferredLocale: "en" | "ar";
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

export function TransferFlow({ initialLocale }: { initialLocale: "en" | "ar" }) {
  const [locale, setLocale] = useState(initialLocale);
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
  const ar = locale === "ar";
  const copy = ar
    ? {
        invalidQr: "رمز هذه البطاقة غير متاح.",
        noQr: "لم يتم العثور على رمز Waflo صالح.",
        liveUnsupported: "المسح المباشر غير مدعوم في هذا المتصفح. ارفع صورة الرمز بدلًا من ذلك.",
        cameraDenied: "لم يُسمح باستخدام الكاميرا. ارفع صورة الرمز بدلًا من ذلك.",
        transferStartFailed: "تعذر بدء نقل البطاقة.",
        transferConfirmFailed: "تعذر تأكيد نقل البطاقة.",
        confirmationSent: "تم إرسال التأكيد",
        checkEmail: "تحقق من بريدك الإلكتروني",
        checkMaskedEmail: "تحقق من",
        emailInstructions: "افتح الرسالة على الجهاز الذي تريد نقل البطاقة إليه.",
        expires: "تنتهي الصلاحية",
        lowerSecurity: "نقل بدون بريد إلكتروني",
        noEmail: "لا يوجد بريد إلكتروني محفوظ لهذه البطاقة",
        screenshotRisk: "نسخة من هذا الرمز تكفي لطلب نقل البطاقة",
        screenshotRiskBody:
          "أي شخص يملك نسخة صالحة من الرمز الحالي يمكنه محاولة نقل البطاقة. تابع فقط على جهاز خاص تتحكم به.",
        acceptRisk: "أفهم ذلك وأريد تغيير بيانات اعتماد البطاقة الآن.",
        transferInvalidate: "انقل البطاقة وأبطل البطاقة القديمة",
        transferBadge: "نقل البطاقة",
        title: "انقل بطاقة ولائك بأمان",
        intro: "امسح الرمز من البطاقة الحالية أو ارفع صورة له. تبقى هويتك مخفية حتى اكتمال التحقق.",
        scanCamera: "المسح بالكاميرا",
        scanCameraBody: "وجّه هذا الجهاز إلى الرمز الظاهر على البطاقة الحالية.",
        openCamera: "فتح الكاميرا",
        uploadQr: "رفع صورة الرمز",
        uploadQrBody: "PNG أو JPEG أو WebP. تُقرأ الصورة في الذاكرة ولا يتم حفظها.",
        chooseImage: "اختيار صورة",
        cameraPreview: "معاينة كاميرا رمز QR",
        closeCamera: "إغلاق الكاميرا",
        activeCard: "تم العثور على بطاقة نشطة",
        confirmation: "التأكيد",
        email: "البريد الإلكتروني",
        cardChallenge: "تحدي رمز البطاقة",
        notStored: "غير محفوظ",
        emailControl: "سيتم التحقق من التحكم بالبريد الإلكتروني",
        emailControlBody: "سيرسل Waflo تأكيدًا قصير الصلاحية إلى العنوان المخفي أعلاه.",
        lessProtection: "النقل يعتمد على الرمز فقط",
        lessProtectionBody: "لا يوجد بريد إلكتروني لهذه البطاقة — حيازة الرمز هي دليل النقل.",
        continueTransfer: "متابعة نقل البطاقة",
        anotherQr: "استخدام رمز آخر",
      }
    : {
        invalidQr: "This card QR is unavailable.",
        noQr: "No valid Waflo QR was found.",
        liveUnsupported:
          "Live QR scanning is not supported by this browser. Upload a QR image instead.",
        cameraDenied: "Camera access was not granted. Upload a QR image instead.",
        transferStartFailed: "Transfer could not be started.",
        transferConfirmFailed: "Transfer could not be confirmed.",
        confirmationSent: "Confirmation sent",
        checkEmail: "Check your email",
        checkMaskedEmail: "Check",
        emailInstructions: "Open the message on the device that should receive this card.",
        expires: "Expires",
        lowerSecurity: "Transfer without email verification",
        noEmail: "No email is stored for this card",
        screenshotRisk: "Anyone with a copy of this QR can attempt a transfer",
        screenshotRiskBody:
          "This card has no stored email. Anyone holding a valid copy of the current QR could request this transfer. Continue only on a private device you control.",
        acceptRisk: "I understand and want to generate a new card credential now.",
        transferInvalidate: "Transfer and invalidate old card",
        transferBadge: "CARD TRANSFER",
        title: "Move your loyalty card safely",
        intro:
          "Scan the QR from the current card or upload a screenshot. Identity remains hidden until authorization.",
        scanCamera: "Scan with camera",
        scanCameraBody: "Point this device at the QR shown on the current card.",
        openCamera: "Open camera",
        uploadQr: "Upload QR image",
        uploadQrBody: "PNG, JPEG, or WebP. The image is decoded in memory and is never saved.",
        chooseImage: "Choose image",
        cameraPreview: "QR camera preview",
        closeCamera: "Close camera",
        activeCard: "Active card found",
        confirmation: "Confirmation",
        email: "Email",
        cardChallenge: "Card QR challenge",
        notStored: "Not stored",
        emailControl: "Email control will be verified",
        emailControlBody: "Waflo will send a short-lived confirmation to the masked address above.",
        lessProtection: "Transfer uses QR only — no email verification",
        lessProtectionBody:
          "No email is stored for this card. Possession of this QR is the transfer proof.",
        continueTransfer: "Continue transfer",
        anotherQr: "Use another QR",
      };

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
      setLocale(result.preferredLocale);
    } catch (caught) {
      setInspection(null);
      setError(caught instanceof CustomerApiError ? caught.message : copy.invalidQr);
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
      setError(caught instanceof CustomerApiError ? caught.message : copy.noQr);
    } finally {
      setBusy(false);
    }
  }

  async function startCamera() {
    setError("");
    const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor })
      .BarcodeDetector;
    if (!Detector) {
      setError(copy.liveUnsupported);
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
      setError(copy.cameraDenied);
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
        body: JSON.stringify({ qrPayload, preferredLocale: locale }),
      });
      setTransfer(result);
    } catch (caught) {
      setError(caught instanceof CustomerApiError ? caught.message : copy.transferStartFailed);
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
      setError(caught instanceof CustomerApiError ? caught.message : copy.transferConfirmFailed);
    } finally {
      setBusy(false);
    }
  }

  if (transfer?.method === "EMAIL_CONFIRMED") {
    return (
      <main className="customer-page customer-centered" lang={locale} dir={ar ? "rtl" : "ltr"}>
        <Card className="transfer-result">
          <MailCheck />
          <Badge tone="success">{copy.confirmationSent}</Badge>
          <h1>
            {inspection?.maskedEmail ? (
              <>
                {copy.checkMaskedEmail} <bdi dir="ltr">{inspection.maskedEmail}</bdi>
              </>
            ) : (
              copy.checkEmail
            )}
          </h1>
          <p>{copy.emailInstructions}</p>
          <small>
            {copy.expires}{" "}
            <bdi dir="ltr">
              {new Date(transfer.expiresAt).toLocaleString(ar ? "ar-u-nu-latn" : "en")}
            </bdi>
          </small>
        </Card>
      </main>
    );
  }

  if (transfer?.method === "QR_WITHOUT_EMAIL") {
    return (
      <main className="customer-page customer-centered" lang={locale} dir={ar ? "rtl" : "ltr"}>
        <Card className="transfer-result transfer-result--warning">
          <ShieldAlert />
          <Badge tone="warning">{copy.lowerSecurity}</Badge>
          <h1>{copy.noEmail}</h1>
          <Alert tone="warning" title={copy.screenshotRisk}>
            {copy.screenshotRiskBody}
          </Alert>
          <Checkbox
            checked={riskAccepted}
            onChange={(event) => setRiskAccepted(event.target.checked)}
            label={copy.acceptRisk}
          />
          {error ? <Alert tone="danger" title={error} /> : null}
          <Button
            disabled={!riskAccepted}
            loading={busy}
            onClick={() => void confirmWithoutEmail()}
          >
            {copy.transferInvalidate}
          </Button>
        </Card>
      </main>
    );
  }

  return (
    <main className="customer-page transfer-page" lang={locale} dir={ar ? "rtl" : "ltr"}>
      <header className="transfer-header">
        <span className="waflo-wordmark">waflo</span>
        <Badge tone="brand">{copy.transferBadge}</Badge>
      </header>
      <section className="transfer-intro">
        <h1>{copy.title}</h1>
        <p>{copy.intro}</p>
      </section>
      {error ? <Alert tone="danger" title={error} /> : null}
      {!inspection ? (
        <section className="transfer-methods">
          <Card>
            <Camera />
            <h2>{copy.scanCamera}</h2>
            <p>{copy.scanCameraBody}</p>
            <Button onClick={() => void startCamera()} loading={busy}>
              {copy.openCamera}
            </Button>
          </Card>
          <Card>
            <ImageUp />
            <h2>{copy.uploadQr}</h2>
            <p>{copy.uploadQrBody}</p>
            <label className="wf-button wf-button--secondary transfer-upload">
              {copy.chooseImage}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => void upload(event.target.files?.[0])}
              />
            </label>
          </Card>
          {cameraOpen ? (
            <div className="camera-sheet">
              <video ref={videoRef} muted playsInline aria-label={copy.cameraPreview} />
              <Button variant="secondary" onClick={stopCamera}>
                {copy.closeCamera}
              </Button>
            </div>
          ) : null}
        </section>
      ) : (
        <Card className="transfer-inspection">
          <QrCode />
          <Badge tone="success">{copy.activeCard}</Badge>
          <h2>{inspection.program.name}</h2>
          <p>{inspection.merchant.name}</p>
          <dl>
            <div>
              <dt>{copy.confirmation}</dt>
              <dd>{inspection.emailConfirmationRequired ? copy.email : copy.cardChallenge}</dd>
            </div>
            <div>
              <dt>{copy.email}</dt>
              <dd>
                {inspection.maskedEmail ? (
                  <bdi dir="ltr">{inspection.maskedEmail}</bdi>
                ) : (
                  copy.notStored
                )}
              </dd>
            </div>
          </dl>
          {inspection.emailConfirmationRequired ? (
            <Alert tone="info" title={copy.emailControl}>
              {copy.emailControlBody}
            </Alert>
          ) : (
            <Alert tone="warning" title={copy.lessProtection}>
              {copy.lessProtectionBody}
            </Alert>
          )}
          <Button loading={busy} onClick={() => void requestTransfer()}>
            {copy.continueTransfer}
          </Button>
          <Button variant="ghost" onClick={() => setInspection(null)}>
            {copy.anotherQr}
          </Button>
        </Card>
      )}
    </main>
  );
}
