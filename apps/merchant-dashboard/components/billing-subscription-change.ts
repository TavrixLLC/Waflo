import { formatCurrencyMinor } from "@waflo/billing";
import { billingCadences, type BillingCadence, type Locale, type PlanCode } from "@waflo/contracts";

export const subscriptionChangeCadences = billingCadences;
export const SUBSCRIPTION_CHANGE_CONVERGENCE_REFRESH_MS = 2_000;

export interface BillingSubscriptionSummary {
  id: string;
  status: string;
  planCode: string;
  createdAt: string;
}

export interface SubscriptionChangePreview {
  previewId: string;
  current: {
    plan: PlanCode;
    cadence: BillingCadence;
    amountMinor: string;
    currency: string;
  };
  target: {
    plan: PlanCode;
    cadence: BillingCadence;
    amountMinor: string;
    currency: string;
  };
  proration: {
    amountDueNow: string;
    creditAmount: string;
    nextRenewalAmount: string | null;
    nextRenewalAt: string | null;
    lines: Array<{ amountMinor: number; currency: string; description: string | null }>;
  };
  expiresAt: string;
}

export interface SubscriptionChangeConfirmation {
  previewId: string;
  status: "CONFIRMED";
  change: {
    fromPlan: PlanCode;
    fromCadence: BillingCadence;
    toPlan: PlanCode;
    toCadence: BillingCadence;
    currency: string;
    targetAmountMinor: string;
  };
  confirmedAt: string;
  providerState: { subscriptionStatus: string };
}

type ApiRequest = <T>(path: string, options?: RequestInit) => Promise<T>;

const changeableStatuses = new Set(["ACTIVE", "TRIALING"]);

export const staleSubscriptionChangeCodes = new Set([
  "SUBSCRIPTION_CHANGE_PREVIEW_EXPIRED",
  "SUBSCRIPTION_CHANGE_PREVIEW_INVALIDATED",
  "SUBSCRIPTION_CHANGE_STATE_CHANGED",
  "SUBSCRIPTION_CHANGE_PRICING_MARKET_CHANGED",
  "SUBSCRIPTION_CHANGE_TARGET_PRICING_CHANGED",
  "SUBSCRIPTION_CHANGE_PREVIEW_STALE",
  "SUBSCRIPTION_CHANGE_PROVIDER_STATE_AMBIGUOUS",
]);

export function activeBillingSubscription(
  subscriptions: readonly BillingSubscriptionSummary[],
): BillingSubscriptionSummary | null {
  return subscriptions.find((subscription) => changeableStatuses.has(subscription.status)) ?? null;
}

export function canChangeSubscription(
  subscription: BillingSubscriptionSummary | null,
  hasCurrentTerms: boolean,
): boolean {
  return subscription !== null && changeableStatuses.has(subscription.status) && hasCurrentTerms;
}

export function billingPlanAction(
  subscription: BillingSubscriptionSummary | null,
  hasCurrentTerms: boolean,
): "subscription-change" | "setup-selection" {
  return canChangeSubscription(subscription, hasCurrentTerms)
    ? "subscription-change"
    : "setup-selection";
}

export function shouldShowInitialCheckout(
  subscription: BillingSubscriptionSummary | null,
  hasCurrentTerms: boolean,
): boolean {
  return billingPlanAction(subscription, hasCurrentTerms) === "setup-selection";
}

export function shouldDisplayAnnualPriceChange<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

export function canSubmitSubscriptionChange(input: {
  hasPreview: boolean;
  inFlight: boolean;
  expired: boolean;
}): boolean {
  return input.hasPreview && !input.inFlight && !input.expired;
}

export function isSubscriptionChangeNoop(
  currentPlan: string,
  currentCadence: string,
  targetPlan: PlanCode,
  targetCadence: BillingCadence,
): boolean {
  return (
    currentPlan.toLocaleLowerCase("en-US") === targetPlan &&
    currentCadence.toLocaleLowerCase("en-US") === targetCadence
  );
}

export function isSubscriptionChangePreviewExpired(
  preview: Pick<SubscriptionChangePreview, "expiresAt">,
  now = Date.now(),
): boolean {
  const expiresAt = Date.parse(preview.expiresAt);
  return !Number.isFinite(expiresAt) || expiresAt <= now;
}

export function formatBillingAmount(minor: string | number, currency: string, locale: Locale) {
  return formatCurrencyMinor(minor, currency, locale === "ar" ? "ar" : "en-US");
}

export function formatBillingDate(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en-US", {
    dateStyle: "medium",
  }).format(new Date(value));
}

export function billingChangeDirection(locale: Locale): "ltr" | "rtl" {
  return locale === "ar" ? "rtl" : "ltr";
}

export function shouldDisplayProrationCredit(creditAmount: string): boolean {
  return Number(creditAmount) > 0;
}

export function nextRenewalDisplay(
  preview: Pick<SubscriptionChangePreview, "target" | "proration">,
  locale: Locale,
): { amount: string | null; date: string | null } {
  return {
    amount:
      preview.proration.nextRenewalAmount === null
        ? null
        : formatBillingAmount(preview.proration.nextRenewalAmount, preview.target.currency, locale),
    date:
      preview.proration.nextRenewalAt === null
        ? null
        : formatBillingDate(preview.proration.nextRenewalAt, locale),
  };
}

export function subscriptionChangePreviewRequest(
  request: ApiRequest,
  organizationId: string,
  targetPlan: PlanCode,
  targetCadence: BillingCadence,
) {
  return request<SubscriptionChangePreview>(
    `/v1/organizations/${organizationId}/billing/subscription-change/preview`,
    {
      method: "POST",
      body: JSON.stringify({ targetPlan, targetCadence }),
    },
  );
}

export function subscriptionChangeConfirmationRequest(
  request: ApiRequest,
  organizationId: string,
  previewId: string,
) {
  return request<SubscriptionChangeConfirmation>(
    `/v1/organizations/${organizationId}/billing/subscription-change/${encodeURIComponent(previewId)}/confirm`,
    { method: "POST", body: JSON.stringify({}) },
  );
}

export function subscriptionChangeErrorKind(code: string): "stale" | "provider" | "other" {
  if (staleSubscriptionChangeCodes.has(code)) return "stale";
  if (code === "SUBSCRIPTION_CHANGE_PROVIDER_FAILED") return "provider";
  return "other";
}

export function billingChangeCopy(locale: Locale) {
  if (locale === "ar") {
    return {
      cadenceLabel: "دورة الفوترة",
      monthly: "شهري",
      quarterly: "كل 3 أشهر",
      yearly: "سنوي",
      reviewTitle: "مراجعة تغيير الاشتراك",
      reviewDescription: "راجع المبالغ التي حسبها مزوّد الدفع قبل تأكيد التغيير.",
      current: "الاشتراك الحالي",
      target: "الاشتراك الجديد",
      plan: "الخطة",
      cadence: "الدورة",
      price: "السعر",
      dueNow: "المبلغ المستحق الآن",
      credit: "الرصيد المحتسب",
      nextRenewal: "التجديد القادم",
      renewalUnknown: "سيظهر إجمالي التجديد النهائي في فاتورتك القادمة.",
      expires: "تنتهي صلاحية هذه المعاينة في",
      confirm: "تأكيد تغيير الاشتراك",
      cancel: "إلغاء",
      previewing: "جارٍ إعداد المعاينة",
      success: "جارٍ تطبيق تغيير اشتراكك.",
      successDetail: "سنحدّث تفاصيل الفوترة بعد تأكيد Stripe للتغيير.",
      expired: "انتهت صلاحية المعاينة. اطلب معاينة جديدة قبل التأكيد.",
      stale: "تغيّرت حالة الاشتراك أو السعر. راجع معاينة جديدة قبل المتابعة.",
      providerError: "تعذّر تطبيق التغيير الآن. لم نعرض أي تفاصيل حساسة؛ حاول مرة أخرى.",
      previewError: "تعذّر إعداد معاينة تغيير الاشتراك.",
      confirmError: "تعذّر تأكيد تغيير الاشتراك.",
      noImmediateCharge: "لن يتم تحصيل مبلغ فوري بحسب معاينة مزوّد الدفع.",
      changePlan: "مراجعة تغيير الخطة",
      close: "إغلاق",
    } as const;
  }
  return {
    cadenceLabel: "Billing cadence",
    monthly: "Monthly",
    quarterly: "Quarterly",
    yearly: "Yearly",
    reviewTitle: "Review subscription change",
    reviewDescription: "Review the provider-calculated amounts before confirming this change.",
    current: "Current subscription",
    target: "New subscription",
    plan: "Plan",
    cadence: "Cadence",
    price: "Price",
    dueNow: "Due now",
    credit: "Credit applied",
    nextRenewal: "Next renewal",
    renewalUnknown: "Final renewal total will be shown on your next invoice.",
    expires: "This preview expires at",
    confirm: "Confirm subscription change",
    cancel: "Cancel",
    previewing: "Preparing preview",
    success: "Your plan change is being applied.",
    successDetail: "Billing details will refresh after Stripe confirms the change.",
    expired: "This preview expired. Request a fresh preview before confirming.",
    stale: "Your subscription or price changed. Review a fresh preview before continuing.",
    providerError: "The change could not be applied right now. Please try again.",
    previewError: "Unable to prepare the subscription change preview.",
    confirmError: "Unable to confirm the subscription change.",
    noImmediateCharge: "The provider preview shows no immediate charge.",
    changePlan: "Review plan change",
    close: "Close",
  } as const;
}
