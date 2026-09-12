import type { Locale } from "@waflo/contracts";
import { formatAdminAnalyticsMoney } from "./admin-overview-analytics";

export const customerPageSizes = [25, 50, 100] as const;
export const customerStatuses = [
  "PENDING_ACTIVATION",
  "TRIALING",
  "ACTIVE",
  "PAST_DUE",
  "GRACE_PERIOD",
  "SUSPENDED",
  "CANCELED",
] as const;
export const customerPlans = ["STARTER", "GROWTH", "SCALE"] as const;

export interface AdminCustomerDirectoryItem {
  customerId: string;
  organization: {
    name: string;
    merchantSlug: string;
    status: string;
    onboardingState: string;
    createdAt: string;
    owner: { displayName: string; email: string; accountStatus: string } | null;
  };
  billing: {
    country: string | null;
    stripeCustomerReference: string | null;
    profileStatus: string | null;
    trialStart: string | null;
    trialEnd: string | null;
  };
  subscription: {
    stripeSubscriptionReference: string;
    plan: string;
    cadence: string;
    status: string;
    entitlement: { code: string; enrollmentAllowed: boolean; existingCardsViewable: boolean };
    market: string | null;
    currency: string | null;
    amountMinor: string | null;
    pricingVersionId: string | null;
    grandfathered: boolean;
    startedAt: string;
    nextRenewalAt: string | null;
    scheduledRepricing: boolean;
  } | null;
}

export interface AdminCustomerDirectoryResponse {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  items: AdminCustomerDirectoryItem[];
}

export interface AdminCustomerDetail {
  customerId: string;
  organization: {
    name: string;
    merchantSlug: string;
    businessCategory: string | null;
    locale: "en" | "ar";
    timezone: string;
    status: string;
    billingCountry: string | null;
    onboardingState: string;
    onboardingCompletedAt: string | null;
    createdAt: string;
    owner: {
      displayName: string;
      email: string;
      accountStatus: string;
      joinedAt: string;
      lastLoginAt: string | null;
    } | null;
  };
  account: {
    activeProgramCount: number;
    publishedProgramCount: number;
    latestProgramPublicationAt: string | null;
  };
  trial: {
    contractDays: number;
    start: string | null;
    end: string | null;
    status: string;
    converted: boolean | null;
    convertedAt: string | null;
  };
  subscription: {
    stripeCustomerReference: string | null;
    stripeSubscriptionReference: string;
    stripePriceReference: string;
    plan: string;
    cadence: string;
    status: string;
    entitlement: { code: string; enrollmentAllowed: boolean; existingCardsViewable: boolean };
    startedAt: string;
    currentPeriodStart: string | null;
    nextRenewalAt: string | null;
    cancelAtPeriodEnd: boolean;
    canceledAt: string | null;
    commercialTerms: {
      market: string | null;
      pricingVersionId: string | null;
      pricingVersion: PricingVersionReference | null;
      amountMinor: string | null;
      currency: string | null;
      grandfathered: boolean;
      currentCatalogVersion: null;
    };
  } | null;
  pricingHistory: PricingHistoryItem[];
  subscriptionChanges: SubscriptionChangeHistoryItem[];
  repricingHistory: RepricingHistoryItem[];
  audit: AuditEntry[];
  financial?: CustomerFinancialDetail;
}

interface PricingVersionReference {
  id: string;
  version: number;
  plan: string;
  cadence: string;
  market: string;
  currency: string;
  amountMinor: string;
  stripePriceReference: string | null;
}

interface PricingHistoryItem {
  subscriptionReference: string;
  plan: string;
  cadence: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  market: string | null;
  pricingVersionId: string | null;
  pricingVersion: PricingVersionReference | null;
  currency: string | null;
  amountMinor: string | null;
  stripePriceReference: string;
  grandfathered: boolean;
}

interface SubscriptionChangeHistoryItem {
  previewId: string;
  subscriptionReference: string;
  source: ChangeTerms;
  target: ChangeTerms;
  proration: { amountDueNowMinor: string; creditAmountMinor: string };
  status: string;
  createdAt: string;
  expiresAt: string;
  confirmedAt: string | null;
  invalidatedAt: string | null;
}

interface ChangeTerms {
  plan: string;
  cadence: string;
  pricingVersionId: string;
  stripePriceReference: string;
  currency: string;
  amountMinor: string;
}

interface RepricingHistoryItem {
  commandId: string;
  subscriptionReference: string;
  status: string;
  effectiveAt: string;
  createdAt: string;
  updatedAt: string;
  notice: {
    status: string;
    createdAt: string | null;
    snapshot: {
      marketCode: string | null;
      sourcePricingVersionId: string | null;
      targetPricingVersionId: string | null;
      sourceCurrency: string | null;
      sourceAmountMinor: string | null;
      targetCurrency: string | null;
      targetAmountMinor: string | null;
      noticeDays: string | null;
      effectiveRenewalAt: string | null;
      replacesCommandId: string | null;
    } | null;
  };
  targetPricingVersion: PricingVersionReference | null;
  replacesCommandId: string | null;
  replacedByCommandId: string | null;
  failureCode: string | null;
}

interface AuditEntry {
  id: string;
  occurredAt: string;
  actor: { type: string; displayName: string | null; role: string | null };
  action: string;
  targetType: string;
  targetReference: string | null;
  metadata: unknown;
}

interface CustomerFinancialDetail {
  historicalDataMayBePartial: true;
  collected: Array<{ currency: string; amountMinor: string }>;
  paidInvoiceCount: number;
  failedPaymentCount: number;
  invoices: Array<{
    stripeInvoiceReference: string;
    currency: string;
    amountDueMinor: string | null;
    amountPaidMinor: string | null;
    status: "BILLED" | "PAID" | "PAYMENT_FAILED";
    finalizedAt: string | null;
    paidAt: string | null;
    failedAt: string | null;
    plan: string | null;
    market: string | null;
    billingReason: null;
  }>;
  refunds: { supported: false; reason: string };
}

const copy = {
  en: {
    eyebrow: "CUSTOMER LEDGER / READ ONLY",
    title: "Customers",
    subtitle:
      "Search the canonical organization and billing record. Changes are not available here.",
    search: "Search name, ID, owner email, Stripe customer or subscription",
    status: "Status",
    plan: "Plan",
    market: "Market",
    country: "Country",
    currency: "Currency",
    grandfathered: "Grandfathered",
    scheduled: "Scheduled price change",
    createdFrom: "Joined from",
    createdTo: "Joined to",
    joined: "Joined",
    renewal: "Renewal",
    customer: "Customer",
    price: "Price",
    trial: "Trial",
    clear: "Clear filters",
    all: "All",
    yes: "Yes",
    no: "No",
    sort: "Sort",
    newest: "Newest joined",
    oldest: "Oldest joined",
    nameAZ: "Name A–Z",
    statusSort: "Status",
    previous: "Previous",
    next: "Next",
    page: "Page",
    of: "of",
    loading: "Loading customer records",
    retry: "Retry",
    empty: "No customers match these filters.",
    details: "View customer record",
    overview: "Overview",
    subscription: "Subscription",
    billingHistory: "Billing history",
    pricingHistory: "Pricing history",
    repricing: "Annual repricing",
    audit: "Audit",
    back: "All customers",
    organization: "Organization",
    account: "Account",
    owner: "Owner",
    businessCountry: "Billing country",
    created: "Created",
    subscriptionStatus: "Subscription status",
    entitlement: "Entitlement",
    cadence: "Cadence",
    started: "Started",
    periodStart: "Current period start",
    stripeCustomer: "Stripe customer",
    stripeSubscription: "Stripe subscription",
    stripePrice: "Stripe price",
    pricingVersion: "Pricing version",
    currentTerms: "Current commercial terms",
    noSubscription: "No canonical subscription has been recorded.",
    trialContract: "Trial contract",
    trialStarted: "Trial start",
    trialEnds: "Trial end",
    conversion: "Trial conversion",
    notProven: "Not proven from recorded payment evidence",
    activePrograms: "Active programs",
    publishedPrograms: "Published programs",
    noHistory: "No recorded history is available.",
    source: "From",
    target: "To",
    dueNow: "Due now",
    credit: "Credit",
    notice: "Notice",
    effective: "Effective renewal",
    replaces: "Replaces",
    replacedBy: "Replaced by",
    partialHistory: "Historical provider evidence may be partial.",
    collected: "Collected",
    paidInvoices: "Paid invoices",
    failedPayments: "Failed payments",
    invoice: "Invoice",
    amountDue: "Amount due",
    amountPaid: "Amount paid",
    refundsUnavailable: "Refund evidence is not yet available.",
    noFinance: "Financial evidence is not available to this administrator role.",
    billingHealth: "Billing health",
    healthy: "Healthy",
    failed: "Customer records could not be loaded.",
  },
  ar: {
    eyebrow: "سجل العملاء / للقراءة فقط",
    title: "العملاء",
    subtitle: "ابحث في سجل المؤسسة والفوترة المعتمد. لا تتوفر التغييرات هنا.",
    search: "ابحث بالاسم أو المعرّف أو بريد المالك أو عميل Stripe أو الاشتراك",
    status: "الحالة",
    plan: "الخطة",
    market: "السوق",
    country: "البلد",
    currency: "العملة",
    grandfathered: "السعر القديم",
    scheduled: "تغيير سعر مجدول",
    createdFrom: "تاريخ الانضمام من",
    createdTo: "تاريخ الانضمام إلى",
    joined: "تاريخ الانضمام",
    renewal: "التجديد",
    customer: "العميل",
    price: "السعر",
    trial: "التجربة",
    clear: "مسح عوامل التصفية",
    all: "الكل",
    yes: "نعم",
    no: "لا",
    sort: "الترتيب",
    newest: "الأحدث انضماماً",
    oldest: "الأقدم انضماماً",
    nameAZ: "الاسم أ–ي",
    statusSort: "الحالة",
    previous: "السابق",
    next: "التالي",
    page: "الصفحة",
    of: "من",
    loading: "جارٍ تحميل سجلات العملاء",
    retry: "إعادة المحاولة",
    empty: "لا يوجد عملاء يطابقون عوامل التصفية.",
    details: "عرض سجل العميل",
    overview: "نظرة عامة",
    subscription: "الاشتراك",
    billingHistory: "سجل الفوترة",
    pricingHistory: "سجل التسعير",
    repricing: "إعادة التسعير السنوية",
    audit: "التدقيق",
    back: "كل العملاء",
    organization: "المؤسسة",
    account: "الحساب",
    owner: "المالك",
    businessCountry: "بلد الفوترة",
    created: "تاريخ الإنشاء",
    subscriptionStatus: "حالة الاشتراك",
    entitlement: "الاستحقاق",
    cadence: "الدورية",
    started: "تاريخ البدء",
    periodStart: "بداية الفترة الحالية",
    stripeCustomer: "عميل Stripe",
    stripeSubscription: "اشتراك Stripe",
    stripePrice: "سعر Stripe",
    pricingVersion: "نسخة التسعير",
    currentTerms: "الشروط التجارية الحالية",
    noSubscription: "لم يتم تسجيل اشتراك معتمد.",
    trialContract: "عقد التجربة",
    trialStarted: "بداية التجربة",
    trialEnds: "نهاية التجربة",
    conversion: "تحويل التجربة",
    notProven: "غير مثبت من أدلة الدفع المسجلة",
    activePrograms: "البرامج النشطة",
    publishedPrograms: "البرامج المنشورة",
    noHistory: "لا يوجد سجل مسجل متاح.",
    source: "من",
    target: "إلى",
    dueNow: "المستحق الآن",
    credit: "الرصيد",
    notice: "الإشعار",
    effective: "تجديد نافذ",
    replaces: "يستبدل",
    replacedBy: "استُبدل بواسطة",
    partialHistory: "قد تكون أدلة مزود الدفع التاريخية جزئية.",
    collected: "المحصل",
    paidInvoices: "الفواتير المدفوعة",
    failedPayments: "الدفعات الفاشلة",
    invoice: "الفاتورة",
    amountDue: "المبلغ المستحق",
    amountPaid: "المبلغ المدفوع",
    refundsUnavailable: "أدلة الاسترداد غير متاحة بعد.",
    noFinance: "الأدلة المالية غير متاحة لدور المسؤول هذا.",
    billingHealth: "حالة الفوترة",
    healthy: "سليم",
    failed: "تعذر تحميل سجلات العملاء.",
  },
} as const;

export function adminCustomersCopy(locale: Locale) {
  return copy[locale];
}

export function adminCustomersPath(parameters: URLSearchParams): string {
  const query = parameters.toString();
  return `/v1/admin/customers${query ? `?${query}` : ""}`;
}

export function adminCustomerDetailPath(customerId: string): string {
  return `/v1/admin/customers/${encodeURIComponent(customerId)}`;
}

export function customerStatusLabel(status: string | null, locale: Locale): string {
  const english: Record<string, string> = {
    PENDING_ACTIVATION: "Pending activation",
    TRIALING: "Trialing",
    ACTIVE: "Active",
    PAST_DUE: "Past due",
    GRACE_PERIOD: "Grace period",
    SUSPENDED: "Suspended",
    CANCELED: "Canceled",
  };
  const arabic: Record<string, string> = {
    PENDING_ACTIVATION: "بانتظار التفعيل",
    TRIALING: "فترة تجريبية",
    ACTIVE: "نشط",
    PAST_DUE: "متأخر الدفع",
    GRACE_PERIOD: "فترة سماح",
    SUSPENDED: "معلّق",
    CANCELED: "ملغى",
  };
  return (locale === "ar" ? arabic : english)[status ?? ""] ?? status ?? "—";
}

export function customerPlanLabel(plan: string | null, locale: Locale): string {
  const english: Record<string, string> = { STARTER: "Starter", GROWTH: "Growth", SCALE: "Scale" };
  const arabic: Record<string, string> = { STARTER: "البداية", GROWTH: "النمو", SCALE: "التوسع" };
  return (locale === "ar" ? arabic : english)[plan ?? ""] ?? plan ?? "—";
}

export function customerCadenceLabel(cadence: string | null, locale: Locale): string {
  const english: Record<string, string> = {
    MONTHLY: "Monthly",
    QUARTERLY: "Quarterly",
    YEARLY: "Yearly",
  };
  const arabic: Record<string, string> = {
    MONTHLY: "شهري",
    QUARTERLY: "كل 3 أشهر",
    YEARLY: "سنوي",
  };
  return (locale === "ar" ? arabic : english)[cadence ?? ""] ?? cadence ?? "—";
}

export function customerInvoiceStatusLabel(status: string, locale: Locale): string {
  const english: Record<string, string> = {
    BILLED: "Billed",
    PAID: "Paid",
    PAYMENT_FAILED: "Payment failed",
  };
  const arabic: Record<string, string> = {
    BILLED: "مفوترة",
    PAID: "مدفوعة",
    PAYMENT_FAILED: "فشلت الدفعة",
  };
  return (locale === "ar" ? arabic : english)[status] ?? status;
}

export function formatCustomerMoney(
  amountMinor: string | null,
  currency: string | null,
  locale: Locale,
): string | null {
  return amountMinor && currency ? formatAdminAnalyticsMoney(amountMinor, currency, locale) : null;
}

export function formatCustomerDate(value: string | null, locale: Locale): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(parsed);
}

export function canViewCustomerFinance(permissions: readonly string[]): boolean {
  return permissions.includes("admin.finance.read");
}

export function customerQueryWith(
  current: URLSearchParams,
  patch: Record<string, string | null>,
): URLSearchParams {
  const next = new URLSearchParams(current.toString());
  for (const [key, value] of Object.entries(patch)) {
    if (!value || value === "all" || (key === "page" && value === "1")) next.delete(key);
    else next.set(key, value);
  }
  return next;
}
