import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@waflo/i18n";
import { MarketingShell } from "../../../components/marketing-shell";
import { PricingExplorer } from "../../../components/pricing-explorer";
import { createMarketingMetadata } from "../../../lib/seo";

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
        <PricingExplorer locale={locale} dashboardUrl={dashboardUrl} />
      </section>
    </MarketingShell>
  );
}
