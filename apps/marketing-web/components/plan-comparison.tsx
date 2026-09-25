"use client";

import { planCatalog } from "@waflo/billing";
import type { PlanCode } from "@waflo/contracts";
import type { InterfaceLocale } from "@waflo/i18n";
import { Check, Minus } from "lucide-react";
import { marketingCopy, type MarketingCopy } from "../lib/marketing-copy";

const plans: readonly PlanCode[] = ["starter", "growth", "scale"];

function limitLabel(
  value: number | null,
  copy: MarketingCopy["pricing"],
): string {
  return value === null ? copy.unlimited : `${copy.upTo} ${value}`;
}

function featureIcon(enabled: boolean) {
  return enabled ? (
    <Check className="marketing-comparison__check" size={18} aria-hidden="true" />
  ) : (
    <Minus className="marketing-comparison__dash" size={18} aria-hidden="true" />
  );
}

function featureLabel(
  enabled: boolean,
  copy: MarketingCopy["pricing"],
): string {
  return enabled ? copy.included : "—";
}

function tierLabel(
  plan: PlanCode,
  copy: MarketingCopy["pricing"],
): string {
  const catalog = planCatalog[plan];
  if (catalog.features.advancedAnalytics) return copy.advanced;
  return copy.basic;
}

export function PlanComparison({ locale }: { locale: InterfaceLocale }) {
  const copy = marketingCopy[locale].pricing;

  const rows: {
    label: string;
    values: Record<PlanCode, { text: string; icon?: boolean }>;
  }[] = [
    {
      label: copy.locations,
      values: {
        starter: { text: limitLabel(planCatalog.starter.limits.locations, copy) },
        growth: { text: limitLabel(planCatalog.growth.limits.locations, copy) },
        scale: { text: limitLabel(planCatalog.scale.limits.locations, copy) },
      },
    },
    {
      label: copy.teamSeats,
      values: {
        starter: { text: limitLabel(planCatalog.starter.limits.teamSeats, copy) },
        growth: { text: limitLabel(planCatalog.growth.limits.teamSeats, copy) },
        scale: { text: limitLabel(planCatalog.scale.limits.teamSeats, copy) },
      },
    },
    {
      label: copy.programs,
      values: {
        starter: { text: limitLabel(planCatalog.starter.limits.programs, copy) },
        growth: { text: limitLabel(planCatalog.growth.limits.programs, copy) },
        scale: { text: limitLabel(planCatalog.scale.limits.programs, copy) },
      },
    },
    {
      label: copy.walletPasses,
      values: {
        starter: { text: copy.included, icon: true },
        growth: { text: copy.included, icon: true },
        scale: { text: copy.included, icon: true },
      },
    },
    {
      label: copy.customization,
      values: {
        starter: { text: copy.basic },
        growth: { text: copy.advanced },
        scale: { text: copy.advanced },
      },
    },
    {
      label: copy.analytics,
      values: {
        starter: { text: tierLabel("starter", copy) },
        growth: { text: tierLabel("growth", copy) },
        scale: { text: tierLabel("scale", copy) },
      },
    },
    {
      label: copy.milestoneRewards,
      values: {
        starter: {
          text: featureLabel(false, copy),
          icon: false,
        },
        growth: {
          text: featureLabel(true, copy),
          icon: true,
        },
        scale: {
          text: featureLabel(true, copy),
          icon: true,
        },
      },
    },
    {
      label: copy.advancedExports,
      values: {
        starter: {
          text: featureLabel(planCatalog.starter.features.advancedExports, copy),
          icon: planCatalog.starter.features.advancedExports,
        },
        growth: {
          text: featureLabel(planCatalog.growth.features.advancedExports, copy),
          icon: planCatalog.growth.features.advancedExports,
        },
        scale: {
          text: featureLabel(planCatalog.scale.features.advancedExports, copy),
          icon: planCatalog.scale.features.advancedExports,
        },
      },
    },
  ];

  const commonFeatures = [copy.loyaltyCards, copy.qrStamping, copy.customerWeb];

  return (
    <section
      className="marketing-plan-comparison"
      aria-labelledby="plan-comparison-heading"
    >
      <h3 id="plan-comparison-heading" className="marketing-plan-comparison__title">
        {copy.comparisonTitle}
      </h3>

      <div className="marketing-plan-comparison__table-wrap">
        <table className="marketing-plan-comparison__table" aria-label={copy.comparisonTitle}>
          <thead>
            <tr className="marketing-plan-comparison__header">
              <th scope="col" className="marketing-plan-comparison__feature-label">
                <span className="wf-sr-only">{copy.comparisonTitle}</span>
              </th>
              {plans.map((plan) => (
                <th
                  scope="col"
                  className="marketing-plan-comparison__plan-header"
                  key={plan}
                  translate="no"
                >
                  {planCatalog[plan].name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr className="marketing-plan-comparison__row" key={row.label}>
                <th scope="row" className="marketing-plan-comparison__feature-label">
                  {row.label}
                </th>
                {plans.map((plan) => {
                  const cell = row.values[plan];
                  return (
                    <td className="marketing-plan-comparison__cell" key={plan}>
                      {cell.icon !== undefined ? (
                        <>
                          {featureIcon(cell.icon)}
                          <span className="wf-sr-only">{cell.text}</span>
                        </>
                      ) : (
                        <span>{cell.text}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="marketing-plan-comparison__common">
        <strong>{copy.allPlansInclude}</strong>
        <ul>
          {commonFeatures.map((feature) => (
            <li key={feature}>
              <Check size={16} aria-hidden="true" />
              {feature}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
