import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { isLocale } from "@waflo/i18n";
import { MarketingShell } from "../../../components/marketing-shell";
import { type PublicPricingCatalog, PricingExplorer } from "../../../components/pricing-explorer";
import { createMarketingMetadata } from "../../../lib/seo";

// Pricing is market-sensitive. Do not pre-render or cache a visitor's market
// selection, otherwise a regional price could be served to another country.
export const dynamic = "force-dynamic";
export const revalidate = 0;

function parsePublicCatalog(value: unknown): PublicPricingCatalog | null {
  if (!value || typeof value !== "object") return null;
  const catalog = value as { marketCode?: unknown; currency?: unknown; terms?: unknown };
  if (
    typeof catalog.marketCode !== "string" ||
    (catalog.currency !== null && typeof catalog.currency !== "string") ||
    !Array.isArray(catalog.terms)
  ) {
    return null;
  }
  const terms = catalog.terms.filter((term): term is PublicPricingCatalog["terms"][number] =>
    Boolean(
      term &&
        typeof term === "object" &&
        typeof (term as { plan?: unknown }).plan === "string" &&
        typeof (term as { cadence?: unknown }).cadence === "string" &&
        typeof (term as { amountMinor?: unknown }).amountMinor === "string" &&
        typeof (term as { currency?: unknown }).currency === "string",
    ),
  );
  return { marketCode: catalog.marketCode, currency: catalog.currency, terms };
}

async function loadPublicPricingCatalog(): Promise<PublicPricingCatalog | null> {
  const requestHeaders = await headers();
  const edgeCountry = requestHeaders.get("cf-ipcountry")?.trim().toLocaleUpperCase("en-US");
  const apiOrigin =
    process.env.API_PUBLIC_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "https://api.waflo.app";
  try {
    const response = await fetch(`${apiOrigin}/v1/public/pricing`, {
      cache: "no-store",
      headers: edgeCountry ? { "cf-ipcountry": edgeCountry } : {},
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { data?: unknown } | unknown;
    return parsePublicCatalog(
      payload && typeof payload === "object" && "data" in payload
        ? (payload as { data?: unknown }).data
        : payload,
    );
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return isLocale(locale) ? createMarketingMetadata(locale, "pricing") : {};
}

export default async function PricingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const ar = locale === "ar";
  const dashboardUrl = process.env.NEXT_PUBLIC_DASHBOARD_URL ?? "https://dashboard.waflo.app";
  const catalog = await loadPublicPricingCatalog();
  return (
    <MarketingShell locale={locale} path="/pricing">
      <section className="marketing-container marketing-content">
        <span className="marketing-kicker">{ar ? "حساب واضح قبل أن تبدأ" : "One clear price"}</span>
        <h1>{ar ? "أسعار بلا حسابات مخفية." : "Pricing without hidden math."}</h1>
        <p className="marketing-content__lead">
          {ar
            ? "اختر وتيرة الدفع وشاهد الرقمين المهمين: التكلفة الشهرية الفعلية والمبلغ الذي ستدفعه."
            : "Pick a cadence and see both numbers that matter: the effective monthly cost and the total you are billed."}
        </p>
        <PricingExplorer locale={locale} dashboardUrl={dashboardUrl} catalog={catalog} />
      </section>
    </MarketingShell>
  );
}
