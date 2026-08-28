import { formatMoney } from "@waflo/billing";
import type { Locale } from "@waflo/contracts";

export type PricingVersionStatus = "DRAFT" | "VALIDATED" | "CURRENT" | "RETIRED";

export interface AdminPricingVersion {
  id: string;
  version: number;
  plan: string;
  cadence: string;
  amountMinor: string;
  currency: string;
  status: PricingVersionStatus;
  rawStatus: string;
  stripeBinding: {
    status: "BOUND" | "UNBOUND";
    stripePriceReference: string | null;
    stripeProductReference: string | null;
  };
  createdAt: string;
  publishedAt: string | null;
  retiredAt: string | null;
  subscribers: number;
  grandfatheredSubscribers: number;
  trialingSubscribers: number;
}

export interface AdminPricingMarket {
  id: string;
  code: string;
  kind: "GLOBAL" | "COUNTRY_OVERRIDE";
  countryCode: string | null;
  configuredCurrency: string | null;
  active: boolean;
  fallbackMarketCode: string | null;
  createdAt: string;
  updatedAt: string;
  subscribers: number;
  grandfatheredSubscribers: number;
  trialingSubscribers: number;
  versions: AdminPricingVersion[];
}

export interface AdminPricingOverview {
  generatedAt: string;
  summary: {
    configuredMarkets: number;
    activePriceVersions: number;
    draftVersions: number;
    bindingIssues: number;
    grandfatheredSubscribers: number;
    upcomingRepricingSubscribers: number;
  };
  markets: AdminPricingMarket[];
  plans: string[];
  cadences: string[];
}

const copy = {
  en: {
    eyebrow: "COMMERCIAL CATALOG / WAFLO AUTHORITY",
    title: "Pricing",
    subtitle:
      "Fixed regional prices, immutable versions, and Stripe bindings for new subscriptions.",
    global: "GLOBAL pricing",
    regional: "Regional markets",
    configuredMarkets: "Configured markets",
    activeVersions: "Current prices",
    drafts: "Draft versions",
    bindingIssues: "Binding issues",
    grandfathered: "Grandfathered subscribers",
    scheduled: "Scheduled repricing",
    addMarket: "Add regional market",
    createDraft: "Create new version",
    market: "Market",
    country: "Country",
    currency: "Currency",
    plan: "Plan",
    status: "Status",
    cadence: "Cadence",
    amount: "Amount",
    reason: "Internal reason",
    active: "Active",
    inactive: "Inactive",
    current: "Current for new subscriptions",
    historical: "Historical / existing subscribers",
    draft: "Draft",
    validated: "Validated",
    retired: "Retired for new subscriptions",
    validate: "Validate",
    publish: "Publish price",
    retire: "Retire",
    saveDraft: "Save draft",
    binding: "Stripe binding",
    bound: "Bound",
    unbound: "Unbound",
    subscribers: "Subscribers",
    trialing: "Trials",
    viewCustomers: "View customers",
    loading: "Loading pricing catalog",
    retry: "Retry",
    empty: "No pricing versions have been created for this market.",
    failed: "Pricing catalog could not be loaded.",
    details: "Open market",
    previous: "Current price",
    newCustomerImpact: "New subscriptions use this version after publication.",
    existingImpact: "Existing subscribers remain on their current version.",
    stripeImpact: "A new immutable Stripe Price will be created and bound.",
    publishTitle: "Publish this price?",
    retireTitle: "Retire this price?",
    deactivateTitle: "Deactivate this market?",
    confirmPublish: "Publish price",
    confirmRetire: "Retire version",
    confirmDeactivate: "Deactivate market",
    cancel: "Cancel",
    password: "Administrator password",
    reauth: "Confirm sensitive action",
    reauthHint: "Re-enter your password to authorize this commercial change.",
    published: "Price published. Existing subscriptions were not changed.",
    draftSaved: "Draft saved.",
    validatedSuccess: "Price version validated.",
    retiredSuccess: "Price retired for new subscriptions.",
    marketCreated: "Regional market created.",
    back: "All pricing markets",
    matrix: "Plan × cadence matrix",
    history: "Version history",
    stripePrice: "Stripe Price",
    stripeProduct: "Stripe Product",
    noManualPrice: "Stripe Price IDs are created and bound by Waflo; they are never entered here.",
    regionalImpact:
      "Regional market configuration affects new subscriptions only. Existing subscriptions keep their locked market and version until an explicit migration.",
    globalSafety:
      "GLOBAL USD remains the fallback for every country without an active explicit override.",
    deactivate: "Deactivate market",
    activate: "Activate market",
    update: "Update market",
    required: "Required",
    allPrices: "All versions",
    filters: "Filters",
    clearFilters: "Clear filters",
    all: "All",
    yes: "Yes",
    no: "No",
    currentPrices: "Current prices",
    planRepricing: "Plan annual repricing",
    viewStripeHealth: "View Stripe Health",
  },
  ar: {
    eyebrow: "كتالوج تجاري / سلطة Waflo",
    title: "التسعير",
    subtitle: "أسعار إقليمية ثابتة وإصدارات غير قابلة للتغيير وروابط Stripe للاشتراكات الجديدة.",
    global: "تسعير GLOBAL",
    regional: "الأسواق الإقليمية",
    configuredMarkets: "الأسواق المُهيأة",
    activeVersions: "الأسعار الحالية",
    drafts: "الإصدارات المسودة",
    bindingIssues: "مشكلات الربط",
    grandfathered: "مشتركو السعر القديم",
    scheduled: "إعادة التسعير المجدولة",
    addMarket: "إضافة سوق إقليمي",
    createDraft: "إنشاء إصدار جديد",
    market: "السوق",
    country: "البلد",
    currency: "العملة",
    plan: "الخطة",
    status: "الحالة",
    cadence: "الدورية",
    amount: "المبلغ",
    reason: "سبب داخلي",
    active: "نشط",
    inactive: "غير نشط",
    current: "الحالي للاشتراكات الجديدة",
    historical: "سجل / مشتركون حاليون",
    draft: "مسودة",
    validated: "تم التحقق",
    retired: "متوقف للاشتراكات الجديدة",
    validate: "تحقق",
    publish: "نشر السعر",
    retire: "إيقاف",
    saveDraft: "حفظ المسودة",
    binding: "ربط Stripe",
    bound: "مربوط",
    unbound: "غير مربوط",
    subscribers: "المشتركون",
    trialing: "التجارب",
    viewCustomers: "عرض العملاء",
    loading: "جارٍ تحميل كتالوج التسعير",
    retry: "إعادة المحاولة",
    empty: "لم يتم إنشاء إصدارات تسعير لهذا السوق بعد.",
    failed: "تعذر تحميل كتالوج التسعير.",
    details: "فتح السوق",
    previous: "السعر الحالي",
    newCustomerImpact: "ستستخدم الاشتراكات الجديدة هذا الإصدار بعد النشر.",
    existingImpact: "يبقى المشتركون الحاليون على إصدارهم الحالي.",
    stripeImpact: "سيُنشأ سعر Stripe غير قابل للتغيير ويتم ربطه.",
    publishTitle: "نشر هذا السعر؟",
    retireTitle: "إيقاف هذا السعر؟",
    deactivateTitle: "إلغاء تفعيل هذا السوق؟",
    confirmPublish: "نشر السعر",
    confirmRetire: "إيقاف الإصدار",
    confirmDeactivate: "إلغاء تفعيل السوق",
    cancel: "إلغاء",
    password: "كلمة مرور المسؤول",
    reauth: "تأكيد الإجراء الحساس",
    reauthHint: "أعد إدخال كلمة المرور لتفويض هذا التغيير التجاري.",
    published: "تم نشر السعر. لم تتغير الاشتراكات الحالية.",
    draftSaved: "تم حفظ المسودة.",
    validatedSuccess: "تم التحقق من إصدار السعر.",
    retiredSuccess: "تم إيقاف السعر للاشتراكات الجديدة.",
    marketCreated: "تم إنشاء السوق الإقليمي.",
    back: "كل أسواق التسعير",
    matrix: "مصفوفة الخطة × الدورية",
    history: "سجل الإصدارات",
    stripePrice: "سعر Stripe",
    stripeProduct: "منتج Stripe",
    noManualPrice: "تنشئ Waflo معرّفات أسعار Stripe وتربطها؛ لا تُدخل هنا أبداً.",
    regionalImpact:
      "تؤثر تهيئة السوق الإقليمي في الاشتراكات الجديدة فقط. تحتفظ الاشتراكات الحالية بسوقها وإصدارها المقفلين إلى حين هجرة صريحة.",
    globalSafety: "يبقى GLOBAL بالدولار الأميركي بديلاً لكل بلد بلا تجاوز صريح نشط.",
    deactivate: "إلغاء تفعيل السوق",
    activate: "تفعيل السوق",
    update: "تحديث السوق",
    required: "مطلوب",
    allPrices: "كل الإصدارات",
    filters: "عوامل التصفية",
    clearFilters: "مسح عوامل التصفية",
    all: "الكل",
    yes: "نعم",
    no: "لا",
    currentPrices: "الأسعار الحالية",
    planRepricing: "تخطيط إعادة التسعير السنوية",
    viewStripeHealth: "عرض حالة Stripe",
  },
} as const;

export function adminPricingCopy(locale: Locale) {
  return copy[locale];
}

export function adminPricingMoney(amountMinor: string, currency: string, locale: Locale): string {
  return formatMoney(BigInt(amountMinor), currency, locale);
}

export function adminPricingStatusLabel(status: PricingVersionStatus, locale: Locale): string {
  const english: Record<PricingVersionStatus, string> = {
    DRAFT: "Draft",
    VALIDATED: "Validated",
    CURRENT: "Current",
    RETIRED: "Retired",
  };
  const arabic: Record<PricingVersionStatus, string> = {
    DRAFT: "مسودة",
    VALIDATED: "تم التحقق",
    CURRENT: "حالي",
    RETIRED: "متوقف",
  };
  return (locale === "ar" ? arabic : english)[status];
}

export function adminPricingDate(value: string | null, locale: Locale): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date);
}

export function adminPricingCustomerLink(
  locale: Locale,
  market: string,
  plan: string,
  grandfathered = false,
) {
  const query = new URLSearchParams({ market, plan });
  if (grandfathered) query.set("grandfathered", "yes");
  return `/${locale}/customers?${query.toString()}`;
}

export function pricingMarketPath(locale: Locale, marketId: string): string {
  return `/${locale}/pricing/${encodeURIComponent(marketId)}`;
}
