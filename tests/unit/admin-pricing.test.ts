import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AdminPermissionGuard } from "../../apps/api/src/admin/admin.guard.js";
import { AdminPricingController } from "../../apps/api/src/admin/admin-pricing.controller.js";
import {
  adminPricingDraftSchema,
  adminPricingMarketCreateSchema,
  adminPricingMarketUpdateSchema,
  pricingDecimalToMinor,
  pricingVersionStatusLabel,
} from "../../apps/api/src/admin/admin-pricing.js";
import { AdminPricingService } from "../../apps/api/src/admin/admin-pricing.service.js";
import {
  adminRoleHasPermission,
  permissionsForAdminRole,
} from "../../apps/api/src/admin/admin-rbac.js";
import {
  currencyMinorDigits,
  PricingCatalogService,
  type PricingStripeCatalogProvider,
} from "../../apps/api/src/billing/pricing-catalog.service.js";
import { ADMIN_PERMISSIONS } from "../../apps/api/src/common/decorators.js";

const NOW = new Date("2026-08-27T12:00:00.000Z");

function catalogFixture(overrides: Record<string, unknown> = {}) {
  const market = {
    id: "10000000-0000-4000-8000-000000000099",
    code: "GLOBAL",
    kind: "GLOBAL",
    countryCode: null,
    configuredCurrency: "USD",
    active: true,
    fallbackMarketCode: null,
    annualNoticeDays: 30,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const versions: Array<Record<string, unknown>> = [];
  let providerCreates = 0;
  const prices = new Map<
    string,
    {
      id: string;
      productId: string;
      active: boolean;
      currency: string;
      unitAmount: number;
      interval: "month" | "year";
      intervalCount: number;
    }
  >();
  const provider: PricingStripeCatalogProvider = {
    validateCurrency: async (currency) => currency !== "ZZZ",
    ensureProduct: async ({ requestedProductId }) => ({
      id: requestedProductId ?? "prod_waflo_growth",
    }),
    retrievePrice: async (priceId) => {
      const price = prices.get(priceId);
      if (!price) throw new Error("missing Stripe price");
      return price;
    },
    createPrice: async (input) => {
      providerCreates += 1;
      const existing = [...prices.values()].find(
        (price) => price.id === `price_${input.idempotencyKey}`,
      );
      if (existing) return existing;
      const price = {
        id: `price_${input.idempotencyKey}`,
        productId: input.productId,
        active: true,
        currency: input.currency,
        unitAmount: input.amountMinor,
        interval: input.interval,
        intervalCount: input.intervalCount,
      };
      prices.set(price.id, price);
      return price;
    },
  };
  const client: Record<string, unknown> = {
    $queryRaw: async () => [{ locked: 1 }],
    $transaction: async (callback: (transaction: unknown) => unknown) => callback(client),
    pricingMarket: {
      findUnique: async ({ where }: { where: { code?: string; id?: string } }) =>
        where.code === market.code || where.id === market.id ? market : null,
      findUniqueOrThrow: async ({ where }: { where: { code?: string; id?: string } }) => {
        if (where.code === market.code || where.id === market.id) return market;
        throw new Error("market not found");
      },
      findFirst: async ({
        where,
      }: {
        where?: { OR?: Array<{ code?: string; countryCode?: string }> };
      } = {}) => {
        if (!where?.OR) return market;
        return where.OR.some(
          (candidate) =>
            candidate.code === market.code || candidate.countryCode === market.countryCode,
        )
          ? market
          : null;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => ({
        ...market,
        ...data,
        id: "market-new",
      }),
      update: async ({ data }: { data: Record<string, unknown> }) => Object.assign(market, data),
    },
    pricingVersion: {
      findUnique: async ({
        where,
        include,
      }: {
        where: { id: string };
        include?: { market?: boolean };
      }) => {
        const version = versions.find((candidate) => candidate.id === where.id) ?? null;
        return version && include?.market ? { ...version, market } : version;
      },
      findUniqueOrThrow: async ({
        where,
        include,
      }: {
        where: { id: string };
        include?: { market?: boolean };
      }) => {
        const version = versions.find((candidate) => candidate.id === where.id);
        if (!version) throw new Error("version not found");
        return include?.market ? { ...version, market } : version;
      },
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const candidates = versions
          .filter((candidate) =>
            Object.entries(where).every(([key, value]) => {
              if (key === "id" && typeof value === "object" && value && "not" in value)
                return candidate.id !== (value as { not: string }).not;
              if (key === "stripeProductId" && typeof value === "object")
                return candidate.stripeProductId !== null;
              return candidate[key] === value;
            }),
          )
          .sort((left, right) => Number(right.version) - Number(left.version));
        return candidates[0] ?? null;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const version = {
          id: `version-${versions.length + 1}`,
          status: "DRAFT",
          createdAt: NOW,
          publishedAt: null,
          retiredAt: null,
          stripeProductId: null,
          stripePriceId: null,
          ...data,
        };
        versions.push(version);
        return version;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const version = versions.find((candidate) => candidate.id === where.id);
        if (!version) throw new Error("not found");
        Object.assign(version, data);
        return version;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        const target = versions.filter(
          (candidate) =>
            candidate.marketId === where.marketId &&
            candidate.planCode === where.planCode &&
            candidate.cadence === where.cadence &&
            candidate.id !== (where.id as { not: string } | undefined)?.not &&
            candidate.status === where.status,
        );
        target.forEach((candidate) => {
          Object.assign(candidate, data);
        });
        return { count: target.length };
      },
      count: async ({ where }: { where: { marketId?: string } }) =>
        versions.filter((candidate) => !where.marketId || candidate.marketId === where.marketId)
          .length,
      findMany: async () => versions,
    },
    ...overrides,
  };
  const catalog = new PricingCatalogService(
    { client } as never,
    {
      values: { STRIPE_SECRET_KEY: "", DEPLOYMENT_ENVIRONMENT: "test" },
      stripeConfigured: false,
    } as never,
    provider,
  );
  return { catalog, market, versions, prices, providerCreates: () => providerCreates, client };
}

describe("Admin Pricing API and immutable catalog", () => {
  it("requires pricing.read for pricing route metadata", () => {
    const required = Reflect.getMetadata(
      ADMIN_PERMISSIONS,
      AdminPricingController.prototype.overview,
    );
    expect(required).toEqual(["admin.pricing.read"]);
  });
  it("requires pricing.write for draft mutation metadata", () => {
    const required = Reflect.getMetadata(
      ADMIN_PERMISSIONS,
      AdminPricingController.prototype.createDraft,
    );
    expect(required).toEqual(["admin.pricing.write"]);
  });
  it("rejects a merchant context at the admin permission boundary", () => {
    const guard = new AdminPermissionGuard({
      getAllAndOverride: () => ["admin.pricing.read"],
    } as never);
    expect(() =>
      guard.canActivate({
        switchToHttp: () => ({ getRequest: () => ({}) }),
        getHandler: () => undefined,
        getClass: () => undefined,
      } as never),
    ).toThrowError(expect.objectContaining({ code: "ADMIN_AUTH_REQUIRED" }));
  });
  it("rejects a customer context at the admin permission boundary", () => {
    const guard = new AdminPermissionGuard({
      getAllAndOverride: () => ["admin.pricing.read"],
    } as never);
    expect(() =>
      guard.canActivate({
        switchToHttp: () => ({ getRequest: () => ({ currentUser: { id: "customer" } }) }),
        getHandler: () => undefined,
        getClass: () => undefined,
      } as never),
    ).toThrowError(expect.objectContaining({ code: "ADMIN_AUTH_REQUIRED" }));
  });
  it("denies pricing access to an admin without pricing.read", () =>
    expect(adminRoleHasPermission("SUPPORT", "admin.pricing.read")).toBe(false));
  it("allows pricing reads to FINANCE", () =>
    expect(adminRoleHasPermission("FINANCE", "admin.pricing.read")).toBe(true));
  it("requires pricing.write for mutations", () =>
    expect(adminRoleHasPermission("READ_ONLY", "admin.pricing.write")).toBe(false));
  it("denies publishing to SUPPORT", () =>
    expect(adminRoleHasPermission("SUPPORT", "admin.pricing.write")).toBe(false));
  it("allows drafts for PRICING_ADMIN", () =>
    expect(adminRoleHasPermission("PRICING_ADMIN", "admin.pricing.write")).toBe(true));
  it("gives SUPER_ADMIN the pricing capabilities", () =>
    expect(permissionsForAdminRole("SUPER_ADMIN")).toEqual(
      expect.arrayContaining(["admin.pricing.read", "admin.pricing.write"]),
    ));

  it("accepts a regional market create payload without a Stripe Price ID", () =>
    expect(adminPricingMarketCreateSchema.parse({ countryCode: "SA", currency: "SAR" })).toEqual({
      countryCode: "SA",
      currency: "SAR",
    }));
  it("rejects a client Stripe Price ID on market creation", () =>
    expect(() =>
      adminPricingMarketCreateSchema.parse({
        countryCode: "SA",
        currency: "SAR",
        stripePriceId: "price_bad",
      }),
    ).toThrow());
  it("accepts a draft decimal amount but no trusted minor amount", () =>
    expect(
      adminPricingDraftSchema.parse({
        marketId: "10000000-0000-4000-8000-000000000001",
        plan: "growth",
        cadence: "monthly",
        amount: "99",
        currency: "SAR",
      }).amount,
    ).toBe("99"));
  it("rejects a client Stripe Price ID on draft creation", () =>
    expect(() =>
      adminPricingDraftSchema.parse({
        marketId: "10000000-0000-4000-8000-000000000001",
        plan: "growth",
        cadence: "monthly",
        amount: "99",
        currency: "SAR",
        stripePriceId: "price_bad",
      }),
    ).toThrow());
  it("rejects a client minor-unit exponent", () =>
    expect(() =>
      adminPricingDraftSchema.parse({
        marketId: "10000000-0000-4000-8000-000000000001",
        plan: "growth",
        cadence: "monthly",
        amount: "99",
        currency: "SAR",
        exponent: 2,
      }),
    ).toThrow());
  it("requires a meaningful market update", () =>
    expect(() => adminPricingMarketUpdateSchema.parse({})).toThrow());
  it("converts USD decimal input using server ISO digits", () =>
    expect(pricingDecimalToMinor("29.00", "USD")).toBe(2900n));
  it("converts zero-decimal input without assumed cents", () =>
    expect(pricingDecimalToMinor("999", "JPY")).toBe(999n));
  it("converts SAR decimal input exactly", () =>
    expect(pricingDecimalToMinor("99", "SAR")).toBe(9900n));
  it("rejects fractional precision beyond the currency exponent", () =>
    expect(() => pricingDecimalToMinor("1.001", "USD")).toThrowError(
      expect.objectContaining({ code: "PRICING_AMOUNT_PRECISION_INVALID" }),
    ));
  it("rejects zero prices", () =>
    expect(() => pricingDecimalToMinor("0", "USD")).toThrowError(
      expect.objectContaining({ code: "PRICING_AMOUNT_INVALID" }),
    ));
  it("rejects negative prices", () =>
    expect(() => pricingDecimalToMinor("-1", "USD")).toThrowError(
      expect.objectContaining({ code: "PRICING_AMOUNT_INVALID" }),
    ));
  it("does not use FX to parse a local amount", () =>
    expect(pricingDecimalToMinor("999", "TRY")).toBe(99900n));
  it("derives correct zero-decimal metadata", () => expect(currencyMinorDigits("JPY")).toBe(0));
  it("labels only actual lifecycle states", () =>
    expect(pricingVersionStatusLabel("ACTIVE_FOR_NEW_SUBSCRIPTIONS")).toBe("CURRENT"));

  it("creates a draft with immutable server-derived minor terms", async () => {
    const { catalog, versions } = catalogFixture();
    const draft = await catalog.createDraft({
      marketCode: "GLOBAL",
      plan: "growth",
      cadence: "MONTHLY",
      currency: "USD",
      amountMinor: 2900n,
    });
    expect(draft).toMatchObject({
      status: "DRAFT",
      amountMinor: 2900n,
      currency: "USD",
      version: 1,
    });
    expect(versions).toHaveLength(1);
  });
  it("rejects a draft with a negative amount", async () => {
    const { catalog } = catalogFixture();
    await expect(
      catalog.createDraft({
        marketCode: "GLOBAL",
        plan: "growth",
        cadence: "MONTHLY",
        currency: "USD",
        amountMinor: -1n,
      }),
    ).rejects.toMatchObject({ code: "PRICING_DRAFT_INVALID" });
  });
  it("rejects a draft with a non-USD GLOBAL currency", async () => {
    const { catalog } = catalogFixture();
    await expect(
      catalog.createDraft({
        marketCode: "GLOBAL",
        plan: "growth",
        cadence: "MONTHLY",
        currency: "SAR",
        amountMinor: 9900n,
      }),
    ).rejects.toMatchObject({ code: "PRICING_MARKET_CURRENCY_CONFLICT" });
  });
  it("rejects a draft for an inactive market", async () => {
    const { catalog, market } = catalogFixture();
    market.active = false;
    await expect(
      catalog.createDraft({
        marketCode: "GLOBAL",
        plan: "growth",
        cadence: "MONTHLY",
        currency: "USD",
        amountMinor: 2900n,
      }),
    ).rejects.toMatchObject({ code: "PRICING_MARKET_UNAVAILABLE" });
  });
  it("creates an explicit country override without inferring any other market", async () => {
    const { catalog } = catalogFixture();
    await expect(
      catalog.createMarket({ countryCode: "SA", currency: "SAR" }),
    ).resolves.toMatchObject({
      code: "SA",
      countryCode: "SA",
      configuredCurrency: "SAR",
    });
  });
  it("rejects an invalid country rather than creating an implicit regional market", async () => {
    const { catalog } = catalogFixture();
    await expect(
      catalog.createMarket({ countryCode: "ZZ", currency: "USD" }),
    ).rejects.toMatchObject({
      code: "PRICING_COUNTRY_INVALID",
    });
  });
  it("does not allow GLOBAL deactivation", async () => {
    const { catalog } = catalogFixture();
    await expect(
      catalog.updateMarket("10000000-0000-4000-8000-000000000099", { active: false }),
    ).rejects.toMatchObject({
      code: "PRICING_GLOBAL_REQUIRED",
    });
  });
  it("allows an explicit regional market deactivation without touching subscriptions", async () => {
    const { catalog, market } = catalogFixture();
    market.kind = "COUNTRY_OVERRIDE";
    market.countryCode = "SA";
    market.code = "SA";
    market.configuredCurrency = "SAR";
    await expect(catalog.updateMarket(market.id, { active: false })).resolves.toMatchObject({
      active: false,
    });
  });
  it("establishes legacy regional configured currency only from an explicit draft", async () => {
    const { catalog, market } = catalogFixture();
    market.kind = "COUNTRY_OVERRIDE";
    market.countryCode = "SA";
    market.code = "SA";
    market.configuredCurrency = null;
    await catalog.createDraft({
      marketCode: "SA",
      plan: "growth",
      cadence: "MONTHLY",
      currency: "SAR",
      amountMinor: 9900n,
    });
    expect(market.configuredCurrency).toBe("SAR");
  });
  it("does not allow a market currency change after immutable price history exists", async () => {
    const { catalog, market, versions } = catalogFixture();
    market.kind = "COUNTRY_OVERRIDE";
    market.countryCode = "SA";
    market.code = "SA";
    market.configuredCurrency = "SAR";
    versions.push({
      id: "version-history",
      marketId: market.id,
      planCode: "GROWTH",
      cadence: "MONTHLY",
      version: 1,
      currency: "SAR",
      amountMinor: 9900n,
      status: "RETIRED_FOR_NEW_SUBSCRIPTIONS",
    });
    await expect(catalog.updateMarket(market.id, { currency: "USD" })).rejects.toMatchObject({
      code: "PRICING_MARKET_CURRENCY_IMMUTABLE",
    });
  });
  it("validates a supported draft", async () => {
    const { catalog } = catalogFixture();
    const draft = await catalog.createDraft({
      marketCode: "GLOBAL",
      plan: "growth",
      cadence: "MONTHLY",
      currency: "USD",
      amountMinor: 2900n,
    });
    await expect(catalog.validateDraft(draft.id as string)).resolves.toMatchObject({
      status: "VALIDATED",
    });
  });
  it("fails validation for a provider-unsupported currency", async () => {
    const { catalog, market } = catalogFixture();
    market.kind = "COUNTRY_OVERRIDE";
    market.configuredCurrency = "ZZZ";
    const draft = await catalog.createDraft({
      marketCode: "GLOBAL",
      plan: "growth",
      cadence: "MONTHLY",
      currency: "ZZZ",
      amountMinor: 100n,
    });
    await expect(catalog.validateDraft(draft.id as string)).rejects.toMatchObject({
      code: "PRICING_CURRENCY_UNSUPPORTED",
    });
  });
  it("does not allow validating a published immutable version", async () => {
    const { catalog, versions } = catalogFixture();
    versions.push({
      id: "version-active",
      marketId: "10000000-0000-4000-8000-000000000099",
      planCode: "GROWTH",
      cadence: "MONTHLY",
      currency: "USD",
      amountMinor: 2900n,
      status: "ACTIVE_FOR_NEW_SUBSCRIPTIONS",
      version: 1,
    });
    await expect(catalog.validateDraft("version-active")).rejects.toMatchObject({
      code: "PRICING_VERSION_IMMUTABLE",
    });
  });
  it("publishes a validated draft through the provider boundary", async () => {
    const { catalog } = catalogFixture();
    const draft = await catalog.createDraft({
      marketCode: "GLOBAL",
      plan: "growth",
      cadence: "MONTHLY",
      currency: "USD",
      amountMinor: 2900n,
    });
    await catalog.validateDraft(draft.id as string);
    await expect(catalog.publish(draft.id as string)).resolves.toMatchObject({
      currency: "USD",
      amountMinor: 2900n,
    });
  });
  it("publishing persists a Stripe binding", async () => {
    const { catalog, versions } = catalogFixture();
    const draft = await catalog.createDraft({
      marketCode: "GLOBAL",
      plan: "growth",
      cadence: "MONTHLY",
      currency: "USD",
      amountMinor: 2900n,
    });
    await catalog.validateDraft(draft.id as string);
    await catalog.publish(draft.id as string);
    expect(versions[0]).toMatchObject({
      status: "ACTIVE_FOR_NEW_SUBSCRIPTIONS",
      stripeProductId: "prod_waflo_growth",
    });
    expect(versions[0]?.stripePriceId).toMatch(/^price_waflo:price:/);
    expect(versions[0]?.stripePriceId).toBe("price_waflo:price:version-1");
  });
  it("publishing verifies exact Stripe amount", async () => {
    const { catalog, versions, prices } = catalogFixture();
    const draft = await catalog.createDraft({
      marketCode: "GLOBAL",
      plan: "growth",
      cadence: "MONTHLY",
      currency: "USD",
      amountMinor: 2900n,
    });
    await catalog.validateDraft(draft.id as string);
    await catalog.publish(draft.id as string);
    expect(prices.get(versions[0]?.stripePriceId as string)?.unitAmount).toBe(2900);
  });
  it("publishing verifies exact Stripe currency and recurrence", async () => {
    const { catalog, versions, prices } = catalogFixture();
    const draft = await catalog.createDraft({
      marketCode: "GLOBAL",
      plan: "growth",
      cadence: "YEARLY",
      currency: "USD",
      amountMinor: 29000n,
    });
    await catalog.validateDraft(draft.id as string);
    await catalog.publish(draft.id as string);
    expect(prices.get(versions[0]?.stripePriceId as string)).toMatchObject({
      currency: "USD",
      interval: "year",
    });
  });
  it("publishing a replay uses the persisted immutable binding", async () => {
    const { catalog, providerCreates } = catalogFixture();
    const draft = await catalog.createDraft({
      marketCode: "GLOBAL",
      plan: "growth",
      cadence: "MONTHLY",
      currency: "USD",
      amountMinor: 2900n,
    });
    await catalog.validateDraft(draft.id as string);
    await catalog.publish(draft.id as string);
    await catalog.publish(draft.id as string);
    expect(providerCreates()).toBe(1);
  });
  it("fails closed if a persisted Stripe binding later conflicts with immutable terms", async () => {
    const { catalog, versions, prices } = catalogFixture();
    const draft = await catalog.createDraft({
      marketCode: "GLOBAL",
      plan: "growth",
      cadence: "MONTHLY",
      currency: "USD",
      amountMinor: 2900n,
    });
    await catalog.validateDraft(draft.id as string);
    await catalog.publish(draft.id as string);
    const price = prices.get(versions[0]?.stripePriceId as string);
    if (price) price.unitAmount = 1;
    await expect(catalog.publish(draft.id as string)).rejects.toMatchObject({
      code: "STRIPE_PRICE_BINDING_MISMATCH",
    });
  });
  it("retiring a previous current version occurs only for new subscriptions", async () => {
    const { catalog, versions } = catalogFixture();
    const first = await catalog.createDraft({
      marketCode: "GLOBAL",
      plan: "growth",
      cadence: "MONTHLY",
      currency: "USD",
      amountMinor: 2900n,
    });
    await catalog.validateDraft(first.id as string);
    await catalog.publish(first.id as string);
    const second = await catalog.createDraft({
      marketCode: "GLOBAL",
      plan: "growth",
      cadence: "MONTHLY",
      currency: "USD",
      amountMinor: 3900n,
    });
    await catalog.validateDraft(second.id as string);
    await catalog.publish(second.id as string);
    expect(versions[0]).toMatchObject({
      status: "RETIRED_FOR_NEW_SUBSCRIPTIONS",
      amountMinor: 2900n,
    });
    expect(versions[1]).toMatchObject({
      status: "ACTIVE_FOR_NEW_SUBSCRIPTIONS",
      amountMinor: 3900n,
    });
  });
  it("does not update a Stripe subscription while publishing a price", async () => {
    const source = String(PricingCatalogService);
    expect(source).not.toContain("subscriptions.update");
  });
  it("does not create an invoice or proration while publishing", async () => {
    const source = String(PricingCatalogService);
    expect(source).not.toMatch(/invoices\.|proration_behavior/);
  });
  it("retains retired immutable versions", async () => {
    const { catalog, versions } = catalogFixture();
    const first = await catalog.createDraft({
      marketCode: "GLOBAL",
      plan: "growth",
      cadence: "MONTHLY",
      currency: "USD",
      amountMinor: 2900n,
    });
    await catalog.validateDraft(first.id as string);
    await catalog.publish(first.id as string);
    const second = await catalog.createDraft({
      marketCode: "GLOBAL",
      plan: "growth",
      cadence: "MONTHLY",
      currency: "USD",
      amountMinor: 3900n,
    });
    await catalog.validateDraft(second.id as string);
    await catalog.publish(second.id as string);
    expect(versions).toHaveLength(2);
  });
  it("cannot retire the sole active GLOBAL fallback", async () => {
    const { catalog } = catalogFixture();
    const draft = await catalog.createDraft({
      marketCode: "GLOBAL",
      plan: "growth",
      cadence: "MONTHLY",
      currency: "USD",
      amountMinor: 2900n,
    });
    await catalog.validateDraft(draft.id as string);
    await catalog.publish(draft.id as string);
    await expect(catalog.retire(draft.id as string)).rejects.toMatchObject({
      code: "PRICING_GLOBAL_FALLBACK_REQUIRED",
    });
  });
  it("does not provide hard-delete catalog behavior", () => {
    expect(Object.getOwnPropertyNames(PricingCatalogService.prototype)).not.toContain("delete");
  });
  it("persists only Waflo metadata in the Stripe Price creation contract", () => {
    const source = String(PricingCatalogService);
    expect(source).toContain("waflo_pricing_version_id");
    expect(source).toContain("waflo_environment");
  });
  it("does not use Adaptive Pricing", () =>
    expect(String(PricingCatalogService)).not.toMatch(/adaptive.?pricing/i));
  it("does not accept client FX-derived authority", () =>
    expect(
      readFileSync(resolve(process.cwd(), "apps/api/src/admin/admin-pricing.ts"), "utf8"),
    ).not.toMatch(/fxRate|exchangeRate|convertedAmount/i));

  it("returns overview counts from canonical database state", async () => {
    const service = new AdminPricingService(
      {
        client: {
          pricingMarket: {
            findMany: async () => [
              {
                id: "market",
                code: "GLOBAL",
                kind: "GLOBAL",
                countryCode: null,
                configuredCurrency: "USD",
                active: true,
                fallbackMarketCode: null,
                createdAt: NOW,
                updatedAt: NOW,
                versions: [],
              },
            ],
          },
          subscription: {
            findMany: async () => [
              {
                id: "sub",
                pricingMarketCode: "GLOBAL",
                pricingVersionId: "version",
                grandfathered: true,
                status: "ACTIVE",
              },
            ],
          },
          subscriptionRepricing: { findMany: async () => [{ subscriptionId: "sub" }] },
        },
      } as never,
      {} as never,
      {} as never,
    );
    await expect(service.overview()).resolves.toMatchObject({
      summary: {
        configuredMarkets: 1,
        grandfatheredSubscribers: 1,
        upcomingRepricingSubscribers: 1,
      },
    });
  });
  it("does not make live Stripe reads in pricing overview", () =>
    expect(String(AdminPricingService)).not.toMatch(/stripe\.|Stripe\(/));
  it("keeps price diagnostics as stored bindings rather than human input", () =>
    expect(
      readFileSync(
        resolve(process.cwd(), "apps/api/src/admin/admin-pricing.controller.ts"),
        "utf8",
      ),
    ).not.toContain("stripePriceId"));
  it("records a publish audit action", () =>
    expect(String(AdminPricingService)).toContain("admin.pricing.price_published"));
  it("records a non-secret Stripe binding failure audit action", () =>
    expect(String(AdminPricingService)).toContain("admin.pricing.stripe_binding_failed"));
  it("requires fresh pricing reauthentication before publishing", () =>
    expect(String(AdminPricingService)).toContain("ADMIN_PRICING_REAUTH_REQUIRED"));
  it("scopes the reauthentication timestamp to the exact Admin session", () =>
    expect(String(AdminPricingService)).toContain("pricingReauthenticatedAt"));
  it("does not require annual repricing authority to publish a version", () => {
    const required = Reflect.getMetadata(
      ADMIN_PERMISSIONS,
      AdminPricingController.prototype.publish,
    );
    expect(required).toEqual(["admin.pricing.write"]);
  });
});
