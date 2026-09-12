import { formatMoney } from "@waflo/billing";
import type { Locale } from "@waflo/contracts";

export const adminAnalyticsRanges = ["7D", "30D", "90D", "YTD", "1Y"] as const;
export type AdminAnalyticsRange = (typeof adminAnalyticsRanges)[number];

export interface AdminCurrencyAmount {
  currency: string;
  amountMinor: string;
}

export interface AdminOperationalAnalytics {
  generatedAt: string;
  range: {
    key: AdminAnalyticsRange;
    start: string;
    end: string;
    bucket: "DAY" | "MONTH";
    timezone: "UTC";
  };
  counts: {
    totalOrganizations: number;
    activeSubscribers: number;
    trialingSubscribers: number;
    pastDueSubscribers: number;
    canceledSubscriptions: number;
    grandfatheredSubscribers: number;
    scheduledRepricingSubscribers: number;
  };
  statusBreakdown: Array<{ status: string; count: number }>;
  planBreakdown: Array<{ plan: string; subscriberCount: number; trialCount: number }>;
  marketBreakdown: Array<{
    marketCode: string;
    countryCode: string | null;
    subscriberCount: number;
    trialCount: number;
    grandfatheredCount: number;
  }>;
  trials: {
    active: number;
    startedInRange: number;
    conversionSupported: boolean;
    evidenceCoverageStart: string | null;
    eligibleCompleted: number | null;
    converted: number | null;
    unconverted: number | null;
    conversionRate: number | null;
  };
  grandfathering: {
    total: number;
    currentPriceSubscribers: number;
    historicalVersionSubscribers: number;
    scheduledRepricingSubscribers: number;
  };
  trends: {
    newOrganizations: Array<{ bucket: string; count: number }>;
    newPaidSubscriptions: Array<{ bucket: string; count: number }>;
    trialConversions: Array<{ bucket: string; count: number }> | null;
  };
}

export interface AdminFinanceAnalytics {
  evidence: {
    available: boolean;
    coverageStart: string | null;
    selectedRangeComplete: boolean;
  };
  recurringRevenue: {
    mrr: AdminCurrencyAmount[];
    arr: AdminCurrencyAmount[];
    complete: boolean;
    unpricedActiveSubscriberCount: number;
    mrrDefinition: string;
    arrDefinition: string;
    reportingCurrencyTotal: null;
  };
  billed: { selectedRange: AdminCurrencyAmount[]; definition: string };
  collected: {
    selectedRange: AdminCurrencyAmount[];
    currentMonth: AdminCurrencyAmount[];
    currentYear: AdminCurrencyAmount[];
    definition: string;
  };
  refunds: { supported: false; selectedRange: null; reason: string };
  netCollected: { supported: false; selectedRange: null; reason: string };
  failedPaymentCount: number;
  planBreakdown: Array<{
    plan: string;
    activeSubscribers: number;
    mrr: AdminCurrencyAmount[];
    collected: AdminCurrencyAmount[];
  }>;
  marketBreakdown: Array<{
    marketCode: string;
    activeSubscribers: number;
    mrr: AdminCurrencyAmount[];
    collected: AdminCurrencyAmount[];
  }>;
  currencyBreakdown: Array<{
    currency: string;
    activeSubscribers: number;
    mrrAmountMinor: string;
    collectedAmountMinor: string;
    refundsAmountMinor: null;
  }>;
  unattributedCollected: AdminCurrencyAmount[];
  trends: {
    collectedRevenue: Array<{ bucket: string; totals: AdminCurrencyAmount[] }>;
  };
}

const copy = {
  en: {
    eyebrow: "OPERATING PULSE / UTC",
    title: "Overview",
    subtitle: "Subscription health and provider-verified revenue evidence.",
    active: "Active subscribers",
    trials: "Active trials",
    pastDue: "Past due",
    grandfathered: "Grandfathered",
    mrr: "Monthly recurring revenue",
    arr: "Annual recurring revenue",
    revenueMonth: "Collected this month",
    failedPayments: "Failed payments",
    organizations: "Organizations",
    scheduled: "Scheduled repricing",
    revenueTrend: "Collected revenue trend",
    status: "Subscription status",
    plans: "Plans",
    markets: "Pricing markets",
    plan: "Plan",
    subscribers: "Subscribers",
    market: "Market",
    currency: "Currency",
    collected: "Collected",
    evidencePartial: "Provider evidence is partial for this range",
    evidenceUnavailable: "No provider financial evidence has been recorded yet",
    unavailable: "Not available",
    noData: "No subscription activity is available for this range.",
    loading: "Loading operating analytics",
    retry: "Retry",
    range: "Reporting range",
    financeRestricted: "Financial metrics are not available to this administrator role.",
    nativeCurrencies: "Native currencies are reported separately; no FX conversion is applied.",
  },
  ar: {
    eyebrow: "نبض العمليات / UTC",
    title: "نظرة عامة",
    subtitle: "صحة الاشتراكات وأدلة الإيرادات الموثقة من مزود الدفع.",
    active: "الاشتراكات النشطة",
    trials: "التجارب النشطة",
    pastDue: "متأخر الدفع",
    grandfathered: "الأسعار القديمة",
    mrr: "الإيراد الشهري المتكرر",
    arr: "الإيراد السنوي المتكرر",
    revenueMonth: "المحصل هذا الشهر",
    failedPayments: "المدفوعات الفاشلة",
    organizations: "المؤسسات",
    scheduled: "إعادة التسعير المجدولة",
    revenueTrend: "اتجاه الإيراد المحصل",
    status: "حالة الاشتراكات",
    plans: "الخطط",
    markets: "أسواق التسعير",
    plan: "الخطة",
    subscribers: "المشتركون",
    market: "السوق",
    currency: "العملة",
    collected: "المحصل",
    evidencePartial: "أدلة مزود الدفع جزئية لهذه الفترة",
    evidenceUnavailable: "لم تُسجل أدلة مالية من مزود الدفع بعد",
    unavailable: "غير متاح",
    noData: "لا يوجد نشاط اشتراكات متاح لهذه الفترة.",
    loading: "جارٍ تحميل تحليلات العمليات",
    retry: "إعادة المحاولة",
    range: "فترة التقرير",
    financeRestricted: "المؤشرات المالية غير متاحة لدور المسؤول هذا.",
    nativeCurrencies: "تُعرض العملات الأصلية منفصلة من دون أي تحويل عملات.",
  },
} as const;

export function adminAnalyticsCopy(locale: Locale) {
  return copy[locale];
}

export function adminAnalyticsPath(kind: "overview" | "finance", range: AdminAnalyticsRange) {
  return `/v1/admin/analytics/${kind}?range=${range}`;
}

export function canViewAdminFinance(permissions: readonly string[]): boolean {
  return permissions.includes("admin.finance.read");
}

export function formatAdminAnalyticsMoney(
  amountMinor: string,
  currency: string,
  locale: Locale,
): string {
  return formatMoney(BigInt(amountMinor), currency, locale);
}

export function formatAdminAnalyticsCount(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === "ar" ? "ar" : "en").format(value);
}

export function rangeLabel(range: AdminAnalyticsRange, locale: Locale): string {
  const labels =
    locale === "ar"
      ? { "7D": "7 أيام", "30D": "30 يومًا", "90D": "90 يومًا", YTD: "منذ بداية السنة", "1Y": "سنة" }
      : { "7D": "7 days", "30D": "30 days", "90D": "90 days", YTD: "Year to date", "1Y": "1 year" };
  return labels[range];
}

export function statusLabel(status: string, locale: Locale): string {
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
  return (locale === "ar" ? arabic : english)[status] ?? status.replaceAll("_", " ");
}

export function planLabel(plan: string, locale: Locale): string {
  const english: Record<string, string> = {
    STARTER: "Starter",
    GROWTH: "Growth",
    SCALE: "Scale",
  };
  const arabic: Record<string, string> = {
    STARTER: "البداية",
    GROWTH: "النمو",
    SCALE: "التوسع",
  };
  return (locale === "ar" ? arabic : english)[plan] ?? plan;
}

export function moneyListState(values: readonly AdminCurrencyAmount[]) {
  return values.length === 0 ? "empty" : values.length === 1 ? "single" : "multiple";
}

export function revenueSeriesByCurrency(finance: AdminFinanceAnalytics | null) {
  if (!finance) return [];
  const currencies = new Set(
    finance.trends.collectedRevenue.flatMap((point) => point.totals.map((total) => total.currency)),
  );
  return [...currencies]
    .sort((left, right) => left.localeCompare(right))
    .map((currency) => ({
      currency,
      points: finance.trends.collectedRevenue.map((point) => ({
        bucket: point.bucket,
        amountMinor: point.totals.find((total) => total.currency === currency)?.amountMinor ?? "0",
      })),
    }));
}

export function safeBarPercent(value: bigint, maximum: bigint): number {
  if (maximum <= 0n || value <= 0n) return 0;
  return Math.max(2, Math.min(100, Number((value * 100n) / maximum)));
}
