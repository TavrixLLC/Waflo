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
        "Your 15-day free trial has not started yet. It will begin when you publish your first loyalty program.",
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
      pending: "لم تبدأ تجربتك المجانية لمدة 15 يوماً بعد. ستبدأ عند نشر أول برنامج ولاء.",
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
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-IQ" : "en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
}
