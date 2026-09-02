"use client";

import { formatCurrencyMinor, publishedCadenceDiscountPercent } from "@waflo/billing";
import type { BillingCadence, PlanCode } from "@waflo/contracts";
import { localeRegistry, type InterfaceLocale } from "@waflo/i18n";
import { Check, CreditCard } from "lucide-react";
import { useMemo, useState } from "react";
import { marketingCopy, type MarketingCopy } from "../lib/marketing-copy";

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

function cadenceLabel(cadence: BillingCadence, copy: MarketingCopy["pricing"]): string {
  return cadence === "monthly"
    ? copy.monthly
    : cadence === "quarterly"
      ? copy.quarterly
      : copy.yearly;
}

function planLabel(plan: PlanCode) {
  const labels: Record<PlanCode, string> = { starter: "Starter", growth: "Growth", scale: "Scale" };
  return labels[plan];
}

function planBenefit(plan: PlanCode, copy: MarketingCopy["pricing"]): string {
  return plan === "starter"
    ? copy.starterBenefit
    : plan === "growth"
      ? copy.growthBenefit
      : copy.scaleBenefit;
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
  locale: InterfaceLocale;
  dashboardUrl: string;
  pricing: MarketingPricingReadModel;
}) {
  const copy = marketingCopy[locale].pricing;
  const localeDefinition = localeRegistry[locale];
  const [cadence, setCadence] = useState<BillingCadence>("yearly");
  const terms = useMemo(
    () => new Map(pricing.terms.map((term) => [`${term.plan}:${term.cadence}`, term] as const)),
    [pricing.terms],
  );
  const localizedAmount = (term: MarketingPricingTerm) =>
    formatCurrencyMinor(
      BigInt(term.amountMinor),
      term.currency,
      localeDefinition.numberFormattingLocale,
    );

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
          <span className="marketing-kicker">{copy.explorerKicker}</span>
          <h2 id="pricing-explorer-heading">{copy.explorerTitle}</h2>
        </div>
        <div
          className="marketing-cadence-selector"
          role="radiogroup"
          aria-label={copy.cadenceLabel}
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
                <strong>{cadenceLabel(option, copy)}</strong>
                {discount ? (
                  <small>
                    {copy.save} <bdi dir="ltr">{discount}</bdi>
                  </small>
                ) : null}
              </label>
            );
          })}
        </div>
      </div>

      <div className="marketing-pricing-explorer__context" aria-live="polite">
        <span>{copy.marketContext}</span>
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
              <strong translate="no">{planLabel(plan)}</strong>
              <span className="marketing-plan-choice__price">
                <bdi dir="ltr">{localizedAmount(term)}</bdi>
              </span>
              <small>{cadenceLabel(cadence, copy)}</small>
              {discount ? (
                <small className="marketing-plan-choice__discount">
                  {copy.save} <bdi dir="ltr">{discount}</bdi>
                </small>
              ) : null}
              <p>{planBenefit(plan, copy)}</p>
            </button>
          );
        })}
      </div>

      <div className="marketing-pricing-cta">
        <div className="marketing-pricing-cta__promise">
          <CreditCard size={20} aria-hidden="true" />
          <p>
            <strong>{copy.trialTitle}</strong>
            <span>{copy.trialBody}</span>
          </p>
        </div>
        <a
          className="wf-button wf-button--primary marketing-button-link"
          href={`${dashboardUrl}/${locale}/signup`}
        >
          {copy.startTrial}
        </a>
      </div>
    </section>
  );
}
