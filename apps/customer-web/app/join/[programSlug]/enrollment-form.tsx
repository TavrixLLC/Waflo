"use client";

import { Alert, Button, Card, Checkbox, FormField, SearchableSelect, TextInput } from "@waflo/ui";
import {
  cardLocaleMetadata,
  defaultProgramTemplatePresentation,
  directionForCardLocale,
  fontStackForCardLocale,
} from "@waflo/contracts";
import { MapPin, ShieldCheck, WalletCards } from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { CustomerMerchantIdentity } from "../../customer-merchant-identity";
import { customerApi, CustomerApiError, customerCommandId } from "../../client-api";
import type { PublicMerchant, PublicProgram } from "../../server-api";

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
  const [marketing, setMarketing] = useState(false);
  const [website, setWebsite] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
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
    () => displayName.trim().length > 0 && terms && (!phoneRequired || phone.trim().length > 0),
    [displayName, phone, phoneRequired, terms],
  );

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

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError("");
    try {
      const query = tenant ? `?tenant=${encodeURIComponent(tenant)}` : "";
      const result = await customerApi<{
        membership: { publicMembershipId: string; cardUrl: string };
      }>(`/v1/public/programs/${encodeURIComponent(program.slug)}/enroll${query}`, {
        method: "POST",
        headers: { "x-idempotency-key": idempotencyKey.current },
        body: JSON.stringify({
          displayName,
          ...(phone.trim() ? { phone: phone.trim() } : {}),
          preferredLocale: interfaceLocale,
          programTermsAccepted: true,
          marketingPhoneConsent: marketing,
          formStartedAt: startedAt.current,
          website,
        }),
      });
      const cardQuery = new URLSearchParams({ wallet: "prepare" });
      if (tenant) cardQuery.set("tenant", tenant);
      window.location.assign(
        `/card/${encodeURIComponent(result.membership.publicMembershipId)}?${cardQuery.toString()}`,
      );
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

  return (
    <div className="join-layout join-layout--compact">
      <section
        className="program-story enrollment-summary"
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
          <span className="enrollment-summary__kicker">
            <WalletCards size={16} aria-hidden="true" />
            {ar
              ? "\u0628\u0637\u0627\u0642\u0629 \u0648\u0644\u0627\u0621 \u0631\u0642\u0645\u064a\u0629"
              : "DIGITAL LOYALTY CARD"}
          </span>
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
            <div className="enrollment-terms" lang={ar ? "ar" : "en"} dir={ar ? "rtl" : "ltr"}>
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
            </div>
            {/* Privacy acceptance is captured implicitly at enrollment. */}
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
