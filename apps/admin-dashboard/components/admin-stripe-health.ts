import { formatMoney } from "@waflo/billing";
import type { Locale } from "@waflo/contracts";

export type HealthSeverity = "HEALTHY" | "INFO" | "WARNING" | "CRITICAL";

export interface StripeHealthIssue {
  id: string;
  type: string;
  severity: Exclude<HealthSeverity, "HEALTHY">;
  title: string;
  summary: string;
  firstSeenAt: string;
  lastSeenAt: string;
  customer: { id: string; name: string } | null;
  subscription: {
    id: string;
    stripeSubscriptionReference: string;
    plan: string;
    status: string;
  } | null;
  pricing: {
    pricingVersionId: string | null;
    market: string | null;
    stripePriceReference: string | null;
  } | null;
  repricingCampaignId: string | null;
  safeContext: Record<string, string | number | boolean | null>;
}

export interface StripeHealthOverview {
  generatedAt: string;
  overall: {
    severity: HealthSeverity;
    criticalCount: number;
    warningCount: number;
    infoCount: number;
    message: string;
  };
  summary: {
    lastWebhookReceivedAt: string | null;
    lastWebhookProcessedAt: string | null;
    webhookFailures: number;
    retryableWebhookEvents: number;
    lastSuccessfulProviderSyncAt: string | null;
    reconciliationFailures: number;
    reconciliationDueForSync: number;
    unknownStripePrices: number;
    pricingBindingIssues: number;
    activeUnboundVersions: number;
    subscriptionStateMismatches: number;
    missingPricingSnapshots: number;
    failedPayments: number;
    pastDueSubscriptions: number;
    repricingFailures: number;
    expiredChangePreviews: number;
  };
  webhooks: {
    lastReceivedAt: string | null;
    lastProcessedAt: string | null;
    failedCount: number;
    retryableCount: number;
    replayedCount: number;
    ignoredStaleCount: number;
    coverage: Array<{
      eventType: string;
      observedCount: number;
      lastObservedAt: string | null;
      status: "OBSERVED" | "NOT_YET_OBSERVED";
    }>;
    recent: Array<{
      eventReference: string;
      eventType: string;
      status: string;
      attempts: number;
      receivedAt: string;
      processedAt: string | null;
      organization: { id: string; name: string } | null;
    }>;
  };
  reconciliation: {
    lastRunAt: string | null;
    lastSuccessfulProviderSyncAt: string | null;
    failureCount: number;
    dueForSyncCount: number;
    activeLeases: number;
    lastRunCoverage: "DURABLY_RECORDED" | "NOT_YET_RECORDED";
    latestRun: {
      id: string;
      status: "RUNNING" | "SUCCEEDED" | "PARTIALLY_FAILED" | "FAILED";
      startedAt: string;
      completedAt: string | null;
      subscriptionsScanned: number;
      subscriptionsConverged: number;
      subscriptionsFailed: number;
      safeFailureCode: string | null;
    } | null;
  };
  catalog: {
    publishedWithoutBinding: number;
    unknownStripePriceCount: number;
    bindingMismatchCount: number;
  };
  payments: {
    failedCount: number;
    pastDueCount: number;
    failures: Array<{
      customer: { id: string; name: string };
      subscriptionId: string;
      plan: string | null;
      invoiceReference: string;
      currency: string;
      amountMinor?: string;
      failureAt: string;
      subscriptionStatus: string;
      market: string | null;
    }>;
  };
  financialEvidence: {
    coverage: "PARTIAL_COVERAGE" | "NO_EVIDENCE";
    ledgerStartedAt: string | null;
    latestEvidenceAt: string | null;
    refunds: "NOT_AVAILABLE";
    providerFees: "NOT_AVAILABLE";
    failedPaymentTotals: Array<{ currency: string; amountMinor: string }>;
  };
  repricing: { failedCount: number; retryingCount: number; staleCount: number };
  providerConfiguration: {
    apiCredentials: "CONFIGURED" | "MISSING";
    webhookSigning: "CONFIGURED" | "MISSING";
    portalConfiguration: "CONFIGURED" | "MISSING";
    mode: "TEST" | "LIVE" | "UNKNOWN";
    environment: "development" | "staging" | "production";
    environmentMismatch: boolean;
  };
  criticalIssues: StripeHealthIssue[];
}

export interface StripeHealthIssuePage {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  items: StripeHealthIssue[];
}

const copy = {
  en: {
    eyebrow: "BILLING OPERATIONS / STORED EVIDENCE",
    title: "Stripe health",
    subtitle:
      "A read-only incident ledger for Waflo billing evidence, workers, and catalog bindings.",
    healthy: "All stored billing signals are healthy",
    attention: "Billing operations need attention",
    critical: "Critical",
    warning: "Warning",
    info: "Info",
    webhook: "Webhook health",
    reconciliation: "Reconciliation",
    payments: "Payment failures",
    catalog: "Pricing bindings",
    evidence: "Evidence coverage",
    configuration: "Provider configuration",
    unknownPrice: "Unknown Stripe Prices",
    missingSnapshot: "Missing pricing snapshots",
    bindingIssues: "Binding mismatches",
    pastDue: "Past due",
    repricing: "Annual repricing",
    retryable: "Retryable events",
    lastReceived: "Last webhook received",
    lastProcessed: "Last processed",
    lastSync: "Last provider sync",
    lastRun: "Last reconciliation run",
    dueForSync: "Due for sync",
    activeLeases: "Active leases",
    noRunRecord: "No durable reconciliation run has been recorded yet.",
    runEvidence:
      "Latest durable run: {status}. Scanned {scanned}; converged {converged}; failed {failed}.",
    expectedEvents: "Expected event coverage",
    recentEvents: "Recent webhook evidence",
    event: "Event",
    status: "Status",
    received: "Received",
    processed: "Processed",
    attempts: "Attempts",
    observed: "Observed",
    notObserved: "Not yet observed",
    issues: "Operational issues",
    filters: "Filters",
    all: "All",
    type: "Issue type",
    severity: "Severity",
    market: "Market",
    clear: "Clear filters",
    previous: "Previous",
    next: "Next",
    page: "Page",
    issueDetail: "Issue detail",
    detected: "Last detected",
    safeEvidence: "Safe evidence",
    viewCustomer: "View customer",
    viewPricing: "View pricing",
    viewRepricing: "View repricing campaign",
    customer: "Customer",
    invoice: "Invoice",
    amount: "Amount",
    failedAt: "Failure date",
    plan: "Plan",
    refunds: "Refund evidence",
    fees: "Provider fee evidence",
    partial:
      "Historical financial evidence is partial. Unknown historical data is not treated as zero.",
    notAvailable: "Not available",
    configured: "Configured",
    missing: "Missing",
    mode: "Provider mode",
    environment: "Deployment environment",
    credentials: "API credentials",
    signing: "Webhook signing",
    portal: "Customer Portal",
    test: "Test mode",
    live: "Live mode",
    unknown: "Unknown",
    noIssues: "No issues match the current filters.",
    loading: "Loading stored billing evidence",
    error: "Stripe health could not be loaded.",
    retry: "Retry",
    noLive: "This page does not call Stripe. It reads Waflo’s stored, reconciled evidence.",
    noDangerousActions:
      "This is a diagnostics surface. It cannot charge, bind, or alter a subscription.",
  },
  ar: {
    eyebrow: "عمليات الفوترة / أدلة مخزنة",
    title: "حالة Stripe",
    subtitle: "سجل تشخيصي للقراءة فقط لأدلة فوترة Waflo والعمال وروابط الكتالوج.",
    healthy: "كل إشارات الفوترة المخزنة سليمة",
    attention: "عمليات الفوترة تحتاج إلى مراجعة",
    critical: "حرج",
    warning: "تحذير",
    info: "معلومة",
    webhook: "حالة Webhook",
    reconciliation: "المطابقة",
    payments: "إخفاقات الدفع",
    catalog: "روابط التسعير",
    evidence: "تغطية الأدلة",
    configuration: "تهيئة المزوّد",
    unknownPrice: "أسعار Stripe غير معروفة",
    missingSnapshot: "لقطات التسعير المفقودة",
    bindingIssues: "اختلافات الربط",
    pastDue: "متأخر السداد",
    repricing: "إعادة التسعير السنوية",
    retryable: "أحداث قابلة لإعادة المحاولة",
    lastReceived: "آخر Webhook مستلم",
    lastProcessed: "آخر حدث معالج",
    lastSync: "آخر مزامنة مع المزوّد",
    lastRun: "آخر تشغيل للمطابقة",
    dueForSync: "مستحق للمزامنة",
    activeLeases: "تأجيرات نشطة",
    noRunRecord: "لم يتم تسجيل أي تشغيل دائم للمطابقة بعد.",
    runEvidence:
      "أحدث تشغيل دائم: {status}. تم فحص {scanned}؛ تمت المطابقة {converged}؛ فشل {failed}.",
    expectedEvents: "تغطية الأحداث المتوقعة",
    recentEvents: "أدلة Webhook الحديثة",
    event: "الحدث",
    status: "الحالة",
    received: "مستلم",
    processed: "معالج",
    attempts: "المحاولات",
    observed: "تمت ملاحظته",
    notObserved: "لم يُلاحظ بعد",
    issues: "المشكلات التشغيلية",
    filters: "عوامل التصفية",
    all: "الكل",
    type: "نوع المشكلة",
    severity: "الخطورة",
    market: "السوق",
    clear: "مسح عوامل التصفية",
    previous: "السابق",
    next: "التالي",
    page: "الصفحة",
    issueDetail: "تفاصيل المشكلة",
    detected: "آخر اكتشاف",
    safeEvidence: "دليل آمن",
    viewCustomer: "عرض العميل",
    viewPricing: "عرض التسعير",
    viewRepricing: "عرض حملة إعادة التسعير",
    customer: "العميل",
    invoice: "الفاتورة",
    amount: "المبلغ",
    failedAt: "تاريخ الإخفاق",
    plan: "الخطة",
    refunds: "دليل الاستردادات",
    fees: "دليل رسوم المزوّد",
    partial:
      "الأدلة المالية التاريخية جزئية. لا تُعامل البيانات التاريخية غير المعروفة على أنها صفر.",
    notAvailable: "غير متاح",
    configured: "مُهيأ",
    missing: "مفقود",
    mode: "وضع المزوّد",
    environment: "بيئة النشر",
    credentials: "بيانات اعتماد API",
    signing: "توقيع Webhook",
    portal: "بوابة العميل",
    test: "وضع الاختبار",
    live: "الوضع الحي",
    unknown: "غير معروف",
    noIssues: "لا توجد مشكلات تطابق عوامل التصفية الحالية.",
    loading: "جارٍ تحميل أدلة الفوترة المخزنة",
    error: "تعذر تحميل حالة Stripe.",
    retry: "إعادة المحاولة",
    noLive: "لا تستدعي هذه الصفحة Stripe. إنها تقرأ أدلة Waflo المخزنة والمطابقة.",
    noDangerousActions: "هذه واجهة تشخيصية. لا يمكنها تحصيل أو ربط أو تغيير اشتراك.",
  },
} as const;

export function stripeHealthCopy(locale: Locale) {
  return copy[locale];
}

export function stripeHealthMoney(
  amountMinor: string | null | undefined,
  currency: string | null | undefined,
  locale: Locale,
) {
  if (!amountMinor || !currency) return null;
  try {
    return formatMoney(BigInt(amountMinor), currency, locale);
  } catch {
    return null;
  }
}

export function stripeHealthDate(value: string | null, locale: Locale) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date);
}

export function stripeHealthIssueLabel(type: string, locale: Locale) {
  const english: Record<string, string> = {
    UNKNOWN_STRIPE_PRICE: "Unknown Stripe Price",
    STRIPE_PRICE_BINDING_MISMATCH: "Stripe Price binding mismatch",
    MISSING_PRICING_BINDING: "Missing pricing binding",
    PRICE_AMOUNT_MISMATCH: "Price amount mismatch",
    PRICE_CURRENCY_MISMATCH: "Price currency mismatch",
    PLAN_MISMATCH: "Plan mismatch",
    CADENCE_MISMATCH: "Cadence mismatch",
    PRICING_MARKET_MISMATCH: "Pricing market mismatch",
    MISSING_PRICING_SNAPSHOT: "Missing pricing snapshot",
    STRIPE_CUSTOMER_ORG_MISMATCH: "Customer / organization mismatch",
    SUBSCRIPTION_STATUS_MISMATCH: "Subscription status mismatch",
    RECONCILIATION_FAILURE: "Reconciliation failure",
    WEBHOOK_PROCESSING_FAILED: "Webhook processing failed",
    WEBHOOK_RETRY_BACKLOG: "Webhook retry backlog",
    FAILED_PAYMENT: "Failed payment",
    STALE_REPRICING_COMMAND: "Stale repricing command",
    REPRICING_COMMAND_FAILED: "Repricing command failed",
    EXPIRED_CHANGE_PREVIEW: "Expired change preview",
    PROVIDER_CONFIGURATION_MISMATCH: "Provider configuration mismatch",
  };
  const arabic: Record<string, string> = {
    UNKNOWN_STRIPE_PRICE: "سعر Stripe غير معروف",
    STRIPE_PRICE_BINDING_MISMATCH: "اختلاف ربط سعر Stripe",
    MISSING_PRICING_BINDING: "ربط تسعير مفقود",
    PRICE_AMOUNT_MISMATCH: "اختلاف مبلغ السعر",
    PRICE_CURRENCY_MISMATCH: "اختلاف عملة السعر",
    PLAN_MISMATCH: "اختلاف الخطة",
    CADENCE_MISMATCH: "اختلاف الدورية",
    PRICING_MARKET_MISMATCH: "اختلاف سوق التسعير",
    MISSING_PRICING_SNAPSHOT: "لقطة تسعير مفقودة",
    STRIPE_CUSTOMER_ORG_MISMATCH: "اختلاف العميل والمؤسسة",
    SUBSCRIPTION_STATUS_MISMATCH: "اختلاف حالة الاشتراك",
    RECONCILIATION_FAILURE: "فشل المطابقة",
    WEBHOOK_PROCESSING_FAILED: "فشلت معالجة Webhook",
    WEBHOOK_RETRY_BACKLOG: "تراكم إعادة محاولة Webhook",
    FAILED_PAYMENT: "دفعة فاشلة",
    STALE_REPRICING_COMMAND: "أمر إعادة تسعير متقادم",
    REPRICING_COMMAND_FAILED: "فشل أمر إعادة التسعير",
    EXPIRED_CHANGE_PREVIEW: "معاينة تغيير منتهية",
    PROVIDER_CONFIGURATION_MISMATCH: "اختلاف تهيئة المزوّد",
  };
  return (locale === "ar" ? arabic : english)[type] ?? type;
}

export function stripeHealthSeverityLabel(severity: HealthSeverity, locale: Locale) {
  const text = stripeHealthCopy(locale);
  if (severity === "CRITICAL") return text.critical;
  if (severity === "WARNING") return text.warning;
  if (severity === "INFO") return text.info;
  return text.healthy;
}
