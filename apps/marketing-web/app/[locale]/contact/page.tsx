import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isInterfaceLocale } from "@waflo/i18n";
import { Card } from "@waflo/ui";
import { MarketingShell } from "../../../components/marketing-shell";
import { marketingDocuments } from "../../../lib/marketing-documents";
import { configuredSupportEmail, createMarketingMetadata } from "../../../lib/seo";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return isInterfaceLocale(locale) ? createMarketingMetadata(locale, "contact") : {};
}

export default async function ContactPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isInterfaceLocale(locale)) notFound();
  const copy = marketingDocuments[locale].contact;
  const supportEmail = configuredSupportEmail();
  const dashboardUrl = process.env.NEXT_PUBLIC_DASHBOARD_URL ?? "https://dashboard.waflo.app";
  return (
    <MarketingShell locale={locale} path="/contact">
      <section className="marketing-container marketing-content">
        <span className="marketing-kicker">{copy.kicker}</span>
        <h1>{copy.title}</h1>
        <p className="marketing-content__lead">{copy.lede}</p>
        <Card style={{ maxWidth: 700, padding: "2rem", marginTop: "2rem" }}>
          <strong>Waflo · Tavrix LLC</strong>
          <p style={{ color: "var(--waflo-muted)", lineHeight: 1.7 }}>{copy.sections[0]?.body}</p>
          {supportEmail ? (
            <a className="marketing-contact-link" href={`mailto:${supportEmail}`}>
              {supportEmail}
            </a>
          ) : (
            <a className="marketing-contact-link" href={`${dashboardUrl}/${locale}/login`}>
              {copy.contactLabel}
            </a>
          )}
        </Card>
      </section>
    </MarketingShell>
  );
}
