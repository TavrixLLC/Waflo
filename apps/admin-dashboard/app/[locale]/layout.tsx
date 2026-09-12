import "@waflo/brand/tokens.css";
import "@waflo/ui/styles.css";
import "../globals.css";
import type { Locale } from "@waflo/contracts";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Waflo Control Room",
  description: "Internal Waflo operations",
  robots: { index: false, follow: false, nocache: true },
};

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!(["en", "ar"] as const).includes(locale as Locale)) notFound();
  return (
    <html lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}>
      <body>{children}</body>
    </html>
  );
}
