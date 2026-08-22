"use client";

import {
  cardLocaleMetadata,
  directionForCardLocale,
  fontStackForCardLocale,
} from "@waflo/contracts";
import { Alert, Badge, Button, Card, SearchableSelect } from "@waflo/ui";
import { ArrowRightLeft, Clock3, LogOut, ShieldCheck, WalletCards } from "lucide-react";
import Image from "next/image";
import QRCode from "qrcode";
import { useCallback, useEffect, useState } from "react";
import { CustomerMerchantIdentity } from "../../customer-merchant-identity";
import { CustomerApiError, customerApi } from "../../client-api";
import { type WalletPlatform, walletPlatform } from "../../wallet-platform";

interface CardView {
  publicMembershipId: string;
  customer: {
    displayName: string;
    preferredLocale: "en" | "ar";
    maskedEmail: string | null;
  };
  merchant: { name: string; slug: string; brandLogoDataUri?: string | null | undefined };
  program: {
    defaultLocale: string;
    enabledLocales: string[];
    contentLocale: string;
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

function walletStatusLabel(status: string, ar: boolean): string {
  if (status === "READY") return ar ? "جاهزة" : "Ready";
  if (status === "PREPARING" || status === "PENDING") return ar ? "قيد التجهيز" : "Preparing";
  return ar ? "غير متاحة" : "Unavailable";
}

function membershipStateLabel(state: string, ar: boolean): string {
  if (state === "ACTIVE") return ar ? "نشطة" : "Active";
  if (state === "TRANSFERRED") return ar ? "منقولة" : "Transferred";
  if (state === "SUSPENDED") return ar ? "موقوفة" : "Suspended";
  return ar ? "غير متاحة" : "Unavailable";
}

export function CustomerCard({
  publicMembershipId,
  tenant,
}: {
  publicMembershipId: string;
  tenant?: string;
}) {
  const [card, setCard] = useState<CardView | null>(null);
  const [qrUrl, setQrUrl] = useState("");
  const [error, setError] = useState("");
  const [walletBusy, setWalletBusy] = useState<"apple" | "google" | null>(null);
  const [platform, setPlatform] = useState<WalletPlatform>("desktop");
  const [selectedCardLocale, setSelectedCardLocale] = useState<string | undefined>();
  const tenantQuery = tenant ? `?tenant=${encodeURIComponent(tenant)}` : "";

  useEffect(() => {
    setPlatform(walletPlatform(window.navigator.userAgent, window.navigator.maxTouchPoints));
  }, []);

  const load = useCallback(
    async (localeOverride?: string) => {
      try {
        const query = new URLSearchParams();
        if (tenant) query.set("tenant", tenant);
        if (localeOverride) query.set("locale", localeOverride);
        setCard(
          await customerApi<CardView>(
            `/v1/customer/card/${encodeURIComponent(publicMembershipId)}${query.size ? `?${query.toString()}` : ""}`,
          ),
        );
      } catch (caught) {
        setError(
          caught instanceof CustomerApiError ? caught.message : "This card could not be opened.",
        );
      }
    },
    [publicMembershipId, tenant],
  );

  useEffect(() => {
    const saved =
      window.localStorage.getItem(`waflo:card-locale:${publicMembershipId}`) ?? undefined;
    setSelectedCardLocale(saved);
    void load(saved);
    const timer = window.setInterval(() => void load(saved), 15_000);
    return () => window.clearInterval(timer);
  }, [load, publicMembershipId]);

  function chooseCardLocale(locale: string) {
    if (!card?.program.enabledLocales.includes(locale)) return;
    setSelectedCardLocale(locale);
    window.localStorage.setItem(`waflo:card-locale:${publicMembershipId}`, locale);
    void load(locale);
  }

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
      const action = await customerApi<{ url: string }>(
        `/v1/customer/wallet/google/add-action${tenantQuery}`,
        {
          method: "POST",
        },
      );
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
        <CustomerMerchantIdentity
          locale={ar ? "ar" : "en"}
          logoDataUri={card.merchant.brandLogoDataUri}
          name={card.merchant.name}
        />
        <div className="customer-card-actions">
          {card.program.enabledLocales.length > 1 ? (
            <SearchableSelect
              ariaLabel={ar ? "لغة محتوى البطاقة" : "Card content language"}
              value={selectedCardLocale ?? card.program.contentLocale}
              onValueChange={chooseCardLocale}
              options={card.program.enabledLocales.map((locale) => {
                const metadata = cardLocaleMetadata(locale);
                return {
                  value: locale,
                  label: metadata ? `${metadata.englishName} · ${metadata.nativeName}` : locale,
                  ...(metadata?.aliases.length ? { searchText: metadata.aliases.join(" ") } : {}),
                };
              })}
            />
          ) : null}
          <button type="button" className="customer-language" onClick={() => void logout()}>
            <LogOut size={15} /> {ar ? "إنهاء الجلسة" : "Sign out"}
          </button>
        </div>
      </header>
      <section
        className={`digital-card ${active ? "" : "digital-card--inactive"}`}
        lang={card.program.contentLocale}
        dir={directionForCardLocale(card.program.contentLocale)}
        style={
          {
            "--card-bg": card.theme.backgroundColor,
            "--card-ink": card.theme.foregroundColor,
            "--card-accent": card.theme.accentColor,
            fontFamily: fontStackForCardLocale(card.program.contentLocale),
          } as React.CSSProperties
        }
      >
        <div className="digital-card__brand">
          <div className="digital-card__issuer">
            <CustomerMerchantIdentity
              locale={ar ? "ar" : "en"}
              logoDataUri={card.merchant.brandLogoDataUri}
              name={card.merchant.name}
              showName={false}
            />
            <div>
              <small>{card.merchant.name}</small>
              <h1>{card.program.name}</h1>
            </div>
          </div>
          <Badge tone={active ? "success" : "warning"}>
            {membershipStateLabel(card.membership.state, ar)}
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
          <strong dir="ltr" className="numeric-fraction">
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
              {ar
                ? "استخدم رمز QR هذا مع بطاقة الولاء."
                : "Use this QR code with your loyalty card."}
            </p>
          </div>
        ) : null}
      </section>
      <section className="card-actions">
        <Card>
          <div className="card-actions__heading">
            <WalletCards />
            <div>
              <h2>{ar ? "أضف إلى المحفظة" : "Add to Wallet"}</h2>
              <p>
                {ar
                  ? "ستظهر خيارات المحفظة هنا عند توفرها."
                  : "Wallet options will appear here when available."}
              </p>
            </div>
          </div>
          <div className="wallet-buttons">
            {platform === "ios" ? (
              card.wallet.apple.status === "READY" ? (
                <a
                  className="wallet-button wallet-button--apple"
                  href={`/api/waflo/v1/customer/wallet/apple/pass${tenantQuery}`}
                >
                  Add to Apple Wallet
                </a>
              ) : (
                <span className="wallet-state">
                  Apple Wallet · {walletStatusLabel(card.wallet.apple.status, ar)}
                </span>
              )
            ) : platform === "android" ? (
              card.wallet.google.status === "READY" ? (
                <Button
                  className="wallet-button wallet-button--google"
                  onClick={() => void addGoogle()}
                  loading={walletBusy === "google"}
                >
                  Add to Google Wallet
                </Button>
              ) : (
                <span className="wallet-state">
                  Google Wallet · {walletStatusLabel(card.wallet.google.status, ar)}
                </span>
              )
            ) : (
              <p className="wallet-platform-note">
                {ar
                  ? "افتح هذه البطاقة على iPhone أو Android لإضافتها إلى محفظة جهازك."
                  : "Open this card on iPhone or Android to add it to that device's wallet."}
              </p>
            )}
          </div>
        </Card>
        {card.transfer.allowed ? (
          <a
            className="transfer-action"
            href={`/transfer?${new URLSearchParams({
              lang: ar ? "ar" : "en",
              ...(tenant ? { tenant } : {}),
            }).toString()}`}
          >
            <ArrowRightLeft />
            <span>
              <strong>{ar ? "نقل البطاقة إلى جهاز آخر" : "Transfer to another device"}</strong>
              <small>
                {card.transfer.emailConfirmationRequired
                  ? ar
                    ? "يتطلب تأكيد البريد"
                    : "Email confirmation required"
                  : ar
                    ? "استخدم رمز QR الخاص ببطاقتك للمتابعة"
                    : "Use your card QR code to continue"}
              </small>
            </span>
          </a>
        ) : null}
      </section>
      <footer className="customer-footer">
        <ShieldCheck size={15} /> {ar ? "مدعوم من Waflo" : "Powered by Waflo"}
      </footer>
    </main>
  );
}
