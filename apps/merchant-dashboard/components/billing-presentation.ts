import { cadencePrice } from "@waflo/billing";
import type { BillingCadence, PlanCode } from "@waflo/contracts";

export function billingPriceTruth({
  plan,
  cadence,
  nextExpectedAmount,
  currency,
}: {
  plan: PlanCode;
  cadence: BillingCadence;
  nextExpectedAmount: number | null;
  currency: string | null;
}) {
  const catalog = cadencePrice(plan, cadence);
  const catalogBilledAmountMinor = Math.round(catalog.billedAmountUsd * 100);
  const hasComparableCurrentSubscriptionCharge =
    nextExpectedAmount !== null && currency?.toLocaleUpperCase("en-US") === "USD";

  return {
    catalog,
    catalogBilledAmountMinor,
    currentSubscriptionPriceDiffers:
      hasComparableCurrentSubscriptionCharge && nextExpectedAmount !== catalogBilledAmountMinor,
  };
}

export function canPersistCatalogSelection(subscriptionStatus: string): boolean {
  return subscriptionStatus === "PENDING_ACTIVATION";
}
