import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { directionFor, isLocale } from "@waflo/i18n";
import { createMarketingMetadata, marketingOrigin } from "../../lib/seo";
import "../globals.css";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const home = createMarketingMetadata(locale, "home");
  return {
    ...home,
    metadataBase: new URL(marketingOrigin),
    title: {
      default: locale === "ar" ? "Waflo — الولاء صار أسهل" : "Waflo — Loyalty that flows",
      template: "%s · Waflo",
    },
    manifest: "/site.webmanifest",
    icons: {
      icon: [{ url: "/brand/favicon.svg", type: "image/svg+xml" }, { url: "/favicon.ico" }],
      apple: "/apple-touch-icon-180.png",
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <html lang={locale} dir={directionFor(locale)}>
      <body>{children}</body>
    </html>
  );
}
