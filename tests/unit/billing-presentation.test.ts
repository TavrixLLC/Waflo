import { describe, expect, it } from "vitest";
import {
  billingPriceTruth,
  canPersistCatalogSelection,
} from "../../apps/merchant-dashboard/components/billing-presentation.js";

describe("billing price presentation", () => {
  it("keeps the canonical catalog amounts exact", () => {
    expect(
      billingPriceTruth({
        plan: "starter",
        cadence: "monthly",
        nextExpectedAmount: 2900,
        currency: "USD",
      }),
    ).toMatchObject({
      catalogBilledAmountMinor: 2900,
      currentSubscriptionPriceDiffers: false,
      catalog: { billedAmountUsd: 29, monthlyEquivalentUsd: 29 },
    });
    expect(
      billingPriceTruth({
        plan: "growth",
        cadence: "quarterly",
        nextExpectedAmount: 18_975,
        currency: "usd",
      }),
    ).toMatchObject({
      catalogBilledAmountMinor: 18_975,
      currentSubscriptionPriceDiffers: false,
      catalog: { monthlyEquivalentUsd: 63.25 },
    });
    expect(
      billingPriceTruth({
        plan: "scale",
        cadence: "yearly",
        nextExpectedAmount: 129_000,
        currency: "USD",
      }),
    ).toMatchObject({
      catalogBilledAmountMinor: 129_000,
      currentSubscriptionPriceDiffers: false,
      catalog: { monthlyEquivalentUsd: 107.5 },
    });
  });

  it("marks only a comparable active Stripe renewal as distinct from the new catalog", () => {
    expect(
      billingPriceTruth({
        plan: "starter",
        cadence: "monthly",
        nextExpectedAmount: 3900,
        currency: "USD",
      }).currentSubscriptionPriceDiffers,
    ).toBe(true);
    expect(
      billingPriceTruth({
        plan: "starter",
        cadence: "monthly",
        nextExpectedAmount: 3900,
        currency: "EUR",
      }).currentSubscriptionPriceDiffers,
    ).toBe(false);
    expect(
      billingPriceTruth({
        plan: "starter",
        cadence: "monthly",
        nextExpectedAmount: null,
        currency: "USD",
      }).currentSubscriptionPriceDiffers,
    ).toBe(false);
  });

  it("keeps active subscriptions in catalog-preview mode", () => {
    expect(canPersistCatalogSelection("PENDING_ACTIVATION")).toBe(true);
    expect(canPersistCatalogSelection("TRIALING")).toBe(false);
    expect(canPersistCatalogSelection("ACTIVE")).toBe(false);
    expect(canPersistCatalogSelection("PAST_DUE")).toBe(false);
  });
});
