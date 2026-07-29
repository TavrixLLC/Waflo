"use client";

import { Alert, Badge, Button, Card } from "@waflo/ui";
import { ArrowRightLeft, Clock3, LogOut, ShieldCheck, WalletCards } from "lucide-react";
import Image from "next/image";
import QRCode from "qrcode";
import { useCallback, useEffect, useState } from "react";
import { customerApi, CustomerApiError } from "../../client-api";

interface CardView {
  publicMembershipId: string;
  customer: {
    displayName: string;
    preferredLocale: "en" | "ar";
    maskedEmail: string | null;
  };
  merchant: { name: string; slug: string };
  program: {
    name: string;
    description: string;
    rewardSummary: string;
    pausedMessage: string | null;
  };
  membership: {
    status: string;
    credentialStatus: string;
    state: string;
    enrolledAt: string;
  };
  progress: {
    currentCycleStampCount: number;
    completedCycleCount: number;
    rewardReady: boolean;
    goal: number;
    stamps: Array<"FILLED" | "EMPTY">;
    render: {
      dataUri: string;
      contentDigest: string;
      configurationDigest: string;
      width: number;
      height: number;
    };
  };
  theme: {
    backgroundColor: string;
    foregroundColor: string;
    accentColor: string;
    secondaryColor: string;
  };
  membershipQr: { payload: string; containsPii: false } | null;
  wallet: {
    apple: { mode: string; status: string; testAdapter: boolean; safeErrorCode: string | null };
    google: { mode: string; status: string; testAdapter: boolean; safeErrorCode: string | null };
  };
  transfer: {
    allowed: boolean;
    emailConfirmationRequired: boolean;
    transferWithoutEmailAllowed: boolean;
  };
}

export function CustomerCard({ publicMembershipId }: { publicMembershipId: string }) {
  const [card, setCard] = useState<CardView | null>(null);
  const [qrUrl, setQrUrl] = useState("");
  const [error, setError] = useState("");
  const [walletBusy, setWalletBusy] = useState<"apple" | "google" | null>(null);
  const [tenantQuery, setTenantQuery] = useState("");

  useEffect(() => {
    const tenant = new URLSearchParams(window.location.search).get("tenant");
    setTenantQuery(tenant ? `?tenant=${encodeURIComponent(tenant)}` : "");
  }, []);

  const load = useCallback(async () => {
    try {
      setCard(
        await customerApi<CardView>(`/v1/customer/card/${encodeURIComponent(publicMembershipId)}`),
      );
    } catch (caught) {
      setError(
        caught instanceof CustomerApiError ? caught.message : "This card could not be opened.",
      );
    }
  }, [publicMembershipId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!card?.membershipQr) {
      setQrUrl("");
      return;
    }
    void QRCode.toDataURL(card.membershipQr.payload, {
      width: 520,
      margin: 3,
      errorCorrectionLevel: "Q",
      color: { dark: card.theme.foregroundColor, light: "#FFFFFFFF" },
    }).then(setQrUrl);
  }, [card]);

  async function addGoogle() {
    setWalletBusy("google");
    try {
      const action = await customerApi<{ url: string }>("/v1/customer/wallet/google/add-action", {
        method: "POST",
      });
      window.location.assign(action.url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Google Wallet is unavailable.");
    } finally {
      setWalletBusy(null);
    }
  }

  async function logout() {
    await customerApi("/v1/customer/session/logout", { method: "POST" });
    window.location.assign("/");
  }

  if (!card) {
    return (
      <main className="customer-page customer-centered">
        <Card className="card-loading">
          {error ? (
            <Alert tone="danger" title={error} />
          ) : (
            <>
              <Clock3 /> Opening your card…
            </>
          )}
        </Card>
      </main>
    );
  }

  const ar = card.customer.preferredLocale === "ar";
  const active = card.membership.state === "ACTIVE";
  return (
    <main className="customer-page card-page" lang={ar ? "ar" : "en"} dir={ar ? "rtl" : "ltr"}>
      <header className="customer-header card-header">
        <span className="waflo-wordmark">waflo</span>
        <button type="button" className="customer-language" onClick={() => void logout()}>
          <LogOut size={15} /> {ar ? "إنهاء الجلسة" : "Sign out"}
        </button>
      </header>
      <section
        className={`digital-card ${active ? "" : "digital-card--inactive"}`}
        style={
          {
            "--card-bg": card.theme.backgroundColor,
            "--card-ink": card.theme.foregroundColor,
            "--card-accent": card.theme.accentColor,
          } as React.CSSProperties
        }
      >
        <div className="digital-card__brand">
          <div>
            <small>{card.merchant.name}</small>
            <h1>{card.program.name}</h1>
          </div>
          <Badge tone={active ? "success" : "warning"}>
            {card.membership.state.replaceAll("_", " ")}
          </Badge>
        </div>
        {!active ? (
          <Alert
            tone={card.membership.state === "TRANSFERRED" ? "warning" : "info"}
            title={
              card.membership.state === "TRANSFERRED"
                ? ar
                  ? "تم نقل هذه البطاقة"
                  : "This card was transferred"
                : ar
                  ? "البطاقة غير نشطة"
                  : "Card unavailable"
            }
          >
            {card.membership.state === "TRANSFERRED"
              ? ar
                ? "رمز QR القديم لم يعد صالحًا."
                : "The old QR credential is no longer valid."
              : card.program.pausedMessage ||
                (ar ? "تواصل مع التاجر للمساعدة." : "Contact the merchant for help.")}
          </Alert>
        ) : null}
        <div className="digital-card__member">
          <span>{ar ? "العضو" : "MEMBER"}</span>
          <strong>{card.customer.displayName}</strong>
          {card.customer.maskedEmail ? <small>{card.customer.maskedEmail}</small> : null}
        </div>
        <Image
          className="published-stamp-artwork"
          src={card.progress.render.dataUri}
          alt={`${card.progress.currentCycleStampCount} of ${card.progress.goal} stamps`}
          width={card.progress.render.width}
          height={card.progress.render.height}
          unoptimized
        />
        <div className="progress-copy">
          <strong>
            {card.progress.currentCycleStampCount} / {card.progress.goal}
          </strong>
          <span>
            {card.progress.rewardReady
              ? ar
                ? "المكافأة جاهزة"
                : "Reward ready"
              : card.program.rewardSummary}
          </span>
        </div>
        {qrUrl && card.membershipQr ? (
          <div className="membership-qr">
            {/* The alt text intentionally describes purpose without exposing the payload. */}
            <Image
              src={qrUrl}
              alt={ar ? "رمز بطاقة العضوية" : "Membership card QR"}
              width={520}
              height={520}
              unoptimized
            />
            <p>
              <ShieldCheck />{" "}
              {ar ? "يحتوي على بيانات اعتماد عشوائية فقط" : "Contains an opaque credential only"}
            </p>
          </div>
        ) : null}
      </section>
      <section className="card-actions">
        <Card>
          <div className="card-actions__heading">
            <WalletCards />
            <div>
              <h2>{ar ? "أضف إلى Wallet" : "Add to Wallet"}</h2>
              <p>
                {ar
                  ? "تظهر الأزرار فقط عندما تصبح البطاقة جاهزة."
                  : "Buttons appear only when provider issuance is ready."}
              </p>
            </div>
          </div>
          <div className="wallet-buttons">
            {card.wallet.apple.status === "READY" ? (
              <a
                className="wallet-button wallet-button--apple"
                href="/api/waflo/v1/customer/wallet/apple/pass"
              >
                Add to Apple Wallet
              </a>
            ) : (
              <span className="wallet-state">Apple Wallet · {card.wallet.apple.status}</span>
            )}
            {card.wallet.google.status === "READY" ? (
              <Button onClick={() => void addGoogle()} loading={walletBusy === "google"}>
                Add to Google Wallet
              </Button>
            ) : (
              <span className="wallet-state">Google Wallet · {card.wallet.google.status}</span>
            )}
          </div>
          {card.wallet.apple.testAdapter || card.wallet.google.testAdapter ? (
            <Alert tone="info" title={ar ? "وضع اختبار" : "Test Adapter mode"}>
              {ar
                ? "لا يمثل هذا تثبيتًا حقيقيًا لدى مزود Wallet."
                : "This does not claim a real provider installation."}
            </Alert>
          ) : null}
        </Card>
        {card.transfer.allowed ? (
          <a className="transfer-action" href={`/transfer${tenantQuery}`}>
            <ArrowRightLeft />
            <span>
              <strong>{ar ? "نقل البطاقة إلى جهاز آخر" : "Transfer to another device"}</strong>
              <small>
                {card.transfer.emailConfirmationRequired
                  ? ar
                    ? "يتطلب تأكيد البريد"
                    : "Email confirmation required"
                  : ar
                    ? "مسار أقل أمانًا باستخدام رمز البطاقة"
                    : "Lower-security QR proof path"}
              </small>
            </span>
          </a>
        ) : null}
      </section>
    </main>
  );
}
