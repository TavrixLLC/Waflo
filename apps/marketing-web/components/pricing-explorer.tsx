"use client";

import {
  billingCadenceCatalog,
  catalogSavingsPercentage,
  formatMoney,
  type CatalogPricePresentationTerm,
} from "@waflo/billing";
import type { BillingCadence, Locale, PlanCode } from "@waflo/contracts";
import { PlanCard } from "@waflo/ui";
import { CreditCard } from "lucide-react";
import { useState } from "react";

const cadences: readonly BillingCadence[] = ["monthly", "quarterly", "yearly"];
const plans: readonly PlanCode[] = ["starter", "growth", "scale"];

export interface PublicPricingCatalog {
  readonly marketCode: string;
  readonly currency: string | null;
  readonly terms: readonly CatalogPricePresentationTerm[];
}

function localizedCadence(cadence: BillingCadence, ar: boolean): string {
  if (!ar) return billingCadenceCatalog[cadence].label;
  return cadence === "monthly" ? "شهري" : cadence === "quarterly" ? "كل 3 أشهر" : "سنوي";
}

function cadenceValue(discount: string | null, ar: boolean): string {
  if (!discount) return ar ? "السعر من الكتالوج المنشور" : "Published catalog price";
  return ar ? `وفّر ${discount}` : `Save ${discount}`;
}

function catalogTerm(
  catalog: PublicPricingCatalog,
  plan: PlanCode,
  cadence: BillingCadence,
): CatalogPricePresentationTerm | null {
  const term = catalog.terms.find(
    (candidate) => candidate.plan === plan && candidate.cadence === cadence,
  );
  return term ? { ...term, marketCode: catalog.marketCode } : null;
}

export function PricingExplorer({
  locale,
  dashboardUrl,
  catalog,
}: {
  locale: Locale;
  dashboardUrl: string;
  catalog: PublicPricingCatalog | null;
}) {
  const ar = locale === "ar";
  const [cadence, setCadence] = useState<BillingCadence>("yearly");
  const growthMonthly = catalog ? catalogTerm(catalog, "growth", "monthly") : null;
  const growthPrice = catalog ? catalogTerm(catalog, "growth", cadence) : null;
  const growthDiscount = catalogSavingsPercentage(growthMonthly, growthPrice);

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
            const monthly = catalog ? catalogTerm(catalog, "growth", "monthly") : null;
            const term = catalog ? catalogTerm(catalog, "growth", option) : null;
            const discount = catalogSavingsPercentage(monthly, term);
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
                <strong>{localizedCadence(option, ar)}</strong>
                <small>{cadenceValue(discount, ar)}</small>
              </label>
            );
          })}
        </div>
      </div>

      <div className="marketing-pricing-explorer__context" aria-live="polite">
        <span>{cadenceValue(growthDiscount, ar)}</span>
        {growthPrice ? (
          <p>
            {ar ? (
              <>
                مثال <bdi dir="ltr">Growth</bdi>:
              </>
            ) : (
              "Growth example:"
            )}{" "}
            <bdi dir="ltr">
              {formatMoney(BigInt(growthPrice.amountMinor), growthPrice.currency, locale)}
            </bdi>{" "}
            {ar ? "يُحصّل" : "billed"} {localizedCadence(cadence, ar)}.
          </p>
        ) : (
          <p>
            {ar
              ? "لا يتوفر سعر منشور لهذه الوتيرة حالياً."
              : "A published catalog price is not currently available for this cadence."}
          </p>
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
              price={catalog ? catalogTerm(catalog, plan, cadence) : null}
              monthlyPrice={catalog ? catalogTerm(catalog, plan, "monthly") : null}
              onSelect={choosePlan}
            />
          </div>
        ))}
      </div>

      <div className="marketing-pricing-cta">
        <div className="marketing-pricing-cta__promise">
          <CreditCard size={20} aria-hidden="true" />
          <p>
            <strong>{ar ? "15 يوماً مجاناً" : "15 days free"}</strong>
            <span>
              {ar
                ? "أضف معلومات الفوترة والبطاقة بأمان. لا يتم تحصيل رسوم مقابل حفظ البطاقة اليوم."
                : "Add billing details and a card securely. Saving a card does not charge you today."}
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
