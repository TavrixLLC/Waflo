import { subscriptionChangeConfirmSchema } from "../../packages/contracts/src/index.js";
import { describe, expect, it, vi } from "vitest";
import { BillingService } from "../../apps/api/src/billing/billing.service.js";
import { stripeSubscriptionFingerprint } from "../../apps/api/src/billing/stripe-subscription-preview.js";
import type Stripe from "stripe";

const organizationId = "10000000-0000-4000-8000-000000000001";
const otherOrganizationId = "10000000-0000-4000-8000-000000000099";
const previewId = "40000000-0000-4000-8000-000000000001";
const request = { requestId: "confirm-test", headers: {} } as never;

function stripeSubscription(
  priceId: string,
  amount: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: "sub_current",
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
          price: { id: priceId, currency: "usd", unit_amount: amount },
        },
      ],
    },
    ...overrides,
  } as unknown as Stripe.Subscription;
}

function harness(
  options: {
    preview?: Record<string, unknown>;
    local?: Record<string, unknown> | null;
    target?: Record<string, unknown> | null;
    authoritative?: Record<string, unknown>;
    provider?: Stripe.Subscription;
    updateError?: Error;
    auditFailsOnce?: boolean;
    activePrograms?: number;
  } = {},
) {
  const sourceProvider = stripeSubscription("price_growth", 6900);
  let providerState = options.provider ?? sourceProvider;
  const sourceItem = sourceProvider.items.data[0];
  if (!sourceItem) throw new Error("source item fixture missing");
  const basePreview = {
    id: "preview-internal",
    publicId: previewId,
    organizationId,
    subscriptionId: "subscription-local",
    stripeSubscriptionId: "sub_current",
    stripeSubscriptionItemId: "si_current",
    sourcePlan: "GROWTH",
    sourceCadence: "MONTHLY",
    sourcePricingVersionId: "version-growth",
    sourceStripePriceId: "price_growth",
    sourceAmountMinor: 6900n,
    sourceCurrency: "USD",
    targetPlan: "SCALE",
    targetCadence: "MONTHLY",
    targetPricingVersionId: "version-scale",
    targetStripePriceId: "price_scale",
    targetAmountMinor: 12900n,
    targetCurrency: "USD",
    prorationDate: new Date("2026-08-27T12:00:00Z"),
    providerFingerprint: stripeSubscriptionFingerprint(sourceProvider, sourceItem),
    amountDueNowMinor: 3100n,
    creditAmountMinor: 900n,
    prorationSummary: [],
    nextRenewalAmountMinor: null,
    nextRenewalAt: null,
    status: "PENDING",
    createdAt: new Date("2026-08-27T12:00:00Z"),
    expiresAt: new Date(Date.now() + 600_000),
    confirmedAt: null,
    invalidatedAt: null,
    ...options.preview,
  };
  let preview = { ...basePreview };
  let local =
    options.local === null
      ? null
      : {
          id: "subscription-local",
          organizationId,
          stripeSubscriptionId: "sub_current",
          stripePriceId: "price_growth",
          pricingVersionId: "version-growth",
          pricingMarketCode: "GLOBAL",
          pricingCurrency: "USD",
          pricingAmountMinor: 6900n,
          cadence: "MONTHLY",
          planCode: "GROWTH",
          status: "ACTIVE",
          ...options.local,
        };
  const target =
    options.target === null
      ? null
      : {
          id: "version-scale",
          planCode: "SCALE",
          cadence: "MONTHLY",
          currency: "USD",
          amountMinor: 12900n,
          stripePriceId: "price_scale",
          market: { code: "GLOBAL" },
          ...options.target,
        };
  const updateCalls: Array<Record<string, unknown>> = [];
  let auditShouldFail = options.auditFailsOnce ?? false;
  let transactionTail = Promise.resolve();
  const client = {
    billingSubscriptionChangePreview: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        where.organizationId === organizationId && where.publicId === previewId ? preview : null,
      ),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        preview = { ...preview, ...data };
        return preview;
      }),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    subscription: {
      findFirst: vi.fn(async () => local),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        local = local ? { ...local, ...data } : local;
        return local;
      }),
    },
    pricingVersion: { findUnique: vi.fn(async () => target) },
    organizationBillingProfile: {
      findUniqueOrThrow: vi.fn(async () => ({ stripeCustomerId: "cus_org" })),
      update: vi.fn(async () => undefined),
    },
    organization: { update: vi.fn(async () => undefined) },
    location: { count: vi.fn(async () => 0) },
    organizationMember: { count: vi.fn(async () => 0) },
    organizationInvitation: { count: vi.fn(async () => 0) },
    loyaltyProgram: {
      findMany: vi.fn(async () => Array.from({ length: options.activePrograms ?? 0 }, () => ({}))),
    },
    exportCommand: { count: vi.fn(async () => 0) },
    auditLog: {
      create: vi.fn(async () => {
        if (auditShouldFail) {
          auditShouldFail = false;
          throw new Error("local failure");
        }
      }),
    },
    $queryRaw: vi.fn(async () => [{ locked: 1 }]),
  };
  const prisma = {
    client: {
      ...client,
      $transaction: async (operation: (tx: typeof client) => Promise<unknown>) => {
        const previous = transactionTail;
        let release = () => undefined;
        transactionTail = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;
        const before = { ...preview };
        const localBefore = local ? { ...local } : local;
        try {
          return await operation(client);
        } catch (error) {
          preview = before;
          local = localBefore;
          throw error;
        } finally {
          release();
        }
      },
    },
  };
  const pricing = {
    resolveForOrganization: vi.fn(async () => ({
      pricingVersionId: "version-scale",
      marketCode: "GLOBAL",
      plan: "scale",
      cadence: "MONTHLY",
      currency: "USD",
      amountMinor: 12900n,
      stripePriceId: "price_scale",
      ...options.authoritative,
    })),
  };
  const tenant = { requireMembership: vi.fn(async () => undefined) };
  const service = new BillingService(
    prisma as never,
    { values: {}, stripeConfigured: false } as never,
    tenant as never,
    {} as never,
    {} as never,
    pricing as never,
  );
  service.subscriptionProvider = {
    retrieveSubscription: vi.fn(async () => providerState),
    createInvoicePreview: vi.fn(async () => {
      throw new Error("not used");
    }),
    updateSubscriptionItem: vi.fn(async (input) => {
      updateCalls.push(input);
      if (options.updateError) throw options.updateError;
      providerState = stripeSubscription("price_scale", 12900);
      return providerState;
    }),
  };
  return {
    service,
    tenant,
    pricing,
    updateCalls,
    getPreview: () => preview,
    getLocal: () => local,
    getProvider: () => providerState,
  };
}

async function confirm(h: ReturnType<typeof harness>, org = organizationId) {
  return h.service.confirmSubscriptionChange("user", org, previewId, request);
}

describe("subscription-change confirmation", () => {
  it("confirms an upgrade", async () => {
    expect((await confirm(harness())).change.toPlan).toBe("scale");
  });
  it("confirms a downgrade", async () => {
    const h = harness({
      preview: {
        targetPlan: "STARTER",
        targetPricingVersionId: "version-scale",
        targetStripePriceId: "price_scale",
      },
      target: { planCode: "STARTER" },
      authoritative: { plan: "starter" },
    });
    expect((await confirm(h)).change.toPlan).toBe("starter");
  });
  it("rejects a downgrade whose usage changed after preview without mutating Stripe", async () => {
    const h = harness({
      preview: {
        targetPlan: "STARTER",
        targetPricingVersionId: "version-scale",
        targetStripePriceId: "price_scale",
      },
      target: { planCode: "STARTER" },
      authoritative: { plan: "starter" },
      activePrograms: 2,
    });
    await expect(confirm(h)).rejects.toMatchObject({ code: "PLAN_DOWNGRADE_BLOCKED" });
    expect(h.updateCalls).toHaveLength(0);
    expect(h.getLocal()?.planCode).toBe("GROWTH");
  });
  it("confirms a cadence change", async () => {
    const h = harness({
      preview: { targetPlan: "GROWTH", targetCadence: "YEARLY" },
      target: { planCode: "GROWTH", cadence: "YEARLY" },
      authoritative: { plan: "growth", cadence: "YEARLY" },
    });
    expect((await confirm(h)).change.toCadence).toBe("yearly");
  });
  it("uses only the persisted target Price", async () => {
    const h = harness();
    await confirm(h);
    expect(h.updateCalls[0]?.targetPriceId).toBe("price_scale");
  });
  it("reuses the persisted proration date", async () => {
    const h = harness();
    await confirm(h);
    expect(h.updateCalls[0]?.prorationDate).toBe(1_787_832_000);
  });
  it("uses merchant create_prorations", async () => {
    const h = harness();
    await confirm(h);
    expect(h.updateCalls[0]?.prorationBehavior).toBe("create_prorations");
  });
  it("updates provider plan and cadence metadata in the same commercial mutation", async () => {
    const h = harness();
    await confirm(h);
    expect(h.updateCalls[0]).toMatchObject({ targetPlan: "scale", targetCadence: "monthly" });
  });
  it("marks the preview confirmed", async () => {
    const h = harness();
    await confirm(h);
    expect(h.getPreview().status).toBe("CONFIRMED");
  });
  it("persists provider-confirmed plan and cadence before webhook reconciliation", async () => {
    const h = harness();
    await confirm(h);
    expect(h.getLocal()).toMatchObject({
      planCode: "SCALE",
      cadence: "MONTHLY",
      stripePriceId: "price_scale",
    });
  });
  it("persists confirmedAt", async () => {
    const h = harness();
    await confirm(h);
    expect(h.getPreview().confirmedAt).toBeInstanceOf(Date);
  });
  it("does not rewrite preview commercial terms", async () => {
    const h = harness();
    await confirm(h);
    expect(h.getPreview()).toMatchObject({
      sourceAmountMinor: 6900n,
      targetAmountMinor: 12900n,
      targetStripePriceId: "price_scale",
    });
  });
  it("rejects expired previews", async () => {
    const h = harness({ preview: { expiresAt: new Date(0) } });
    await expect(confirm(h)).rejects.toMatchObject({ code: "SUBSCRIPTION_CHANGE_PREVIEW_EXPIRED" });
  });
  it("rejects invalidated previews", async () => {
    await expect(confirm(harness({ preview: { status: "INVALIDATED" } }))).rejects.toMatchObject({
      code: "SUBSCRIPTION_CHANGE_PREVIEW_INVALIDATED",
    });
  });
  it("replays an already confirmed preview without mutation", async () => {
    const h = harness({ preview: { status: "CONFIRMED", confirmedAt: new Date() } });
    expect((await confirm(h)).status).toBe("CONFIRMED");
    expect(h.updateCalls).toHaveLength(0);
  });
  it("rejects cross-tenant confirmation", async () => {
    await expect(confirm(harness(), otherOrganizationId)).rejects.toMatchObject({
      code: "SUBSCRIPTION_CHANGE_PREVIEW_NOT_FOUND",
    });
  });
  it("rejects an authoritative market change", async () => {
    await expect(confirm(harness({ authoritative: { marketCode: "SA" } }))).rejects.toMatchObject({
      code: "SUBSCRIPTION_CHANGE_PRICING_MARKET_CHANGED",
    });
  });
  it("rejects target version term mismatch", async () => {
    await expect(confirm(harness({ target: { amountMinor: 13000n } }))).rejects.toMatchObject({
      code: "SUBSCRIPTION_CHANGE_TARGET_PRICING_CHANGED",
    });
  });
  it("rejects target Stripe binding mismatch", async () => {
    await expect(
      confirm(harness({ target: { stripePriceId: "price_rebound" } })),
    ).rejects.toMatchObject({ code: "SUBSCRIPTION_CHANGE_TARGET_PRICING_CHANGED" });
  });
  it("rejects a changed provider fingerprint", async () => {
    const changed = stripeSubscription("price_growth", 6900, { cancel_at_period_end: true });
    await expect(confirm(harness({ provider: changed }))).rejects.toMatchObject({
      code: "SUBSCRIPTION_CHANGE_PREVIEW_STALE",
    });
  });
  it("rejects a changed source Price", async () => {
    await expect(
      confirm(harness({ provider: stripeSubscription("price_other", 6900) })),
    ).rejects.toMatchObject({ code: "SUBSCRIPTION_CHANGE_PREVIEW_STALE" });
  });
  it("rejects a missing subscription item", async () => {
    await expect(
      confirm(
        harness({ provider: stripeSubscription("price_growth", 6900, { items: { data: [] } }) }),
      ),
    ).rejects.toMatchObject({ code: "STRIPE_SUBSCRIPTION_ITEM_INVALID" });
  });
  it("rejects multi-item subscriptions", async () => {
    const provider = stripeSubscription("price_growth", 6900);
    const firstItem = provider.items.data[0];
    if (!firstItem) throw new Error("fixture subscription item missing");
    provider.items.data.push(firstItem);
    await expect(confirm(harness({ provider }))).rejects.toMatchObject({
      code: "STRIPE_SUBSCRIPTION_ITEM_INVALID",
    });
  });
  it("does not confirm after provider failure", async () => {
    const h = harness({ updateError: new Error("provider") });
    await expect(confirm(h)).rejects.toMatchObject({ code: "SUBSCRIPTION_CHANGE_PROVIDER_FAILED" });
    expect(h.getPreview().status).toBe("PENDING");
  });
  it("converges provider success after local failure without a second mutation", async () => {
    const h = harness({ auditFailsOnce: true });
    await expect(confirm(h)).rejects.toThrow("local failure");
    expect(h.updateCalls).toHaveLength(1);
    expect((await confirm(h)).status).toBe("CONFIRMED");
    expect(h.updateCalls).toHaveLength(1);
  });
  it("makes duplicate confirmation safe", async () => {
    const h = harness();
    await confirm(h);
    await confirm(h);
    expect(h.updateCalls).toHaveLength(1);
  });
  it("serializes concurrent confirmation", async () => {
    const h = harness();
    const results = await Promise.all([confirm(h), confirm(h)]);
    expect(results).toHaveLength(2);
    expect(h.updateCalls).toHaveLength(1);
  });
  it("makes a competing old-source preview stale", async () => {
    const h = harness();
    await confirm(h);
    const second = harness({
      provider: h.getProvider(),
      preview: {
        targetPlan: "STARTER",
        targetPricingVersionId: "version-starter",
        targetStripePriceId: "price_starter",
        targetAmountMinor: 2900n,
      },
      target: {
        id: "version-starter",
        planCode: "STARTER",
        stripePriceId: "price_starter",
        amountMinor: 2900n,
      },
      authoritative: {
        pricingVersionId: "version-starter",
        plan: "starter",
        amountMinor: 2900n,
        stripePriceId: "price_starter",
      },
    });
    await expect(confirm(second)).rejects.toMatchObject({
      code: "SUBSCRIPTION_CHANGE_PREVIEW_STALE",
    });
  });
  it("confirmation body rejects amount", () => {
    expect(subscriptionChangeConfirmSchema.safeParse({ amount: 1 }).success).toBe(false);
  });
  it("confirmation body rejects currency", () => {
    expect(subscriptionChangeConfirmSchema.safeParse({ currency: "TRY" }).success).toBe(false);
  });
  it("confirmation body rejects Stripe Price", () => {
    expect(
      subscriptionChangeConfirmSchema.safeParse({ stripePriceId: "price_attack" }).success,
    ).toBe(false);
  });
  it("updates the existing subscription item instead of recreating a subscription", async () => {
    const h = harness();
    await confirm(h);
    expect(h.updateCalls[0]).toMatchObject({
      subscriptionId: "sub_current",
      subscriptionItemId: "si_current",
    });
  });
  it("does not invoke Checkout or invoice preview", async () => {
    const h = harness();
    await confirm(h);
    expect(h.updateCalls).toHaveLength(1);
  });
});
