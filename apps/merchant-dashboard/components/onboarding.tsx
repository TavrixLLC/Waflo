"use client";

import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { billingCadenceCatalog, cadencePrice, planCatalog } from "@waflo/billing";
import { type BillingCadence, countryOptions, type Locale, type PlanCode } from "@waflo/contracts";
import { Alert, Button, FormField, LanguageSwitcher, SearchableSelect, TextInput } from "@waflo/ui";
import { Check, CreditCard, Link2, LockKeyhole } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ApiClientError, apiFetch } from "../lib/api-client";
import {
  LocationAddressFields,
  LocationMapPicker,
  type LocationMapSelection,
} from "./location-map-picker";

type OnboardingStep = 1 | 2 | 3 | 4 | 5;

interface BillingIdentityDraft {
  name: string;
  email: string;
  countryCode: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  region: string;
  postalCode: string;
}

interface TrialSetupResponse {
  completed: boolean;
  clientSecret: string | null;
  setupIntentId: string;
  publishableKey: string;
  trialDays: 7;
  amount: number;
  currency: string;
  expectedTrialStart: string;
  expectedFirstChargeAt: string;
}

interface TrialPreview {
  plan: PlanCode;
  cadence: BillingCadence;
  trialDays: 7;
  amount: number;
  currency: string;
  expectedTrialStart: string;
  expectedFirstChargeAt: string;
  paymentMethod: {
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
  };
}

interface TrialResult {
  status: "trialing";
  trialStart: string;
  trialEnd: string;
  firstChargeAt: string;
  amount: number;
  currency: string;
  initialInvoiceAmount: 0;
  paymentMethod: TrialPreview["paymentMethod"];
}

interface WizardDraft {
  organizationId?: string;
  step?: OnboardingStep;
  plan?: PlanCode;
  cadence?: BillingCadence;
  billingIdentity?: BillingIdentityDraft;
}

const initialLocationSelection: LocationMapSelection = {
  latitude: null,
  longitude: null,
  coordinatesConfirmed: false,
  addressLine1: "",
  addressLine2: "",
  city: "",
  region: "",
  postalCode: "",
  countryCode: "",
  timezone: "",
};

const WIZARD_KEY = "waflo:onboarding-wizard";
const ORGANIZATION_COMMAND_KEY = "waflo:onboarding-organization-command";
const BILLING_COMMAND_KEY = "waflo:onboarding-billing-command";
const TRIAL_RESULT_KEY = "waflo:onboarding-trial-result";

function sessionCommand(key: string): string {
  const existing = window.sessionStorage.getItem(key);
  if (existing) return existing;
  const created = window.crypto.randomUUID();
  window.sessionStorage.setItem(key, created);
  return created;
}

function readWizard(): WizardDraft {
  try {
    return JSON.parse(window.sessionStorage.getItem(WIZARD_KEY) ?? "{}") as WizardDraft;
  } catch {
    return {};
  }
}

function writeWizard(update: Partial<WizardDraft>) {
  window.sessionStorage.setItem(WIZARD_KEY, JSON.stringify({ ...readWizard(), ...update }));
}

function localizedError(caught: unknown, ar: boolean, fallback: string): string {
  if (caught instanceof ApiClientError) return caught.message;
  return ar ? "تعذر إكمال هذه الخطوة. حاول مرة أخرى." : fallback;
}

function money(amount: number, currency: string, _locale: Locale): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount / 100);
}

function dateLabel(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-IQ-u-nu-latn" : "en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
}

function cadenceLabel(cadence: BillingCadence, locale: Locale): string {
  if (locale === "en") return billingCadenceCatalog[cadence].label;
  return cadence === "monthly" ? "شهري" : cadence === "quarterly" ? "كل 3 أشهر" : "سنوي";
}

function cadenceDiscountLabel(cadence: BillingCadence): string {
  return cadence === "quarterly" ? "8.33%" : cadence === "yearly" ? "16.67%" : "";
}

function OnboardingShell({
  locale,
  step,
  children,
}: {
  locale: Locale;
  step: OnboardingStep;
  children: ReactNode;
}) {
  const ar = locale === "ar";
  const steps = ar
    ? ["المؤسسة", "الباقة", "بيانات الدفع", "البطاقة", "التأكيد"]
    : ["Organization", "Plan", "Billing", "Card", "Confirm"];
  return (
    <main className="onboarding-shell">
      <header className="onboarding-header">
        <Image
          src="/brand/waflo-logo-white-horizontal.svg"
          alt="Waflo"
          width={140}
          height={40}
          priority
        />
        <LanguageSwitcher
          locale={locale}
          href={`/${locale === "ar" ? "en" : "ar"}/onboarding/business`}
        />
      </header>
      <div className="onboarding-main">
        <nav
          className="onboarding-progress"
          aria-label={ar ? "خطوات إنشاء الحساب" : "Signup progress"}
        >
          {steps.map((label, index) => {
            const number = (index + 1) as OnboardingStep;
            const complete = number < step;
            return (
              <div
                key={label}
                className={`onboarding-progress__item ${
                  number === step
                    ? "onboarding-progress__item--active"
                    : complete
                      ? "onboarding-progress__item--complete"
                      : ""
                }`}
                aria-current={number === step ? "step" : undefined}
              >
                <span>{complete ? <Check size={15} aria-hidden="true" /> : number}</span>
                <small>{label}</small>
              </div>
            );
          })}
        </nav>
        <section className="onboarding-card">{children}</section>
      </div>
    </main>
  );
}

function PlanStep({
  locale,
  plan,
  cadence,
  onPlan,
  onCadence,
  onContinue,
}: {
  locale: Locale;
  plan: PlanCode;
  cadence: BillingCadence;
  onPlan: (value: PlanCode) => void;
  onCadence: (value: BillingCadence) => void;
  onContinue: () => void;
}) {
  const ar = locale === "ar";
  const planBenefits: Record<PlanCode, string> = ar
    ? {
        starter: "موقع واحد، 3 أعضاء فريق، بطاقة ولاء واحدة",
        growth: "3 مواقع، 10 أعضاء فريق، بطاقات وتحليلات متقدمة",
        scale: "حدود مرنة، تصدير متقدم، ودعم للنمو",
      }
    : {
        starter: "1 location, 3 team members, 1 active loyalty card",
        growth: "3 locations, 10 team members, unlimited cards and advanced analytics",
        scale: "Flexible limits, advanced exports, and room to grow",
      };
  return (
    <>
      <div className="onboarding-heading">
        <span>{ar ? "الخطوة 2 من 5" : "Step 2 of 5"}</span>
        <h1>{ar ? "اختر الباقة المناسبة" : "Choose your plan"}</h1>
        <p>
          {ar
            ? "يمكنك تغيير الباقة لاحقاً. جميع تصاميم البطاقات متاحة في كل الباقات."
            : "You can change later. Every loyalty card template is included with every plan."}
        </p>
      </div>
      <div
        className="onboarding-cadence"
        role="radiogroup"
        aria-label={ar ? "دورة الفوترة" : "Billing cadence"}
      >
        {(["monthly", "quarterly", "yearly"] as const).map((value) => {
          const definition = billingCadenceCatalog[value];
          return (
            <label key={value} className={cadence === value ? "is-selected" : ""}>
              <input
                className="wf-sr-only"
                type="radio"
                name="billingCadence"
                value={value}
                checked={cadence === value}
                onChange={() => onCadence(value)}
              />
              <strong>{cadenceLabel(value, locale)}</strong>
              {definition.discountRate ? (
                <small>
                  {value === "yearly" ? (ar ? "شهران مجاناً · " : "2 months free · ") : null}
                  {ar ? "توفير" : "Save"} <bdi dir="ltr">{cadenceDiscountLabel(value)}</bdi>
                </small>
              ) : null}
            </label>
          );
        })}
      </div>
      <div className="onboarding-plan-grid" role="radiogroup" aria-label={ar ? "الباقة" : "Plan"}>
        {(["starter", "growth", "scale"] as const).map((value) => {
          const pricing = cadencePrice(value, cadence);
          const savings = pricing.undiscountedAmountUsd - pricing.billedAmountUsd;
          return (
            <label
              key={value}
              className={`onboarding-plan-option ${plan === value ? "is-selected" : ""}`}
            >
              <input
                className="wf-sr-only"
                type="radio"
                name="plan"
                value={value}
                checked={plan === value}
                onChange={() => onPlan(value)}
              />
              <span className="onboarding-plan-option__check" aria-hidden="true">
                <Check size={16} />
              </span>
              <strong>
                <bdi dir="ltr">{planCatalog[value].name}</bdi>
              </strong>
              <span className="onboarding-plan-option__price">
                <bdi dir="ltr">
                  {money(Math.round(pricing.billedAmountUsd * 100), "USD", locale)}
                </bdi>
              </span>
              <small>
                {ar
                  ? `إجمالي ${cadenceLabel(cadence, locale)}`
                  : `${cadenceLabel(cadence, locale)} total`}
              </small>
              {cadence !== "monthly" ? (
                <small className="onboarding-plan-option__savings">
                  <bdi dir="ltr">${pricing.monthlyEquivalentUsd.toFixed(2)}</bdi>/
                  {ar ? "شهر" : "month"}
                  {" · "}
                  {ar ? "وفّر" : "Save"} <bdi dir="ltr">${savings.toFixed(2)}</bdi>
                </small>
              ) : null}
              <p>{planBenefits[value]}</p>
            </label>
          );
        })}
      </div>
      <div className="onboarding-actions">
        <Button onClick={onContinue}>{ar ? "متابعة" : "Continue"}</Button>
      </div>
    </>
  );
}

function SecurePaymentForm({
  locale,
  organizationId,
  billingIdentity,
  billingCommand,
  onReady,
}: {
  locale: Locale;
  organizationId: string;
  billingIdentity: BillingIdentityDraft;
  billingCommand: string;
  onReady: (preview: TrialPreview) => void;
}) {
  const ar = locale === "ar";
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const returnedIntentChecked = useRef(false);

  const loadPreview = useCallback(
    async (setupIntentId: string) => {
      const preview = await apiFetch<TrialPreview>(
        `/v1/organizations/${organizationId}/billing/trial/preview`,
        {
          method: "POST",
          headers: { "x-idempotency-key": billingCommand },
          body: JSON.stringify({ setupIntentId }),
        },
      );
      onReady(preview);
    },
    [billingCommand, onReady, organizationId],
  );

  useEffect(() => {
    if (!stripe || returnedIntentChecked.current) return;
    const returnedSecret = new URLSearchParams(window.location.search).get(
      "setup_intent_client_secret",
    );
    if (!returnedSecret) return;
    returnedIntentChecked.current = true;
    void stripe.retrieveSetupIntent(returnedSecret).then(({ setupIntent, error: stripeError }) => {
      if (stripeError)
        setError(
          stripeError.message ?? (ar ? "تعذر التحقق من البطاقة." : "Unable to verify the card."),
        );
      else if (setupIntent?.status === "succeeded")
        void loadPreview(setupIntent.id).catch((caught) =>
          setError(localizedError(caught, ar, "Unable to review your trial.")),
        );
    });
  }, [ar, loadPreview, stripe]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stripe || !elements) return;
    setLoading(true);
    setError("");
    const result = await stripe.confirmSetup({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/${locale}/onboarding/business?organization=${organizationId}`,
        payment_method_data: {
          billing_details: {
            name: billingIdentity.name,
            email: billingIdentity.email,
            address: {
              country: billingIdentity.countryCode,
              line1: billingIdentity.addressLine1,
              line2: billingIdentity.addressLine2 || null,
              city: billingIdentity.city,
              state: billingIdentity.region || null,
              postal_code: billingIdentity.postalCode || null,
            },
          },
        },
      },
      redirect: "if_required",
    });
    if (result.error) {
      setError(result.error.message ?? (ar ? "تعذر حفظ البطاقة." : "Unable to save the card."));
      setLoading(false);
      return;
    }
    if (result.setupIntent?.status !== "succeeded") {
      setError(ar ? "أكمل التحقق من البطاقة للمتابعة." : "Complete card verification to continue.");
      setLoading(false);
      return;
    }
    try {
      await loadPreview(result.setupIntent.id);
    } catch (caught) {
      setError(localizedError(caught, ar, "Unable to review your trial."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="onboarding-payment" onSubmit={submit}>
      {error ? <Alert tone="danger" title={error} /> : null}
      <div className="onboarding-payment__secure">
        <LockKeyhole size={18} aria-hidden="true" />
        <span>
          {ar
            ? "تتم معالجة بيانات البطاقة بأمان بواسطة Stripe. لا تحفظ Waflo رقم البطاقة أو رمز CVC."
            : "Stripe securely handles your card details. Waflo never stores the card number or CVC."}
        </span>
      </div>
      <div className="onboarding-payment__element">
        <PaymentElement
          options={{
            layout: "tabs",
            fields: { billingDetails: "never" },
          }}
        />
      </div>
      <Button type="submit" loading={loading} disabled={!stripe || !elements}>
        {ar ? "حفظ البطاقة ومراجعة التجربة" : "Save card and review trial"}
      </Button>
    </form>
  );
}

export function BusinessOnboarding({
  locale,
  organizationId: initialOrganizationId,
  resumeState,
}: {
  locale: Locale;
  organizationId?: string;
  resumeState?: string;
}) {
  const ar = locale === "ar";
  const router = useRouter();
  const [step, setStep] = useState<OnboardingStep>(1);
  const [organizationId, setOrganizationId] = useState(initialOrganizationId ?? "");
  const [plan, setPlan] = useState<PlanCode>("starter");
  const [cadence, setCadence] = useState<BillingCadence>("monthly");
  const [billingIdentity, setBillingIdentity] = useState<BillingIdentityDraft | null>(null);
  const [setup, setSetup] = useState<TrialSetupResponse | null>(null);
  const [preview, setPreview] = useState<TrialPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [slug, setSlug] = useState("");
  const [availability, setAvailability] = useState("");
  const [firstLocation, setFirstLocation] =
    useState<LocationMapSelection>(initialLocationSelection);
  const resumed = useRef(false);
  const stripePromise = useMemo(
    () => (setup?.publishableKey ? loadStripe(setup.publishableKey) : null),
    [setup?.publishableKey],
  );
  const countries = useMemo(
    () => countryOptions(locale).map((option) => ({ value: option.code, label: option.name })),
    [locale],
  );

  const finishCompletedTrial = useCallback(
    async (currentOrganizationId: string, setupIntentId: string, billingCommand: string) => {
      const result = await apiFetch<TrialResult>(
        `/v1/organizations/${currentOrganizationId}/billing/trial/complete`,
        {
          method: "POST",
          headers: { "x-idempotency-key": billingCommand },
          body: JSON.stringify({ setupIntentId }),
        },
      );
      await apiFetch(`/v1/organizations/${currentOrganizationId}/complete-onboarding`, {
        method: "POST",
      });
      window.sessionStorage.setItem(TRIAL_RESULT_KEY, JSON.stringify(result));
      writeWizard({ step: 5 });
      router.replace(`/${locale}/onboarding/complete?organization=${currentOrganizationId}`);
    },
    [locale, router],
  );

  const preparePayment = useCallback(
    async (
      currentOrganizationId: string,
      currentPlan: PlanCode,
      currentCadence: BillingCadence,
      identity: BillingIdentityDraft,
    ) => {
      const billingCommand = sessionCommand(BILLING_COMMAND_KEY);
      const response = await apiFetch<TrialSetupResponse>(
        `/v1/organizations/${currentOrganizationId}/billing/trial/setup`,
        {
          method: "POST",
          headers: { "x-idempotency-key": billingCommand },
          body: JSON.stringify({
            plan: currentPlan,
            cadence: currentCadence,
            billingIdentity: identity,
          }),
        },
      );
      if (response.completed) {
        await finishCompletedTrial(currentOrganizationId, response.setupIntentId, billingCommand);
        return;
      }
      if (!response.clientSecret) {
        throw new ApiClientError(
          "BILLING_SETUP_INVALID",
          ar ? "تعذر فتح نموذج البطاقة." : "Unable to open secure card setup.",
        );
      }
      setSetup(response);
      setStep(4);
      writeWizard({
        organizationId: currentOrganizationId,
        plan: currentPlan,
        cadence: currentCadence,
        billingIdentity: identity,
        step: 4,
      });
    },
    [ar, finishCompletedTrial],
  );

  useEffect(() => {
    if (resumed.current) return;
    resumed.current = true;
    const draft = readWizard();
    const currentOrganizationId = initialOrganizationId ?? draft.organizationId ?? "";
    const currentPlan = draft.plan ?? "starter";
    const currentCadence = draft.cadence ?? "monthly";
    setOrganizationId(currentOrganizationId);
    setPlan(currentPlan);
    setCadence(currentCadence);
    if (draft.billingIdentity) setBillingIdentity(draft.billingIdentity);
    if (currentOrganizationId && draft.billingIdentity && (draft.step ?? 2) >= 4) {
      setLoading(true);
      void preparePayment(currentOrganizationId, currentPlan, currentCadence, draft.billingIdentity)
        .catch((caught) => {
          setStep(3);
          setError(localizedError(caught, ar, "Unable to resume secure payment setup."));
        })
        .finally(() => setLoading(false));
    } else if (currentOrganizationId) {
      const authoritativeResumeStep =
        resumeState === "location_required"
          ? 1
          : [
                "billing_identity_required",
                "payment_method_required",
                "trial_confirmation_required",
              ].includes(resumeState ?? "")
            ? 3
            : 2;
      setStep(authoritativeResumeStep as OnboardingStep);
    }
  }, [ar, initialOrganizationId, preparePayment, resumeState]);

  useEffect(() => {
    if (slug.length < 3) {
      setAvailability("");
      return;
    }
    const timeout = window.setTimeout(() => {
      void apiFetch<{ available: boolean }>(
        `/v1/public/merchant-slug/availability?slug=${encodeURIComponent(slug)}`,
      )
        .then((result) =>
          setAvailability(
            result.available
              ? ar
                ? "الرابط متاح"
                : "URL is available"
              : ar
                ? "الرابط غير متاح"
                : "URL is unavailable",
          ),
        )
        .catch(() => setAvailability(""));
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [ar, slug]);

  async function createOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      firstLocation.latitude === null ||
      firstLocation.longitude === null ||
      !firstLocation.coordinatesConfirmed ||
      !firstLocation.countryCode ||
      !firstLocation.timezone
    ) {
      setError(
        ar
          ? "حدّد موقع الفرع الأول بدقة على الخريطة ثم أكّده."
          : "Choose the exact first location on the map and confirm it.",
      );
      return;
    }
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      if (organizationId && resumeState === "location_required") {
        await apiFetch(`/v1/organizations/${organizationId}/locations`, {
          method: "POST",
          body: JSON.stringify({
            name: String(form.get("locationName") ?? ""),
            addressLine1: firstLocation.addressLine1 || undefined,
            addressLine2: firstLocation.addressLine2 || undefined,
            city: firstLocation.city || undefined,
            region: firstLocation.region || undefined,
            postalCode: firstLocation.postalCode || undefined,
            countryCode: firstLocation.countryCode,
            timezone: firstLocation.timezone,
            latitude: firstLocation.latitude,
            longitude: firstLocation.longitude,
            coordinatesConfirmed: true,
          }),
        });
        setStep(2);
        writeWizard({ organizationId, step: 2, plan, cadence });
        return;
      }
      const organization = await apiFetch<{ id: string }>("/v1/organizations", {
        method: "POST",
        body: JSON.stringify({
          name: String(form.get("name") ?? ""),
          merchantSlug: slug,
          businessCategory: String(form.get("category") ?? "") || undefined,
          defaultLocale: String(form.get("defaultLocale") ?? locale),
          timezone: firstLocation.timezone,
          selectedPlan: "starter",
          commandId: sessionCommand(ORGANIZATION_COMMAND_KEY),
          firstLocation: {
            name: String(form.get("locationName") ?? ""),
            addressLine1: firstLocation.addressLine1 || undefined,
            addressLine2: firstLocation.addressLine2 || undefined,
            city: firstLocation.city || undefined,
            region: firstLocation.region || undefined,
            postalCode: firstLocation.postalCode || undefined,
            countryCode: firstLocation.countryCode,
            timezone: firstLocation.timezone,
            latitude: firstLocation.latitude,
            longitude: firstLocation.longitude,
            coordinatesConfirmed: true,
          },
        }),
      });
      setOrganizationId(organization.id);
      setStep(2);
      writeWizard({ organizationId: organization.id, step: 2, plan, cadence });
      window.history.replaceState(
        null,
        "",
        `/${locale}/onboarding/business?organization=${organization.id}`,
      );
    } catch (caught) {
      setError(localizedError(caught, ar, "Unable to create your organization."));
    } finally {
      setLoading(false);
    }
  }

  async function saveBilling(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) return;
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const identity: BillingIdentityDraft = {
      name: String(form.get("billingName") ?? ""),
      email: String(form.get("billingEmail") ?? ""),
      countryCode: String(form.get("billingCountry") ?? "IQ"),
      addressLine1: String(form.get("addressLine1") ?? ""),
      addressLine2: String(form.get("addressLine2") ?? ""),
      city: String(form.get("billingCity") ?? ""),
      region: String(form.get("billingRegion") ?? ""),
      postalCode: String(form.get("postalCode") ?? ""),
    };
    setBillingIdentity(identity);
    try {
      await preparePayment(organizationId, plan, cadence, identity);
    } catch (caught) {
      setError(localizedError(caught, ar, "Unable to start secure payment setup."));
    } finally {
      setLoading(false);
    }
  }

  async function startTrial() {
    if (!organizationId || !setup || !preview) return;
    setLoading(true);
    setError("");
    try {
      await finishCompletedTrial(
        organizationId,
        setup.setupIntentId,
        sessionCommand(BILLING_COMMAND_KEY),
      );
    } catch (caught) {
      setError(localizedError(caught, ar, "Unable to start your trial."));
    } finally {
      setLoading(false);
    }
  }

  if (step === 1) {
    const recoveringLocation = Boolean(organizationId && resumeState === "location_required");
    return (
      <OnboardingShell locale={locale} step={1}>
        <div className="onboarding-heading">
          <span>{ar ? "الخطوة 1 من 5" : "Step 1 of 5"}</span>
          <h1>
            {recoveringLocation
              ? ar
                ? "أكمل إعداد موقعك"
                : "Finish setting up your location"
              : ar
                ? "أخبرنا عن نشاطك"
                : "Set up your organization"}
          </h1>
          <p>
            {recoveringLocation
              ? ar
                ? "أضف أول فرع للمتابعة إلى إعداد الفوترة."
                : "Add your first location to continue to billing setup."
              : ar
                ? "أضف المعلومات الأساسية وأول فرع. يمكنك تعديلها لاحقاً."
                : "Add the essentials and your first location. You can edit them later."}
          </p>
        </div>
        {error ? <Alert tone="danger" title={error} /> : null}
        <form className="onboarding-form" onSubmit={createOrganization}>
          {!recoveringLocation ? (
            <div className="dashboard-form__row">
              <FormField label={ar ? "اسم النشاط" : "Business name"} required>
                <TextInput
                  name="name"
                  minLength={2}
                  maxLength={120}
                  autoComplete="organization"
                  required
                />
              </FormField>
              <FormField label={ar ? "نوع النشاط" : "Business type"}>
                <SearchableSelect
                  name="category"
                  options={
                    ar
                      ? [
                          { value: "Cafe", label: "مقهى" },
                          { value: "Restaurant", label: "مطعم" },
                          { value: "Retail", label: "متجر" },
                          { value: "Other", label: "أخرى" },
                        ]
                      : [
                          { value: "Cafe", label: "Cafe" },
                          { value: "Restaurant", label: "Restaurant" },
                          { value: "Retail", label: "Retail" },
                          { value: "Other", label: "Other" },
                        ]
                  }
                  placeholder={ar ? "اختر النوع" : "Choose a type"}
                />
              </FormField>
            </div>
          ) : null}
          {!recoveringLocation ? (
            <FormField label={ar ? "رابط نشاطك" : "Merchant URL"} hint={availability} required>
              <TextInput
                name="slug"
                value={slug}
                onChange={(event) =>
                  setSlug(
                    event.currentTarget.value.toLocaleLowerCase("en-US").replace(/[^a-z0-9-]/g, ""),
                  )
                }
                minLength={3}
                maxLength={40}
                dir="ltr"
                required
              />
            </FormField>
          ) : null}
          {!recoveringLocation ? (
            <div className="onboarding-url" dir="ltr">
              <Link2 size={17} aria-hidden="true" />
              https://{slug || "your-business"}.waflo.app
            </div>
          ) : null}
          <div className="dashboard-form__row">
            <FormField label={ar ? "اسم الفرع الأول" : "First location"} required>
              <TextInput
                name="locationName"
                minLength={2}
                placeholder={ar ? "مثلاً: فرع المنصور" : "e.g. Downtown"}
                required
              />
            </FormField>
          </div>
          <LocationMapPicker locale={locale} value={firstLocation} onChange={setFirstLocation} />
          <LocationAddressFields
            locale={locale}
            value={firstLocation}
            onChange={setFirstLocation}
          />
          <input type="hidden" name="defaultLocale" value={locale} />
          <Button type="submit" loading={loading} disabled={!firstLocation.coordinatesConfirmed}>
            {ar ? "حفظ ومتابعة" : "Save and continue"}
          </Button>
        </form>
      </OnboardingShell>
    );
  }

  if (step === 2) {
    return (
      <OnboardingShell locale={locale} step={2}>
        <PlanStep
          locale={locale}
          plan={plan}
          cadence={cadence}
          onPlan={setPlan}
          onCadence={setCadence}
          onContinue={() => {
            setStep(3);
            writeWizard({ organizationId, plan, cadence, step: 3 });
          }}
        />
      </OnboardingShell>
    );
  }

  if (step === 3) {
    return (
      <OnboardingShell locale={locale} step={3}>
        <div className="onboarding-heading">
          <span>{ar ? "الخطوة 3 من 5" : "Step 3 of 5"}</span>
          <h1>{ar ? "بيانات الفوترة" : "Billing details"}</h1>
          <p>
            {ar
              ? "تظهر هذه المعلومات في فواتيرك ويمكنك تعديلها لاحقاً."
              : "These details appear on your invoices and can be updated later."}
          </p>
        </div>
        {error ? <Alert tone="danger" title={error} /> : null}
        <form className="onboarding-form" onSubmit={saveBilling}>
          <div className="dashboard-form__row">
            <FormField
              label={ar ? "اسم المؤسسة أو العميل" : "Customer or organization name"}
              required
            >
              <TextInput
                name="billingName"
                defaultValue={billingIdentity?.name}
                autoComplete="organization"
                required
              />
            </FormField>
            <FormField label={ar ? "بريد الفوترة" : "Billing email"} required>
              <TextInput
                name="billingEmail"
                type="email"
                defaultValue={billingIdentity?.email}
                autoComplete="email"
                required
              />
            </FormField>
          </div>
          <FormField label={ar ? "البلد" : "Billing country"} required>
            <SearchableSelect
              name="billingCountry"
              options={countries}
              defaultValue={billingIdentity?.countryCode ?? "IQ"}
              placeholder={ar ? "ابحث عن بلد" : "Search countries"}
              required
            />
          </FormField>
          <FormField label={ar ? "العنوان" : "Address line 1"} required>
            <TextInput
              name="addressLine1"
              defaultValue={billingIdentity?.addressLine1}
              autoComplete="address-line1"
              required
            />
          </FormField>
          <FormField label={ar ? "العنوان الإضافي (اختياري)" : "Address line 2 (optional)"}>
            <TextInput
              name="addressLine2"
              defaultValue={billingIdentity?.addressLine2}
              autoComplete="address-line2"
            />
          </FormField>
          <div className="dashboard-form__row dashboard-form__row--three">
            <FormField label={ar ? "المدينة" : "City"} required>
              <TextInput
                name="billingCity"
                defaultValue={billingIdentity?.city}
                autoComplete="address-level2"
                required
              />
            </FormField>
            <FormField label={ar ? "المحافظة / المنطقة" : "State / region"}>
              <TextInput
                name="billingRegion"
                defaultValue={billingIdentity?.region}
                autoComplete="address-level1"
              />
            </FormField>
            <FormField label={ar ? "الرمز البريدي" : "Postal code"}>
              <TextInput
                name="postalCode"
                defaultValue={billingIdentity?.postalCode}
                autoComplete="postal-code"
              />
            </FormField>
          </div>
          <Button type="submit" loading={loading}>
            {ar ? "متابعة إلى البطاقة" : "Continue to payment"}
          </Button>
        </form>
      </OnboardingShell>
    );
  }

  if (step === 4) {
    const clientSecret = setup?.clientSecret ?? null;
    return (
      <OnboardingShell locale={locale} step={4}>
        <div className="onboarding-heading">
          <span>{ar ? "الخطوة 4 من 5" : "Step 4 of 5"}</span>
          <h1>{ar ? "أضف طريقة الدفع" : "Add your payment method"}</h1>
          <p>
            {ar
              ? "لن يتم خصم أي مبلغ اليوم. نحتاج البطاقة لبدء التجربة المجانية وإجراء الدفعات المستقبلية."
              : "You will not be charged today. A card is required for the free trial and future subscription payments."}
          </p>
        </div>
        {error ? <Alert tone="danger" title={error} /> : null}
        {loading || !setup || !billingIdentity || !stripePromise || !clientSecret ? (
          <div className="onboarding-local-loading" role="status">
            {ar ? "جارٍ فتح نموذج الدفع الآمن…" : "Opening secure payment form…"}
          </div>
        ) : (
          <Elements
            stripe={stripePromise}
            options={{
              clientSecret,
              locale: ar ? "ar" : "en",
              appearance: {
                theme: "stripe",
                variables: {
                  colorPrimary: "#AE3115",
                  colorText: "#241916",
                  colorBackground: "#FFFFFF",
                  colorDanger: "#C93C2B",
                  fontFamily: ar
                    ? "Cairo, system-ui, sans-serif"
                    : "Manrope, system-ui, sans-serif",
                  borderRadius: "8px",
                  spacingUnit: "4px",
                },
                rules: {
                  ".Input": { border: "1px solid #DCCFC9", boxShadow: "none" },
                  ".Input:focus": {
                    border: "1px solid #AE3115",
                    boxShadow: "0 0 0 3px rgba(174,49,21,.14)",
                  },
                },
              },
            }}
          >
            <SecurePaymentForm
              locale={locale}
              organizationId={organizationId}
              billingIdentity={billingIdentity}
              billingCommand={sessionCommand(BILLING_COMMAND_KEY)}
              onReady={(value) => {
                setPreview(value);
                setStep(5);
                writeWizard({ step: 5 });
              }}
            />
          </Elements>
        )}
      </OnboardingShell>
    );
  }

  return (
    <OnboardingShell locale={locale} step={5}>
      <div className="onboarding-heading">
        <span>{ar ? "الخطوة 5 من 5" : "Step 5 of 5"}</span>
        <h1>{ar ? "راجع تجربتك المجانية" : "Review your free trial"}</h1>
        <p>
          {ar
            ? "راجع المبلغ والتاريخ قبل البدء. يمكنك الإلغاء من صفحة الفوترة."
            : "Check the amount and date before you start. You can cancel from Billing."}
        </p>
      </div>
      {error ? <Alert tone="danger" title={error} /> : null}
      {preview ? (
        <div className="onboarding-trial-review">
          <div className="onboarding-trial-review__promise">
            <strong>{ar ? "7 أيام مجاناً" : "7 days free"}</strong>
            <span>
              {ar
                ? `ثم ${money(preview.amount, preview.currency, locale)} ابتداءً من ${dateLabel(preview.expectedFirstChargeAt, locale)}`
                : `Then ${money(preview.amount, preview.currency, locale)} starting ${dateLabel(preview.expectedFirstChargeAt, locale)}`}
            </span>
          </div>
          <dl>
            <div>
              <dt>{ar ? "الباقة" : "Plan"}</dt>
              <dd>
                <bdi dir="ltr">{planCatalog[preview.plan].name}</bdi>
              </dd>
            </div>
            <div>
              <dt>{ar ? "دورة الفوترة" : "Cadence"}</dt>
              <dd>{cadenceLabel(preview.cadence, locale)}</dd>
            </div>
            <div>
              <dt>{ar ? "بداية التجربة" : "Trial starts"}</dt>
              <dd>{dateLabel(preview.expectedTrialStart, locale)}</dd>
            </div>
            <div>
              <dt>{ar ? "أول دفعة" : "First charge"}</dt>
              <dd>
                {dateLabel(preview.expectedFirstChargeAt, locale)} ·{" "}
                {money(preview.amount, preview.currency, locale)}
              </dd>
            </div>
            <div>
              <dt>{ar ? "طريقة الدفع" : "Payment method"}</dt>
              <dd className="onboarding-card-summary">
                <CreditCard size={17} aria-hidden="true" />
                {preview.paymentMethod.brand.toUpperCase()} •••• {preview.paymentMethod.last4} ·{" "}
                {preview.paymentMethod.expMonth}/{preview.paymentMethod.expYear}
              </dd>
            </div>
          </dl>
          <p className="onboarding-trial-review__policy">
            {ar
              ? "لن يتم خصم أي مبلغ اليوم. إذا لم تُلغِ قبل نهاية التجربة، سيتم تحصيل المبلغ الموضح أعلاه تلقائياً."
              : "Nothing is charged today. Unless you cancel before the trial ends, the amount above will be charged automatically."}
          </p>
          <div className="onboarding-policy-links">
            <a
              href={`${process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://waflo.app"}/${locale}/refunds`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {ar ? "سياسة الفوترة والاسترداد" : "Billing & Refund Policy"}
            </a>
            <a
              href={`${process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://waflo.app"}/${locale}/terms`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {ar ? "الشروط" : "Terms"}
            </a>
            <a
              href={`${process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://waflo.app"}/${locale}/privacy`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {ar ? "الخصوصية" : "Privacy"}
            </a>
          </div>
          <Button onClick={() => void startTrial()} loading={loading}>
            {ar ? "ابدأ التجربة المجانية لمدة 7 أيام" : "Start 7-day free trial"}
          </Button>
        </div>
      ) : (
        <Alert
          tone="danger"
          title={ar ? "تعذر تحميل ملخص التجربة." : "Trial review is unavailable."}
        />
      )}
    </OnboardingShell>
  );
}

export function CompletionOnboarding({
  locale,
  organizationId,
}: {
  locale: Locale;
  organizationId?: string;
}) {
  const ar = locale === "ar";
  const [result, setResult] = useState<TrialResult | null>(null);
  useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem(TRIAL_RESULT_KEY);
      if (stored) setResult(JSON.parse(stored) as TrialResult);
    } catch {
      setResult(null);
    }
  }, []);
  return (
    <OnboardingShell locale={locale} step={5}>
      <div className="onboarding-success-mark" aria-hidden="true">
        <Check size={30} />
      </div>
      <div className="onboarding-heading onboarding-heading--center">
        <span>{ar ? "تم إعداد حسابك" : "Setup complete"}</span>
        <h1>{ar ? "بدأت تجربتك المجانية" : "Your free trial has started"}</h1>
        <p>
          {ar
            ? "أصبح حساب Waflo جاهزاً. سنرسل تذكيراً قبل أول دفعة بيومين."
            : "Waflo is ready. We will remind you two days before the first charge."}
        </p>
      </div>
      {result ? (
        <div className="onboarding-success-summary">
          <div>
            <span>{ar ? "تنتهي التجربة" : "Trial ends"}</span>
            <strong>{dateLabel(result.trialEnd, locale)}</strong>
          </div>
          <div>
            <span>{ar ? "أول دفعة" : "First charge"}</span>
            <strong>{money(result.amount, result.currency, locale)}</strong>
          </div>
          <div>
            <span>{ar ? "البطاقة" : "Card"}</span>
            <strong>
              {result.paymentMethod.brand.toUpperCase()} •••• {result.paymentMethod.last4}
            </strong>
          </div>
        </div>
      ) : null}
      <div className="onboarding-success-actions">
        <Link className="wf-button wf-button--primary" href={`/${locale}/dashboard`}>
          {ar ? "فتح لوحة التحكم" : "Open dashboard"}
        </Link>
        <Link className="wf-button wf-button--secondary" href={`/${locale}/dashboard/programs/new`}>
          {ar ? "إنشاء بطاقة ولاء" : "Create loyalty card"}
        </Link>
      </div>
      {!organizationId ? (
        <Alert
          tone="danger"
          title={ar ? "تعذر العثور على المؤسسة." : "Organization context is missing."}
        />
      ) : null}
    </OnboardingShell>
  );
}
