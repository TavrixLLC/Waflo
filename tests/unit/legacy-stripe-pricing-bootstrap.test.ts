import { describe, expect, it, vi } from "vitest";
import {
  bootstrapLegacyStripePricing,
  type LegacyPricingBootstrapProvider,
  type LegacyPricingBootstrapRepository,
  type LegacyPricingVersion,
  type LegacyStripePriceTerms,
} from "../../apps/api/src/billing/legacy-stripe-pricing-bootstrap.js";

const subscription = {
  id: "subscription-1",
  stripePriceId: "price_legacy_growth_usd",
  planCode: "GROWTH" as const,
};
const price: LegacyStripePriceTerms = {
  id: subscription.stripePriceId,
  currency: "usd",
  amountMinor: 2900,
  cadence: "MONTHLY",
  active: true,
  productId: "prod_growth",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
};

function harness(
  options: {
    subscriptions?: readonly (typeof subscription)[];
    price?: LegacyStripePriceTerms;
    existing?: LegacyPricingVersion | null;
    retrieveError?: Error;
  } = {},
) {
  const created: Array<Record<string, unknown>> = [];
  const snapshots: Array<Record<string, unknown>> = [];
  const provider = {
    retrievePrice: vi.fn(async () => {
      if (options.retrieveError) throw options.retrieveError;
      return options.price ?? price;
    }),
    updateSubscription: vi.fn(),
    createInvoice: vi.fn(),
  } satisfies LegacyPricingBootstrapProvider & {
    updateSubscription: ReturnType<typeof vi.fn>;
    createInvoice: ReturnType<typeof vi.fn>;
  };
  const repository = {
    globalMarketId: vi.fn(async () => "market-global"),
    unmappedSubscriptions: vi.fn(async () => options.subscriptions ?? [subscription]),
    pricingVersionByStripePriceId: vi.fn(async () => options.existing ?? null),
    pricingVersionCount: vi.fn(async () => 2),
    createHistoricalVersion: vi.fn(async (input) => {
      created.push(input);
      return {
        id: "historical-version-1",
        planCode: input.planCode,
        cadence: input.cadence,
        currency: input.currency,
        amountMinor: input.amountMinor,
      };
    }),
    snapshotSubscription: vi.fn(async (input) => {
      snapshots.push(input);
    }),
  } satisfies LegacyPricingBootstrapRepository;
  return { repository, provider, created, snapshots };
}

describe("legacy Stripe pricing bootstrap", () => {
  it("maps the snapshot cadence through the current Subscription schema field", () =>
    expect(
      readFileSync(resolve(process.cwd(), "scripts/bootstrap-legacy-stripe-pricing.mts"), "utf8"),
    ).toContain("cadence: input.cadence"));
  it("maps yearly Stripe recurring Prices to the release YEARLY cadence", () => {
    const script = readFileSync(
      resolve(process.cwd(), "scripts/bootstrap-legacy-stripe-pricing.mts"),
      "utf8",
    );
    expect(script).toContain('? "YEARLY"');
    expect(script).not.toContain('? "ANNUAL"');
  });

  it("defaults to dry run and produces no Waflo writes", async () => {
    const h = harness();
    const result = await bootstrapLegacyStripePricing(h.repository, h.provider, { write: false });
    expect(result).toMatchObject({ dryRun: true, total: 1 });
    expect(h.repository.createHistoricalVersion).not.toHaveBeenCalled();
    expect(h.repository.snapshotSubscription).not.toHaveBeenCalled();
  });

  it("reports exact provider currency, amount, and cadence in dry run", async () => {
    const h = harness();
    const result = await bootstrapLegacyStripePricing(h.repository, h.provider, { write: false });
    expect(result.report).toContainEqual({
      subscriptionId: subscription.id,
      result: "WILL_CREATE_HISTORICAL_VERSION",
      priceId: price.id,
      currency: "USD",
      amountMinor: 2900,
      cadence: "MONTHLY",
    });
  });

  it("writes a retired GLOBAL historical binding and immutable subscription snapshot", async () => {
    const h = harness();
    await bootstrapLegacyStripePricing(h.repository, h.provider, {
      write: true,
      now: new Date("2026-08-27T00:00:00.000Z"),
    });
    expect(h.created).toContainEqual({
      marketId: "market-global",
      planCode: "GROWTH",
      cadence: "MONTHLY",
      version: -3,
      currency: "USD",
      amountMinor: 2900n,
      stripeProductId: "prod_growth",
      stripePriceId: price.id,
      stripeBindingKey: "GLOBAL:GROWTH:MONTHLY:legacy:price_legacy_growth_usd",
      publishedAt: new Date("2026-01-01T00:00:00.000Z"),
      retiredAt: new Date("2026-08-27T00:00:00.000Z"),
    });
    expect(h.snapshots).toContainEqual({
      subscriptionId: subscription.id,
      pricingVersionId: "historical-version-1",
      cadence: "MONTHLY",
      currency: "USD",
      amountMinor: 2900n,
    });
  });

  it("replay reuses an existing matching binding and creates no duplicate", async () => {
    const h = harness({
      existing: {
        id: "historical-version-1",
        planCode: "GROWTH",
        cadence: "MONTHLY",
        currency: "USD",
        amountMinor: 2900n,
      },
    });
    const result = await bootstrapLegacyStripePricing(h.repository, h.provider, { write: true });
    expect(result.report[0]).toMatchObject({ result: "WILL_SNAPSHOT_EXISTING" });
    expect(h.repository.createHistoricalVersion).not.toHaveBeenCalled();
    expect(h.repository.snapshotSubscription).toHaveBeenCalledOnce();
  });

  it("does not change an existing Stripe subscription Price", async () => {
    const h = harness();
    await bootstrapLegacyStripePricing(h.repository, h.provider, { write: true });
    expect(h.provider.updateSubscription).not.toHaveBeenCalled();
  });

  it("does not create an invoice or proration", async () => {
    const h = harness();
    await bootstrapLegacyStripePricing(h.repository, h.provider, { write: true });
    expect(h.provider.createInvoice).not.toHaveBeenCalled();
  });

  it("fails closed for an unknown provider Price", async () => {
    const h = harness({ retrieveError: new Error("not found") });
    const result = await bootstrapLegacyStripePricing(h.repository, h.provider, { write: true });
    expect(result.report).toEqual([
      { subscriptionId: subscription.id, result: "UNKNOWN_STRIPE_PRICE", priceId: price.id },
    ]);
    expect(h.repository.snapshotSubscription).not.toHaveBeenCalled();
  });

  it.each([
    ["currency", { ...price, currency: "sar" }],
    ["amount", { ...price, amountMinor: 9900 }],
    ["cadence", { ...price, cadence: "YEARLY" as const }],
  ])("fails closed for a conflicting existing %s binding", async (_field, conflictingPrice) => {
    const h = harness({
      price: conflictingPrice,
      existing: {
        id: "historical-version-1",
        planCode: "GROWTH",
        cadence: "MONTHLY",
        currency: "USD",
        amountMinor: 2900n,
      },
    });
    const result = await bootstrapLegacyStripePricing(h.repository, h.provider, { write: true });
    expect(result.report[0]).toMatchObject({ result: "BINDING_CONFLICT" });
    expect(h.repository.snapshotSubscription).not.toHaveBeenCalled();
  });

  it("fails closed when provider terms are inactive or non-recurring", async () => {
    for (const invalid of [
      { ...price, active: false },
      { ...price, cadence: null },
    ]) {
      const h = harness({ price: invalid });
      const result = await bootstrapLegacyStripePricing(h.repository, h.provider, { write: true });
      expect(result.report[0]).toMatchObject({ result: "AMBIGUOUS_STRIPE_TERMS" });
      expect(h.repository.snapshotSubscription).not.toHaveBeenCalled();
    }
  });

  it("preserves a zero-decimal amount exactly without FX conversion", async () => {
    const h = harness({ price: { ...price, currency: "jpy", amountMinor: 9900 } });
    await bootstrapLegacyStripePricing(h.repository, h.provider, { write: true });
    expect(h.created[0]).toMatchObject({ currency: "JPY", amountMinor: 9900n });
    expect(h.snapshots[0]).toMatchObject({ currency: "JPY", amountMinor: 9900n });
  });

  it("preserves per-subscription tenant identity through repository-scoped writes", async () => {
    const h = harness();
    await bootstrapLegacyStripePricing(h.repository, h.provider, { write: true });
    expect(h.repository.snapshotSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionId: subscription.id }),
    );
  });
});
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
