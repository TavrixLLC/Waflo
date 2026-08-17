"use client";

import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  EmailInput,
  FormField,
  Select,
  TextInput,
} from "@waflo/ui";
import { Check, MapPin, ShieldCheck, WalletCards } from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { customerApi, CustomerApiError, customerCommandId } from "../../client-api";
import type { PublicProgram } from "../../server-api";

function walletReadiness(status: string, ar: boolean): string {
  if (status === "READY") return ar ? "جاهزة" : "Ready";
  if (status === "PREPARING") return ar ? "قيد التجهيز" : "Preparing";
  return ar ? "غير متاحة" : "Unavailable";
}

export function EnrollmentForm({
  merchant,
  program,
  initialLocale,
  tenant,
}: {
  merchant: { name: string; slug: string };
  program: PublicProgram;
  initialLocale: "en" | "ar";
  tenant?: string;
}) {
  const [locale, setLocale] = useState(initialLocale);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [website, setWebsite] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
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
  const ar = locale === "ar";
  const copy = program.translations[locale] ?? program.translations.en;
  const reward = program.rewards[program.rewards.length - 1]?.translations[locale];
  const stampPreview = program.stampPreviews[locale] ?? program.stampPreview;
  const emailRequired = program.policy.emailCollectionMode === "REQUIRED";
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
      (!emailRequired || email.trim().length > 0),
    [displayName, email, emailRequired, privacy, terms],
  );

  useEffect(() => {
    const page = document.querySelector("main.join-page");
    page?.setAttribute("lang", locale);
    page?.setAttribute("dir", locale === "ar" ? "rtl" : "ltr");
  }, [locale]);

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
          ...(program.policy.emailCollectionMode === "HIDDEN" ? {} : { email }),
          preferredLocale: locale,
          programTermsAccepted: true,
          wafloPrivacyAccepted: true,
          marketingEmailConsent: marketing,
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
    return (
      <section className="enrollment-success" aria-live="polite">
        <span className="success-icon">
          <Check />
        </span>
        <Badge tone="success">{ar ? "تم إنشاء بطاقتك" : "Your card is ready"}</Badge>
        <h1>{ar ? `أهلًا بك في ${copy?.programName}` : `Welcome to ${copy?.programName}`}</h1>
        <p>
          {ar
            ? "حُفظت بطاقتك على هذا الجهاز. يمكنك فتحها الآن ومتابعة تجهيز المحفظة."
            : "Your card is saved on this device. Open it now while Wallet prepares in the background."}
        </p>
        <a
          href={`/card/${completed.membership.publicMembershipId}${tenant ? `?tenant=${encodeURIComponent(tenant)}` : ""}`}
        >
          <Button>{ar ? "فتح بطاقتي" : "Open my card"}</Button>
        </a>
        <div className="wallet-readiness">
          <span>Apple Wallet · {walletReadiness(completed.providerStates.apple.status, ar)}</span>
          <span>Google Wallet · {walletReadiness(completed.providerStates.google.status, ar)}</span>
        </div>
      </section>
    );
  }

  return (
    <div className="join-layout">
      <section className="program-story">
        <Badge tone="brand">{merchant.name}</Badge>
        <h1>{copy?.programName}</h1>
        <p className="customer-lead">{copy?.fullDescription || copy?.shortDescription}</p>
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
          <strong dir="ltr" className="numeric-fraction">
            0 / {program.goal}
          </strong>{" "}
          {ar ? "أختام عند الانضمام" : "stamps when you join"}
        </p>
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
            <Select
              aria-label={ar ? "اللغة" : "Language"}
              value={locale}
              onChange={(event) => setLocale(event.target.value as "en" | "ar")}
            >
              <option value="en">English</option>
              <option value="ar">العربية</option>
            </Select>
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
            {program.policy.emailCollectionMode !== "HIDDEN" ? (
              <FormField
                label={ar ? "البريد الإلكتروني" : "Email"}
                hint={
                  emailRequired
                    ? ar
                      ? "مطلوب لنقل البطاقة بأمان"
                      : "Required for secure card transfer"
                    : ar
                      ? "اختياري · يساعدك في نقل البطاقة"
                      : "Optional · helps with card transfer"
                }
                required={emailRequired}
              >
                <EmailInput
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required={emailRequired}
                  maxLength={254}
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
            {program.policy.marketingConsentVisible && email ? (
              <Checkbox
                checked={marketing}
                onChange={(event) => setMarketing(event.target.checked)}
                label={
                  ar
                    ? "أرغب في تلقي رسائل تسويقية من التاجر"
                    : "I want marketing email from the merchant"
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
            <Button type="submit" loading={busy} disabled={!canSubmit}>
              {ar ? "إنشاء بطاقتي" : "Create my card"}
            </Button>
            <p className="privacy-note">
              {ar
                ? "تدير Tavrix LLC منصة Waflo، ويدير التاجر برنامج الولاء. لن نضع اسمك أو بريدك في رمز QR."
                : "Tavrix LLC operates Waflo; the merchant operates this loyalty program. Your QR never contains your name or email."}
            </p>
          </form>
        )}
      </Card>
    </div>
  );
}
