import type { PrismaClient } from "@waflo/database";
import { describe, expect, it } from "vitest";
import {
  BillingRepairCliError,
  parseBillingRepairSubscriptionPricingArgs,
  repairSubscriptionPricingFromCli,
} from "../../scripts/billing-repair-subscription-pricing-cli.ts";

const subscriptionId = "c1aef6ad-9d6a-4b68-8cf5-987c8a3dfce1";
const pricingVersionId = "c2aef6ad-9d6a-4b68-8cf5-987c8a3dfce1";

const subscription = {
  id: subscriptionId,
  organizationId: "c3aef6ad-9d6a-4b68-8cf5-987c8a3dfce1",
  stripeSubscriptionId: "sub_historical",
  stripePriceId: "price_historical",
  planCode: "STARTER",
  cadence: "MONTHLY",
  pricingVersionId: null,
  pricingMarketCode: null,
  pricingCurrency: null,
  pricingAmountMinor: null,
  pricingVersion: null,
  organization: { name: "Hamza Cafe" },
};

const candidate = {
  id: pricingVersionId,
  stripePriceId: null,
  stripeProductId: "prod_starter",
  planCode: "STARTER",
  cadence: "MONTHLY",
  currency: "USD",
  amountMinor: 2900n,
  market: { code: "GLOBAL" },
};

function stripeForRepair() {
  return {
    subscriptions: {
      retrieve: async () => ({
        items: {
          data: [
            {
              price: {
                id: "price_historical",
                unit_amount: 2900,
                currency: "usd",
                product: "prod_starter",
                recurring: { interval: "month", interval_count: 1 },
              },
            },
          ],
        },
      }),
    },
  };
}

function clientForRepair(options: { candidates?: readonly (typeof candidate)[] } = {}) {
  let disconnected = false;
  const operations: Array<{ name: string; value: unknown }> = [];
  const client = {
    subscription: {
      findUniqueOrThrow: async () => subscription,
    },
    pricingVersion: {
      findMany: async () => [...(options.candidates ?? [candidate])],
    },
    $transaction: async (callback: (transaction: unknown) => Promise<unknown>) =>
      callback({
        pricingVersion: {
          updateMany: async (value: unknown) => {
            operations.push({ name: "bind", value });
            return { count: 1 };
          },
        },
        subscription: {
          update: async (value: unknown) => operations.push({ name: "snapshot", value }),
        },
        auditLog: {
          create: async (value: unknown) => operations.push({ name: "audit", value }),
        },
      }),
    $disconnect: async () => {
      disconnected = true;
    },
  } as unknown as PrismaClient;
  return { client, operations, disconnected: () => disconnected };
}

function dryRunOptions() {
  return parseBillingRepairSubscriptionPricingArgs(["--subscription", subscriptionId, "--dry-run"]);
}

describe("subscription pricing repair CLI", () => {
  it("validates UUID arguments and rejects mutually exclusive write modes", () => {
    expect(() =>
      parseBillingRepairSubscriptionPricingArgs(["--subscription", "not-a-uuid"]),
    ).toThrow(BillingRepairCliError);
    expect(() =>
      parseBillingRepairSubscriptionPricingArgs([
        "--subscription",
        subscriptionId,
        "--write",
        "--dry-run",
      ]),
    ).toThrow("either --dry-run or --write");
  });

  it("reports deterministic dry-run evidence without any writes or Stripe mutation", async () => {
    const fixture = clientForRepair();
    const report = await repairSubscriptionPricingFromCli(dryRunOptions(), {
      getClient: () => fixture.client,
      stripe: stripeForRepair() as never,
    });

    expect(report).toMatchObject({
      dryRun: true,
      subscription: {
        wafloSubscriptionId: subscriptionId,
        stripeSubscriptionId: "sub_historical",
        stripePriceId: "price_historical",
        market: "GLOBAL",
        currency: "USD",
        cadence: "MONTHLY",
        unitAmountMinor: "2900",
      },
      candidatePricingVersion: { id: pricingVersionId },
    });
    expect(fixture.operations).toEqual([]);
    expect(fixture.disconnected()).toBe(true);
  });

  it("refuses ambiguous Price mappings without a repair write", async () => {
    const alternative = { ...candidate, id: "c4aef6ad-9d6a-4b68-8cf5-987c8a3dfce1" };
    const fixture = clientForRepair({ candidates: [candidate, alternative] });
    await expect(
      repairSubscriptionPricingFromCli(dryRunOptions(), {
        getClient: () => fixture.client,
        stripe: stripeForRepair() as never,
      }),
    ).rejects.toThrow("No unique deterministic PricingVersion mapping");
    expect(fixture.operations).toEqual([]);
    expect(fixture.disconnected()).toBe(true);
  });

  it("writes only the binding, immutable snapshot, and audit evidence", async () => {
    const fixture = clientForRepair();
    const writeOptions = parseBillingRepairSubscriptionPricingArgs([
      "--subscription",
      subscriptionId,
      "--write",
    ]);
    const report = await repairSubscriptionPricingFromCli(writeOptions, {
      getClient: () => fixture.client,
      stripe: stripeForRepair() as never,
    });

    expect(report.dryRun).toBe(false);
    expect(fixture.operations.map((operation) => operation.name)).toEqual([
      "bind",
      "snapshot",
      "audit",
    ]);
    expect(fixture.operations[2]).toEqual(
      expect.objectContaining({
        value: expect.objectContaining({
          data: expect.objectContaining({ action: "billing.subscription_pricing_repaired" }),
        }),
      }),
    );
    expect(JSON.stringify(report)).not.toContain("sk_test_");
    expect(fixture.disconnected()).toBe(true);
  });
});
