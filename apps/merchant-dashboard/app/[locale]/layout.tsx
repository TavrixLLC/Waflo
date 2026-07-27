import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { directionFor, isLocale } from "@waflo/i18n";
import "../globals.css";

export const metadata: Metadata = {
  title: {
    default: "Waflo merchant dashboard",
    template: "%s · Waflo",
  },
  description: "Secure merchant administration for Waflo.",
  manifest: "/site.webmanifest",
  icons: {
    icon: [{ url: "/brand/favicon.svg", type: "image/svg+xml" }, { url: "/favicon.ico" }],
    apple: "/apple-touch-icon-180.png",
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
