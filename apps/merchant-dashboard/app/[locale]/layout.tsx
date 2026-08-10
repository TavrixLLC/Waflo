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
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
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
  const productionFontStylesheet =
    "https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Noto+Sans+Arabic:wght@400;500;600;700;800&display=swap";
  return (
    <html lang={locale} dir={directionFor(locale)}>
      {process.env.NODE_ENV === "production" ? (
        <head>
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
          <link rel="stylesheet" href={productionFontStylesheet} />
        </head>
      ) : null}
      <body>{children}</body>
    </html>
  );
}
