import { formatMoney } from "@waflo/billing";
import type { Locale } from "@waflo/contracts";

export type RepricingCampaignStatus =
  | "PREVIEWED"
  | "SCHEDULED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "PARTIAL_FAILURE"
  | "CANCELED"
  | "SUPERSEDED";

export interface RepricingCampaign {
  campaignId: string;
  status: RepricingCampaignStatus;
  market: { id: string; code: string; countryCode: string | null };
  plan: string;
  cadence: string;
  target: { pricingVersionId: string; version: number; currency: string; amountMinor: string };
  effectiveOnOrAfter: string;
  noticeDays: number;
  previewedAt: string;
  previewExpiresAt: string;
  scheduledAt: string | null;
  canceledAt: string | null;
  replacesCampaignId: string | null;
  replacedByCampaignId: string | null;
  impact: RepricingImpact;
}

export interface RepricingImpact {
  marketCode: string;
  plan: string;
  cadence: string;
  targetPricingVersionId: string;
  targetVersion: number;
  currency: string;
  targetAmountMinor: string;
  effectiveOnOrAfter: string;
  noticeDays: number;
  eligibleCount: number;
  excludedCount: number;
  monthlySubscribers: number;
  annualSubscribers: number;
  earliestEffectiveRenewal: string | null;
  latestKnownRenewal: string | null;
  currentMrrMinor: string;
  projectedMrrMinor: string;
  monthlyDeltaMinor: string;
  annualizedDeltaMinor: string;
  sourceVersions: Array<{ versionId: string; subscribers: number; amountMinor: string }>;
  exclusions: Record<string, number>;
}

export interface RepricingOverview {
  generatedAt: string;
  summary: {
    grandfatheredSubscribers: number;
    eligibleForRepricing: number;
    scheduled: number;
    pending: number;
    executed: number;
    failed: number;
    canceled: number;
    superseded: number;
    upcomingRenewals: number;
    marketsWithGrandfatheredSubscribers: number;
  };
  campaigns: RepricingCampaign[];
}

export interface RepricingSubscribers {
  page: number;
  pageSize: number;
  total: number;
  rows: Array<{
    customer: { publicId: string; name: string };
    currentPricingVersionId: string | null;
    targetPricingVersionId: string;
    currentVersion: number | null;
    targetVersion: number | null;
    currentAmountMinor: string | null;
    targetAmountMinor: string | null;
    currency: string | null;
    status: string;
    noticeStatus: string | null;
    expectedRenewalAt: string | null;
    executedAt: string | null;
    failureCode: string | null;
  }>;
}

const copy = {
  en: {
    eyebrow: "RENEWAL POLICY / GRANDMOTHERED TERMS",
    title: "Annual repricing",
    subtitle:
      "Review a cohort first. Each approved change happens only at a subscriber’s eligible normal renewal.",
    newCampaign: "Plan annual repricing",
    grandfathered: "Grandfathered",
    eligible: "Eligible",
    scheduled: "Scheduled",
    created: "Created",
    pending: "Pending",
    executed: "Executed",
    failed: "Failed",
    canceled: "Canceled",
    superseded: "Superseded",
    upcomingRenewals: "Upcoming renewals",
    markets: "Markets with grandfathered subscribers",
    campaigns: "Campaigns",
    market: "Market",
    plan: "Plan",
    cadence: "Cadence",
    target: "Target version",
    effective: "Effective on or after",
    noticeDays: "Notice period (days)",
    preview: "Preview repricing",
    schedule: "Schedule repricing",
    replace: "Replace target",
    cancelCampaign: "Cancel repricing",
    currentPrice: "Current price",
    currentVersion: "Current version",
    newPrice: "New price",
    targetVersion: "Target version",
    currentMrr: "Current MRR",
    projectedMrr: "Projected MRR",
    monthlyDelta: "Monthly change",
    annualizedDelta: "Annualized change",
    excluded: "Excluded",
    annual: "Annual subscribers remain on their paid term until annual renewal.",
    noProration: "No platform repricing proration or mid-cycle charge will be created.",
    renewals: "Each subscriber changes at the first eligible normal renewal on or after this date.",
    historical: "Historical invoices and original command evidence are never rewritten.",
    reauth: "Administrator password",
    confirmSchedule: "Confirm schedule",
    confirmCancel: "Confirm cancellation",
    confirmReplace: "Confirm replacement",
    customer: "Customer",
    status: "Status",
    notice: "Notice",
    renewal: "Expected renewal",
    failure: "Failure",
    viewCustomer: "View customer",
    loading: "Loading repricing operations",
    retry: "Retry",
    empty: "No repricing campaigns have been created.",
    error: "Repricing operations could not be completed.",
    previewExpired: "This preview expired. Create a fresh preview before scheduling.",
    previewReady: "Review the cohort and impact before scheduling.",
    scheduleSuccess: "Repricing commands were scheduled. No subscriptions were changed now.",
    cancelSuccess: "Pending repricing commands were canceled. Executed commands remain historical.",
    replaceSuccess:
      "A replacement campaign was scheduled. The original pending commands are superseded.",
    back: "All annual repricing",
    all: "All",
    previous: "Previous target",
    replacement: "Replacement",
    noFinance: "Financial impact is available only while planning a permitted repricing operation.",
  },
  ar: {
    eyebrow: "سياسة التجديد / الشروط المُستبقة",
    title: "إعادة التسعير السنوية",
    subtitle: "راجع المجموعة أولاً. لا يحدث كل تغيير إلا عند التجديد الطبيعي المؤهل للمشترك.",
    newCampaign: "تخطيط إعادة التسعير السنوية",
    grandfathered: "مشتركو السعر السابق",
    eligible: "المؤهلون",
    scheduled: "مجدول",
    created: "تم إنشاؤه",
    pending: "قيد الانتظار",
    executed: "منفذ",
    failed: "فشل",
    canceled: "ملغى",
    superseded: "تم استبداله",
    upcomingRenewals: "التجديدات القادمة",
    markets: "أسواق بها مشتركون بأسعار سابقة",
    campaigns: "الحملات",
    market: "السوق",
    plan: "الخطة",
    cadence: "الدورية",
    target: "الإصدار المستهدف",
    effective: "يسري في أو بعد",
    noticeDays: "فترة الإشعار (أيام)",
    preview: "معاينة إعادة التسعير",
    schedule: "جدولة إعادة التسعير",
    replace: "استبدال السعر المستهدف",
    cancelCampaign: "إلغاء إعادة التسعير",
    currentPrice: "السعر الحالي",
    currentVersion: "الإصدار الحالي",
    newPrice: "السعر الجديد",
    targetVersion: "الإصدار المستهدف",
    currentMrr: "الإيراد الشهري الحالي",
    projectedMrr: "الإيراد الشهري المتوقع",
    monthlyDelta: "التغير الشهري",
    annualizedDelta: "التغير السنوي",
    excluded: "مستبعد",
    annual: "يبقى المشتركون السنويون على مدتهم المدفوعة حتى التجديد السنوي.",
    noProration: "لن يتم إنشاء تسوية أو رسوم منتصف الدورة لإعادة التسعير من المنصة.",
    renewals: "يتغير كل مشترك في أول تجديد طبيعي مؤهل في هذا التاريخ أو بعده.",
    historical: "لا يعاد كتابة الفواتير التاريخية أو دليل الأوامر الأصلية.",
    reauth: "كلمة مرور المسؤول",
    confirmSchedule: "تأكيد الجدولة",
    confirmCancel: "تأكيد الإلغاء",
    confirmReplace: "تأكيد الاستبدال",
    customer: "العميل",
    status: "الحالة",
    notice: "الإشعار",
    renewal: "التجديد المتوقع",
    failure: "الفشل",
    viewCustomer: "عرض العميل",
    loading: "جارٍ تحميل عمليات إعادة التسعير",
    retry: "إعادة المحاولة",
    empty: "لم يتم إنشاء حملات إعادة تسعير بعد.",
    error: "تعذر إكمال عملية إعادة التسعير.",
    previewExpired: "انتهت هذه المعاينة. أنشئ معاينة جديدة قبل الجدولة.",
    previewReady: "راجع المجموعة والأثر قبل الجدولة.",
    scheduleSuccess: "تمت جدولة أوامر إعادة التسعير. لم تتغير الاشتراكات الآن.",
    cancelSuccess: "ألغيت الأوامر المعلقة. تبقى الأوامر المنفذة حقائق تاريخية.",
    replaceSuccess: "تمت جدولة حملة بديلة. استُبدلت الأوامر الأصلية المعلقة.",
    back: "كل عمليات إعادة التسعير السنوية",
    all: "الكل",
    previous: "السعر المستهدف السابق",
    replacement: "البديل",
    noFinance: "الأثر المالي متاح فقط أثناء تخطيط عملية إعادة تسعير مسموح بها.",
  },
} as const;

export function repricingCopy(locale: Locale) {
  return copy[locale];
}
export function repricingMoney(amountMinor: string, currency: string, locale: Locale) {
  return formatMoney(BigInt(amountMinor), currency, locale);
}
export function repricingDate(value: string | null, locale: Locale) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
}
export function repricingPath(locale: Locale, campaignId: string) {
  return `/${locale}/repricing/${encodeURIComponent(campaignId)}`;
}
