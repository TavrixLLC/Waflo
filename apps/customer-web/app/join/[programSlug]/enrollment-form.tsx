"use client";

import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  FormField,
  SearchableSelect,
  TextInput,
} from "@waflo/ui";
import {
  cardLocaleMetadata,
  defaultProgramTemplatePresentation,
  directionForCardLocale,
  fontStackForCardLocale,
} from "@waflo/contracts";
import { Check, MapPin, ShieldCheck, WalletCards } from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { CustomerMerchantIdentity } from "../../customer-merchant-identity";
import { customerApi, CustomerApiError, customerCommandId } from "../../client-api";
import type { PublicMerchant, PublicProgram } from "../../server-api";
import { type WalletPlatform, walletPlatform } from "../../wallet-platform";

function walletReadiness(status: string, ar: boolean): string {
  if (status === "READY") return ar ? "جاهزة" : "Ready";
  if (status === "PREPARING") return ar ? "قيد التجهيز" : "Preparing";
  return ar ? "غير متاحة" : "Unavailable";
}

export function EnrollmentForm({
  merchant,
  program,
  initialLocale,
  interfaceLocale,
  tenant,
}: {
  merchant: PublicMerchant;
  program: PublicProgram;
  initialLocale: string;
  interfaceLocale: "en" | "ar";
  tenant?: string;
}) {
  const [cardLocale, setCardLocale] = useState(initialLocale);
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [website, setWebsite] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [walletBusy, setWalletBusy] = useState(false);
  const [platform, setPlatform] = useState<WalletPlatform>("desktop");
  const [completed, setCompleted] = useState<{
    membership: {
      publicMembershipId: string;
      cardUrl: string;
    };
    providerStates: {
      apple: { status: string; testAdapter: boolean };
      google: { status: string; testAdapter: boolean };
    };
  } | null>(null);
  const startedAt = useRef(Date.now());
  const idempotencyKey = useRef(customerCommandId("enroll"));
  const ar = interfaceLocale === "ar";
  const copy = program.translations[cardLocale] ?? program.translations[program.defaultLocale];
  const reward = program.rewards[program.rewards.length - 1]?.translations[cardLocale];
  const stampPreview = program.stampPreviews[cardLocale] ?? program.stampPreview;
  const presentation = program.template?.presentation ?? defaultProgramTemplatePresentation;
  const identityArtworkDataUri = program.template?.identityArtworkDataUri ?? null;
  const phoneRequired = program.policy.phoneCollectionMode === "REQUIRED";
  const enrollable = program.enrollmentStatus === "OPEN";
  const unavailableTitle =
    program.enrollmentStatus === "MERCHANT_UNAVAILABLE"
      ? ar
        ? "برنامج الولاء غير متاح مؤقتًا"
        : "This loyalty program is temporarily unavailable"
      : program.enrollmentStatus === "PROGRAM_UNAVAILABLE"
        ? ar
          ? "بطاقة الولاء غير متاحة مؤقتًا"
          : "This loyalty card is temporarily unavailable"
        : ar
          ? "التسجيل غير متاح الآن"
          : "Enrollment is not open";
  const unavailableBody =
    program.enrollmentStatus === "MERCHANT_UNAVAILABLE"
      ? ar
        ? "يمكنك عرض بطاقتك الحالية، لكن لا يمكن إنشاء عضوية جديدة الآن. حاول مرة أخرى لاحقًا."
        : "Existing members can still view their cards, but new memberships are unavailable right now. Try again later."
      : program.enrollmentStatus === "PROGRAM_UNAVAILABLE"
        ? ar
          ? "حاول مرة أخرى لاحقًا أو تواصل مع التاجر."
          : "Try again later or contact the merchant."
        : ar
          ? "يمكنك العودة لاحقًا أو التواصل مع التاجر."
          : "Return later or contact the merchant.";
  const canSubmit = useMemo(
    () =>
      displayName.trim().length > 0 &&
      terms &&
      privacy &&
      (!phoneRequired || phone.trim().length > 0),
    [displayName, phone, phoneRequired, privacy, terms],
  );

  useEffect(() => {
    setPlatform(walletPlatform(window.navigator.userAgent, window.navigator.maxTouchPoints));
  }, []);

  useEffect(() => {
    const storageKey = `waflo:card-locale:${program.slug}`;
    const saved = window.localStorage.getItem(storageKey);
    if (saved && program.enabledLocales.includes(saved)) setCardLocale(saved);
  }, [program.enabledLocales, program.slug]);

  function chooseCardLocale(nextLocale: string) {
    if (!program.enabledLocales.includes(nextLocale)) return;
    setCardLocale(nextLocale);
    window.localStorage.setItem(`waflo:card-locale:${program.slug}`, nextLocale);
    const url = new URL(window.location.href);
    url.searchParams.set("lang", nextLocale);
    window.history.replaceState(null, "", url);
  }

  async function addCompletedCardToGoogleWallet() {
    setWalletBusy(true);
    setError("");
    try {
      const query = tenant ? `?tenant=${encodeURIComponent(tenant)}` : "";
      const action = await customerApi<{ url: string }>(
        `/v1/customer/wallet/google/add-action${query}`,
        { method: "POST" },
      );
      window.location.assign(action.url);
    } catch (caught) {
      setError(
        caught instanceof CustomerApiError
          ? caught.message
          : ar
            ? "تعذر فتح Google Wallet. افتح بطاقتك وحاول مرة أخرى."
            : "Google Wallet could not be opened. Open your card and try again.",
      );
    } finally {
      setWalletBusy(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError("");
    try {
      const query = tenant ? `?tenant=${encodeURIComponent(tenant)}` : "";
      const result = await customerApi<
        typeof completed extends null ? never : NonNullable<typeof completed>
      >(`/v1/public/programs/${encodeURIComponent(program.slug)}/enroll${query}`, {
        method: "POST",
        headers: { "x-idempotency-key": idempotencyKey.current },
        body: JSON.stringify({
          displayName,
          ...(program.policy.phoneCollectionMode === "HIDDEN" ? {} : { phone }),
          preferredLocale: interfaceLocale,
          programTermsAccepted: true,
          wafloPrivacyAccepted: true,
          marketingPhoneConsent: marketing,
          formStartedAt: startedAt.current,
          website,
        }),
      });
      setCompleted(result);
    } catch (caught) {
      setError(
        caught instanceof CustomerApiError
          ? caught.message
          : ar
            ? "تعذر إكمال التسجيل."
            : "Enrollment could not be completed.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (completed) {
    const cardHref = `/card/${completed.membership.publicMembershipId}${tenant ? `?tenant=${encodeURIComponent(tenant)}` : ""}`;
    const appleReady = completed.providerStates.apple.status === "READY";
    const googleReady = completed.providerStates.google.status === "READY";
    return (
      <section className="enrollment-success" aria-live="polite">
        <span className="success-icon">
          <Check />
        </span>
        <Badge tone="success">{ar ? "تم إنشاء بطاقتك" : "Your card is ready"}</Badge>
        <h1>{ar ? `أهلًا بك في ${copy?.programName}` : `Welcome to ${copy?.programName}`}</h1>
        <p>
          {ar
            ? "حُفظت بطاقة الولاء على هذا الجهاز. أضفها إلى محفظة هاتفك عندما تكون جاهزة."
            : "Your loyalty card is saved on this device. Add it to your phone's wallet when ready."}
        </p>
        {error ? <Alert tone="danger" title={error} /> : null}
        {platform === "ios" && appleReady ? (
          <a
            className="wallet-button wallet-button--apple"
            href={`/api/waflo/v1/customer/wallet/apple/pass${tenant ? `?tenant=${encodeURIComponent(tenant)}` : ""}`}
          >
            Add to Apple Wallet
          </a>
        ) : platform === "android" && googleReady ? (
          <Button
            className="wallet-button wallet-button--google"
            onClick={() => void addCompletedCardToGoogleWallet()}
            loading={walletBusy}
          >
            Add to Google Wallet
          </Button>
        ) : (
          <a href={cardHref}>
            <Button>
              {platform === "desktop"
                ? ar
                  ? "فتح بطاقتي"
                  : "Open my card"
                : ar
                  ? "عرض البطاقة أثناء تجهيز المحفظة"
                  : "View card while Wallet prepares"}
            </Button>
          </a>
        )}
        <div className="wallet-readiness">
          <span>Apple Wallet · {walletReadiness(completed.providerStates.apple.status, ar)}</span>
          <span>Google Wallet · {walletReadiness(completed.providerStates.google.status, ar)}</span>
        </div>
      </section>
    );
  }

  return (
    <div className="join-layout">
      <section
        className="program-story"
        lang={cardLocale}
        dir={directionForCardLocale(cardLocale)}
        data-composition={presentation.composition}
        data-corner-treatment={presentation.cornerTreatment}
        data-density={presentation.density}
        data-motif-treatment={presentation.motifTreatment}
        data-reward-treatment={presentation.rewardTreatment}
        data-title-treatment={presentation.titleTreatment}
        data-visual-role={presentation.visualRole}
        style={{ fontFamily: fontStackForCardLocale(cardLocale) }}
      >
        {identityArtworkDataUri ? (
          <span className="program-story__motif" aria-hidden="true">
            <Image
              className="program-story__motif-art"
              src={identityArtworkDataUri}
              alt=""
              width={96}
              height={96}
              unoptimized
            />
          </span>
        ) : null}
        <div className="program-story__header">
          <CustomerMerchantIdentity
            className="program-story__merchant"
            locale={interfaceLocale}
            logoDataUri={merchant.brandLogoDataUri}
            name={merchant.name}
          />
          <h1>{copy?.programName}</h1>
          <p className="customer-lead">{copy?.fullDescription || copy?.shortDescription}</p>
        </div>
        <div className="program-story__progress">
          <Image
            className="published-stamp-artwork published-stamp-artwork--preview"
            src={stampPreview.dataUri}
            alt={ar ? `0 من ${program.goal} أختام` : `0 of ${program.goal} stamps`}
            width={stampPreview.width}
            height={stampPreview.height}
            unoptimized
            priority
          />
          <p className="stamp-preview-count">
            <bdi dir="ltr" className="numeric-fraction">
              0 / {program.goal}
            </bdi>{" "}
            {ar ? "أختام عند الانضمام" : "stamps when you join"}
          </p>
        </div>
        <Card className="reward-card">
          <span>{program.goal}</span>
          <div>
            <small>{ar ? "أختام للحصول على" : "stamps to unlock"}</small>
            <strong>{reward?.name ?? copy?.rewardSummary}</strong>
            <p>{reward?.description}</p>
          </div>
        </Card>
        <ul className="program-details">
          <li>
            <WalletCards />{" "}
            {copy?.joinInstructions ||
              (ar ? "بطاقة رقمية بلا تطبيق" : "A digital card with no app")}
          </li>
          <li>
            <MapPin /> {program.locations.length} {ar ? "موقع مشارك" : "participating locations"}
          </li>
          <li>
            <ShieldCheck /> {ar ? "بطاقتك جاهزة للاستخدام." : "Your card is ready to use."}
          </li>
        </ul>
      </section>
      <Card className="enrollment-card">
        <div className="enrollment-card__heading">
          <span className="customer-kicker">{ar ? "انضم الآن" : "JOIN NOW"}</span>
          <h2>{ar ? "أنشئ بطاقة الولاء" : "Create your loyalty card"}</h2>
          {program.policy.allowLocaleSelection ? (
            <SearchableSelect
              ariaLabel={ar ? "لغة محتوى البطاقة" : "Card content language"}
              value={cardLocale}
              onValueChange={chooseCardLocale}
              options={program.enabledLocales.map((enabledLocale) => {
                const metadata = cardLocaleMetadata(enabledLocale);
                return {
                  value: enabledLocale,
                  label: metadata
                    ? `${metadata.englishName} · ${metadata.nativeName}`
                    : enabledLocale,
                  ...(metadata?.aliases.length ? { searchText: metadata.aliases.join(" ") } : {}),
                };
              })}
            />
          ) : null}
        </div>
        {!enrollable ? (
          <Alert tone="warning" title={unavailableTitle}>
            {unavailableBody}
          </Alert>
        ) : (
          <form onSubmit={submit} className="enrollment-form">
            {error ? <Alert tone="danger" title={error} /> : null}
            <FormField label={ar ? "اسمك على البطاقة" : "Name on card"} required>
              <TextInput
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                autoComplete="name"
                maxLength={120}
                required
              />
            </FormField>
            {program.policy.phoneCollectionMode !== "HIDDEN" ? (
              <FormField
                label={ar ? "رقم الهاتف" : "Phone number"}
                hint={
                  phoneRequired
                    ? ar
                      ? "مطلوب للتواصل بشأن بطاقتك"
                      : "Required for your card contact"
                    : ar
                      ? "اختياري · أدخل رقمك بصيغة +964"
                      : "Optional · use +964 7XX XXX XXXX"
                }
                required={phoneRequired}
              >
                <TextInput
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="+964 7XX XXX XXXX"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  required={phoneRequired}
                  maxLength={30}
                />
              </FormField>
            ) : null}
            <Checkbox
              checked={terms}
              onChange={(event) => setTerms(event.target.checked)}
              label={
                ar
                  ? `أوافق على شروط برنامج ${copy?.programName}`
                  : `I accept the ${copy?.programName} program terms`
              }
              required
            />
            <details className="customer-terms">
              <summary>{ar ? "عرض شروط البرنامج" : "View program terms"}</summary>
              <p>{copy?.termsAndConditions}</p>
            </details>
            <Checkbox
              checked={privacy}
              onChange={(event) => setPrivacy(event.target.checked)}
              label={ar ? "أوافق على إشعار خصوصية Waflo" : "I accept the Waflo privacy notice"}
              required
            />
            {program.policy.marketingConsentVisible && phone ? (
              <Checkbox
                checked={marketing}
                onChange={(event) => setMarketing(event.target.checked)}
                label={
                  ar
                    ? "أرغب في تلقي رسائل تسويقية من التاجر"
                    : "I want marketing messages from the merchant"
                }
              />
            ) : null}
            <label className="customer-honeypot" aria-hidden="true">
              Website
              <input
                tabIndex={-1}
                autoComplete="off"
                value={website}
                onChange={(event) => setWebsite(event.target.value)}
              />
            </label>
            <Button type="submit" loading={busy}>
              {ar ? "إنشاء بطاقتي" : "Create my card"}
            </Button>
            <p className="privacy-note">
              {ar
                ? "تدير Tavrix LLC منصة Waflo، ويدير التاجر برنامج الولاء. لن تتضمن بيانات العضوية القابلة للمسح اسمك أو رقم هاتفك."
                : "Tavrix LLC operates Waflo; the merchant operates this loyalty program. Your scannable membership credential never contains your name or phone number."}
            </p>
          </form>
        )}
      </Card>
    </div>
  );
}
