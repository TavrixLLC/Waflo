import type { Metadata } from "next";
import { Cairo, Manrope } from "next/font/google";
import localFont from "next/font/local";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { interfaceLocaleFor } from "@waflo/i18n";
import "../globals.css";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });
const cairo = Cairo({ subsets: ["arabic", "latin"], variable: "--font-cairo", display: "swap" });
const kurdistan24 = localFont({
  src: "../fonts/kurdistan-24-light.ttf",
  variable: "--font-kurdistan-24",
  display: "swap",
  preload: true,
  weight: "300",
  style: "normal",
});

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
  const definition = interfaceLocaleFor(locale);
  if (!definition) notFound();
  return (
    <html
      lang={definition.htmlLang}
      dir={definition.direction}
      data-interface-typography={definition.typography}
    >
      <body className={`${manrope.variable} ${cairo.variable} ${kurdistan24.variable}`}>
        {children}
      </body>
    </html>
  );
}
