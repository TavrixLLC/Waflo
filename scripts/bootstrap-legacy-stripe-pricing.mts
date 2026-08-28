/**
 * Controlled, restartable legacy-price bootstrap. Defaults to dry-run.
 * Run only against TEST mode: pnpm tsx scripts/bootstrap-legacy-stripe-pricing.mts --write
 */
import { randomUUID } from "node:crypto";
import { createPrismaClient } from "@waflo/database";
import Stripe from "stripe";
import { bootstrapLegacyStripePricing } from "../apps/api/src/billing/legacy-stripe-pricing-bootstrap.js";

const write = process.argv.includes("--write");
const key = process.env.STRIPE_SECRET_KEY;
if (!key || key.startsWith("sk_live_")) throw new Error("A Stripe TEST secret key is required.");
const stripe = new Stripe(key);
const prisma = createPrismaClient();

try {
  const result = await bootstrapLegacyStripePricing(
    {
      globalMarketId: async () =>
        (await prisma.pricingMarket.findUniqueOrThrow({ where: { code: "GLOBAL" } })).id,
      unmappedSubscriptions: () =>
        prisma.subscription.findMany({
          where: { pricingVersionId: null },
          orderBy: { createdAt: "asc" },
          select: { id: true, stripePriceId: true, planCode: true },
        }),
      pricingVersionByStripePriceId: (stripePriceId) =>
        prisma.pricingVersion.findUnique({ where: { stripePriceId } }),
      pricingVersionCount: (input) =>
        prisma.pricingVersion.count({
          where: {
            marketId: input.marketId,
            planCode: input.planCode,
            cadence: input.cadence,
          },
        }),
      createHistoricalVersion: (input) =>
        prisma.pricingVersion.create({
          data: { id: randomUUID(), status: "RETIRED_FOR_NEW_SUBSCRIPTIONS", ...input },
        }),
      snapshotSubscription: (input) =>
        prisma.subscription
          .updateMany({
            where: { id: input.subscriptionId, pricingVersionId: null },
            data: {
              pricingVersionId: input.pricingVersionId,
              pricingMarketCode: "GLOBAL",
              pricingCurrency: input.currency,
              pricingAmountMinor: input.amountMinor,
              cadence: input.cadence,
              grandfathered: true,
            },
          })
          .then(() => undefined),
    },
    {
      retrievePrice: async (stripePriceId) => {
        const price = await stripe.prices.retrieve(stripePriceId);
        return {
          id: price.id,
          currency: price.currency,
          amountMinor: price.unit_amount,
          cadence:
            price.recurring?.interval === "year"
              ? "YEARLY"
              : price.recurring?.interval === "month"
                ? "MONTHLY"
                : null,
          active: price.active,
          productId: typeof price.product === "string" ? price.product : price.product.id,
          createdAt: new Date(price.created * 1000),
        };
      },
    },
    { write },
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await prisma.$disconnect();
}
