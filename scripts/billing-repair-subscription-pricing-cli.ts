/**
 * Operational repair for a subscription whose historical Stripe Price was not
 * bound to an authoritative Waflo PricingVersion. It deliberately has no
 * Stripe writes: only existing Waflo evidence can be backfilled or bound.
 */
import { randomUUID } from "node:crypto";
import {
  createPrismaClient,
  type BillingCadence,
  type PlanCode,
  type PrismaClient,
} from "@waflo/database";
import Stripe from "stripe";

type Cadence = BillingCadence;

export class BillingRepairCliError extends Error {}

export interface BillingRepairSubscriptionPricingOptions {
  readonly subscriptionId: string;
  readonly explicitPricingVersionId: string | null;
  readonly write: boolean;
}

export interface BillingRepairSubscriptionPricingDependencies {
  readonly getClient?: () => PrismaClient;
  readonly stripe?: Pick<Stripe, "subscriptions">;
  readonly stripeSecretKey?: string | undefined;
}

interface CandidatePricingVersion {
  readonly id: string;
  readonly stripePriceId: string | null;
  readonly stripeProductId: string | null;
  readonly planCode: PlanCode;
  readonly cadence: Cadence;
  readonly currency: string;
  readonly amountMinor: bigint;
  readonly market: { readonly code: string };
}

interface SubscriptionSnapshot {
  readonly id: string;
  readonly stripeSubscriptionId: string;
  readonly organizationId: string;
  readonly planCode: PlanCode;
  readonly cadence: Cadence | null;
  readonly stripePriceId: string | null;
  readonly pricingVersionId: string | null;
  readonly pricingMarketCode: string | null;
  readonly pricingCurrency: string | null;
  readonly pricingAmountMinor: bigint | null;
  readonly pricingVersion: { readonly id: string } | null;
  readonly organization: { readonly name: string };
}

function usage(): string {
  return [
    "Usage: pnpm billing:repair-subscription-pricing -- --subscription <waflo-subscription-id> [--pricing-version <pricing-version-id>] [--dry-run|--write]",
    "Dry-run is the default. Write mode records deterministic existing evidence and never changes Stripe.",
  ].join("\n");
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function optionValue(argv: readonly string[], index: number, name: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new BillingRepairCliError(`${name} requires a value.`);
  }
  return value;
}

export function parseBillingRepairSubscriptionPricingArgs(
  argv: readonly string[],
): BillingRepairSubscriptionPricingOptions {
  let subscriptionId: string | undefined;
  let explicitPricingVersionId: string | null = null;
  let write = false;
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--subscription") {
      subscriptionId = optionValue(argv, index, argument);
      index += 1;
    } else if (argument === "--pricing-version") {
      explicitPricingVersionId = optionValue(argv, index, argument);
      index += 1;
    } else if (argument === "--write") {
      write = true;
    } else if (argument === "--dry-run") {
      dryRun = true;
    } else if (argument === "--help" || argument === "-h") {
      throw new BillingRepairCliError(usage());
    } else {
      throw new BillingRepairCliError(`Unsupported argument: ${argument}.\n${usage()}`);
    }
  }

  if (!subscriptionId || !isUuid(subscriptionId)) {
    throw new BillingRepairCliError("--subscription must be a Waflo subscription UUID.");
  }
  if (explicitPricingVersionId && !isUuid(explicitPricingVersionId)) {
    throw new BillingRepairCliError("--pricing-version must be a PricingVersion UUID.");
  }
  if (write && dryRun) {
    throw new BillingRepairCliError("Use either --dry-run or --write, not both.");
  }
  return { subscriptionId, explicitPricingVersionId, write };
}

export function cadenceForStripePrice(price: Stripe.Price): Cadence | null {
  const recurring = price.recurring;
  if (!recurring) return null;
  if (recurring.interval === "month" && recurring.interval_count === 1) return "MONTHLY";
  if (recurring.interval === "month" && recurring.interval_count === 3) return "QUARTERLY";
  if (recurring.interval === "year" && recurring.interval_count === 1) return "YEARLY";
  return null;
}

function productId(value: string | Stripe.Product | Stripe.DeletedProduct | null): string | null {
  return typeof value === "string" ? value : (value?.id ?? null);
}

function ensureExistingSnapshotIsCompatible(
  subscription: SubscriptionSnapshot,
  candidate: CandidatePricingVersion,
  stripePriceId: string,
) {
  const conflict =
    (subscription.pricingVersionId && subscription.pricingVersionId !== candidate.id) ||
    (subscription.pricingMarketCode && subscription.pricingMarketCode !== candidate.market.code) ||
    (subscription.pricingCurrency && subscription.pricingCurrency !== candidate.currency) ||
    (subscription.pricingAmountMinor &&
      subscription.pricingAmountMinor !== candidate.amountMinor) ||
    (subscription.cadence && subscription.cadence !== candidate.cadence) ||
    (subscription.stripePriceId && subscription.stripePriceId !== stripePriceId);
  if (conflict) {
    throw new BillingRepairCliError(
      "Existing subscription pricing evidence conflicts with the candidate; automatic repair is refused.",
    );
  }
}

export async function repairSubscriptionPricingFromCli(
  options: BillingRepairSubscriptionPricingOptions,
  dependencies: BillingRepairSubscriptionPricingDependencies = {},
) {
  const key = dependencies.stripeSecretKey ?? process.env.STRIPE_SECRET_KEY;
  if (!dependencies.stripe && !key?.startsWith("sk_test_")) {
    throw new BillingRepairCliError(
      "A Stripe TEST secret key is required for subscription-pricing repair.",
    );
  }
  const stripe = dependencies.stripe ?? new Stripe(key ?? "");
  const prisma = (dependencies.getClient ?? createPrismaClient)();
  try {
    const subscription = (await prisma.subscription.findUniqueOrThrow({
      where: { id: options.subscriptionId },
      include: {
        pricingVersion: { select: { id: true } },
        organization: { select: { name: true } },
      },
    })) as SubscriptionSnapshot;
    const providerSubscription = await stripe.subscriptions.retrieve(
      subscription.stripeSubscriptionId,
      {
        expand: ["items.data.price.product"],
      },
    );
    if (providerSubscription.items.data.length !== 1) {
      throw new BillingRepairCliError(
        "Repair requires exactly one recurring Stripe subscription item.",
      );
    }
    const item = providerSubscription.items.data[0];
    if (!item?.price || item.price.unit_amount === null) {
      throw new BillingRepairCliError("Stripe subscription item has no fixed unit amount.");
    }
    const cadence = cadenceForStripePrice(item.price);
    if (!cadence) {
      throw new BillingRepairCliError("Stripe Price cadence is not a supported Waflo cadence.");
    }
    const currency = item.price.currency.toUpperCase();
    const amountMinor = BigInt(item.price.unit_amount);
    const providerProductId = productId(item.price.product);
    const candidates = (options.explicitPricingVersionId
      ? await prisma.pricingVersion.findMany({
          where: { id: options.explicitPricingVersionId },
          include: { market: { select: { code: true } } },
        })
      : await prisma.pricingVersion.findMany({
          where: {
            OR: [
              { stripePriceId: item.price.id },
              {
                stripePriceId: null,
                planCode: subscription.planCode,
                cadence,
                currency,
                amountMinor,
                ...(providerProductId ? { stripeProductId: providerProductId } : {}),
              },
            ],
          },
          include: { market: { select: { code: true } } },
        })) as unknown as CandidatePricingVersion[];
    const compatible = candidates.filter(
      (candidate) =>
        candidate.planCode === subscription.planCode &&
        candidate.cadence === cadence &&
        candidate.currency === currency &&
        candidate.amountMinor === amountMinor &&
        (!candidate.stripePriceId
          ? !providerProductId || candidate.stripeProductId === providerProductId
          : candidate.stripePriceId === item.price.id),
    );
    if (compatible.length !== 1) {
      throw new BillingRepairCliError(
        `No unique deterministic PricingVersion mapping was found (candidates: ${compatible.length}). ` +
          "Use --pricing-version only after an operator has established the authoritative historical terms.",
      );
    }
    const candidate = compatible[0];
    ensureExistingSnapshotIsCompatible(subscription, candidate, item.price.id);

    const operations = {
      bindPrice:
        candidate.stripePriceId === null
          ? { pricingVersionId: candidate.id, stripePriceId: item.price.id }
          : null,
      snapshotSubscription: {
        subscriptionId: subscription.id,
        pricingVersionId: candidate.id,
        marketCode: candidate.market.code,
        currency,
        amountMinor: amountMinor.toString(),
        cadence,
      },
    };
    const report = {
      dryRun: !options.write,
      subscription: {
        wafloSubscriptionId: subscription.id,
        stripeSubscriptionId: subscription.stripeSubscriptionId,
        merchant: subscription.organization.name,
        stripePriceId: item.price.id,
        market: candidate.market.code,
        currency,
        cadence,
        unitAmountMinor: amountMinor.toString(),
      },
      candidatePricingVersion: {
        id: candidate.id,
        reason:
          candidate.stripePriceId === item.price.id
            ? "existing authoritative Stripe Price binding"
            : options.explicitPricingVersionId
              ? "operator-supplied PricingVersion with matching immutable terms"
              : "the sole unbound PricingVersion with matching plan, cadence, currency, amount, and product",
      },
      intendedOperations: operations,
    };

    if (!options.write) return report;
    await prisma.$transaction(async (transaction) => {
      if (candidate.stripePriceId === null) {
        const bound = await transaction.pricingVersion.updateMany({
          where: { id: candidate.id, stripePriceId: null },
          data: {
            stripePriceId: item.price.id,
            ...(candidate.stripeProductId || !providerProductId
              ? {}
              : { stripeProductId: providerProductId }),
          },
        });
        if (bound.count !== 1) {
          throw new BillingRepairCliError("PricingVersion binding changed while repair ran.");
        }
      }
      await transaction.subscription.update({
        where: { id: subscription.id },
        data: {
          stripePriceId: item.price.id,
          pricingVersionId: candidate.id,
          pricingMarketCode: candidate.market.code,
          pricingCurrency: currency,
          pricingAmountMinor: amountMinor,
          cadence,
        },
      });
      await transaction.auditLog.create({
        data: {
          organization: { connect: { id: subscription.organizationId } },
          action: "billing.subscription_pricing_repaired",
          targetType: "subscription",
          targetId: subscription.id,
          requestId: `billing-repair:${randomUUID()}`,
          metadata: {
            pricingVersionId: candidate.id,
            stripePriceId: item.price.id,
            market: candidate.market.code,
            currency,
            cadence,
            amountMinor: amountMinor.toString(),
            deterministic: !options.explicitPricingVersionId,
          },
        },
      });
    });
    return report;
  } finally {
    await prisma.$disconnect();
  }
}

export async function runBillingRepairSubscriptionPricingCli(
  argv = process.argv.slice(2),
): Promise<void> {
  const report = await repairSubscriptionPricingFromCli(
    parseBillingRepairSubscriptionPricingArgs(argv),
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.dryRun) {
    process.stdout.write(
      "Repair committed. Run normal reconciliation before relying on the health view.\n",
    );
  }
}

export function billingRepairSubscriptionPricingUsage(): string {
  return usage();
}
