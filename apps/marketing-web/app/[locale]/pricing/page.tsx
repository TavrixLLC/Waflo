import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { billingCadenceCatalog, cadencePrice, planCatalog } from "@waflo/billing";
import { isLocale } from "@waflo/i18n";
import { PlanCard } from "@waflo/ui";
import { Check } from "lucide-react";
import { MarketingShell } from "../../../components/marketing-shell";
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
  const dashboardUrl = process.env.NEXT_PUBLIC_DASHBOARD_URL ?? "http://localhost:3001";
  return (
    <MarketingShell locale={locale} path="/pricing">
      <section className="marketing-container marketing-content">
        <span className="marketing-kicker">
          {ar ? "الخطة شيء، ووتيرة الفوترة شيء آخر" : "Plan tier and billing cadence, made clear"}
        </span>
        <h1>{ar ? "اختر المساحة التي تناسب نموك." : "Choose the space your business needs."}</h1>
        <p className="marketing-content__lead">
          {ar
            ? "كل الأسعار بالدولار الأمريكي. اختر Starter أو Growth أو Scale، ثم اختر الدفع الشهري أو كل ثلاثة أشهر بخصم 7% أو السنوي بخصم 17%. اختيار الخطة أثناء الإعداد لا يبدأ الدفع أو التجربة."
            : "All prices are in USD. Choose Starter, Growth, or Scale, then choose monthly billing, quarterly billing at 7% off, or yearly billing at 17% off. Selecting a plan during setup does not start payment or your trial."}
        </p>
        <div className="marketing-plans" style={{ marginTop: "3rem" }}>
          {Object.values(planCatalog).map((plan) => (
            <div className="marketing-plan-choice" key={plan.code}>
              <PlanCard plan={plan.code} selected={false} locale={locale} cadence="monthly" />
              <a
                className="wf-button wf-button--primary marketing-button-link marketing-button-link--full"
                href={`${dashboardUrl}/${locale}/signup`}
              >
                {ar ? "ابدأ الإعداد" : "Start setup"}
              </a>
            </div>
          ))}
        </div>
        <section className="marketing-cadence-comparison" aria-labelledby="cadence-heading">
          <span className="marketing-kicker">{ar ? "وتيرة الفوترة" : "Billing cadence"}</span>
          <h2 id="cadence-heading">{ar ? "اختر موعد الدفعة" : "Choose when the charge happens"}</h2>
          <div className="marketing-cadence-grid">
            {(["monthly", "quarterly", "yearly"] as const).map((cadence) => (
              <article key={cadence}>
                <strong>{billingCadenceCatalog[cadence].label}</strong>
                <span>
                  {billingCadenceCatalog[cadence].discountRate
                    ? `${Math.round(billingCadenceCatalog[cadence].discountRate * 100)}% ${ar ? "خصم" : "off"}`
                    : ar
                      ? "بدون خصم"
                      : "No discount"}
                </span>
                <dl>
                  {(["starter", "growth", "scale"] as const).map((plan) => (
                    <div key={plan}>
                      <dt>{planCatalog[plan].name}</dt>
                      <dd>${cadencePrice(plan, cadence).billedAmountUsd.toFixed(2)}</dd>
                    </div>
                  ))}
                </dl>
              </article>
            ))}
          </div>
        </section>
        <div style={{ marginTop: "2rem" }}>
          <div className="wf-alert wf-alert--info">
            <Check size={20} aria-hidden="true" />
            <div>
              <strong>{ar ? "تجربة مجانية لمدة 15 يوماً" : "15-day free trial"}</strong>
              <div>
                {ar
                  ? "لا تبدأ عند إنشاء الحساب. ستبدأ فقط عند نشر أول برنامج ولاء في المرحلة التالية."
                  : "It does not start at account creation. It begins only when the first loyalty program is published in a later phase."}
              </div>
            </div>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
