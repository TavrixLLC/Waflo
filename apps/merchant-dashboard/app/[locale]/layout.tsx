import type { Metadata } from "next";
import { Cairo, Manrope, Noto_Sans_Arabic } from "next/font/google";
import localFont from "next/font/local";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { interfaceLocaleFor } from "@waflo/i18n";
import "../globals.css";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });
const cairo = Cairo({ subsets: ["arabic", "latin"], variable: "--font-cairo", display: "swap" });
const notoSansArabic = Noto_Sans_Arabic({
  subsets: ["arabic"],
  variable: "--font-noto-sans-arabic",
  display: "swap",
});
const sirwan = localFont({
  src: "../../../../packages/brand/assets/fonts/Sirwan.ttf",
  variable: "--font-sirwan",
  display: "swap",
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const definition = interfaceLocaleFor(locale);
  if (!definition) return {};
  return {
    title: {
      default: definition.messages.auth.metadata.merchantDashboard,
      template: "%s · Waflo",
    },
    description: definition.messages.auth.metadata.merchantDescription,
    robots: {
      index: false,
      follow: false,
      nocache: true,
    },
    manifest: "/site.webmanifest",
    icons: {
      icon: [{ url: "/brand/favicon.svg?v=2", type: "image/svg+xml" }, { url: "/favicon.ico?v=2" }],
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
  const definition = interfaceLocaleFor(locale);
  if (!definition) notFound();
  // A merchant can preview Arabic-script card locales while their Dashboard
  // interface remains English. Keep the approved font variable available to
  // the browser-safe Wallet render plan without changing interface typography.
  const fontVariables = `${manrope.variable} ${cairo.variable} ${notoSansArabic.variable} ${sirwan.variable}`;
  return (
    <html
      lang={definition.htmlLang}
      dir={definition.direction}
      data-interface-typography={definition.typography}
    >
      <body className={fontVariables}>{children}</body>
    </html>
  );
}
