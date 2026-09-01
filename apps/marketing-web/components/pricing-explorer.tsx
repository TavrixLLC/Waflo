"use client";

import { formatCurrencyMinor, publishedCadenceDiscountPercent } from "@waflo/billing";
import type { BillingCadence, Locale, PlanCode } from "@waflo/contracts";
import { Check, CreditCard } from "lucide-react";
import { useMemo, useState } from "react";

const cadences: readonly BillingCadence[] = ["monthly", "quarterly", "yearly"];
const plans: readonly PlanCode[] = ["starter", "growth", "scale"];

export interface MarketingPricingTerm {
  plan: PlanCode;
  cadence: BillingCadence;
  amountMinor: string;
  currency: string;
}

export interface MarketingPricingReadModel {
  market: { code: string; country: string | null; currency: string | null };
  terms: MarketingPricingTerm[];
}

function cadenceLabel(cadence: BillingCadence, ar: boolean) {
  if (!ar)
    return cadence === "monthly"
      ? "Monthly"
      : cadence === "quarterly"
        ? "Every 3 months"
        : "Yearly";
  return cadence === "monthly" ? "شهري" : cadence === "quarterly" ? "كل 3 أشهر" : "سنوي";
}

function planLabel(plan: PlanCode) {
  const labels: Record<PlanCode, string> = { starter: "Starter", growth: "Growth", scale: "Scale" };
  return labels[plan];
}

function planBenefit(plan: PlanCode, ar: boolean) {
  const en: Record<PlanCode, string> = {
    starter: "Everything you need to launch.",
    growth: "More capacity for a growing team.",
    scale: "Advanced tools for larger operations.",
  };
  return ar ? "ميزات مناسبة لمرحلة نمو أعمالك." : en[plan];
}

export function cadenceDiscount(
  monthly: MarketingPricingTerm | undefined,
  term: MarketingPricingTerm | undefined,
): string | null {
  return publishedCadenceDiscountPercent(monthly, term);
}

export function PricingExplorer({
  locale,
  dashboardUrl,
  pricing,
}: {
  locale: Locale;
  dashboardUrl: string;
  pricing: MarketingPricingReadModel;
}) {
  const ar = locale === "ar";
  const [cadence, setCadence] = useState<BillingCadence>("yearly");
  const terms = useMemo(
    () => new Map(pricing.terms.map((term) => [`${term.plan}:${term.cadence}`, term] as const)),
    [pricing.terms],
  );
  const localizedAmount = (term: MarketingPricingTerm) =>
    formatCurrencyMinor(BigInt(term.amountMinor), term.currency, ar ? "ar-SA" : "en-US");

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
          {cadences.map((option) => {
            const discount = cadenceDiscount(
              terms.get("growth:monthly"),
              terms.get(`growth:${option}`),
            );
            return (
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
                <strong>{cadenceLabel(option, ar)}</strong>
                {discount ? <small>{ar ? `وفّر ${discount}` : `Save ${discount}`}</small> : null}
              </label>
            );
          })}
        </div>
      </div>

      <div className="marketing-pricing-explorer__context" aria-live="polite">
        <span>{ar ? "الأسعار المنشورة لسوقك" : "Published prices for your market"}</span>
      </div>

      <div className="marketing-plans">
        {plans.map((plan) => {
          const term = terms.get(`${plan}:${cadence}`);
          const monthly = terms.get(`${plan}:monthly`);
          const discount = cadenceDiscount(monthly, term);
          if (!term) return null;
          return (
            <button
              className="marketing-plan-choice"
              key={plan}
              type="button"
              onClick={() => choosePlan(plan)}
            >
              <span className="marketing-plan-choice__select" aria-hidden="true">
                <Check size={16} />
              </span>
              <strong>{planLabel(plan)}</strong>
              <span className="marketing-plan-choice__price">
                <bdi>{localizedAmount(term)}</bdi>
              </span>
              <small>{cadenceLabel(cadence, ar)}</small>
              {discount ? (
                <small className="marketing-plan-choice__discount">
                  {ar ? `وفّر ${discount}` : `Save ${discount}`}
                </small>
              ) : null}
              <p>{planBenefit(plan, ar)}</p>
            </button>
          );
        })}
      </div>

      <div className="marketing-pricing-cta">
        <div className="marketing-pricing-cta__promise">
          <CreditCard size={20} aria-hidden="true" />
          <p>
            <strong>{ar ? "15 يوماً مجاناً" : "15 days free"}</strong>
            <span>
              {ar
                ? "أضف بيانات الفوترة والبطاقة بأمان. لن يتم تحصيل أي مبلغ اليوم."
                : "Add billing details and a card securely. Nothing is charged today."}
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
