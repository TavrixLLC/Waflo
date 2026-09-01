import { HttpStatus, Injectable, Optional } from "@nestjs/common";
import {
  currencyMinorUnitExponent,
  normalizePricingCurrency,
  type PublishedPricingMarket,
  resolvePublishedPricingMarket,
} from "@waflo/billing";
import { billingCadences, type PlanCode, planCodes } from "@waflo/contracts";
import { Prisma } from "@waflo/database";
import Stripe from "stripe";
import { AppError } from "../common/app-error.js";
import { withInvariantLock } from "../common/organization-transaction.js";
import { EnvironmentService } from "../config/environment.service.js";
import { PrismaService } from "../database/prisma.service.js";

export type PricingCadence = "MONTHLY" | "QUARTERLY" | "YEARLY";

/** A catalog term resolved exclusively from Waflo's database. */
export interface ResolvedPrice {
  readonly pricingVersionId: string;
  readonly marketCode: string;
  readonly plan: PlanCode;
  readonly cadence: PricingCadence;
  readonly currency: string;
  readonly amountMinor: bigint;
  readonly stripePriceId: string;
}

export interface StripeCatalogPrice {
  readonly id: string;
  readonly productId: string;
  readonly active: boolean;
  readonly currency: string;
  readonly unitAmount: number | null;
  readonly interval: "month" | "year" | null;
  readonly intervalCount: number | null;
}

/**
 * Narrow provider boundary for immutable Stripe catalog artifacts. It keeps
 * catalog orchestration deterministic in tests and deliberately excludes any
 * subscription or invoice mutation.
 */
export interface PricingStripeCatalogProvider {
  validateCurrency(currency: string): Promise<boolean>;
  ensureProduct(input: {
    plan: string;
    requestedProductId: string | null;
    environment: string;
  }): Promise<{ id: string }>;
  retrievePrice(priceId: string): Promise<StripeCatalogPrice>;
  createPrice(input: {
    productId: string;
    currency: string;
    amountMinor: number;
    interval: "month" | "year";
    intervalCount: number;
    metadata: Record<string, string>;
    idempotencyKey: string;
  }): Promise<StripeCatalogPrice>;
}

export function currencyMinorDigits(currency: string): number {
  try {
    return currencyMinorUnitExponent(currency);
  } catch {
    throw new AppError(
      "PRICING_CURRENCY_INVALID",
      "The selected currency is not recognized.",
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

export function isSupportedPricingPlan(value: string): value is PlanCode {
  return (planCodes as readonly string[]).includes(value.toLowerCase());
}

export function isSupportedPricingCadence(value: string): value is PricingCadence {
  return (billingCadences as readonly string[]).includes(value.toLowerCase());
}

@Injectable()
export class PricingCatalogService {
  private readonly stripe: Stripe | null;
  private readonly injectedCatalogProvider: PricingStripeCatalogProvider | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly environment: EnvironmentService,
    @Optional()
    catalogProvider?: PricingStripeCatalogProvider,
  ) {
    this.stripe = environment.values.STRIPE_SECRET_KEY
      ? new Stripe(environment.values.STRIPE_SECRET_KEY, {
          appInfo: { name: "Waflo", version: "1.0.0" },
        })
      : null;
    this.injectedCatalogProvider = catalogProvider ?? null;
  }

  /** GLOBAL is always the deterministic fallback. Country comes only from the billing profile. */
  async resolveForOrganization(
    organizationId: string,
    plan: PlanCode,
    cadence: PricingCadence = "MONTHLY",
  ): Promise<ResolvedPrice> {
    const profile = await this.prisma.client.organizationBillingProfile.findUniqueOrThrow({
      where: { organizationId },
    });
    return this.resolveForCountry(profile.billingCountryCode, plan, cadence);
  }

  /** Resolve an explicit billing country without changing its commercial state. */
  async resolveForCountry(
    billingCountryCode: string | null | undefined,
    plan: PlanCode,
    cadence: PricingCadence = "MONTHLY",
  ): Promise<ResolvedPrice> {
    const country = billingCountryCode?.toUpperCase() ?? null;
    const market = country
      ? await this.prisma.client.pricingMarket.findFirst({
          where: { kind: "COUNTRY_OVERRIDE", countryCode: country, active: true },
        })
      : null;
    const globalMarket = await this.prisma.client.pricingMarket.findUniqueOrThrow({
      where: { code: "GLOBAL" },
    });
    let selectedMarket = market ?? globalMarket;
    let version = await this.prisma.client.pricingVersion.findFirst({
      where: {
        marketId: selectedMarket.id,
        planCode: plan.toUpperCase() as "STARTER" | "GROWTH" | "SCALE",
        cadence,
        status: "ACTIVE_FOR_NEW_SUBSCRIPTIONS",
      },
      orderBy: [{ version: "desc" }, { createdAt: "desc" }],
    });
    // A partial or unbound regional publication cannot produce a hybrid
    // commercial contract. It falls back as a whole to published GLOBAL.
    if (!version?.stripePriceId && market) {
      selectedMarket = globalMarket;
      version = await this.prisma.client.pricingVersion.findFirst({
        where: {
          marketId: globalMarket.id,
          planCode: plan.toUpperCase() as "STARTER" | "GROWTH" | "SCALE",
          cadence,
          status: "ACTIVE_FOR_NEW_SUBSCRIPTIONS",
        },
        orderBy: [{ version: "desc" }, { createdAt: "desc" }],
      });
    }
    // A country override never silently mixes its currency with GLOBAL: it either
    // publishes the requested term or explicitly points to GLOBAL by being absent.
    if (!version?.stripePriceId) {
      throw new AppError(
        "PRICING_NOT_PUBLISHED",
        "A published price is not available for this plan.",
        HttpStatus.SERVICE_UNAVAILABLE,
        { market: selectedMarket.code, plan, cadence },
      );
    }
    return {
      pricingVersionId: version.id,
      marketCode: selectedMarket.code,
      plan,
      cadence,
      currency: version.currency,
      amountMinor: version.amountMinor,
      stripePriceId: version.stripePriceId,
    };
  }

  async resolveForMarket(
    marketCode: string,
    plan: PlanCode,
    cadence: PricingCadence,
  ): Promise<ResolvedPrice> {
    const market = await this.prisma.client.pricingMarket.findFirst({
      where: { code: marketCode, active: true },
    });
    if (!market)
      throw new AppError(
        "PRICING_MARKET_UNAVAILABLE",
        "The subscription pricing market is unavailable.",
        HttpStatus.CONFLICT,
      );
    const version = await this.prisma.client.pricingVersion.findFirst({
      where: {
        marketId: market.id,
        planCode: plan.toUpperCase() as "STARTER" | "GROWTH" | "SCALE",
        cadence,
        status: "ACTIVE_FOR_NEW_SUBSCRIPTIONS",
      },
      orderBy: { version: "desc" },
    });
    if (!version?.stripePriceId)
      throw new AppError(
        "PRICING_NOT_PUBLISHED",
        "A published bound target price is unavailable.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    return {
      pricingVersionId: version.id,
      marketCode: market.code,
      plan,
      cadence,
      currency: version.currency,
      amountMinor: version.amountMinor,
      stripePriceId: version.stripePriceId,
    };
  }

  async resolveStripePrice(priceId: string): Promise<ResolvedPrice> {
    const version = await this.prisma.client.pricingVersion.findUnique({
      where: { stripePriceId: priceId },
      include: { market: true },
    });
    if (!version?.stripePriceId)
      throw new AppError(
        "STRIPE_PRICE_UNKNOWN",
        "The Stripe Price is not bound to Waflo pricing.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    return {
      pricingVersionId: version.id,
      marketCode: version.market.code,
      plan: version.planCode.toLowerCase() as PlanCode,
      cadence: version.cadence,
      currency: version.currency,
      amountMinor: version.amountMinor,
      stripePriceId: version.stripePriceId,
    };
  }

  /** Catalog-backed cadence availability for merchant billing controls. */
  async cadenceAvailabilityForOrganization(organizationId: string) {
    const profile = await this.prisma.client.organizationBillingProfile.findUniqueOrThrow({
      where: { organizationId },
    });
    const country = profile.billingCountryCode?.toUpperCase() ?? null;
    const override = country
      ? await this.prisma.client.pricingMarket.findFirst({
          where: { kind: "COUNTRY_OVERRIDE", countryCode: country, active: true },
        })
      : null;
    const market =
      override ??
      (await this.prisma.client.pricingMarket.findUniqueOrThrow({ where: { code: "GLOBAL" } }));
    const versions = await this.prisma.client.pricingVersion.findMany({
      where: {
        marketId: market.id,
        status: "ACTIVE_FOR_NEW_SUBSCRIPTIONS",
        stripePriceId: { not: null },
      },
      select: { cadence: true, planCode: true },
    });
    const complete = (cadence: PricingCadence) =>
      (["STARTER", "GROWTH", "SCALE"] as const).every((planCode) =>
        versions.some((version) => version.cadence === cadence && version.planCode === planCode),
      );
    return {
      monthly: complete("MONTHLY"),
      quarterly: complete("QUARTERLY"),
      yearly: complete("YEARLY"),
    };
  }

  /**
   * Read-only catalog terms for merchant presentation. Values originate from
   * the published Waflo catalog, not configuration or a Stripe list call.
   */
  async catalogTermsForOrganization(organizationId: string) {
    const profile = await this.prisma.client.organizationBillingProfile.findUniqueOrThrow({
      where: { organizationId },
      select: { billingCountryCode: true },
    });
    const country = profile.billingCountryCode?.toUpperCase() ?? null;
    const override = country
      ? await this.prisma.client.pricingMarket.findFirst({
          where: { kind: "COUNTRY_OVERRIDE", countryCode: country, active: true },
          select: { id: true, code: true },
        })
      : null;
    const market =
      override ??
      (await this.prisma.client.pricingMarket.findUniqueOrThrow({
        where: { code: "GLOBAL" },
        select: { id: true, code: true },
      }));
    const terms = await this.prisma.client.pricingVersion.findMany({
      where: {
        marketId: market.id,
        status: "ACTIVE_FOR_NEW_SUBSCRIPTIONS",
        stripePriceId: { not: null },
      },
      select: { planCode: true, cadence: true, amountMinor: true, currency: true, version: true },
      orderBy: [{ planCode: "asc" }, { cadence: "asc" }, { version: "desc" }],
    });
    const current = new Map<string, (typeof terms)[number]>();
    for (const term of terms) {
      const key = `${term.planCode}:${term.cadence}`;
      if (!current.has(key)) current.set(key, term);
    }
    return {
      marketCode: market.code,
      terms: [...current.values()].map((term) => ({
        plan: term.planCode.toLocaleLowerCase("en-US") as PlanCode,
        cadence: term.cadence.toLocaleLowerCase("en-US") as (typeof billingCadences)[number],
        amountMinor: term.amountMinor.toString(),
        currency: term.currency,
      })),
    };
  }

  /**
   * Public, read-only Waflo catalog projection. A current Stripe binding is not
   * required for presentation: publication is the Waflo commercial authority.
   */
  async publicCatalogTermsForCountry(countryCode: string | null) {
    const markets = await this.prisma.client.pricingMarket.findMany({
      where: {
        OR: [
          { code: "GLOBAL" },
          ...(countryCode
            ? [{ kind: "COUNTRY_OVERRIDE" as const, countryCode: countryCode.toUpperCase() }]
            : []),
        ],
      },
      include: {
        versions: {
          where: { status: "ACTIVE_FOR_NEW_SUBSCRIPTIONS" },
          select: {
            planCode: true,
            cadence: true,
            amountMinor: true,
            currency: true,
            version: true,
          },
          orderBy: [{ version: "desc" }, { createdAt: "desc" }],
        },
      },
    });
    const mapMarket = (market: (typeof markets)[number]): PublishedPricingMarket => {
      const terms = new Map<string, (typeof market.versions)[number]>();
      for (const version of market.versions) {
        const key = `${version.planCode}:${version.cadence}`;
        if (!terms.has(key)) terms.set(key, version);
      }
      return {
        code: market.code,
        countryCode: market.countryCode,
        currency: market.configuredCurrency,
        active: market.active,
        terms: [...terms.values()].map((term) => ({
          plan: term.planCode.toLowerCase() as PlanCode,
          cadence: term.cadence.toLowerCase() as (typeof billingCadences)[number],
          amountMinor: term.amountMinor.toString(),
          currency: term.currency,
        })),
      };
    };
    const global = markets.find((market) => market.code === "GLOBAL");
    if (!global) {
      throw new AppError(
        "PRICING_GLOBAL_UNAVAILABLE",
        "GLOBAL pricing is unavailable.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const resolved = resolvePublishedPricingMarket({
      country: countryCode,
      global: mapMarket(global),
      regionalMarkets: markets
        .filter((market) => market.kind === "COUNTRY_OVERRIDE")
        .map(mapMarket),
    });
    return {
      market: {
        code: resolved.market.code,
        country: resolved.market.countryCode,
        currency: resolved.market.currency,
      },
      terms: resolved.market.terms,
      fallbackReason: resolved.fallbackReason,
    };
  }

  async inspect() {
    const markets = await this.prisma.client.pricingMarket.findMany({
      include: {
        versions: { orderBy: [{ planCode: "asc" }, { cadence: "asc" }, { version: "desc" }] },
      },
      orderBy: { code: "asc" },
    });
    return Promise.all(
      markets.map(async (market) => ({
        ...market,
        subscriberCount: await this.prisma.client.subscription.count({
          where: { pricingMarketCode: market.code },
        }),
        grandfatheredSubscriberCount: await this.prisma.client.subscription.count({
          where: { pricingMarketCode: market.code, grandfathered: true },
        }),
      })),
    );
  }

  async createMarket(input: { countryCode: string; currency: string }) {
    const countryCode = input.countryCode.toUpperCase();
    const currency = input.currency.toUpperCase();
    if (!this.isIsoCountry(countryCode)) {
      throw new AppError(
        "PRICING_COUNTRY_INVALID",
        "Select a valid ISO country code for a regional market.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    await this.assertSupportedCurrency(currency);
    return withInvariantLock(
      this.prisma.client,
      `pricing-market:country:${countryCode}`,
      async (tx) => {
        const existing = await tx.pricingMarket.findFirst({
          where: { OR: [{ code: countryCode }, { countryCode }] },
          select: { id: true },
        });
        if (existing) {
          throw new AppError(
            "PRICING_MARKET_EXISTS",
            "A pricing market already exists for this country.",
            HttpStatus.CONFLICT,
          );
        }
        return tx.pricingMarket.create({
          data: {
            code: countryCode,
            kind: "COUNTRY_OVERRIDE",
            countryCode,
            configuredCurrency: currency,
            fallbackMarketCode: "GLOBAL",
          },
        });
      },
    );
  }

  async updateMarket(
    marketId: string,
    input: { active?: boolean | undefined; currency?: string | undefined },
  ) {
    const market = await this.prisma.client.pricingMarket.findUniqueOrThrow({
      where: { id: marketId },
    });
    const currency = input.currency?.toUpperCase();
    if (market.kind === "GLOBAL" && input.active === false) {
      throw new AppError(
        "PRICING_GLOBAL_REQUIRED",
        "GLOBAL pricing cannot be deactivated.",
        HttpStatus.CONFLICT,
      );
    }
    if (market.kind === "GLOBAL" && currency && currency !== "USD") {
      throw new AppError(
        "PRICING_GLOBAL_CURRENCY_REQUIRED",
        "GLOBAL pricing is denominated in USD.",
        HttpStatus.CONFLICT,
      );
    }
    if (currency) await this.assertSupportedCurrency(currency);
    return withInvariantLock(this.prisma.client, `pricing-market:${market.id}`, async (tx) => {
      const establishedVersions = currency
        ? await tx.pricingVersion.count({ where: { marketId: market.id } })
        : 0;
      if (
        currency &&
        market.configuredCurrency !== null &&
        currency !== market.configuredCurrency &&
        establishedVersions > 0
      ) {
        throw new AppError(
          "PRICING_MARKET_CURRENCY_IMMUTABLE",
          "A market currency cannot change after a pricing version exists. Create an explicit market migration instead.",
          HttpStatus.CONFLICT,
        );
      }
      return tx.pricingMarket.update({
        where: { id: market.id },
        data: {
          ...(input.active === undefined ? {} : { active: input.active }),
          ...(currency ? { configuredCurrency: currency } : {}),
        },
      });
    });
  }

  async createDraft(input: {
    marketCode: string;
    plan: PlanCode;
    cadence: PricingCadence;
    currency: string;
    amountMinor: bigint;
  }) {
    const currency = input.currency.toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency) || input.amountMinor <= 0n)
      throw new AppError(
        "PRICING_DRAFT_INVALID",
        "Currency and a positive minor amount are required.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    await this.assertSupportedCurrency(currency);
    const market = await this.prisma.client.pricingMarket.findUniqueOrThrow({
      where: { code: input.marketCode.toUpperCase() },
    });
    if (!market.active) {
      throw new AppError(
        "PRICING_MARKET_UNAVAILABLE",
        "A draft cannot be created for an inactive market.",
        HttpStatus.CONFLICT,
      );
    }
    if (
      (market.kind === "GLOBAL" && currency !== "USD") ||
      (market.configuredCurrency && market.configuredCurrency !== currency)
    ) {
      throw new AppError(
        "PRICING_MARKET_CURRENCY_CONFLICT",
        "The price currency must match the configured market currency.",
        HttpStatus.CONFLICT,
      );
    }
    return withInvariantLock(
      this.prisma.client,
      `pricing-version:${market.id}:${input.plan.toUpperCase()}:${input.cadence}`,
      async (tx) => {
        if (market.configuredCurrency === null) {
          // Legacy regional markets were intentionally not backfilled by
          // inference. The first explicit operator draft establishes the
          // market policy prospectively without changing historical versions.
          await tx.pricingMarket.update({
            where: { id: market.id },
            data: { configuredCurrency: currency },
          });
        }
        const latest = await tx.pricingVersion.findFirst({
          where: {
            marketId: market.id,
            planCode: input.plan.toUpperCase() as "STARTER" | "GROWTH" | "SCALE",
            cadence: input.cadence,
          },
          orderBy: { version: "desc" },
        });
        const version = (latest?.version ?? 0) + 1;
        return tx.pricingVersion.create({
          data: {
            marketId: market.id,
            planCode: input.plan.toUpperCase() as "STARTER" | "GROWTH" | "SCALE",
            cadence: input.cadence,
            version,
            currency,
            amountMinor: input.amountMinor,
            stripeBindingKey: `${market.code}:${input.plan}:${input.cadence}:${version}`,
          },
        });
      },
    );
  }

  async validateDraft(versionId: string) {
    const version = await this.prisma.client.pricingVersion.findUniqueOrThrow({
      where: { id: versionId },
      include: { market: true },
    });
    if (version.status !== "DRAFT")
      throw new AppError(
        "PRICING_VERSION_IMMUTABLE",
        "Only a draft can be validated.",
        HttpStatus.CONFLICT,
      );
    if (
      !version.market.active ||
      version.amountMinor <= 0n ||
      !/^[A-Z]{3}$/.test(version.currency) ||
      (version.market.kind === "GLOBAL" && version.currency !== "USD") ||
      (version.market.configuredCurrency !== null &&
        version.market.configuredCurrency !== version.currency)
    )
      throw new AppError(
        "PRICING_DRAFT_INVALID",
        "Invalid immutable terms.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    await this.assertSupportedCurrency(version.currency);
    return this.prisma.client.pricingVersion.update({
      where: { id: versionId },
      data: { status: "VALIDATED" },
    });
  }

  async retire(versionId: string) {
    const version = await this.prisma.client.pricingVersion.findUniqueOrThrow({
      where: { id: versionId },
      include: { market: true },
    });
    if (version.status === "DRAFT" || version.status === "VALIDATED")
      throw new AppError(
        "PRICING_VERSION_NOT_PUBLISHED",
        "Only published versions can be retired.",
        HttpStatus.CONFLICT,
      );
    return withInvariantLock(
      this.prisma.client,
      `pricing-version:${version.marketId}:${version.planCode}:${version.cadence}`,
      async (tx) => {
        if (version.market.kind === "GLOBAL") {
          const replacement = await tx.pricingVersion.findFirst({
            where: {
              marketId: version.marketId,
              planCode: version.planCode,
              cadence: version.cadence,
              id: { not: version.id },
              status: "ACTIVE_FOR_NEW_SUBSCRIPTIONS",
              stripePriceId: { not: null },
            },
            select: { id: true },
          });
          if (!replacement) {
            throw new AppError(
              "PRICING_GLOBAL_FALLBACK_REQUIRED",
              "Retiring this GLOBAL price would leave the fallback unavailable for new subscriptions.",
              HttpStatus.CONFLICT,
            );
          }
        }
        return tx.pricingVersion.update({
          where: { id: versionId },
          data: { status: "RETIRED_FOR_NEW_SUBSCRIPTIONS", retiredAt: new Date() },
        });
      },
    );
  }

  async annualPreview(marketCode: string) {
    const market = await this.prisma.client.pricingMarket.findUniqueOrThrow({
      where: { code: marketCode.toUpperCase() },
    });
    const subscriptions = await this.prisma.client.subscription.findMany({
      where: {
        pricingMarketCode: market.code,
        grandfathered: true,
        status: { in: ["ACTIVE", "TRIALING"] },
      },
    });
    return Promise.all(
      subscriptions.map(async (subscription) => ({
        subscriptionId: subscription.id,
        plan: subscription.planCode,
        cadence: subscription.cadence,
        current: {
          versionId: subscription.pricingVersionId,
          currency: subscription.pricingCurrency,
          amountMinor: subscription.pricingAmountMinor?.toString() ?? null,
        },
        target: await this.prisma.client.pricingVersion.findFirst({
          where: {
            marketId: market.id,
            planCode: subscription.planCode,
            cadence: subscription.cadence,
            status: "ACTIVE_FOR_NEW_SUBSCRIPTIONS",
          },
          orderBy: { version: "desc" },
        }),
        effectiveAt: subscription.currentPeriodEnd,
      })),
    );
  }

  async cancelAnnualRepricing(id: string) {
    return this.prisma.client.subscriptionRepricing.updateMany({
      where: { id, status: "SCHEDULED" },
      data: { status: "CANCELED", noticeStatus: "CANCELED" },
    });
  }

  async replaceAnnualRepricing(id: string, targetPricingVersionId: string) {
    const target = await this.prisma.client.pricingVersion.findUniqueOrThrow({
      where: { id: targetPricingVersionId },
    });
    if (target.status !== "ACTIVE_FOR_NEW_SUBSCRIPTIONS" || !target.stripePriceId)
      throw new AppError(
        "PRICING_NOT_PUBLISHED",
        "Replacement target must be published and bound.",
        HttpStatus.CONFLICT,
      );
    return this.prisma.client.$transaction(async (tx) => {
      const original = await tx.subscriptionRepricing.findFirstOrThrow({
        where: { id, status: "SCHEDULED" },
        include: { subscription: true },
      });
      if (
        target.planCode !== original.subscription.planCode ||
        target.cadence !== original.subscription.cadence
      )
        throw new AppError(
          "REPRICING_TARGET_MISMATCH",
          "Replacement target must match the subscription plan and cadence.",
          HttpStatus.CONFLICT,
        );
      // Release the partial unique slot before creating the successor. The old
      // command's target and notice evidence remain untouched forever.
      await tx.subscriptionRepricing.update({
        where: { id: original.id },
        data: { status: "SUPERSEDED", noticeStatus: "CANCELED" },
      });
      const replacement = await tx.subscriptionRepricing.create({
        data: {
          subscriptionId: original.subscriptionId,
          targetPricingVersionId,
          effectiveAt: original.effectiveAt,
          noticeStatus: "SCHEDULED",
          noticeSnapshot: {
            marketCode: original.subscription.pricingMarketCode,
            plan: original.subscription.planCode,
            cadence: original.subscription.cadence,
            sourcePricingVersionId: original.subscription.pricingVersionId,
            targetPricingVersionId,
            sourceCurrency: original.subscription.pricingCurrency,
            sourceAmountMinor: original.subscription.pricingAmountMinor?.toString() ?? null,
            targetCurrency: target.currency,
            targetAmountMinor: target.amountMinor.toString(),
            effectiveRenewalAt: original.effectiveAt.toISOString(),
            replacesCommandId: original.id,
          },
          replacesRepricingId: original.id,
          idempotencyKey: `${original.idempotencyKey}:replacement:${targetPricingVersionId}`,
        },
      });
      await tx.subscriptionRepricing.update({
        where: { id: original.id },
        data: { replacedByRepricingId: replacement.id },
      });
      return replacement;
    });
  }

  /** Safe publisher called by an internal operator workflow, never by a merchant. */
  async publish(versionId: string): Promise<ResolvedPrice> {
    const initial = await this.prisma.client.pricingVersion.findUniqueOrThrow({
      where: { id: versionId },
      include: { market: true },
    });
    return withInvariantLock(
      this.prisma.client,
      `pricing-version:${initial.marketId}:${initial.planCode}:${initial.cadence}`,
      async (tx) => {
        const version = await tx.pricingVersion.findUniqueOrThrow({
          where: { id: versionId },
          include: { market: true },
        });
        if (version.status !== "VALIDATED" && version.status !== "ACTIVE_FOR_NEW_SUBSCRIPTIONS") {
          throw new AppError(
            "PRICING_VERSION_NOT_VALIDATED",
            "Only validated pricing versions can be published.",
            HttpStatus.CONFLICT,
          );
        }
        if (!version.market.active) {
          throw new AppError(
            "PRICING_MARKET_UNAVAILABLE",
            "An inactive market cannot publish a new price.",
            HttpStatus.CONFLICT,
          );
        }
        const provider = this.catalogProvider();
        const interval = version.cadence === "YEARLY" ? "year" : "month";
        const intervalCount = version.cadence === "QUARTERLY" ? 3 : 1;
        let priceId = version.stripePriceId;
        let productId = version.stripeProductId;
        if (priceId) {
          this.assertBoundPrice(
            version,
            await provider.retrievePrice(priceId),
            interval,
            intervalCount,
          );
        } else {
          const previousProduct = await tx.pricingVersion.findFirst({
            where: { planCode: version.planCode, stripeProductId: { not: null } },
            select: { stripeProductId: true },
            orderBy: { publishedAt: "desc" },
          });
          const product = await provider.ensureProduct({
            plan: version.planCode,
            requestedProductId: productId ?? previousProduct?.stripeProductId ?? null,
            environment: this.environment.values.DEPLOYMENT_ENVIRONMENT,
          });
          const created = await provider.createPrice({
            productId: product.id,
            currency: version.currency,
            amountMinor: Number(version.amountMinor),
            interval,
            intervalCount,
            metadata: {
              waflo_environment: this.environment.values.DEPLOYMENT_ENVIRONMENT,
              waflo_plan: version.planCode,
              waflo_cadence: version.cadence,
              waflo_market: version.market.code,
              waflo_pricing_version: String(version.version),
              waflo_pricing_version_id: version.id,
              waflo_currency: version.currency,
            },
            // Version ordinals repeat in independent Waflo databases. Stripe
            // idempotency is account-wide, so scope the retry key to this
            // immutable PricingVersion rather than its market-local ordinal.
            idempotencyKey: `waflo:price:${version.id}`,
          });
          this.assertBoundPrice(version, created, interval, intervalCount);
          priceId = created.id;
          productId = created.productId;
          await tx.pricingVersion.update({
            where: { id: version.id },
            data: { stripeProductId: productId, stripePriceId: priceId },
          });
        }
        const now = new Date();
        await tx.pricingVersion.updateMany({
          where: {
            marketId: version.marketId,
            planCode: version.planCode,
            cadence: version.cadence,
            id: { not: version.id },
            status: "ACTIVE_FOR_NEW_SUBSCRIPTIONS",
          },
          data: { status: "RETIRED_FOR_NEW_SUBSCRIPTIONS", retiredAt: now },
        });
        await tx.pricingVersion.update({
          where: { id: version.id },
          data: {
            stripeProductId: productId,
            stripePriceId: priceId,
            status: "ACTIVE_FOR_NEW_SUBSCRIPTIONS",
            publishedAt: now,
          },
        });
        return {
          pricingVersionId: version.id,
          marketCode: version.market.code,
          plan: version.planCode.toLowerCase() as PlanCode,
          cadence: version.cadence,
          currency: version.currency,
          amountMinor: version.amountMinor,
          stripePriceId: priceId,
        };
      },
    );
  }

  /** Creates retry-safe, reviewable annual-transition commands; a worker executes them at renewal. */
  async scheduleAnnualRepricing(asOf = new Date()): Promise<number> {
    const markets = await this.prisma.client.pricingMarket.findMany({
      where: {
        active: true,
        annualEffectiveMonth: { not: null },
        annualEffectiveDay: { not: null },
      },
    });
    let scheduled = 0;
    for (const market of markets) {
      const month = market.annualEffectiveMonth;
      const day = market.annualEffectiveDay;
      if (month === null || day === null) continue;
      const effective = new Date(Date.UTC(asOf.getUTCFullYear(), month - 1, day));
      if (asOf < effective) continue;
      const subscriptions = await this.prisma.client.subscription.findMany({
        where: {
          grandfathered: true,
          pricingMarketCode: market.code,
          status: { in: ["ACTIVE", "TRIALING"] },
          currentPeriodEnd: { not: null },
        },
      });
      for (const subscription of subscriptions) {
        if (!subscription.currentPeriodEnd) continue;
        const target = await this.prisma.client.pricingVersion.findFirst({
          where: {
            marketId: market.id,
            planCode: subscription.planCode,
            cadence: subscription.cadence,
            status: "ACTIVE_FOR_NEW_SUBSCRIPTIONS",
          },
          orderBy: { version: "desc" },
        });
        if (!target || target.id === subscription.pricingVersionId || !target.stripePriceId)
          continue;
        const noticeAt = new Date(effective.getTime() - market.annualNoticeDays * 86_400_000);
        const key = `annual:${subscription.id}:${target.id}:${effective.toISOString().slice(0, 10)}`;
        try {
          await this.prisma.client.subscriptionRepricing.create({
            data: {
              subscriptionId: subscription.id,
              targetPricingVersionId: target.id,
              effectiveAt: subscription.currentPeriodEnd,
              noticeSentAt: asOf >= noticeAt ? asOf : null,
              noticeStatus: asOf >= noticeAt ? "CREATED" : "SCHEDULED",
              noticeSnapshot: {
                marketCode: market.code,
                oldPricingVersionId: subscription.pricingVersionId,
                targetPricingVersionId: target.id,
                oldCurrency: subscription.pricingCurrency,
                oldAmountMinor: subscription.pricingAmountMinor?.toString() ?? null,
                newCurrency: target.currency,
                newAmountMinor: target.amountMinor.toString(),
                noticeDays: market.annualNoticeDays,
                effectiveRenewalAt: subscription.currentPeriodEnd.toISOString(),
              },
              idempotencyKey: key,
            },
          });
          scheduled += 1;
        } catch (error) {
          if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002")
            throw error;
        }
      }
    }
    return scheduled;
  }

  private async assertSupportedCurrency(currency: string): Promise<void> {
    const normalized = normalizePricingCurrency(currency);
    if (!normalized) {
      throw new AppError(
        "PRICING_CURRENCY_UNSUPPORTED",
        "The selected currency is not supported by Waflo's Stripe card catalog.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    currencyMinorDigits(normalized);
    if (!(await this.catalogProvider().validateCurrency(normalized))) {
      throw new AppError(
        "PRICING_CURRENCY_UNSUPPORTED",
        "The selected currency is not supported by the configured Stripe billing route.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
  }

  private isIsoCountry(countryCode: string): boolean {
    if (!/^[A-Z]{2}$/u.test(countryCode)) return false;
    try {
      const display = new Intl.DisplayNames(["en"], { type: "region" }).of(countryCode);
      return Boolean(display && display !== countryCode && display !== "Unknown Region");
    } catch {
      return false;
    }
  }

  private assertBoundPrice(
    version: {
      currency: string;
      amountMinor: bigint;
    },
    price: StripeCatalogPrice,
    interval: "month" | "year",
    intervalCount: number,
  ): void {
    if (
      !price.active ||
      price.currency.toUpperCase() !== version.currency ||
      price.unitAmount !== Number(version.amountMinor) ||
      price.interval !== interval ||
      price.intervalCount !== intervalCount
    ) {
      throw new AppError(
        "STRIPE_PRICE_BINDING_MISMATCH",
        "The Stripe Price does not match the immutable Waflo price contract.",
        HttpStatus.CONFLICT,
      );
    }
  }

  private catalogProvider(): PricingStripeCatalogProvider {
    if (this.injectedCatalogProvider) return this.injectedCatalogProvider;
    const stripe = this.requireStripe();
    return {
      validateCurrency: async (currency) => {
        return normalizePricingCurrency(currency) !== null;
      },
      ensureProduct: async ({ plan, requestedProductId, environment }) => {
        if (requestedProductId) {
          const existing = await stripe.products.retrieve(requestedProductId);
          if (!existing.active) {
            throw new AppError(
              "STRIPE_PRODUCT_INVALID",
              "The Stripe Product bound to this plan is inactive.",
              HttpStatus.CONFLICT,
            );
          }
          return { id: existing.id };
        }
        const product = await stripe.products.create(
          {
            name: `Waflo ${plan}`,
            metadata: { waflo_environment: environment, waflo_plan: plan },
          },
          { idempotencyKey: `waflo:product:${environment}:${plan}` },
        );
        return { id: product.id };
      },
      retrievePrice: async (priceId) => {
        const price = await stripe.prices.retrieve(priceId);
        return {
          id: price.id,
          productId: typeof price.product === "string" ? price.product : price.product.id,
          active: price.active,
          currency: price.currency.toUpperCase(),
          unitAmount: price.unit_amount,
          interval:
            price.recurring?.interval === "month" || price.recurring?.interval === "year"
              ? price.recurring.interval
              : null,
          intervalCount: price.recurring?.interval_count ?? null,
        };
      },
      createPrice: async (input) => {
        const price = await stripe.prices.create(
          {
            product: input.productId,
            currency: input.currency.toLowerCase(),
            unit_amount: input.amountMinor,
            recurring: { interval: input.interval, interval_count: input.intervalCount },
            metadata: input.metadata,
          },
          { idempotencyKey: input.idempotencyKey },
        );
        return {
          id: price.id,
          productId: typeof price.product === "string" ? price.product : price.product.id,
          active: price.active,
          currency: price.currency.toUpperCase(),
          unitAmount: price.unit_amount,
          interval:
            price.recurring?.interval === "month" || price.recurring?.interval === "year"
              ? price.recurring.interval
              : null,
          intervalCount: price.recurring?.interval_count ?? null,
        };
      },
    };
  }

  private requireStripe(): Stripe {
    if (!this.stripe || !this.environment.stripeConfigured)
      throw new AppError(
        "STRIPE_NOT_CONFIGURED",
        "Stripe test configuration is required for this action.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    return this.stripe;
  }
}
