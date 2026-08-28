import { subscriptionChangePreviewSchema } from "../../packages/contracts/src/index.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BillingService } from "../../apps/api/src/billing/billing.service.js";
import {
  stripeSubscriptionFingerprint,
  SUBSCRIPTION_CHANGE_PREVIEW_TTL_MS,
  summarizeStripeInvoicePreview,
} from "../../apps/api/src/billing/stripe-subscription-preview.js";
import type Stripe from "stripe";

const organizationId = "10000000-0000-4000-8000-000000000001";
const userId = "10000000-0000-4000-8000-000000000002";
const request = { requestId: "preview-test", headers: {} } as never;
const local = {
  id: "20000000-0000-4000-8000-000000000001",
  organizationId,
  stripeSubscriptionId: "sub_current",
  stripePriceId: "price_growth_usd",
  pricingVersionId: "30000000-0000-4000-8000-000000000001",
  pricingMarketCode: "GLOBAL",
  pricingCurrency: "USD",
  pricingAmountMinor: 6900n,
  cadence: "MONTHLY",
  planCode: "GROWTH",
  status: "ACTIVE",
};

function providerSubscription(priceId = local.stripePriceId, currency = "usd", amount = 6900) {
  return {
    id: local.stripeSubscriptionId,
    status: "active",
    customer: "cus_org",
    cancel_at_period_end: false,
    items: {
      data: [
        {
          id: "si_current",
          quantity: 1,
          current_period_start: 1_700_000_000,
          current_period_end: 1_702_592_000,
          price: { id: priceId, currency, unit_amount: amount },
        },
      ],
    },
  } as unknown as Stripe.Subscription;
}

function providerInvoice(currency = "usd") {
  return {
    id: "upcoming_in_preview",
    currency,
    amount_due: 3100,
    period_end: 1_702_592_000,
    lines: {
      data: [
        {
          amount: -900,
          currency,
          description: "Unused Growth time",
          parent: { subscription_item_details: { proration: true } },
        },
        {
          amount: 4000,
          currency,
          description: "Remaining Scale time",
          parent: { subscription_item_details: { proration: true } },
        },
      ],
    },
  } as unknown as Stripe.Invoice;
}

function harness(overrides: Record<string, unknown> = {}) {
  const created: Array<Record<string, unknown>> = [];
  const previewCalls: Array<Record<string, unknown>> = [];
  const prisma = {
    client: {
      subscription: { findFirst: vi.fn(async () => local) },
      organizationBillingProfile: {
        findUniqueOrThrow: vi.fn(async () => ({ organizationId, stripeCustomerId: "cus_org" })),
      },
      billingSubscriptionChangePreview: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return { ...data, publicId: "40000000-0000-4000-8000-000000000001" };
        }),
      },
    },
  };
  const pricing = {
    resolveForMarket: vi.fn(async (marketCode: string) => ({
      pricingVersionId: "30000000-0000-4000-8000-000000000002",
      marketCode,
      plan: "scale",
      cadence: "MONTHLY",
      currency: "USD",
      amountMinor: 12900n,
      stripePriceId: "price_scale_usd",
    })),
  };
  const tenant = { requireMembership: vi.fn(async () => undefined) };
  const audit = { record: vi.fn(async () => undefined) };
  const service = new BillingService(
    prisma as never,
    { values: {}, stripeConfigured: false } as never,
    tenant as never,
    audit as never,
    {} as never,
    pricing as never,
  );
  service.subscriptionProvider = {
    retrieveSubscription: vi.fn(async () => providerSubscription()),
    createInvoicePreview: vi.fn(async (input) => {
      previewCalls.push(input);
      return providerInvoice();
    }),
    updateSubscriptionItem: vi.fn(async () =>
      providerSubscription("price_scale_usd", "usd", 12900),
    ),
  };
  Object.assign(prisma.client.subscription, overrides.subscription);
  Object.assign(pricing, overrides.pricing);
  Object.assign(tenant, overrides.tenant);
  Object.assign(service.subscriptionProvider, overrides.provider);
  return { service, prisma, pricing, tenant, audit, created, previewCalls };
}

describe("subscription-change preview", () => {
  beforeEach(() => vi.useRealTimers());

  it("resolves the target in the subscription's GLOBAL market", async () => {
    const h = harness();
    await h.service.createSubscriptionChangePreview(
      userId,
      organizationId,
      "scale",
      "monthly",
      request,
    );
    expect(h.pricing.resolveForMarket).toHaveBeenCalledWith("GLOBAL", "scale", "MONTHLY");
  });

  it("retains an explicit regional market", async () => {
    const h = harness({
      subscription: { findFirst: vi.fn(async () => ({ ...local, pricingMarketCode: "SA" })) },
    });
    await h.service.createSubscriptionChangePreview(
      userId,
      organizationId,
      "scale",
      "monthly",
      request,
    );
    expect(h.pricing.resolveForMarket).toHaveBeenCalledWith("SA", "scale", "MONTHLY");
  });

  it("uses GLOBAL when the canonical subscription snapshot is GLOBAL", async () => {
    const h = harness();
    const result = await h.service.createSubscriptionChangePreview(
      userId,
      organizationId,
      "scale",
      "monthly",
      request,
    );
    expect(result.target.currency).toBe("USD");
  });

  it("uses the manual target catalog amount", async () => {
    const h = harness();
    const result = await h.service.createSubscriptionChangePreview(
      userId,
      organizationId,
      "scale",
      "monthly",
      request,
    );
    expect(result.target.amountMinor).toBe("12900");
  });

  it("has no client amount, currency, or Price fields", () => {
    expect(
      subscriptionChangePreviewSchema.safeParse({
        targetPlan: "scale",
        targetCadence: "monthly",
        amount: 1,
      }).success,
    ).toBe(false);
    expect(
      subscriptionChangePreviewSchema.safeParse({
        targetPlan: "scale",
        targetCadence: "monthly",
        currency: "TRY",
      }).success,
    ).toBe(false);
    expect(
      subscriptionChangePreviewSchema.safeParse({
        targetPlan: "scale",
        targetCadence: "monthly",
        stripePriceId: "price_attack",
      }).success,
    ).toBe(false);
  });

  it("passes the bound target Price to Stripe preview", async () => {
    const h = harness();
    await h.service.createSubscriptionChangePreview(
      userId,
      organizationId,
      "scale",
      "monthly",
      request,
    );
    expect(h.previewCalls[0]).toMatchObject({
      targetPriceId: "price_scale_usd",
      subscriptionItemId: "si_current",
    });
  });

  it("generates and persists one proration date", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-27T12:00:00Z"));
    const h = harness();
    await h.service.createSubscriptionChangePreview(
      userId,
      organizationId,
      "scale",
      "monthly",
      request,
    );
    expect(h.previewCalls[0]?.prorationDate).toBe(1_787_832_000);
    expect(h.created[0]?.prorationDate).toEqual(new Date("2026-08-27T12:00:00Z"));
  });

  it("persists a deterministic provider fingerprint", async () => {
    const h = harness();
    await h.service.createSubscriptionChangePreview(
      userId,
      organizationId,
      "scale",
      "monthly",
      request,
    );
    expect(h.created[0]?.providerFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("fingerprint changes with provider Price state", () => {
    const a = providerSubscription();
    const b = providerSubscription("price_changed");
    const aItem = a.items.data[0];
    const bItem = b.items.data[0];
    expect(aItem).toBeDefined();
    expect(bItem).toBeDefined();
    if (!aItem || !bItem) throw new Error("fixture subscription item missing");
    expect(stripeSubscriptionFingerprint(a, aItem)).not.toBe(
      stripeSubscriptionFingerprint(b, bItem),
    );
  });

  it("persists the centralized preview TTL", async () => {
    const h = harness();
    await h.service.createSubscriptionChangePreview(
      userId,
      organizationId,
      "scale",
      "monthly",
      request,
    );
    const created = h.created[0];
    expect(created).toBeDefined();
    if (!created) throw new Error("preview fixture was not persisted");
    expect((created.expiresAt as Date).getTime() - (created.createdAt as Date).getTime()).toBe(
      SUBSCRIPTION_CHANGE_PREVIEW_TTL_MS,
    );
  });

  it("maps provider amount due and credits", async () => {
    const summary = summarizeStripeInvoicePreview(providerInvoice());
    expect(summary.amountDueNow).toBe(3100);
    expect(summary.creditAmount).toBe(900);
  });

  it("persists the PENDING lifecycle", async () => {
    const h = harness();
    await h.service.createSubscriptionChangePreview(
      userId,
      organizationId,
      "scale",
      "monthly",
      request,
    );
    expect(h.created[0]?.status).toBe("PENDING");
  });

  it("rejects cross-tenant access before commercial resolution", async () => {
    const denied = vi.fn(async () => {
      throw new Error("denied");
    });
    const h = harness({ tenant: { requireMembership: denied } });
    await expect(
      h.service.createSubscriptionChangePreview(
        userId,
        organizationId,
        "scale",
        "monthly",
        request,
      ),
    ).rejects.toThrow("denied");
    expect(h.pricing.resolveForMarket).not.toHaveBeenCalled();
  });

  it("fails without an active subscription", async () => {
    const h = harness({ subscription: { findFirst: vi.fn(async () => null) } });
    await expect(
      h.service.createSubscriptionChangePreview(
        userId,
        organizationId,
        "scale",
        "monthly",
        request,
      ),
    ).rejects.toMatchObject({ code: "ACTIVE_SUBSCRIPTION_REQUIRED" });
  });

  it("fails closed when target binding is missing", async () => {
    const h = harness({
      pricing: {
        resolveForMarket: vi.fn(async () => {
          throw new Error("unbound");
        }),
      },
    });
    await expect(
      h.service.createSubscriptionChangePreview(
        userId,
        organizationId,
        "scale",
        "monthly",
        request,
      ),
    ).rejects.toThrow("unbound");
  });

  it("fails closed for a currency transition", async () => {
    const h = harness({
      pricing: {
        resolveForMarket: vi.fn(async () => ({
          pricingVersionId: "target",
          marketCode: "GLOBAL",
          plan: "scale",
          cadence: "MONTHLY",
          currency: "TRY",
          amountMinor: 99900n,
          stripePriceId: "price_try",
        })),
      },
    });
    await expect(
      h.service.createSubscriptionChangePreview(
        userId,
        organizationId,
        "scale",
        "monthly",
        request,
      ),
    ).rejects.toMatchObject({ code: "SUBSCRIPTION_CHANGE_CURRENCY_UNSUPPORTED" });
  });

  it("does not persist when Stripe preview fails", async () => {
    const h = harness({
      provider: {
        createInvoicePreview: vi.fn(async () => {
          throw new Error("provider");
        }),
      },
    });
    await expect(
      h.service.createSubscriptionChangePreview(
        userId,
        organizationId,
        "scale",
        "monthly",
        request,
      ),
    ).rejects.toMatchObject({ code: "STRIPE_PRORATION_PREVIEW_FAILED" });
    expect(h.created).toHaveLength(0);
  });

  it("rejects provider state inconsistent with the Waflo snapshot", async () => {
    const h = harness({
      provider: { retrieveSubscription: vi.fn(async () => providerSubscription("price_other")) },
    });
    await expect(
      h.service.createSubscriptionChangePreview(
        userId,
        organizationId,
        "scale",
        "monthly",
        request,
      ),
    ).rejects.toMatchObject({ code: "STRIPE_SUBSCRIPTION_SNAPSHOT_MISMATCH" });
  });

  it("rejects an exact plan and cadence no-op", async () => {
    const h = harness();
    await expect(
      h.service.createSubscriptionChangePreview(
        userId,
        organizationId,
        "growth",
        "monthly",
        request,
      ),
    ).rejects.toMatchObject({ code: "SUBSCRIPTION_CHANGE_NOOP" });
  });

  it("rejects a provider preview in another currency", async () => {
    const h = harness({
      provider: { createInvoicePreview: vi.fn(async () => providerInvoice("try")) },
    });
    await expect(
      h.service.createSubscriptionChangePreview(
        userId,
        organizationId,
        "scale",
        "monthly",
        request,
      ),
    ).rejects.toMatchObject({ code: "STRIPE_PREVIEW_CURRENCY_MISMATCH" });
  });

  it("performs no FX derivation", async () => {
    const h = harness();
    await h.service.createSubscriptionChangePreview(
      userId,
      organizationId,
      "scale",
      "monthly",
      request,
    );
    expect(h.created[0]).toMatchObject({ sourceAmountMinor: 6900n, targetAmountMinor: 12900n });
  });
});
