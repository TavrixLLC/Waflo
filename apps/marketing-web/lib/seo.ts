import type { Locale } from "@waflo/contracts";
import type { Metadata } from "next";

export const marketingOrigin = "https://waflo.app";
export const marketingSocialImage = "/brand/waflo-open-graph-1200x630.png";
export const publicMarketingPaths = ["", "/pricing", "/contact", "/privacy", "/terms"] as const;

export type MarketingPage = "home" | "pricing" | "contact" | "privacy" | "terms";

const pageCopy: Record<
  MarketingPage,
  Record<
    Locale,
    { title: string; description: string; path: (typeof publicMarketingPaths)[number] }
  >
> = {
  home: {
    en: {
      title: "Wallet-first loyalty for local businesses",
      description:
        "Create digital loyalty cards for Customer Web, Apple Wallet, and Google Wallet—without requiring customers to install another app.",
      path: "",
    },
    ar: {
      title: "ولاء رقمي يبدأ من المحفظة للأعمال المحلية",
      description:
        "أنشئ بطاقات ولاء رقمية للويب وApple Wallet وGoogle Wallet من دون مطالبة العملاء بتثبيت تطبيق إضافي.",
      path: "",
    },
  },
  pricing: {
    en: {
      title: "Pricing for digital loyalty",
      description:
        "Compare Waflo monthly plans for loyalty programs, business locations, team seats, customization, and analytics.",
      path: "/pricing",
    },
    ar: {
      title: "أسعار برامج الولاء الرقمية",
      description:
        "قارن خطط Waflo الشهرية لبرامج الولاء والفروع ومقاعد الفريق والتخصيص والتحليلات.",
      path: "/pricing",
    },
  },
  contact: {
    en: {
      title: "Contact and support",
      description: "Contact Waflo about merchant setup, digital loyalty cards, or account support.",
      path: "/contact",
    },
    ar: {
      title: "التواصل والدعم",
      description: "تواصل مع Waflo بشأن إعداد حساب التاجر أو بطاقات الولاء الرقمية أو دعم الحساب.",
      path: "/contact",
    },
  },
  privacy: {
    en: {
      title: "Privacy Policy",
      description:
        "Read the Waflo Privacy Policy covering the platform's current data-handling principles.",
      path: "/privacy",
    },
    ar: {
      title: "سياسة الخصوصية",
      description: "اطّلع على سياسة خصوصية Waflo ومبادئ معالجة البيانات الحالية في المنصة.",
      path: "/privacy",
    },
  },
  terms: {
    en: {
      title: "Terms of Service",
      description: "Read the current terms governing merchant use of the Waflo platform.",
      path: "/terms",
    },
    ar: {
      title: "شروط الخدمة",
      description: "اطّلع على الشروط الحالية التي تنظّم استخدام التجار لمنصة Waflo.",
      path: "/terms",
    },
  },
};

export function localizedMarketingUrl(locale: Locale, path = ""): string {
  return `${marketingOrigin}/${locale}${path}`;
}

export function alternateMarketingUrls(path = "") {
  return {
    en: localizedMarketingUrl("en", path),
    ar: localizedMarketingUrl("ar", path),
    "x-default": localizedMarketingUrl("en", path),
  };
}

export function isStagingDeployment(
  deploymentEnvironment = process.env.DEPLOYMENT_ENVIRONMENT,
): boolean {
  return deploymentEnvironment === "staging";
}

export function createMarketingMetadata(locale: Locale, page: MarketingPage): Metadata {
  const content = pageCopy[page][locale];
  const url = localizedMarketingUrl(locale, content.path);
  const socialTitle = `${content.title} · Waflo`;

  return {
    title: content.title,
    description: content.description,
    alternates: {
      canonical: url,
      languages: alternateMarketingUrls(content.path),
    },
    openGraph: {
      type: "website",
      siteName: "Waflo",
      url,
      title: socialTitle,
      description: content.description,
      images: [
        {
          url: marketingSocialImage,
          width: 1200,
          height: 630,
          alt: locale === "ar" ? "Waflo — الولاء صار أسهل" : "Waflo — Loyalty that flows",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: socialTitle,
      description: content.description,
      images: [marketingSocialImage],
    },
    ...(isStagingDeployment()
      ? {
          robots: {
            index: false,
            follow: false,
            nocache: true,
          },
        }
      : {}),
  };
}

export function configuredSupportEmail(value = process.env.SUPPORT_EMAIL): string | null {
  const candidate = value?.trim() ?? "";
  if (
    !candidate ||
    candidate.startsWith("REPLACE_") ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)
  ) {
    return null;
  }
  return candidate;
}

export function configuredLegalEffectiveDate(
  locale: Locale,
  value = process.env.LEGAL_EFFECTIVE_DATE,
): string {
  const candidate = value?.trim() ?? "";
  if (
    !candidate ||
    candidate === "LEGAL_REVIEW_REQUIRED" ||
    candidate === "To be confirmed after legal review" ||
    candidate.startsWith("REPLACE_")
  ) {
    return locale === "ar" ? "يُحدد بعد المراجعة القانونية" : "To be confirmed after legal review";
  }
  return candidate;
}

export function marketingStructuredData() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${marketingOrigin}/#organization`,
        name: "Waflo",
        legalName: "Tavrix LLC",
        url: marketingOrigin,
        logo: `${marketingOrigin}/brand/waflo-logo-primary-horizontal.svg`,
      },
      {
        "@type": "WebSite",
        "@id": `${marketingOrigin}/#website`,
        name: "Waflo",
        url: marketingOrigin,
        inLanguage: ["en", "ar"],
        publisher: { "@id": `${marketingOrigin}/#organization` },
      },
    ],
  };
}
