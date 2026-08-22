import type { Metadata } from "next";
import { Cairo, Manrope } from "next/font/google";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import {
  directionForInterface,
  interfaceLocales,
  isInterfaceLocale,
  localeRegistry,
} from "@waflo/i18n";
import { marketingCopy } from "../../lib/marketing-copy";
import { createMarketingMetadata, marketingOrigin } from "../../lib/seo";
import "../globals.css";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });
const cairo = Cairo({ subsets: ["arabic", "latin"], variable: "--font-cairo", display: "swap" });

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isInterfaceLocale(locale)) return {};
  const home = createMarketingMetadata(locale, "home");
  return {
    ...home,
    metadataBase: new URL(marketingOrigin),
    title: {
      default: `Waflo — ${marketingCopy[locale].meta.title}`,
      template: "%s · Waflo",
    },
    manifest: "/site.webmanifest",
    icons: {
      icon: [{ url: "/brand/favicon.svg?v=2", type: "image/svg+xml" }, { url: "/favicon.ico?v=2" }],
      apple: "/apple-touch-icon-180.png",
    },
  };
}

export function generateStaticParams() {
  return interfaceLocales.map((locale) => ({ locale: locale.id }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isInterfaceLocale(locale)) notFound();
  const definition = localeRegistry[locale];
  return (
    <html lang={definition.htmlLang} dir={directionForInterface(locale)}>
      <body
        className={`${manrope.variable} ${cairo.variable}`}
        data-interface-locale={locale}
        data-interface-typography={definition.typography}
      >
        {children}
      </body>
    </html>
  );
}
