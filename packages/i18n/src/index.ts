import type { Locale } from "@waflo/contracts";

export const directions: Readonly<Record<Locale, "ltr" | "rtl">> = {
  en: "ltr",
  ar: "rtl",
};

export function isLocale(value: string): value is Locale {
  return value === "en" || value === "ar";
}

export function directionFor(locale: Locale): "ltr" | "rtl" {
  return directions[locale];
}

export function localePath(locale: Locale, path = ""): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `/${locale}${normalizedPath === "/" ? "" : normalizedPath}`;
}

export const messages = {
  en: {
    brandTagline: "Loyalty that flows.",
    navigation: {
      home: "Home",
      pricing: "Pricing",
      contact: "Contact",
      login: "Log in",
      signup: "Start free",
    },
    trial: {
      pending:
        "7 days free. Add a payment method now; your first charge is shown before you confirm.",
    },
  },
  ar: {
    brandTagline: "الولاء صار أسهل",
    navigation: {
      home: "الرئيسية",
      pricing: "الأسعار",
      contact: "تواصل معنا",
      login: "تسجيل الدخول",
      signup: "ابدأ مجاناً",
    },
    trial: {
      pending: "7 أيام مجاناً. أضف طريقة الدفع الآن، وسنوضح لك موعد أول دفعة قبل التأكيد.",
    },
  },
} as const;

export function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(value: Date | string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-IQ-u-nu-latn" : "en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
}
