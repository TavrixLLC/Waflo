import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { planCatalog } from "@waflo/billing";
import { isLocale } from "@waflo/i18n";
import { Button, Card } from "@waflo/ui";
import { Check } from "lucide-react";
import { MarketingShell } from "../../../components/marketing-shell";

export const metadata: Metadata = {
  title: "Pricing",
};

export default async function PricingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const ar = locale === "ar";
  const dashboardUrl = process.env.NEXT_PUBLIC_DASHBOARD_URL ?? "http://localhost:3001";
  const details = {
    starter: ar
      ? ["موقع واحد", "برنامج ولاء واحد مستقبلاً", "3 مقاعد فريق", "تخصيص وتحليلات أساسية"]
      : [
          "1 location",
          "1 future loyalty program",
          "3 team seats",
          "Basic customization and analytics",
        ],
    growth: ar
      ? ["حتى 3 مواقع", "برامج متعددة مستقبلاً", "10 مقاعد فريق", "تخصيص وتحليلات متقدمة"]
      : [
          "Up to 3 locations",
          "Multiple future programs",
          "10 team seats",
          "Advanced customization and analytics",
        ],
    scale: ar
      ? ["حدود مرنة للمواقع والفريق", "صلاحيات متقدمة", "تصدير متقدم", "دعم ذو أولوية"]
      : [
          "Configurable location and team limits",
          "Advanced permissions",
          "Advanced exports",
          "Priority support",
        ],
  } as const;
  return (
    <MarketingShell locale={locale}>
      <section className="marketing-container marketing-content">
        <span className="marketing-kicker">
          {ar ? "أسعار شهرية واضحة" : "Simple monthly pricing"}
        </span>
        <h1>{ar ? "اختر المساحة التي تناسب نموك." : "Choose the space your business needs."}</h1>
        <p className="marketing-content__lead">
          {ar
            ? "كل الأسعار بالدولار الأمريكي والفوترة شهرية في المرحلة الحالية. اختيار الخطة أثناء الإعداد لا يعني بدء الدفع أو التجربة."
            : "All prices are in USD and billed monthly in W1. Selecting a plan during setup does not start payment or your trial."}
        </p>
        <div className="marketing-plans" style={{ marginTop: "3rem" }}>
          {Object.values(planCatalog).map((plan) => (
            <Card className="wf-plan-card" key={plan.code}>
              <div className="wf-plan-card__heading">
                <h2>{plan.name}</h2>
                {plan.code === "growth" ? (
                  <span className="wf-badge wf-badge--brand">
                    {ar ? "الأكثر مرونة" : "Most flexible"}
                  </span>
                ) : null}
              </div>
              <p className="wf-plan-card__price">
                ${plan.monthlyPriceUsd}
                <span>/{ar ? "شهرياً" : "month"}</span>
              </p>
              <ul style={{ listStyle: "none", padding: 0 }}>
                {details[plan.code].map((item) => (
                  <li key={item} style={{ display: "flex", gap: ".5rem" }}>
                    <Check size={17} color="var(--waflo-brick)" aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
              <a href={`${dashboardUrl}/${locale}/signup`}>
                <Button style={{ width: "100%" }}>{ar ? "ابدأ الإعداد" : "Start setup"}</Button>
              </a>
            </Card>
          ))}
        </div>
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
