import { isInterfaceLocale } from "@waflo/i18n";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { MarketingShell } from "../../../components/marketing-shell";
import { PricingExplorer } from "../../../components/pricing-explorer";
import { marketingCopy } from "../../../lib/marketing-copy";
import { fetchMarketingPricing, trustedCloudflareCountry } from "../../../lib/public-pricing";
import { createMarketingMetadata } from "../../../lib/seo";

// Prices are selected from a trusted edge country hint. Never permit one
// country response to be statically generated or shared with another market.
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return isInterfaceLocale(locale) ? createMarketingMetadata(locale, "pricing") : {};
}

export default async function PricingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isInterfaceLocale(locale)) notFound();
  const copy = marketingCopy[locale].pricing;
  const dashboardUrl = process.env.NEXT_PUBLIC_DASHBOARD_URL ?? "https://dashboard.waflo.app";
  const country = trustedCloudflareCountry(await headers());
  const pricing = await fetchMarketingPricing(country);
  return (
    <MarketingShell locale={locale} path="/pricing">
      <section className="marketing-container marketing-content">
        <span className="marketing-kicker">{copy.kicker}</span>
        <h1>{copy.title}</h1>
        <p className="marketing-content__lead">{copy.lede}</p>
        <PricingExplorer locale={locale} dashboardUrl={dashboardUrl} pricing={pricing} />
      </section>
    </MarketingShell>
  );
}
