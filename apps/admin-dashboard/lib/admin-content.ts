import type { Locale } from "@waflo/contracts";

export const adminNavigation = [
  { key: "overview", href: "", permission: "admin.dashboard.read" },
  { key: "customers", href: "/customers", permission: "admin.customers.read" },
  { key: "pricing", href: "/pricing", permission: "admin.pricing.read" },
  { key: "repricing", href: "/repricing", permission: "admin.repricing.read" },
  { key: "finance", href: "/finance", permission: "admin.finance.read" },
  { key: "stripeHealth", href: "/stripe-health", permission: "admin.stripe_health.read" },
  { key: "audit", href: "/audit", permission: "admin.audit.read" },
  { key: "settings", href: "/settings", permission: "admin.dashboard.read" },
] as const;

export type AdminNavigationKey = (typeof adminNavigation)[number]["key"];

const copy = {
  en: {
    product: "Waflo control room",
    internal: "Internal operations",
    overview: "Overview",
    customers: "Customers",
    pricing: "Pricing",
    repricing: "Annual repricing",
    finance: "Finance",
    stripeHealth: "Stripe health",
    audit: "Audit log",
    settings: "Settings",
    comingSoon: "This operational surface is intentionally not enabled in this foundation round.",
    signOut: "Sign out",
    role: "Admin role",
    api: "API connectivity",
    environment: "Environment",
    session: "Session expires",
    connected: "Connected",
    permissions: "Granted capabilities",
    forbidden: "This role cannot open that section.",
    loginTitle: "Administrator sign in",
    loginIntro: "Use your provisioned Waflo internal account. Merchant accounts are not accepted.",
    email: "Email address",
    password: "Password",
    signIn: "Sign in to control room",
    loginError: "Sign-in could not be completed.",
    loading: "Verifying administrator session",
    sessionExpired: "Your administrator session ended. Sign in again.",
  },
  ar: {
    product: "غرفة تحكم Waflo",
    internal: "العمليات الداخلية",
    overview: "نظرة عامة",
    customers: "العملاء",
    pricing: "التسعير",
    repricing: "إعادة التسعير السنوية",
    finance: "المالية",
    stripeHealth: "حالة Stripe",
    audit: "سجل التدقيق",
    settings: "الإعدادات",
    comingSoon: "لم يتم تفعيل سطح العمليات هذا عمداً في جولة التأسيس الحالية.",
    signOut: "تسجيل الخروج",
    role: "دور المسؤول",
    api: "اتصال API",
    environment: "البيئة",
    session: "انتهاء الجلسة",
    connected: "متصل",
    permissions: "الصلاحيات الممنوحة",
    forbidden: "لا يسمح هذا الدور بفتح هذا القسم.",
    loginTitle: "تسجيل دخول المسؤول",
    loginIntro: "استخدم حساب Waflo الداخلي المخصص لك. حسابات التجار غير مقبولة.",
    email: "البريد الإلكتروني",
    password: "كلمة المرور",
    signIn: "الدخول إلى غرفة التحكم",
    loginError: "تعذر إكمال تسجيل الدخول.",
    loading: "جارٍ التحقق من جلسة المسؤول",
    sessionExpired: "انتهت جلسة المسؤول. سجل الدخول مجدداً.",
  },
} as const;

export function adminCopy(locale: Locale) {
  return copy[locale];
}

export function adminDirection(locale: Locale): "ltr" | "rtl" {
  return locale === "ar" ? "rtl" : "ltr";
}

export function visibleAdminNavigation(permissions: readonly string[]) {
  const granted = new Set(permissions);
  return adminNavigation.filter((item) => granted.has(item.permission));
}
