import type { BillingCadence, BillingStatus, PlanCode } from "@waflo/contracts";

export interface PlanLimits {
  readonly locations: number | null;
  readonly teamSeats: number | null;
  readonly programs: number | null;
}

export interface PlanFeatures {
  readonly advancedCustomization: boolean;
  readonly advancedAnalytics: boolean;
  readonly campaigns: boolean;
  readonly customDomains: boolean;
  readonly apiAccess: boolean;
  readonly webhooks: boolean;
  readonly advancedExports: boolean;
}

export interface PlanDefinition {
  readonly code: PlanCode;
  readonly name: string;
  readonly monthlyPriceUsd: number;
  readonly limits: PlanLimits;
  readonly features: PlanFeatures;
}

export const planCatalog: Readonly<Record<PlanCode, PlanDefinition>> = {
  starter: {
    code: "starter",
    name: "Starter",
    monthlyPriceUsd: 29,
    limits: { locations: 1, teamSeats: 3, programs: 1 },
    features: {
      advancedCustomization: false,
      advancedAnalytics: false,
      campaigns: false,
      customDomains: false,
      apiAccess: false,
      webhooks: false,
      advancedExports: false,
    },
  },
  growth: {
    code: "growth",
    name: "Growth",
    monthlyPriceUsd: 69,
    limits: { locations: 3, teamSeats: 10, programs: null },
    features: {
      advancedCustomization: true,
      advancedAnalytics: true,
      campaigns: false,
      customDomains: false,
      apiAccess: false,
      webhooks: false,
      advancedExports: false,
    },
  },
  scale: {
    code: "scale",
    name: "Scale",
    monthlyPriceUsd: 129,
    limits: { locations: null, teamSeats: null, programs: null },
    features: {
      advancedCustomization: true,
      advancedAnalytics: true,
      campaigns: false,
      customDomains: false,
      apiAccess: false,
      webhooks: false,
      advancedExports: true,
    },
  },
} as const;

export const billingCadenceCatalog: Readonly<
  Record<
    BillingCadence,
    {
      readonly months: 1 | 3 | 12;
      readonly discountRate: number;
      readonly label: string;
    }
  >
> = {
  monthly: { months: 1, discountRate: 0, label: "Monthly" },
  // Quarterly receives half of the yearly discount: one quarter of a month free.
  quarterly: { months: 3, discountRate: 1 / 12, label: "Quarterly" },
  // Yearly is billed as ten months instead of twelve: two months free.
  yearly: { months: 12, discountRate: 1 / 6, label: "Yearly" },
};

export function cadencePrice(
  plan: PlanCode,
  cadence: BillingCadence,
): {
  monthlyEquivalentUsd: number;
  billedAmountUsd: number;
  undiscountedAmountUsd: number;
} {
  const monthly = planCatalog[plan].monthlyPriceUsd;
  const definition = billingCadenceCatalog[cadence];
  const undiscountedMinorUnits = monthly * 100 * definition.months;
  // Keep the business rule explicit so Stripe validation and every UI surface
  // agree exactly: quarterly is 2.75 months and yearly is 10 months.
  const billedMinorUnits =
    cadence === "monthly"
      ? monthly * 100
      : cadence === "quarterly"
        ? Math.round((monthly * 100 * 11) / 4)
        : monthly * 100 * 10;
  const undiscountedAmountUsd = undiscountedMinorUnits / 100;
  const billedAmountUsd = billedMinorUnits / 100;
  return {
    monthlyEquivalentUsd: Number((billedAmountUsd / definition.months).toFixed(2)),
    billedAmountUsd,
    undiscountedAmountUsd,
  };
}

export const BILLING_GRACE_HOURS = 48;
export const BILLING_RECOVERY_RETRY_HOURS = [12, 47] as const;

export type BillingFailureCategory =
  | "RECOVERABLE_FUNDS"
  | "AUTHENTICATION_REQUIRED"
  | "INVALID_PAYMENT_METHOD"
  | "HARD_DECLINE"
  | "CUSTOMER_ACTION_REQUIRED";

export function billingFailurePolicy(code: string | null | undefined): {
  category: BillingFailureCategory;
  automaticRetryEligible: boolean;
} {
  const normalized = code?.trim().toLocaleLowerCase("en-US") ?? "";
  if (
    [
      "insufficient_funds",
      "card_velocity_exceeded",
      "issuer_not_available",
      "processing_error",
    ].includes(normalized)
  ) {
    return { category: "RECOVERABLE_FUNDS", automaticRetryEligible: true };
  }
  if (["authentication_required", "payment_intent_authentication_failure"].includes(normalized)) {
    return { category: "AUTHENTICATION_REQUIRED", automaticRetryEligible: false };
  }
  if (
    [
      "expired_card",
      "incorrect_number",
      "invalid_number",
      "invalid_expiry_month",
      "invalid_expiry_year",
    ].includes(normalized)
  ) {
    return { category: "INVALID_PAYMENT_METHOD", automaticRetryEligible: false };
  }
  if (
    [
      "do_not_honor",
      "fraudulent",
      "lost_card",
      "pickup_card",
      "restricted_card",
      "stolen_card",
    ].includes(normalized)
  ) {
    return { category: "HARD_DECLINE", automaticRetryEligible: false };
  }
  return { category: "CUSTOMER_ACTION_REQUIRED", automaticRetryEligible: false };
}

export function billingGraceDeadline(firstFailedAt: Date): Date {
  return new Date(firstFailedAt.getTime() + BILLING_GRACE_HOURS * 60 * 60 * 1000);
}

export function billingRecoverySchedule(firstFailedAt: Date): readonly Date[] {
  return BILLING_RECOVERY_RETRY_HOURS.map(
    (hours) => new Date(firstFailedAt.getTime() + hours * 60 * 60 * 1000),
  );
}

function calendarOrdinal(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return Math.floor(Date.UTC(value("year"), value("month") - 1, value("day")) / 86_400_000);
}

export function isExactlyTwoLocalCalendarDaysBefore(
  now: Date,
  renewalAt: Date,
  timeZone: string,
): boolean {
  return calendarOrdinal(renewalAt, timeZone) - calendarOrdinal(now, timeZone) === 2;
}

export function formatBillingDate(date: Date, locale: "en" | "ar", timeZone: string): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-IQ-u-nu-latn" : "en-US", {
    timeZone,
    dateStyle: "full",
    timeStyle: "short",
  }).format(date);
}

export function formatMinorUnits(amount: number, currency: string, locale: "en" | "ar"): string {
  return new Intl.NumberFormat(locale === "ar" ? "ar-IQ-u-nu-latn" : "en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount / 100);
}

export interface BillingEmailPayload {
  organizationName?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  amount: number;
  currency: string;
  plan?: string | null;
  cadence?: string | null;
  status?: string | null;
  expectedChargeAt?: string | null;
  failedAt?: string | null;
  graceEndsAt?: string | null;
  failureCategory?: BillingFailureCategory | null;
  automaticRetryEligible?: boolean;
  paymentMethod?: { brand: string; last4: string; expMonth?: number; expYear?: number } | null;
  billingUrl?: string | null;
  hostedInvoiceUrl?: string | null;
  invoicePdfUrl?: string | null;
  originalPaymentDate?: string | null;
  refundStatus?: string | null;
  refundReason?: string | null;
  timezone: string;
}

export type BillingEmailKind =
  | "RENEWAL_REMINDER"
  | "INVOICE_PAID"
  | "PAYMENT_FAILED"
  | "BILLING_GRACE_EXPIRED"
  | "REFUND_REQUEST_RECEIVED"
  | "REFUND_APPROVED"
  | "REFUND_SUCCEEDED"
  | "REFUND_REJECTED"
  | "REFUND_FAILED";

function emailEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeBillingLink(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

export function renderBillingEmail(
  kind: BillingEmailKind,
  payload: BillingEmailPayload,
  locale: "en" | "ar",
): { subject: string; html: string } {
  if (!Number.isSafeInteger(payload.amount) || payload.amount < 0)
    throw new Error("INVALID_AMOUNT");
  if (!payload.currency || !payload.timezone) throw new Error("INVALID_BILLING_EMAIL_PAYLOAD");
  const ar = locale === "ar";
  const organization = emailEscape(
    payload.organizationName || (ar ? "مؤسستك" : "your organization"),
  );
  const amount = emailEscape(formatMinorUnits(payload.amount, payload.currency, locale));
  const method = payload.paymentMethod
    ? `${emailEscape(payload.paymentMethod.brand)} •••• ${emailEscape(payload.paymentMethod.last4)}`
    : ar
      ? "طريقة الدفع المحفوظة"
      : "your saved payment method";
  const expiry =
    payload.paymentMethod?.expMonth && payload.paymentMethod.expYear
      ? ` (${ar ? "تنتهي" : "expires"} ${payload.paymentMethod.expMonth}/${payload.paymentMethod.expYear})`
      : "";
  const plan = payload.plan ? emailEscape(payload.plan) : ar ? "خطة Waflo" : "Waflo plan";
  const cadence = payload.cadence ? ` · ${emailEscape(payload.cadence)}` : "";
  const billingLink = safeBillingLink(payload.billingUrl);
  const invoiceLink =
    safeBillingLink(payload.hostedInvoiceUrl) ?? safeBillingLink(payload.invoicePdfUrl);
  let subject: string;
  let heading: string;
  let body: string;
  let actionUrl: string | null = billingLink;
  let actionLabel = ar ? "فتح الفوترة" : "Open Billing";
  if (kind === "RENEWAL_REMINDER") {
    if (!payload.expectedChargeAt) throw new Error("INVALID_RENEWAL_DATE");
    const date = emailEscape(
      formatBillingDate(new Date(payload.expectedChargeAt), locale, payload.timezone),
    );
    subject = ar ? "تذكير بتجديد اشتراك Waflo خلال يومين" : "Your Waflo renewal is in two days";
    heading = subject;
    body = ar
      ? `نتوقع خصم ${amount} من ${method}${expiry} في ${date} لتجديد ${plan}${cadence} لدى ${organization}.`
      : `Waflo expects to charge ${amount} to ${method}${expiry} on ${date} for ${organization}'s ${plan}${cadence}.`;
  } else if (kind === "INVOICE_PAID") {
    if (!payload.invoiceDate) throw new Error("INVALID_INVOICE_DATE");
    const date = emailEscape(
      formatBillingDate(new Date(payload.invoiceDate), locale, payload.timezone),
    );
    subject = ar ? "تم دفع فاتورة Waflo" : "Your Waflo invoice was paid";
    heading = subject;
    body = ar
      ? `تم دفع فاتورة ${emailEscape(payload.invoiceNumber ?? "—")} بقيمة ${amount} في ${date} لـ ${organization}. الحالة: مدفوعة. ${plan}${cadence}. طريقة الدفع: ${method}.`
      : `Invoice ${emailEscape(payload.invoiceNumber ?? "—")} for ${amount} was paid on ${date} for ${organization}. Status: paid. ${plan}${cadence}. Payment method: ${method}.`;
    actionUrl = invoiceLink;
    actionLabel = ar ? "عرض فاتورة Stripe" : "View Stripe invoice";
  } else if (kind === "PAYMENT_FAILED") {
    if (!payload.graceEndsAt) throw new Error("INVALID_GRACE_DEADLINE");
    const deadline = emailEscape(
      formatBillingDate(new Date(payload.graceEndsAt), locale, payload.timezone),
    );
    const category =
      payload.failureCategory === "RECOVERABLE_FUNDS"
        ? ar
          ? "قد ينجح إعادة المحاولة المجدولة"
          : "a scheduled retry may succeed"
        : ar
          ? "يلزم تحديث أو توثيق طريقة الدفع"
          : "the payment method must be updated or authenticated";
    subject = ar
      ? "فشل دفع اشتراك Waflo — مهلة 48 ساعة"
      : "Waflo payment failed — 48-hour grace window";
    heading = subject;
    body = ar
      ? `فشل دفع الفاتورة ${emailEscape(payload.invoiceNumber ?? "—")} بقيمة ${amount} باستخدام ${method}. السبب: ${category}. تنتهي مهلة الاسترداد في ${deadline}.`
      : `Payment for invoice ${emailEscape(payload.invoiceNumber ?? "—")} (${amount}) failed using ${method}. Action: ${category}. The 48-hour recovery window ends ${deadline}.`;
  } else if (kind === "BILLING_GRACE_EXPIRED") {
    if (!payload.graceEndsAt) throw new Error("INVALID_GRACE_DEADLINE");
    const deadline = emailEscape(
      formatBillingDate(new Date(payload.graceEndsAt), locale, payload.timezone),
    );
    subject = ar ? "فاتورة Waflo ما زالت متأخرة" : "Your Waflo invoice remains overdue";
    heading = subject;
    body = ar
      ? `انتهت مهلة 48 ساعة في ${deadline} وما زالت فاتورة ${emailEscape(payload.invoiceNumber ?? "—")} بقيمة ${amount} غير مدفوعة. الحساب الآن متأخر الدفع وتبقى الاستعادة متاحة بعد الدفع.`
      : `The 48-hour grace window ended ${deadline}; invoice ${emailEscape(payload.invoiceNumber ?? "—")} for ${amount} remains unpaid. The account is now past due and can recover after successful payment.`;
  } else {
    const invoiceNumber = emailEscape(payload.invoiceNumber ?? "—");
    const refundStatus = emailEscape(payload.refundStatus ?? kind.replace("REFUND_", ""));
    const originalPaymentDate = payload.originalPaymentDate
      ? emailEscape(
          formatBillingDate(new Date(payload.originalPaymentDate), locale, payload.timezone),
        )
      : ar
        ? "غير متاح"
        : "not available";
    actionUrl = billingLink;
    actionLabel = ar ? "فتح الفوترة والاسترداد" : "Open Billing & refunds";
    if (kind === "REFUND_REQUEST_RECEIVED") {
      subject = ar ? "استلمنا طلب استرداد Waflo" : "We received your Waflo refund request";
      heading = subject;
      body = ar
        ? `استلمنا طلب استرداد ${amount} للفاتورة ${invoiceNumber}. الحالة: ${refundStatus}. سنراجع سبب الطلب ومبلغ الدفع الأصلي قبل أي تنفيذ.`
        : `We received a request to refund ${amount} for invoice ${invoiceNumber}. Status: ${refundStatus}. Waflo will review the reason and original payment before any refund is executed.`;
    } else if (kind === "REFUND_APPROVED") {
      subject = ar ? "تمت الموافقة على استرداد Waflo" : "Your Waflo refund was approved";
      heading = subject;
      body = ar
        ? `تمت الموافقة على استرداد ${amount} للفاتورة ${invoiceNumber}. الحالة: ${refundStatus}. ستتم المعالجة إلى وسيلة الدفع الأصلية.`
        : `A refund of ${amount} for invoice ${invoiceNumber} was approved. Status: ${refundStatus}. Processing uses the original payment path.`;
    } else if (kind === "REFUND_SUCCEEDED") {
      subject = ar ? "اكتمل استرداد Waflo" : "Your Waflo refund succeeded";
      heading = subject;
      body = ar
        ? `اكتمل استرداد ${amount} للفاتورة ${invoiceNumber} المدفوعة في ${originalPaymentDate}. الحالة: ${refundStatus}. أُعيد المبلغ إلى ${method}. قد تختلف مدة ظهوره حسب البنك أو شبكة الدفع.`
        : `The ${amount} refund for invoice ${invoiceNumber}, originally paid on ${originalPaymentDate}, succeeded. Status: ${refundStatus}. It was returned to ${method}. Issuer and payment-network posting times can vary.`;
    } else if (kind === "REFUND_REJECTED") {
      subject = ar ? "تمت مراجعة طلب استرداد Waflo" : "Your Waflo refund request was reviewed";
      heading = subject;
      body = ar
        ? `تم رفض طلب استرداد ${amount} للفاتورة ${invoiceNumber} بعد المراجعة. الحالة: ${refundStatus}. افتح الفوترة للاطلاع على الحالة أو التواصل بشأنها.`
        : `The ${amount} refund request for invoice ${invoiceNumber} was rejected after review. Status: ${refundStatus}. Open Billing to view the request or contact support about it.`;
    } else {
      subject = ar ? "يتطلب استرداد Waflo إجراءً" : "Your Waflo refund needs attention";
      heading = subject;
      body = ar
        ? `تعذرت معالجة استرداد ${amount} للفاتورة ${invoiceNumber}. الحالة: ${refundStatus}. لم نعرض تفاصيل مزود الدفع الخام؛ سيتابع فريق الفوترة الحالة بأمان.`
        : `The ${amount} refund for invoice ${invoiceNumber} could not be completed. Status: ${refundStatus}. Raw provider diagnostics are not shown; the billing team can review the safe failure state.`;
    }
  }
  const action = actionUrl
    ? `<a href="${emailEscape(actionUrl)}" style="display:inline-block;background:#AE3115;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:700">${emailEscape(actionLabel)}</a>`
    : "";
  return {
    subject,
    html: `<!doctype html><html lang="${locale}" dir="${ar ? "rtl" : "ltr"}"><body style="margin:0;background:#F7F9FF;color:#241916;font-family:Arial,sans-serif"><div style="max-width:620px;margin:32px auto;background:#fff;border-radius:22px;padding:32px"><div style="font-size:28px;font-weight:800;color:#AE3115">waflo</div><h1 style="font-size:24px">${emailEscape(heading)}</h1><p style="line-height:1.75">${body}</p>${action}<p style="margin-top:32px;color:#76645F;font-size:12px">Waflo is owned and operated by Tavrix LLC.</p></div></body></html>`,
  };
}

export interface EntitlementDecision {
  readonly allowed: boolean;
  readonly limit: number | null;
  readonly currentUsage: number;
  readonly remaining: number | null;
  readonly reasonCode: "ALLOWED" | "LIMIT_REACHED" | "FEATURE_UNAVAILABLE";
  readonly recommendedPlan: PlanCode | null;
}

export function usageDecision(
  plan: PlanCode,
  kind: "locations" | "teamSeats" | "programs",
  currentUsage: number,
  configuredScaleLimit?: number,
): EntitlementDecision {
  const catalogLimit = planCatalog[plan].limits[kind];
  const limit = plan === "scale" ? (configuredScaleLimit ?? catalogLimit) : catalogLimit;
  const allowed = limit === null || currentUsage < limit;
  const remaining = limit === null ? null : Math.max(0, limit - currentUsage);
  return {
    allowed,
    limit,
    currentUsage,
    remaining,
    reasonCode: allowed ? "ALLOWED" : "LIMIT_REACHED",
    recommendedPlan: allowed
      ? null
      : plan === "starter"
        ? "growth"
        : plan === "growth"
          ? "scale"
          : null,
  };
}

export function canCreateLocation(
  plan: PlanCode,
  currentUsage: number,
  configuredScaleLimit?: number,
): EntitlementDecision {
  return usageDecision(plan, "locations", currentUsage, configuredScaleLimit);
}

export function canInviteTeamMember(
  plan: PlanCode,
  currentUsage: number,
  configuredScaleLimit?: number,
): EntitlementDecision {
  return usageDecision(plan, "teamSeats", currentUsage, configuredScaleLimit);
}

export type ProgramEntitlement =
  | "canCreateProgram"
  | "canRestoreProgram"
  | "canPublishProgram"
  | "canUseProMode"
  | "canUseAdvancedLayouts"
  | "canUseCustomStampUploads"
  | "canUseMilestoneRewards"
  | "canUseMultipleRewards"
  | "canUseAdvancedWalletPreviewControls";

export function programEntitlement(plan: PlanCode, entitlement: ProgramEntitlement): boolean {
  if (
    entitlement === "canUseProMode" ||
    entitlement === "canUseMultipleRewards" ||
    entitlement === "canUseMilestoneRewards" ||
    entitlement === "canUseAdvancedWalletPreviewControls"
  )
    return plan !== "starter";
  if (entitlement === "canUseAdvancedLayouts") return true;
  if (entitlement === "canUseCustomStampUploads") return true;
  return true;
}

export function canCreateProgram(plan: PlanCode, currentUsage: number): EntitlementDecision {
  return usageDecision(plan, "programs", currentUsage);
}

export function canRestoreProgram(plan: PlanCode, currentUsage: number): EntitlementDecision {
  return canCreateProgram(plan, currentUsage);
}

export function canPublishWithinProgramLimit(
  plan: PlanCode,
  currentUsage: number,
): EntitlementDecision {
  const limit = planCatalog[plan].limits.programs;
  const allowed = limit === null || currentUsage <= limit;
  return {
    allowed,
    limit,
    currentUsage,
    remaining: limit === null ? null : Math.max(0, limit - currentUsage),
    reasonCode: allowed ? "ALLOWED" : "LIMIT_REACHED",
    recommendedPlan: allowed
      ? null
      : plan === "starter"
        ? "growth"
        : plan === "growth"
          ? "scale"
          : null,
  };
}

export const programPublicationAllowedBillingStatuses = [
  "trialing",
  "active",
  "grace_period",
] as const satisfies readonly BillingStatus[];

export function canPublishForBillingStatus(status: BillingStatus): boolean {
  return (programPublicationAllowedBillingStatuses as readonly BillingStatus[]).includes(status);
}

export const enrollmentAllowedBillingStatuses = [
  "trialing",
  "active",
  "grace_period",
] as const satisfies readonly BillingStatus[];

export interface EnrollmentBillingDecision {
  readonly allowed: boolean;
  readonly code:
    | "ALLOWED"
    | "PENDING_ACTIVATION_INCONSISTENCY"
    | "PAST_DUE"
    | "SUSPENDED"
    | "CANCELED";
  readonly existingCardsViewable: boolean;
  readonly walletAvailable: boolean;
}

export function enrollmentBillingDecision(status: BillingStatus): EnrollmentBillingDecision {
  if ((enrollmentAllowedBillingStatuses as readonly BillingStatus[]).includes(status)) {
    return {
      allowed: true,
      code: "ALLOWED",
      existingCardsViewable: true,
      walletAvailable: true,
    };
  }
  if (status === "pending_activation") {
    return {
      allowed: false,
      code: "PENDING_ACTIVATION_INCONSISTENCY",
      existingCardsViewable: true,
      walletAvailable: false,
    };
  }
  if (status === "past_due") {
    return {
      allowed: false,
      code: "PAST_DUE",
      existingCardsViewable: true,
      walletAvailable: false,
    };
  }
  return {
    allowed: false,
    code: status === "suspended" ? "SUSPENDED" : "CANCELED",
    existingCardsViewable: false,
    walletAvailable: false,
  };
}

/** An elapsed local trial is never an entitlement, even if webhook delivery is delayed. */
export function effectiveBillingStatus(
  status: BillingStatus,
  trialEnd: Date | null | undefined,
  now = new Date(),
): BillingStatus {
  return status === "trialing" && trialEnd !== null && trialEnd !== undefined && trialEnd <= now
    ? "past_due"
    : status;
}

export interface MerchantOperationalBillingSnapshot {
  readonly status: BillingStatus | Uppercase<BillingStatus>;
  readonly trialEnd?: Date | null | undefined;
  readonly gracePeriodEnd?: Date | null | undefined;
}

/**
 * The shared, time-aware billing policy used immediately before an operational
 * mutation or an irreversible provider/worker side effect.
 */
export function hasMerchantOperationalBillingAccess(
  snapshot: MerchantOperationalBillingSnapshot,
  now = new Date(),
): boolean {
  const status = snapshot.status.toLocaleLowerCase("en-US") as BillingStatus;
  if (status === "active") return true;
  if (status === "trialing") return Boolean(snapshot.trialEnd && snapshot.trialEnd > now);
  if (status === "grace_period") {
    return Boolean(snapshot.gracePeriodEnd && snapshot.gracePeriodEnd > now);
  }
  return false;
}

export function walletIncludedForPlan(_plan: PlanCode): boolean {
  return true;
}

export type ProgramPublicationFeatureViolation =
  | "PRO_MODE"
  | "MULTIPLE_REWARDS"
  | "MILESTONE_REWARDS"
  | "ADVANCED_LAYOUT";

export function programPublicationFeatureViolations(
  plan: PlanCode,
  input: {
    editingMode: "QUICK" | "PRO";
    rewardThresholds: readonly number[];
    requiredStampCount: number;
    layoutType: "ROW" | "GRID" | "PATH" | "RING";
  },
): ProgramPublicationFeatureViolation[] {
  const violations: ProgramPublicationFeatureViolation[] = [];
  if (input.editingMode === "PRO" && !programEntitlement(plan, "canUseProMode"))
    violations.push("PRO_MODE");
  if (input.rewardThresholds.length > 1 && !programEntitlement(plan, "canUseMultipleRewards"))
    violations.push("MULTIPLE_REWARDS");
  if (
    input.rewardThresholds.some((threshold) => threshold < input.requiredStampCount) &&
    !programEntitlement(plan, "canUseMilestoneRewards")
  )
    violations.push("MILESTONE_REWARDS");
  if (
    (input.layoutType === "PATH" || input.layoutType === "RING") &&
    !programEntitlement(plan, "canUseAdvancedLayouts")
  )
    violations.push("ADVANCED_LAYOUT");
  return violations;
}

export type PlanDowngradeViolationCode =
  | "LOCATIONS"
  | "TEAM_SEATS"
  | "ACTIVE_PROGRAMS"
  | "PRO_MODE"
  | "MULTIPLE_REWARDS"
  | "MILESTONE_REWARDS"
  | "ADVANCED_LAYOUT"
  | "ACTIVE_ADVANCED_EXPORTS";

export interface PlanDowngradeViolation {
  readonly code: PlanDowngradeViolationCode;
  readonly currentUsage: number;
  readonly limit: number | null;
}

export function planDowngradeViolations(
  plan: PlanCode,
  usage: {
    locations: number;
    teamSeats: number;
    programs: number;
    activeAdvancedExports: number;
    programFeatures: Readonly<Partial<Record<ProgramPublicationFeatureViolation, number>>>;
  },
  configuredScaleLimits: { locations?: number; teamSeats?: number } = {},
): PlanDowngradeViolation[] {
  const limits = {
    locations:
      plan === "scale"
        ? (configuredScaleLimits.locations ?? planCatalog[plan].limits.locations)
        : planCatalog[plan].limits.locations,
    teamSeats:
      plan === "scale"
        ? (configuredScaleLimits.teamSeats ?? planCatalog[plan].limits.teamSeats)
        : planCatalog[plan].limits.teamSeats,
    programs: planCatalog[plan].limits.programs,
  };
  const violations: PlanDowngradeViolation[] = [];
  if (limits.locations !== null && usage.locations > limits.locations)
    violations.push({ code: "LOCATIONS", currentUsage: usage.locations, limit: limits.locations });
  if (limits.teamSeats !== null && usage.teamSeats > limits.teamSeats)
    violations.push({ code: "TEAM_SEATS", currentUsage: usage.teamSeats, limit: limits.teamSeats });
  if (limits.programs !== null && usage.programs > limits.programs)
    violations.push({
      code: "ACTIVE_PROGRAMS",
      currentUsage: usage.programs,
      limit: limits.programs,
    });

  const featureCodes: readonly ProgramPublicationFeatureViolation[] = [
    "PRO_MODE",
    "MULTIPLE_REWARDS",
    "MILESTONE_REWARDS",
    "ADVANCED_LAYOUT",
  ];
  for (const code of featureCodes) {
    const currentUsage = usage.programFeatures[code] ?? 0;
    if (currentUsage > 0 && !programEntitlement(plan, featureEntitlement(code))) {
      violations.push({ code, currentUsage, limit: 0 });
    }
  }
  if (!planCatalog[plan].features.advancedExports && usage.activeAdvancedExports > 0) {
    violations.push({
      code: "ACTIVE_ADVANCED_EXPORTS",
      currentUsage: usage.activeAdvancedExports,
      limit: 0,
    });
  }
  return violations;
}

function featureEntitlement(code: ProgramPublicationFeatureViolation): ProgramEntitlement {
  if (code === "PRO_MODE") return "canUseProMode";
  if (code === "MULTIPLE_REWARDS") return "canUseMultipleRewards";
  if (code === "MILESTONE_REWARDS") return "canUseMilestoneRewards";
  return "canUseAdvancedLayouts";
}

export function formatPlanPrice(plan: PlanCode): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(planCatalog[plan].monthlyPriceUsd);
}

export interface TrialState {
  readonly status: BillingStatus;
  readonly started: boolean;
  readonly trialStart: Date | null;
  readonly trialEnd: Date | null;
  readonly messageKey: "trial.pending" | "trial.active" | "trial.inactive";
}

export function calculateTrialState(input: {
  status: BillingStatus;
  trialStart: Date | null;
  trialEnd: Date | null;
}): TrialState {
  if (input.status === "pending_activation") {
    return {
      status: input.status,
      started: false,
      trialStart: null,
      trialEnd: null,
      messageKey: "trial.pending",
    };
  }
  return {
    status: input.status,
    started: input.trialStart !== null,
    trialStart: input.trialStart,
    trialEnd: input.trialEnd,
    messageKey: input.status === "trialing" ? "trial.active" : "trial.inactive",
  };
}
