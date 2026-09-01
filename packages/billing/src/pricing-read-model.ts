import { type BillingCadence, billingCadences, type PlanCode, planCodes } from "@waflo/contracts";

export interface PublishedPricingTerm {
  readonly plan: PlanCode;
  readonly cadence: BillingCadence;
  readonly amountMinor: string;
  readonly currency: string;
}

export interface PublishedPricingMarket {
  readonly code: string;
  readonly countryCode: string | null;
  readonly currency: string | null;
  readonly active: boolean;
  readonly terms: readonly PublishedPricingTerm[];
}

export type PricingMarketFallbackReason =
  | "regional_published"
  | "no_country"
  | "no_active_regional_market"
  | "regional_catalog_incomplete";

export interface ResolvedPublishedPricingMarket {
  readonly market: PublishedPricingMarket;
  readonly fallbackReason: PricingMarketFallbackReason;
}

/**
 * Computes a customer-facing cadence discount only when both terms are from
 * the same market/currency. It intentionally returns null rather than
 * comparing a regional term against GLOBAL or fabricating a percentage.
 */
export function publishedCadenceDiscountPercent(
  monthly: PublishedPricingTerm | undefined,
  selected: PublishedPricingTerm | undefined,
): string | null {
  if (
    !monthly ||
    !selected ||
    monthly.plan !== selected.plan ||
    selected.cadence === "monthly" ||
    monthly.currency.toUpperCase() !== selected.currency.toUpperCase()
  ) {
    return null;
  }
  const months = selected.cadence === "quarterly" ? 3n : 12n;
  const baseline = BigInt(monthly.amountMinor) * months;
  const amount = BigInt(selected.amountMinor);
  if (baseline <= 0n || amount >= baseline) return null;
  const basisPoints = ((baseline - amount) * 10_000n) / baseline;
  const whole = basisPoints / 100n;
  const fraction = basisPoints % 100n;
  return fraction === 0n ? `${whole}%` : `${whole}.${fraction.toString().padStart(2, "0")}%`;
}

/**
 * A regional market is used only when it is a complete, internally consistent
 * catalog. This prevents a visitor from seeing a mix of regional and GLOBAL
 * prices while preserving GLOBAL as the deterministic fallback.
 */
export function hasCompletePublishedPricingMarket(market: PublishedPricingMarket): boolean {
  if (!market.active || !market.currency) return false;
  const terms = new Map(market.terms.map((term) => [`${term.plan}:${term.cadence}`, term]));
  return planCodes.every((plan) =>
    billingCadences.every((cadence) => {
      const term = terms.get(`${plan}:${cadence}`);
      return (
        term !== undefined &&
        term.currency.toUpperCase() === market.currency?.toUpperCase() &&
        /^\d+$/u.test(term.amountMinor) &&
        BigInt(term.amountMinor) > 0n
      );
    }),
  );
}

export function resolvePublishedPricingMarket(input: {
  country: string | null;
  global: PublishedPricingMarket;
  regionalMarkets: readonly PublishedPricingMarket[];
}): ResolvedPublishedPricingMarket {
  const country = input.country?.toUpperCase() ?? null;
  if (!country) return { market: input.global, fallbackReason: "no_country" };
  const regional = input.regionalMarkets.find(
    (market) => market.active && market.countryCode?.toUpperCase() === country,
  );
  if (!regional) return { market: input.global, fallbackReason: "no_active_regional_market" };
  if (!hasCompletePublishedPricingMarket(regional)) {
    return { market: input.global, fallbackReason: "regional_catalog_incomplete" };
  }
  return { market: regional, fallbackReason: "regional_published" };
}
