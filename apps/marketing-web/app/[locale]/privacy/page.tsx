import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isInterfaceLocale } from "@waflo/i18n";
import { MarketingShell } from "../../../components/marketing-shell";
import { marketingDocuments } from "../../../lib/marketing-documents";
import { configuredLegalEffectiveDate, createMarketingMetadata } from "../../../lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return isInterfaceLocale(locale) ? createMarketingMetadata(locale, "privacy") : {};
}

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isInterfaceLocale(locale)) notFound();
  const copy = marketingDocuments[locale].privacy;
  return (
    <MarketingShell locale={locale} path="/privacy">
      <article className="marketing-container marketing-content">
        <span className="marketing-kicker">{copy.kicker}</span>
        <h1>{copy.title}</h1>
        <p className="marketing-content__lead">{copy.lede}</p>
        <div className="marketing-legal">
          <p>
            <strong>{copy.effectiveDate}</strong> {configuredLegalEffectiveDate(locale)}
          </p>
          {copy.sections.map((section) => (
            <section key={section.heading}>
              <h2>{section.heading}</h2>
              <p>{section.body}</p>
            </section>
          ))}
          <p>
            <a href={`/${locale}/contact`}>{copy.contactLabel}</a>
          </p>
        </div>
      </article>
    </MarketingShell>
  );
}
