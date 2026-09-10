"use client";

import {
  cardLocaleMetadata,
  defaultProgramTemplatePresentation,
  directionForCardLocale,
  fontStackForCardLocale,
  type ProgramTemplatePresentation,
} from "@waflo/contracts";
import { Alert, Badge, Card, SearchableSelect } from "@waflo/ui";
import { ArrowRightLeft, Clock3, LogOut, ShieldCheck, WalletCards } from "lucide-react";
import Image from "next/image";
import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState } from "react";
import { CustomerApiError, customerApi } from "../../client-api";
import { CustomerMerchantIdentity } from "../../customer-merchant-identity";
import { type WalletPlatform, walletPlatform } from "../../wallet-platform";

interface CardView {
  publicMembershipId: string;
  customer: {
    displayName: string;
    preferredLocale: "en" | "ar";
    maskedPhone: string | null;
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
    template?: {
      code: string | null;
      version: number | null;
      presentation: ProgramTemplatePresentation;
      identityArtworkDataUri: string | null;
    };
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

type CardLoadOutcome = "applied" | "failed" | "superseded";

const walletConvergenceDelays = [250, 500, 1_000, 2_000, 4_000, 8_000, 8_000] as const;

function walletIsPreparing(status: string): boolean {
  return status === "PREPARING" || status === "PENDING";
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
  const [walletBusy, setWalletBusy] = useState<"google" | null>(null);
  const [platform, setPlatform] = useState<WalletPlatform | null>(null);
  const [selectedCardLocale, setSelectedCardLocale] = useState<string | undefined>();
  const [walletRetryExhausted, setWalletRetryExhausted] = useState(false);
  const [walletRefreshInFlight, setWalletRefreshInFlight] = useState(false);
  const [cardLoadInFlight, setCardLoadInFlight] = useState(false);
  const walletConvergenceAttempts = useRef(0);
  const activeCardRequest = useRef<AbortController | null>(null);
  const cardRequestGeneration = useRef(0);
  const walletRefreshGeneration = useRef(0);
  const walletRefreshInFlightRef = useRef(false);
  const mounted = useRef(false);
  const tenantQuery = tenant ? `?tenant=${encodeURIComponent(tenant)}` : "";

  useEffect(() => {
    setPlatform(walletPlatform(window.navigator.userAgent, window.navigator.maxTouchPoints));
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cardRequestGeneration.current += 1;
      walletRefreshGeneration.current += 1;
      walletRefreshInFlightRef.current = false;
      activeCardRequest.current?.abort();
      activeCardRequest.current = null;
    };
  }, []);

  const load = useCallback(
    async (localeOverride?: string): Promise<CardLoadOutcome> => {
      activeCardRequest.current?.abort();
      const controller = new AbortController();
      activeCardRequest.current = controller;
      const requestGeneration = ++cardRequestGeneration.current;
      if (mounted.current) setCardLoadInFlight(true);
      try {
        const query = new URLSearchParams();
        if (tenant) query.set("tenant", tenant);
        if (localeOverride) query.set("locale", localeOverride);
        const nextCard = await customerApi<CardView>(
          `/v1/customer/card/${encodeURIComponent(publicMembershipId)}${query.size ? `?${query.toString()}` : ""}`,
          { signal: controller.signal },
        );
        if (
          controller.signal.aborted ||
          requestGeneration !== cardRequestGeneration.current ||
          !mounted.current
        ) {
          return "superseded";
        }
        setError("");
        setCard(nextCard);
        return "applied";
      } catch (caught) {
        if (
          controller.signal.aborted ||
          requestGeneration !== cardRequestGeneration.current ||
          !mounted.current
        ) {
          return "superseded";
        }
        setError(
          caught instanceof CustomerApiError ? caught.message : "This card could not be opened.",
        );
        return "failed";
      } finally {
        if (requestGeneration === cardRequestGeneration.current) {
          activeCardRequest.current = null;
          if (mounted.current) setCardLoadInFlight(false);
        }
      }
    },
    [publicMembershipId, tenant],
  );

  useEffect(() => {
    const saved =
      window.localStorage.getItem(`waflo:card-locale:${publicMembershipId}`) ?? undefined;
    setSelectedCardLocale(saved);
    void load(saved);
    return () => {
      cardRequestGeneration.current += 1;
      walletRefreshGeneration.current += 1;
      walletRefreshInFlightRef.current = false;
      activeCardRequest.current?.abort();
      activeCardRequest.current = null;
    };
  }, [load, publicMembershipId]);

  useEffect(() => {
    if (!card || !platform || platform === "desktop") {
      walletConvergenceAttempts.current = 0;
      setWalletRetryExhausted(false);
      return;
    }
    const status = platform === "ios" ? card.wallet.apple.status : card.wallet.google.status;
    if (!walletIsPreparing(status)) {
      walletConvergenceAttempts.current = 0;
      setWalletRetryExhausted(false);
      return;
    }
    if (cardLoadInFlight || walletRetryExhausted) return;
    const attempt = walletConvergenceAttempts.current;
    if (attempt >= walletConvergenceDelays.length) {
      setWalletRetryExhausted(true);
      return;
    }
    setWalletRetryExhausted(false);
    walletConvergenceAttempts.current += 1;
    // Issuance is server-side and normally finishes while the customer reaches
    // this page. Re-read the canonical no-store card model for a bounded window
    // so navigation, not a manual reload, observes a slower initial issuance.
    const timer = window.setTimeout(
      () => void load(selectedCardLocale),
      walletConvergenceDelays[attempt],
    );
    return () => window.clearTimeout(timer);
  }, [card, cardLoadInFlight, load, platform, selectedCardLocale, walletRetryExhausted]);

  function chooseCardLocale(locale: string) {
    if (!card?.program.enabledLocales.includes(locale)) return;
    walletConvergenceAttempts.current = 0;
    walletRefreshGeneration.current += 1;
    walletRefreshInFlightRef.current = false;
    setWalletRefreshInFlight(false);
    setWalletRetryExhausted(false);
    setSelectedCardLocale(locale);
    window.localStorage.setItem(`waflo:card-locale:${publicMembershipId}`, locale);
    void load(locale);
  }

  async function checkWalletReadiness() {
    if (walletRefreshInFlightRef.current) return;
    walletRefreshInFlightRef.current = true;
    const refreshGeneration = ++walletRefreshGeneration.current;
    walletConvergenceAttempts.current = 0;
    setWalletRetryExhausted(false);
    setWalletRefreshInFlight(true);
    const outcome = await load(selectedCardLocale);
    if (!mounted.current || refreshGeneration !== walletRefreshGeneration.current) return;
    walletRefreshInFlightRef.current = false;
    setWalletRefreshInFlight(false);
    if (outcome === "failed") {
      walletConvergenceAttempts.current = walletConvergenceDelays.length;
      setWalletRetryExhausted(true);
    }
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
  const selectedWalletStatus =
    platform === "ios"
      ? card.wallet.apple.status
      : platform === "android"
        ? card.wallet.google.status
        : null;
  const waitingForWallet = Boolean(selectedWalletStatus && walletIsPreparing(selectedWalletStatus));
  const walletRetryIsExhausted = waitingForWallet && walletRetryExhausted;
  const walletDescription =
    platform === null
      ? ar
        ? "جارٍ التحقق من خيار المحفظة لهذا الجهاز."
        : "Checking the wallet option for this device."
      : platform === "desktop"
        ? ar
          ? "استخدم جهازًا محمولًا مدعومًا لإضافة بطاقتك إلى المحفظة."
          : "Use a supported mobile device to add your card to Wallet."
        : selectedWalletStatus === "READY"
          ? ar
            ? "بطاقتك جاهزة للإضافة إلى المحفظة."
            : "Your card is ready to add to Wallet."
          : waitingForWallet
            ? walletRetryIsExhausted
              ? ar
                ? "\u062a\u0633\u062a\u063a\u0631\u0642 \u0628\u0637\u0627\u0642\u062a\u0643 \u0644\u0644\u0645\u062d\u0641\u0638\u0629 \u0648\u0642\u062a\u064b\u0627 \u0623\u0637\u0648\u0644 \u0645\u0646 \u0627\u0644\u0645\u062a\u0648\u0642\u0639. \u062a\u062d\u0642\u0651\u0642 \u0645\u0631\u0629 \u0623\u062e\u0631\u0649 \u0644\u0645\u0639\u0631\u0641\u0629 \u0645\u0627 \u0625\u0630\u0627 \u0643\u0627\u0646\u062a \u062c\u0627\u0647\u0632\u0629."
                : "Your Wallet pass is taking longer than expected. Check again to see if it\u0027s ready."
              : ar
                ? "يتم تجهيز بطاقتك للمحفظة الآن، وسيظهر الزر تلقائيًا."
                : "Your Wallet pass is being prepared. The button will appear automatically."
            : ar
              ? "يتعذر إضافة هذه البطاقة إلى المحفظة حاليًا."
              : "This card cannot be added to Wallet right now.";
  const presentation = card.program.template?.presentation ?? defaultProgramTemplatePresentation;
  const identityArtworkDataUri = card.program.template?.identityArtworkDataUri ?? null;
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
        data-composition={presentation.composition}
        data-corner-treatment={presentation.cornerTreatment}
        data-density={presentation.density}
        data-motif-treatment={presentation.motifTreatment}
        data-reward-treatment={presentation.rewardTreatment}
        data-title-treatment={presentation.titleTreatment}
        data-visual-role={presentation.visualRole}
        style={
          {
            "--card-bg": card.theme.backgroundColor,
            "--card-ink": card.theme.foregroundColor,
            "--card-accent": card.theme.accentColor,
            "--card-secondary": card.theme.secondaryColor,
            fontFamily: fontStackForCardLocale(card.program.contentLocale),
          } as React.CSSProperties
        }
      >
        {identityArtworkDataUri ? (
          <span className="digital-card__motif" aria-hidden="true">
            <Image src={identityArtworkDataUri} alt="" width={96} height={96} unoptimized />
          </span>
        ) : null}
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
          {card.customer.maskedPhone ? <small>{card.customer.maskedPhone}</small> : null}
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
              <p role="status" aria-live="polite">
                {walletDescription}
              </p>
            </div>
          </div>
          <div
            className="wallet-buttons"
            aria-busy={waitingForWallet || walletRefreshInFlight || undefined}
          >
            {platform === "ios" ? (
              card.wallet.apple.status === "READY" ? (
                <a
                  className="wallet-button wallet-button--apple"
                  aria-label="Add to Apple Wallet"
                  href={`/api/waflo/v1/customer/wallet/apple/pass${tenantQuery}`}
                >
                  <Image
                    src={
                      ar
                        ? "/wallet-buttons/apple-add-to-wallet-ar.svg"
                        : "/wallet-buttons/apple-add-to-wallet-en.svg"
                    }
                    alt=""
                    width={111}
                    height={35}
                    unoptimized
                  />
                </a>
              ) : card.wallet.apple.status === "UNAVAILABLE" ? (
                <p className="wallet-platform-note">
                  {ar
                    ? "\u064a\u062a\u0639\u0630\u0631 \u0625\u0636\u0627\u0641\u0629 \u0647\u0630\u0647 \u0627\u0644\u0628\u0637\u0627\u0642\u0629 \u0625\u0644\u0649 Apple Wallet \u062d\u0627\u0644\u064a\u0627\u064b."
                    : "This card cannot be added to Apple Wallet right now."}
                </p>
              ) : waitingForWallet ? (
                walletRetryIsExhausted ? (
                  <button
                    type="button"
                    className="wallet-check-again"
                    onClick={() => void checkWalletReadiness()}
                    disabled={walletRefreshInFlight}
                    aria-busy={walletRefreshInFlight || undefined}
                  >
                    {ar
                      ? "\u062a\u062d\u0642\u0651\u0642 \u0645\u0631\u0629 \u0623\u062e\u0631\u0649"
                      : "Check again"}
                  </button>
                ) : (
                  <p className="wallet-platform-note">
                    {ar
                      ? "\u0633\u064a\u0638\u0647\u0631 \u0632\u0631 Apple Wallet \u062a\u0644\u0642\u0627\u0626\u064a\u064b\u0627 \u0639\u0646\u062f \u062c\u0627\u0647\u0632\u064a\u0629 \u0627\u0644\u0628\u0637\u0627\u0642\u0629."
                      : "The Apple Wallet button will appear automatically when your pass is ready."}
                  </p>
                )
              ) : null
            ) : platform === "android" ? (
              card.wallet.google.status === "READY" ? (
                <button
                  type="button"
                  className="wallet-button wallet-button--google"
                  onClick={() => void addGoogle()}
                  disabled={walletBusy === "google"}
                  aria-busy={walletBusy === "google" || undefined}
                  aria-label={
                    walletBusy === "google" ? "Adding to Google Wallet" : "Add to Google Wallet"
                  }
                >
                  <Image
                    src={
                      ar
                        ? "/wallet-buttons/google-add-to-wallet-ar.svg"
                        : "/wallet-buttons/google-add-to-wallet-en.svg"
                    }
                    alt=""
                    width={283}
                    height={50}
                    unoptimized
                  />
                </button>
              ) : card.wallet.google.status === "UNAVAILABLE" ? (
                <p className="wallet-platform-note">
                  {ar
                    ? "\u064a\u062a\u0639\u0630\u0631 \u0625\u0636\u0627\u0641\u0629 \u0647\u0630\u0647 \u0627\u0644\u0628\u0637\u0627\u0642\u0629 \u0625\u0644\u0649 Google Wallet \u062d\u0627\u0644\u064a\u0627\u064b."
                    : "This card cannot be added to Google Wallet right now."}
                </p>
              ) : waitingForWallet ? (
                walletRetryIsExhausted ? (
                  <button
                    type="button"
                    className="wallet-check-again"
                    onClick={() => void checkWalletReadiness()}
                    disabled={walletRefreshInFlight}
                    aria-busy={walletRefreshInFlight || undefined}
                  >
                    {ar
                      ? "\u062a\u062d\u0642\u0651\u0642 \u0645\u0631\u0629 \u0623\u062e\u0631\u0649"
                      : "Check again"}
                  </button>
                ) : (
                  <p className="wallet-platform-note">
                    {ar
                      ? "\u0633\u064a\u0638\u0647\u0631 \u0632\u0631 Google Wallet \u062a\u0644\u0642\u0627\u0626\u064a\u064b\u0627 \u0639\u0646\u062f \u062c\u0627\u0647\u0632\u064a\u0629 \u0627\u0644\u0628\u0637\u0627\u0642\u0629."
                      : "The Google Wallet button will appear automatically when your pass is ready."}
                  </p>
                )
              ) : null
            ) : (
              <p className="wallet-platform-note">
                {ar
                  ? "\u0627\u0641\u062a\u062d \u0647\u0630\u0647 \u0627\u0644\u0628\u0637\u0627\u0642\u0629 \u0639\u0644\u0649 iPhone \u0623\u0648 Android \u0644\u0625\u0636\u0627\u0641\u062a\u0647\u0627 \u0625\u0644\u0649 \u0645\u062d\u0641\u0638\u0629 \u062c\u0647\u0627\u0632\u0643."
                  : "Open this card on iPhone or Android to add it to that device\u0027s wallet."}
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
