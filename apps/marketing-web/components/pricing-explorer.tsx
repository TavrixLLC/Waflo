"use client";

import { billingCadenceCatalog, cadencePrice } from "@waflo/billing";
import type { BillingCadence, Locale, PlanCode } from "@waflo/contracts";
import { PlanCard } from "@waflo/ui";
import { CreditCard } from "lucide-react";
import { useState } from "react";

const cadences: readonly BillingCadence[] = ["monthly", "quarterly", "yearly"];
const plans: readonly PlanCode[] = ["starter", "growth", "scale"];

function localizedCadence(cadence: BillingCadence, ar: boolean): string {
  if (!ar) return billingCadenceCatalog[cadence].label;
  return cadence === "monthly" ? "شهري" : cadence === "quarterly" ? "كل 3 أشهر" : "سنوي";
}

function cadenceValue(cadence: BillingCadence, ar: boolean): string {
  if (cadence === "monthly") return ar ? "دون خصم" : "No discount";
  if (cadence === "quarterly") return ar ? "وفّر 8.33%" : "Save 8.33%";
  return ar ? "شهران مجاناً · وفّر 16.67%" : "2 months free · Save 16.67%";
}

export function PricingExplorer({
  locale,
  dashboardUrl,
}: {
  locale: Locale;
  dashboardUrl: string;
}) {
  const ar = locale === "ar";
  const [cadence, setCadence] = useState<BillingCadence>("yearly");
  const sample = cadencePrice("growth", cadence);

  function choosePlan(plan: PlanCode) {
    const target = new URL(`/${locale}/signup`, dashboardUrl);
    target.searchParams.set("plan", plan);
    target.searchParams.set("cadence", cadence);
    window.location.assign(target.toString());
  }

  return (
    <section className="marketing-pricing-explorer" aria-labelledby="pricing-explorer-heading">
      <div className="marketing-pricing-explorer__heading">
        <div>
          <span className="marketing-kicker">{ar ? "الفوترة بوضوح" : "One clear price"}</span>
          <h2 id="pricing-explorer-heading">
            {ar
              ? "اختر الباقة وموعد الدفع في مكان واحد"
              : "Choose a plan and billing cadence in one place"}
          </h2>
        </div>
        <div
          className="marketing-cadence-selector"
          role="radiogroup"
          aria-label={ar ? "دورة الفوترة" : "Billing cadence"}
        >
          {cadences.map((option) => (
            <label
              key={option}
              className={cadence === option ? "marketing-cadence-selector__option--active" : ""}
            >
              <input
                className="wf-sr-only"
                type="radio"
                name="marketing-billing-cadence"
                value={option}
                checked={cadence === option}
                onChange={() => setCadence(option)}
              />
              <strong>{localizedCadence(option, ar)}</strong>
              <small>{cadenceValue(option, ar)}</small>
            </label>
          ))}
        </div>
      </div>

      <div className="marketing-pricing-explorer__context" aria-live="polite">
        <span>{cadenceValue(cadence, ar)}</span>
        {cadence !== "monthly" ? (
          <p>
            {ar ? (
              <>
                مثال <bdi dir="ltr">Growth</bdi>:
              </>
            ) : (
              "Growth example:"
            )}{" "}
            <bdi dir="ltr">${sample.billedAmountUsd.toFixed(2)}</bdi>{" "}
            {ar ? "إجمالاً، أي" : "total, equal to"}{" "}
            <bdi dir="ltr">${sample.monthlyEquivalentUsd.toFixed(2)}</bdi>/{ar ? "شهر" : "month"}.
          </p>
        ) : (
          <p>{ar ? "تُحصّل قيمة شهر واحد من دون خصم." : "One month is charged with no discount."}</p>
        )}
      </div>

      <div className="marketing-plans">
        {plans.map((plan) => (
          <div className="marketing-plan-choice" key={plan}>
            <PlanCard
              plan={plan}
              selected={false}
              locale={locale}
              cadence={cadence}
              onSelect={choosePlan}
            />
          </div>
        ))}
      </div>

      <div className="marketing-pricing-cta">
        <div className="marketing-pricing-cta__promise">
          <CreditCard size={20} aria-hidden="true" />
          <p>
            <strong>{ar ? "7 أيام مجاناً" : "7 days free"}</strong>
            <span>
              {ar
                ? "أضف معلومات الفوترة والبطاقة بأمان. تبدأ التجربة بفاتورة قيمتها $0 ولن يُخصم منك شيء اليوم."
                : "Add billing details and a card securely. Your trial starts with a $0 invoice, and nothing is charged today."}
            </span>
          </p>
        </div>
        <a
          className="wf-button wf-button--primary marketing-button-link"
          href={`${dashboardUrl}/${locale}/signup`}
        >
          {ar ? "ابدأ التجربة" : "Start your trial"}
        </a>
      </div>
    </section>
  );
}
