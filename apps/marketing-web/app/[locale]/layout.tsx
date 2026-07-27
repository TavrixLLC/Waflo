import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { brandAssets } from "@waflo/brand";
import { directionFor, isLocale } from "@waflo/i18n";
import "../globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_MARKETING_URL ?? "http://localhost:3000"),
  title: {
    default: "Waflo — Wallet-first loyalty for local businesses",
    template: "%s · Waflo",
  },
  description:
    "Build flexible digital loyalty experiences designed for Apple Wallet and Google Wallet—without asking customers to install another app.",
  manifest: "/site.webmanifest",
  icons: {
    icon: [{ url: "/brand/favicon.svg", type: "image/svg+xml" }, { url: "/favicon.ico" }],
    apple: "/apple-touch-icon-180.png",
  },
  openGraph: {
    title: "Waflo — Loyalty that flows.",
    description: "Wallet-first loyalty for local businesses.",
    images: [{ url: brandAssets.openGraph, width: 1200, height: 630, alt: "Waflo" }],
  },
};

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
