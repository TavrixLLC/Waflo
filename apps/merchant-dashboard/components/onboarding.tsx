"use client";

import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { billingCadenceCatalog, cadencePrice } from "@waflo/billing";
import { type BillingCadence, countryOptions, type PlanCode } from "@waflo/contracts";
import {
  contentLocaleForInterface,
  localeRegistry,
  messages,
  type InterfaceLocale,
  type InterfaceMessages,
} from "@waflo/i18n";
import { Alert, Button, FormField, SearchableSelect, TextInput } from "@waflo/ui";
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
import { MerchantLanguagePicker } from "./merchant-language-picker";
import { ProgramAssetPicker } from "./program-asset-uploader";
import type { AssetItem } from "./program-studio-types";

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

type OnboardingCopy = InterfaceMessages["onboarding"];

function localizedError(caught: unknown, copy: OnboardingCopy, fallback: string): string {
  if (caught instanceof ApiClientError && caught.code === "BILLING_CONFIGURATION_INCOMPLETE") {
    return copy.payment.billingConfigurationIncomplete;
  }
  return fallback;
}

function money(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount / 100);
}

function dateLabel(value: string, locale: InterfaceLocale): string {
  return new Intl.DateTimeFormat(localeRegistry[locale].dateFormattingLocale, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
}

function cadenceLabel(cadence: BillingCadence, copy: OnboardingCopy): string {
  return cadence === "monthly"
    ? copy.plan.monthly
    : cadence === "quarterly"
      ? copy.plan.quarterly
      : copy.plan.yearly;
}

function formatMessage(template: string, values: Readonly<Record<string, string>>): string {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replace(`{${key}}`, value),
    template,
  );
}

function cadenceDiscountLabel(cadence: BillingCadence): string {
  return cadence === "quarterly" ? "8.33%" : cadence === "yearly" ? "16.67%" : "";
}

function planName(plan: PlanCode, copy: OnboardingCopy): string {
  return plan === "starter"
    ? copy.plan.starterName
    : plan === "growth"
      ? copy.plan.growthName
      : copy.plan.scaleName;
}

function OnboardingShell({
  locale,
  step,
  children,
}: {
  locale: InterfaceLocale;
  step: OnboardingStep;
  children: ReactNode;
}) {
  const copy = messages[locale];
  const steps = [
    copy.onboarding.progress.organization,
    copy.onboarding.progress.plan,
    copy.onboarding.progress.billing,
    copy.onboarding.progress.card,
    copy.onboarding.progress.confirm,
  ];
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
        <MerchantLanguagePicker
          locale={locale}
          routePath="/onboarding/business"
          label={copy.language.label}
        />
      </header>
      <div className="onboarding-main">
        <nav className="onboarding-progress" aria-label={copy.onboarding.progress.ariaLabel}>
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
  locale: InterfaceLocale;
  plan: PlanCode;
  cadence: BillingCadence;
  onPlan: (value: PlanCode) => void;
  onCadence: (value: BillingCadence) => void;
  onContinue: () => void;
}) {
  const copy = messages[locale].onboarding;
  const planBenefits: Record<PlanCode, string> = {
    starter: copy.plan.starterBenefits,
    growth: copy.plan.growthBenefits,
    scale: copy.plan.scaleBenefits,
  };
  const planNames: Record<PlanCode, string> = {
    starter: copy.plan.starterName,
    growth: copy.plan.growthName,
    scale: copy.plan.scaleName,
  };
  return (
    <>
      <div className="onboarding-heading">
        <span>{copy.plan.step}</span>
        <h1>{copy.plan.title}</h1>
        <p>{copy.plan.description}</p>
      </div>
      <div className="onboarding-cadence" role="radiogroup" aria-label={copy.plan.billingCadence}>
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
              <strong>{cadenceLabel(value, copy)}</strong>
              {definition.discountRate ? (
                <small>
                  {value === "yearly" ? `${copy.plan.twoMonthsFree} ` : null}
                  {copy.plan.save} <bdi dir="ltr">{cadenceDiscountLabel(value)}</bdi>
                </small>
              ) : null}
            </label>
          );
        })}
      </div>
      <div className="onboarding-plan-grid" role="radiogroup" aria-label={copy.plan.planLabel}>
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
              <strong>{planNames[value]}</strong>
              <span className="onboarding-plan-option__price">
                <bdi dir="ltr">{money(Math.round(pricing.billedAmountUsd * 100), "USD")}</bdi>
              </span>
              <small>
                {formatMessage(copy.plan.cadenceTotal, { cadence: cadenceLabel(cadence, copy) })}
              </small>
              {cadence !== "monthly" ? (
                <small className="onboarding-plan-option__savings">
                  <bdi dir="ltr">${pricing.monthlyEquivalentUsd.toFixed(2)}</bdi>/{copy.plan.month}
                  {" · "}
                  {copy.plan.save} <bdi dir="ltr">${savings.toFixed(2)}</bdi>
                </small>
              ) : null}
              <p>{planBenefits[value]}</p>
            </label>
          );
        })}
      </div>
      <div className="onboarding-actions">
        <Button onClick={onContinue}>{copy.plan.continue}</Button>
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
  locale: InterfaceLocale;
  organizationId: string;
  billingIdentity: BillingIdentityDraft;
  billingCommand: string;
  onReady: (preview: TrialPreview) => void;
}) {
  const copy = messages[locale].onboarding;
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
      if (stripeError) setError(copy.payment.verifyCardError);
      else if (setupIntent?.status === "succeeded")
        void loadPreview(setupIntent.id).catch((caught) =>
          setError(localizedError(caught, copy, copy.payment.reviewTrialError)),
        );
    });
  }, [copy, loadPreview, stripe]);

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
      setError(copy.payment.saveCardError);
      setLoading(false);
      return;
    }
    if (result.setupIntent?.status !== "succeeded") {
      setError(copy.payment.completeVerification);
      setLoading(false);
      return;
    }
    try {
      await loadPreview(result.setupIntent.id);
    } catch (caught) {
      setError(localizedError(caught, copy, copy.payment.reviewTrialError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="onboarding-payment" onSubmit={submit}>
      {error ? <Alert tone="danger" title={error} /> : null}
      <div className="onboarding-payment__secure">
        <LockKeyhole size={18} aria-hidden="true" />
        <span>{copy.payment.secureDescription}</span>
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
        {copy.payment.saveAndReview}
      </Button>
    </form>
  );
}

export function BusinessOnboarding({
  locale,
  organizationId: initialOrganizationId,
  resumeState,
}: {
  locale: InterfaceLocale;
  organizationId?: string;
  resumeState?: string;
}) {
  const copy = messages[locale].onboarding;
  const contentLocale = contentLocaleForInterface(locale);
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
  const [logoAssets, setLogoAssets] = useState<AssetItem[]>([]);
  const [brandLogoAssetId, setBrandLogoAssetId] = useState<string | null>(null);
  const [logoNotice, setLogoNotice] = useState("");
  const [logoError, setLogoError] = useState("");
  const [firstLocation, setFirstLocation] =
    useState<LocationMapSelection>(initialLocationSelection);
  const resumed = useRef(false);
  const stripePromise = useMemo(
    () => (setup?.publishableKey ? loadStripe(setup.publishableKey) : null),
    [setup?.publishableKey],
  );
  const countries = useMemo(
    () =>
      countryOptions(contentLocale).map((option) => ({ value: option.code, label: option.name })),
    [contentLocale],
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
        throw new ApiClientError("BILLING_SETUP_INVALID", copy.payment.setupUnavailable);
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
    [copy.payment.setupUnavailable, finishCompletedTrial],
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
          setError(localizedError(caught, copy, copy.payment.resumeError));
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
  }, [copy, initialOrganizationId, preparePayment, resumeState]);

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
            result.available ? copy.organization.urlAvailable : copy.organization.urlUnavailable,
          ),
        )
        .catch(() => setAvailability(""));
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [copy.organization.urlAvailable, copy.organization.urlUnavailable, slug]);

  useEffect(() => {
    if (!organizationId || step !== 2) return;
    let active = true;
    void Promise.all([
      apiFetch<{ brandLogoAsset: AssetItem | null }>(`/v1/organizations/${organizationId}`),
      apiFetch<{ items: AssetItem[] }>(
        `/v1/organizations/${organizationId}/assets?category=LOGO&limit=30`,
      ),
    ])
      .then(([organization, assets]) => {
        if (!active) return;
        setBrandLogoAssetId(organization.brandLogoAsset?.id ?? null);
        setLogoAssets(assets.items);
        setLogoError("");
      })
      .catch(() => {
        if (active) setLogoError(copy.logo.loadError);
      });
    return () => {
      active = false;
    };
  }, [copy.logo.loadError, organizationId, step]);

  async function updateMerchantLogo(assetId: string | null): Promise<void> {
    if (!organizationId) return;
    setLogoNotice("");
    setLogoError("");
    try {
      await apiFetch(`/v1/organizations/${organizationId}`, {
        method: "PATCH",
        body: JSON.stringify({ brandLogoAssetId: assetId }),
      });
      setBrandLogoAssetId(assetId);
      if (assetId) setLogoNotice(copy.logo.saved);
    } catch {
      setLogoError(copy.logo.saveError);
    }
  }

  async function createOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      firstLocation.latitude === null ||
      firstLocation.longitude === null ||
      !firstLocation.coordinatesConfirmed ||
      !firstLocation.countryCode ||
      !firstLocation.timezone
    ) {
      setError(copy.organization.exactLocationRequired);
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
          defaultLocale: String(form.get("defaultLocale") ?? contentLocale),
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
      setError(localizedError(caught, copy, copy.organization.createError));
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
      setError(localizedError(caught, copy, copy.payment.startSetupError));
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
      setError(localizedError(caught, copy, copy.payment.startTrialError));
    } finally {
      setLoading(false);
    }
  }

  if (step === 1) {
    const recoveringLocation = Boolean(organizationId && resumeState === "location_required");
    return (
      <OnboardingShell locale={locale} step={1}>
        <div className="onboarding-heading">
          <span>{copy.organization.step}</span>
          <h1>
            {recoveringLocation
              ? copy.organization.finishLocationTitle
              : copy.organization.setupTitle}
          </h1>
          <p>
            {recoveringLocation
              ? copy.organization.finishLocationDescription
              : copy.organization.setupDescription}
          </p>
        </div>
        {error ? <Alert tone="danger" title={error} /> : null}
        <form className="onboarding-form" onSubmit={createOrganization}>
          {!recoveringLocation ? (
            <div className="dashboard-form__row">
              <FormField label={copy.organization.businessName} required>
                <TextInput
                  name="name"
                  minLength={2}
                  maxLength={120}
                  autoComplete="organization"
                  required
                />
              </FormField>
              <FormField label={copy.organization.businessType}>
                <SearchableSelect
                  name="category"
                  options={[
                    { value: "Cafe", label: copy.organization.categoryCafe },
                    { value: "Restaurant", label: copy.organization.categoryRestaurant },
                    { value: "Retail", label: copy.organization.categoryRetail },
                    { value: "Other", label: copy.organization.categoryOther },
                  ]}
                  placeholder={copy.organization.chooseType}
                />
              </FormField>
            </div>
          ) : null}
          {!recoveringLocation ? (
            <FormField label={copy.organization.merchantUrl} hint={availability} required>
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
              https://{slug || copy.organization.urlPreviewPlaceholder}.waflo.app
            </div>
          ) : null}
          <div className="dashboard-form__row">
            <FormField label={copy.organization.firstLocation} required>
              <TextInput
                name="locationName"
                minLength={2}
                placeholder={copy.organization.firstLocationPlaceholder}
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
          <input type="hidden" name="defaultLocale" value={contentLocale} />
          <Button type="submit" loading={loading} disabled={!firstLocation.coordinatesConfirmed}>
            {copy.organization.saveAndContinue}
          </Button>
        </form>
      </OnboardingShell>
    );
  }

  if (step === 2) {
    return (
      <OnboardingShell locale={locale} step={2}>
        <section className="onboarding-logo-panel" aria-labelledby="onboarding-logo-title">
          <div className="onboarding-logo-panel__heading">
            <div>
              <h2 id="onboarding-logo-title">{copy.logo.title}</h2>
              <span>{copy.logo.optional}</span>
            </div>
            <p>{copy.logo.description}</p>
            <p className="field-help">{copy.logo.settingsHint}</p>
          </div>
          {logoNotice ? <Alert tone="success" title={logoNotice} /> : null}
          {logoError ? <Alert tone="danger" title={logoError} /> : null}
          <ProgramAssetPicker
            organizationId={organizationId}
            category="LOGO"
            label={copy.logo.title}
            assets={logoAssets}
            selectedId={brandLogoAssetId}
            onSelected={(assetId) => void updateMerchantLogo(assetId)}
            onUploaded={(asset) =>
              setLogoAssets((current) => [
                asset,
                ...current.filter((existing) => existing.id !== asset.id),
              ])
            }
            ar={contentLocale === "ar"}
            interfaceLocale={locale}
          />
          <Button
            type="button"
            variant="ghost"
            onClick={() =>
              document.getElementById("onboarding-plan-section")?.scrollIntoView({
                behavior: "smooth",
                block: "start",
              })
            }
          >
            {copy.logo.skip}
          </Button>
        </section>
        <div id="onboarding-plan-section">
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
        </div>
      </OnboardingShell>
    );
  }

  if (step === 3) {
    return (
      <OnboardingShell locale={locale} step={3}>
        <div className="onboarding-heading">
          <span>{copy.billing.step}</span>
          <h1>{copy.billing.title}</h1>
          <p>{copy.billing.description}</p>
        </div>
        {error ? <Alert tone="danger" title={error} /> : null}
        <form className="onboarding-form" onSubmit={saveBilling}>
          <div className="dashboard-form__row">
            <FormField label={copy.billing.customerName} required>
              <TextInput
                name="billingName"
                defaultValue={billingIdentity?.name}
                autoComplete="organization"
                required
              />
            </FormField>
            <FormField label={copy.billing.email} required>
              <TextInput
                name="billingEmail"
                type="email"
                defaultValue={billingIdentity?.email}
                autoComplete="email"
                required
              />
            </FormField>
          </div>
          <FormField label={copy.billing.country} required>
            <SearchableSelect
              name="billingCountry"
              options={countries}
              defaultValue={billingIdentity?.countryCode ?? "IQ"}
              placeholder={copy.billing.searchCountries}
              required
            />
          </FormField>
          <FormField label={copy.billing.addressLine1} required>
            <TextInput
              name="addressLine1"
              defaultValue={billingIdentity?.addressLine1}
              autoComplete="address-line1"
              required
            />
          </FormField>
          <FormField label={copy.billing.addressLine2}>
            <TextInput
              name="addressLine2"
              defaultValue={billingIdentity?.addressLine2}
              autoComplete="address-line2"
            />
          </FormField>
          <div className="dashboard-form__row dashboard-form__row--three">
            <FormField label={copy.billing.city} required>
              <TextInput
                name="billingCity"
                defaultValue={billingIdentity?.city}
                autoComplete="address-level2"
                required
              />
            </FormField>
            <FormField label={copy.billing.region}>
              <TextInput
                name="billingRegion"
                defaultValue={billingIdentity?.region}
                autoComplete="address-level1"
              />
            </FormField>
            <FormField label={copy.billing.postalCode}>
              <TextInput
                name="postalCode"
                defaultValue={billingIdentity?.postalCode}
                autoComplete="postal-code"
              />
            </FormField>
          </div>
          <Button type="submit" loading={loading}>
            {copy.billing.continue}
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
          <span>{copy.payment.step}</span>
          <h1>{copy.payment.title}</h1>
          <p>{copy.payment.description}</p>
        </div>
        {error ? <Alert tone="danger" title={error} /> : null}
        {loading || !setup || !billingIdentity || !stripePromise || !clientSecret ? (
          <div className="onboarding-local-loading" role="status">
            {copy.payment.opening}
          </div>
        ) : (
          <Elements
            stripe={stripePromise}
            options={{
              clientSecret,
              locale: contentLocale,
              appearance: {
                theme: "stripe",
                variables: {
                  colorPrimary: "#AE3115",
                  colorText: "#241916",
                  colorBackground: "#FFFFFF",
                  colorDanger: "#C93C2B",
                  fontFamily:
                    contentLocale === "ar"
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
        <span>{copy.trial.step}</span>
        <h1>{copy.trial.title}</h1>
        <p>{copy.trial.description}</p>
      </div>
      {error ? <Alert tone="danger" title={error} /> : null}
      {preview ? (
        <div className="onboarding-trial-review">
          <div className="onboarding-trial-review__promise">
            <strong>{copy.trial.free}</strong>
            <span>
              {formatMessage(copy.trial.thenStarting, {
                amount: money(preview.amount, preview.currency),
                date: dateLabel(preview.expectedFirstChargeAt, locale),
              })}
            </span>
          </div>
          <dl>
            <div>
              <dt>{copy.trial.plan}</dt>
              <dd>{planName(preview.plan, copy)}</dd>
            </div>
            <div>
              <dt>{copy.trial.cadence}</dt>
              <dd>{cadenceLabel(preview.cadence, copy)}</dd>
            </div>
            <div>
              <dt>{copy.trial.trialStarts}</dt>
              <dd>{dateLabel(preview.expectedTrialStart, locale)}</dd>
            </div>
            <div>
              <dt>{copy.trial.firstCharge}</dt>
              <dd>
                {dateLabel(preview.expectedFirstChargeAt, locale)} ·{" "}
                {money(preview.amount, preview.currency)}
              </dd>
            </div>
            <div>
              <dt>{copy.trial.paymentMethod}</dt>
              <dd className="onboarding-card-summary">
                <CreditCard size={17} aria-hidden="true" />
                {preview.paymentMethod.brand.toUpperCase()} •••• {preview.paymentMethod.last4} ·{" "}
                {preview.paymentMethod.expMonth}/{preview.paymentMethod.expYear}
              </dd>
            </div>
          </dl>
          <p className="onboarding-trial-review__policy">{copy.trial.policy}</p>
          <div className="onboarding-policy-links">
            <a
              href={`${process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://waflo.app"}/${contentLocale}/refunds`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {copy.trial.billingRefundPolicy}
            </a>
            <a
              href={`${process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://waflo.app"}/${contentLocale}/terms`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {copy.trial.terms}
            </a>
            <a
              href={`${process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://waflo.app"}/${contentLocale}/privacy`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {copy.trial.privacy}
            </a>
          </div>
          <Button onClick={() => void startTrial()} loading={loading}>
            {copy.trial.start}
          </Button>
        </div>
      ) : (
        <Alert tone="danger" title={copy.trial.unavailable} />
      )}
    </OnboardingShell>
  );
}

export function CompletionOnboarding({
  locale,
  organizationId,
}: {
  locale: InterfaceLocale;
  organizationId?: string;
}) {
  const copy = messages[locale].onboarding;
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
        <span>{copy.completion.label}</span>
        <h1>{copy.completion.title}</h1>
        <p>{copy.completion.description}</p>
      </div>
      {result ? (
        <div className="onboarding-success-summary">
          <div>
            <span>{copy.completion.trialEnds}</span>
            <strong>{dateLabel(result.trialEnd, locale)}</strong>
          </div>
          <div>
            <span>{copy.completion.firstCharge}</span>
            <strong>{money(result.amount, result.currency)}</strong>
          </div>
          <div>
            <span>{copy.completion.card}</span>
            <strong>
              {result.paymentMethod.brand.toUpperCase()} •••• {result.paymentMethod.last4}
            </strong>
          </div>
        </div>
      ) : null}
      <div className="onboarding-success-actions">
        <Link className="wf-button wf-button--primary" href={`/${locale}/dashboard`}>
          {copy.completion.openDashboard}
        </Link>
        <Link className="wf-button wf-button--secondary" href={`/${locale}/dashboard/programs/new`}>
          {copy.completion.createLoyaltyCard}
        </Link>
      </div>
      {!organizationId ? <Alert tone="danger" title={copy.completion.missingOrganization} /> : null}
    </OnboardingShell>
  );
}
