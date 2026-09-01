import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PricingCatalogService } from "../../apps/api/src/billing/pricing-catalog.service.js";
import { EnvironmentService } from "../../apps/api/src/config/environment.service.js";
import { PrismaService } from "../../apps/api/src/database/prisma.service.js";

const plans = ["STARTER", "GROWTH", "SCALE"] as const;
const cadences = ["MONTHLY", "QUARTERLY", "YEARLY"] as const;
const runId = randomUUID().slice(0, 8);

let prisma: PrismaService;
let catalog: PricingCatalogService;
let turkeyMarketId = "";

async function publishTerms(input: {
  marketId: string;
  currency: "USD" | "TRY";
  amounts: readonly (readonly [bigint, bigint, bigint])[];
}) {
  await Promise.all(
    plans.flatMap((plan, planIndex) =>
      cadences.map((cadence, cadenceIndex) => {
        const amountMinor = input.amounts[planIndex]?.[cadenceIndex];
        if (!amountMinor) throw new Error("Pricing test fixture is incomplete.");
        return prisma.client.pricingVersion.upsert({
          where: {
            marketId_planCode_cadence_version: {
              marketId: input.marketId,
              planCode: plan,
              cadence,
              version: 1,
            },
          },
          update: {
            currency: input.currency,
            amountMinor,
            status: "ACTIVE_FOR_NEW_SUBSCRIPTIONS",
            publishedAt: new Date(),
          },
          create: {
            marketId: input.marketId,
            planCode: plan,
            cadence,
            version: 1,
            currency: input.currency,
            amountMinor,
            status: "ACTIVE_FOR_NEW_SUBSCRIPTIONS",
            stripeBindingKey: `public-read:${runId}:${input.currency}:${plan}:${cadence}`,
            publishedAt: new Date(),
          },
        });
      }),
    ),
  );
}

beforeAll(async () => {
  const environment = new EnvironmentService();
  prisma = new PrismaService(environment);
  catalog = new PricingCatalogService(prisma, environment);
  const global = await prisma.client.pricingMarket.upsert({
    where: { code: "GLOBAL" },
    update: { active: true, configuredCurrency: "USD" },
    create: { code: "GLOBAL", kind: "GLOBAL", active: true, configuredCurrency: "USD" },
  });
  const turkey = await prisma.client.pricingMarket.upsert({
    where: { code: "TR" },
    update: {
      kind: "COUNTRY_OVERRIDE",
      countryCode: "TR",
      active: true,
      configuredCurrency: "TRY",
    },
    create: {
      code: "TR",
      kind: "COUNTRY_OVERRIDE",
      countryCode: "TR",
      active: true,
      configuredCurrency: "TRY",
      fallbackMarketCode: "GLOBAL",
    },
  });
  turkeyMarketId = turkey.id;
  await publishTerms({
    marketId: global.id,
    currency: "USD",
    amounts: [
      [2900n, 8100n, 29000n],
      [6900n, 19200n, 69000n],
      [12900n, 36000n, 129000n],
    ],
  });
  await publishTerms({
    marketId: turkey.id,
    currency: "TRY",
    amounts: [
      [109900n, 299700n, 1_099_000n],
      [179900n, 489700n, 1_799_000n],
      [369900n, 999700n, 3_699_000n],
    ],
  });
});

afterAll(async () => prisma.onModuleDestroy());

describe("published public pricing market read model", () => {
  it("uses active complete Turkey terms for TR without FX conversion", async () => {
    await expect(catalog.publicCatalogTermsForCountry("TR")).resolves.toMatchObject({
      market: { code: "TR", country: "TR", currency: "TRY" },
      fallbackReason: "regional_published",
      terms: expect.arrayContaining([
        { plan: "starter", cadence: "monthly", amountMinor: "109900", currency: "TRY" },
        { plan: "growth", cadence: "monthly", amountMinor: "179900", currency: "TRY" },
        { plan: "scale", cadence: "monthly", amountMinor: "369900", currency: "TRY" },
      ]),
    });
  });

  it("falls back to GLOBAL for no override, inactive TR, or incomplete TR publication", async () => {
    await expect(catalog.publicCatalogTermsForCountry("US")).resolves.toMatchObject({
      market: { code: "GLOBAL", currency: "USD" },
    });
    await expect(catalog.publicCatalogTermsForCountry(null)).resolves.toMatchObject({
      market: { code: "GLOBAL", currency: "USD" },
    });

    await prisma.client.pricingMarket.update({
      where: { id: turkeyMarketId },
      data: { active: false },
    });
    await expect(catalog.publicCatalogTermsForCountry("TR")).resolves.toMatchObject({
      market: { code: "GLOBAL", currency: "USD" },
      fallbackReason: "no_active_regional_market",
    });
    await prisma.client.pricingMarket.update({
      where: { id: turkeyMarketId },
      data: { active: true },
    });
    await prisma.client.pricingVersion.updateMany({
      where: { marketId: turkeyMarketId, planCode: "SCALE", cadence: "YEARLY" },
      data: { status: "RETIRED_FOR_NEW_SUBSCRIPTIONS" },
    });
    await expect(catalog.publicCatalogTermsForCountry("TR")).resolves.toMatchObject({
      market: { code: "GLOBAL", currency: "USD" },
      fallbackReason: "regional_catalog_incomplete",
    });
  });

  it("keeps sequential country reads isolated", async () => {
    await publishTerms({
      marketId: turkeyMarketId,
      currency: "TRY",
      amounts: [
        [109900n, 299700n, 1_099_000n],
        [179900n, 489700n, 1_799_000n],
        [369900n, 999700n, 3_699_000n],
      ],
    });
    const currencies = await Promise.all(
      ["TR", "US", "TR"].map(async (country) => {
        const result = await catalog.publicCatalogTermsForCountry(country);
        return result.market.currency;
      }),
    );
    expect(currencies).toEqual(["TRY", "USD", "TRY"]);
  });
});
