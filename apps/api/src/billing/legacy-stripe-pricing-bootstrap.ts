/**
 * Controlled legacy commercial-term bootstrap. This boundary intentionally has
 * no subscription-update, invoice, or payment operations: it can only read a
 * legacy Stripe Price and write Waflo's historical snapshot/binding evidence.
 */
export type LegacyPricingCadence = "MONTHLY" | "QUARTERLY" | "YEARLY";

export interface LegacyStripePriceTerms {
  readonly id: string;
  readonly currency: string;
  readonly amountMinor: number | null;
  readonly cadence: LegacyPricingCadence | null;
  readonly active: boolean;
  readonly productId: string | null;
  readonly createdAt: Date;
}

export interface LegacyUnmappedSubscription {
  readonly id: string;
  readonly stripePriceId: string;
  readonly planCode: "STARTER" | "GROWTH" | "SCALE";
}

export interface LegacyPricingVersion {
  readonly id: string;
  readonly planCode: "STARTER" | "GROWTH" | "SCALE";
  readonly cadence: LegacyPricingCadence;
  readonly currency: string;
  readonly amountMinor: bigint;
}

export interface LegacyPricingBootstrapRepository {
  globalMarketId(): Promise<string>;
  unmappedSubscriptions(): Promise<readonly LegacyUnmappedSubscription[]>;
  pricingVersionByStripePriceId(stripePriceId: string): Promise<LegacyPricingVersion | null>;
  pricingVersionCount(input: {
    marketId: string;
    planCode: LegacyUnmappedSubscription["planCode"];
    cadence: LegacyPricingCadence;
  }): Promise<number>;
  createHistoricalVersion(input: {
    marketId: string;
    planCode: LegacyUnmappedSubscription["planCode"];
    cadence: LegacyPricingCadence;
    version: number;
    currency: string;
    amountMinor: bigint;
    stripeProductId: string | null;
    stripePriceId: string;
    stripeBindingKey: string;
    publishedAt: Date;
    retiredAt: Date;
  }): Promise<LegacyPricingVersion>;
  snapshotSubscription(input: {
    subscriptionId: string;
    pricingVersionId: string;
    cadence: LegacyPricingCadence;
    currency: string;
    amountMinor: bigint;
  }): Promise<void>;
}

export interface LegacyPricingBootstrapProvider {
  retrievePrice(stripePriceId: string): Promise<LegacyStripePriceTerms>;
}

export type LegacyPricingBootstrapResult =
  | {
      subscriptionId: string;
      result: "UNKNOWN_STRIPE_PRICE" | "AMBIGUOUS_STRIPE_TERMS" | "BINDING_CONFLICT";
      priceId: string;
    }
  | {
      subscriptionId: string;
      result: "WILL_SNAPSHOT_EXISTING" | "WILL_CREATE_HISTORICAL_VERSION";
      priceId: string;
      currency: string;
      amountMinor: number;
      cadence: LegacyPricingCadence;
    };

export async function bootstrapLegacyStripePricing(
  repository: LegacyPricingBootstrapRepository,
  provider: LegacyPricingBootstrapProvider,
  options: { write: boolean; now?: Date },
): Promise<{
  dryRun: boolean;
  total: number;
  report: LegacyPricingBootstrapResult[];
}> {
  const [globalMarketId, subscriptions] = await Promise.all([
    repository.globalMarketId(),
    repository.unmappedSubscriptions(),
  ]);
  const report: LegacyPricingBootstrapResult[] = [];
  const now = options.now ?? new Date();

  for (const subscription of subscriptions) {
    let price: LegacyStripePriceTerms;
    try {
      price = await provider.retrievePrice(subscription.stripePriceId);
    } catch {
      report.push({
        subscriptionId: subscription.id,
        result: "UNKNOWN_STRIPE_PRICE",
        priceId: subscription.stripePriceId,
      });
      continue;
    }
    if (!price.cadence || price.amountMinor === null || !price.active) {
      report.push({
        subscriptionId: subscription.id,
        result: "AMBIGUOUS_STRIPE_TERMS",
        priceId: price.id,
      });
      continue;
    }
    const currency = price.currency.toUpperCase();
    const existing = await repository.pricingVersionByStripePriceId(price.id);
    if (
      existing &&
      (existing.currency !== currency ||
        existing.amountMinor !== BigInt(price.amountMinor) ||
        existing.cadence !== price.cadence ||
        existing.planCode !== subscription.planCode)
    ) {
      report.push({
        subscriptionId: subscription.id,
        result: "BINDING_CONFLICT",
        priceId: price.id,
      });
      continue;
    }
    report.push({
      subscriptionId: subscription.id,
      result: existing ? "WILL_SNAPSHOT_EXISTING" : "WILL_CREATE_HISTORICAL_VERSION",
      priceId: price.id,
      currency,
      amountMinor: price.amountMinor,
      cadence: price.cadence,
    });
    if (!options.write) continue;
    const version =
      existing ??
      (await repository.createHistoricalVersion({
        marketId: globalMarketId,
        planCode: subscription.planCode,
        cadence: price.cadence,
        version: -(
          (await repository.pricingVersionCount({
            marketId: globalMarketId,
            planCode: subscription.planCode,
            cadence: price.cadence,
          })) + 1
        ),
        currency,
        amountMinor: BigInt(price.amountMinor),
        stripeProductId: price.productId,
        stripePriceId: price.id,
        stripeBindingKey: `GLOBAL:${subscription.planCode}:${price.cadence}:legacy:${price.id}`,
        publishedAt: price.createdAt,
        retiredAt: now,
      }));
    await repository.snapshotSubscription({
      subscriptionId: subscription.id,
      pricingVersionId: version.id,
      cadence: price.cadence,
      currency,
      amountMinor: BigInt(price.amountMinor),
    });
  }
  return { dryRun: !options.write, total: subscriptions.length, report };
}
