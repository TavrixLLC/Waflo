import { HttpStatus, Injectable } from "@nestjs/common";
import { verifyPassword } from "@waflo/auth";
import { billingCadences, type PlanCode, planCodes } from "@waflo/contracts";
import { AuditService } from "../audit/audit.service.js";
import {
  type PricingCadence,
  PricingCatalogService,
  type ResolvedPrice,
} from "../billing/pricing-catalog.service.js";
import { AppError } from "../common/app-error.js";
import type { WafloRequest } from "../common/request-context.js";
import { PrismaService } from "../database/prisma.service.js";
import { pricingDecimalToMinor, pricingVersionStatusLabel } from "./admin-pricing.js";

const COMMERCIAL_SUBSCRIPTION_STATUSES = [
  "ACTIVE",
  "TRIALING",
  "PAST_DUE",
  "GRACE_PERIOD",
] as const;
const PRICING_REAUTH_TTL_MILLISECONDS = 10 * 60 * 1000;

type AdminActor = { id: string; displayName: string };

function date(value: Date | null | undefined): string | null {
  return value?.toISOString() ?? null;
}

function amount(value: bigint): string {
  return value.toString();
}

@Injectable()
export class AdminPricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: PricingCatalogService,
    private readonly audit: AuditService,
  ) {}

  async overview() {
    const [markets, subscriptions, scheduledRepricings] = await Promise.all([
      this.prisma.client.pricingMarket.findMany({
        orderBy: [{ kind: "asc" }, { code: "asc" }],
        include: {
          versions: {
            orderBy: [{ planCode: "asc" }, { cadence: "asc" }, { version: "desc" }],
          },
        },
      }),
      this.prisma.client.subscription.findMany({
        where: { status: { in: [...COMMERCIAL_SUBSCRIPTION_STATUSES] } },
        select: {
          id: true,
          pricingMarketCode: true,
          pricingVersionId: true,
          grandfathered: true,
          status: true,
        },
      }),
      this.prisma.client.subscriptionRepricing.findMany({
        where: { status: "SCHEDULED" },
        select: { subscriptionId: true },
      }),
    ]);
    const byVersion = new Map<
      string,
      { subscribers: number; grandfathered: number; trialing: number }
    >();
    const byMarket = new Map<
      string,
      { subscribers: number; grandfathered: number; trialing: number }
    >();
    for (const subscription of subscriptions) {
      const market = subscription.pricingMarketCode ?? "UNMAPPED";
      const marketCounts = byMarket.get(market) ?? {
        subscribers: 0,
        grandfathered: 0,
        trialing: 0,
      };
      marketCounts.subscribers += 1;
      if (subscription.grandfathered) marketCounts.grandfathered += 1;
      if (subscription.status === "TRIALING") marketCounts.trialing += 1;
      byMarket.set(market, marketCounts);
      if (subscription.pricingVersionId) {
        const versionCounts = byVersion.get(subscription.pricingVersionId) ?? {
          subscribers: 0,
          grandfathered: 0,
          trialing: 0,
        };
        versionCounts.subscribers += 1;
        if (subscription.grandfathered) versionCounts.grandfathered += 1;
        if (subscription.status === "TRIALING") versionCounts.trialing += 1;
        byVersion.set(subscription.pricingVersionId, versionCounts);
      }
    }
    const scheduledIds = new Set(scheduledRepricings.map((command) => command.subscriptionId));
    const marketRows = markets.map((market) => {
      const marketCounts = byMarket.get(market.code) ?? {
        subscribers: 0,
        grandfathered: 0,
        trialing: 0,
      };
      const versions = market.versions.map((version) => {
        const counts = byVersion.get(version.id) ?? {
          subscribers: 0,
          grandfathered: 0,
          trialing: 0,
        };
        return {
          id: version.id,
          version: version.version,
          plan: version.planCode,
          cadence: version.cadence,
          amountMinor: amount(version.amountMinor),
          currency: version.currency,
          status: pricingVersionStatusLabel(version.status),
          rawStatus: version.status,
          stripeBinding: {
            status: version.stripePriceId ? "BOUND" : "UNBOUND",
            stripePriceReference: version.stripePriceId,
            stripeProductReference: version.stripeProductId,
          },
          createdAt: version.createdAt.toISOString(),
          publishedAt: date(version.publishedAt),
          retiredAt: date(version.retiredAt),
          subscribers: counts.subscribers,
          grandfatheredSubscribers: counts.grandfathered,
          trialingSubscribers: counts.trialing,
        };
      });
      return {
        id: market.id,
        code: market.code,
        kind: market.kind,
        countryCode: market.countryCode,
        configuredCurrency: market.configuredCurrency,
        active: market.active,
        fallbackMarketCode: market.fallbackMarketCode,
        createdAt: market.createdAt.toISOString(),
        updatedAt: market.updatedAt.toISOString(),
        subscribers: marketCounts.subscribers,
        grandfatheredSubscribers: marketCounts.grandfathered,
        trialingSubscribers: marketCounts.trialing,
        versions,
      };
    });
    const allVersions = marketRows.flatMap((market) => market.versions);
    return {
      generatedAt: new Date().toISOString(),
      summary: {
        configuredMarkets: marketRows.length,
        activePriceVersions: allVersions.filter(
          (version) => version.rawStatus === "ACTIVE_FOR_NEW_SUBSCRIPTIONS",
        ).length,
        draftVersions: allVersions.filter((version) => version.rawStatus === "DRAFT").length,
        bindingIssues: allVersions.filter(
          (version) =>
            version.rawStatus === "ACTIVE_FOR_NEW_SUBSCRIPTIONS" &&
            version.stripeBinding.status !== "BOUND",
        ).length,
        grandfatheredSubscribers: subscriptions.filter((subscription) => subscription.grandfathered)
          .length,
        upcomingRepricingSubscribers: scheduledIds.size,
      },
      markets: marketRows,
      // The Admin matrix follows the executable product catalog rather than a
      // second, admin-specific enumeration of plans or cadences.
      plans: planCodes.map((plan) => plan.toUpperCase()),
      cadences: billingCadences.map((cadence) => cadence.toUpperCase()),
    };
  }

  async markets() {
    return (await this.overview()).markets;
  }

  async market(marketId: string) {
    const market = (await this.overview()).markets.find((candidate) => candidate.id === marketId);
    if (!market) {
      throw new AppError(
        "PRICING_MARKET_NOT_FOUND",
        "The pricing market was not found.",
        HttpStatus.NOT_FOUND,
      );
    }
    return market;
  }

  async version(versionId: string) {
    const version = await this.prisma.client.pricingVersion.findUnique({
      where: { id: versionId },
      include: { market: true },
    });
    if (!version) {
      throw new AppError(
        "PRICING_VERSION_NOT_FOUND",
        "The pricing version was not found.",
        HttpStatus.NOT_FOUND,
      );
    }
    const [subscribers, grandfatheredSubscribers, trialingSubscribers] = await Promise.all([
      this.prisma.client.subscription.count({
        where: {
          pricingVersionId: version.id,
          status: { in: [...COMMERCIAL_SUBSCRIPTION_STATUSES] },
        },
      }),
      this.prisma.client.subscription.count({
        where: {
          pricingVersionId: version.id,
          grandfathered: true,
          status: { in: [...COMMERCIAL_SUBSCRIPTION_STATUSES] },
        },
      }),
      this.prisma.client.subscription.count({
        where: { pricingVersionId: version.id, status: "TRIALING" },
      }),
    ]);
    return {
      id: version.id,
      version: version.version,
      market: {
        id: version.market.id,
        code: version.market.code,
        countryCode: version.market.countryCode,
        configuredCurrency: version.market.configuredCurrency,
      },
      plan: version.planCode,
      cadence: version.cadence,
      amountMinor: amount(version.amountMinor),
      currency: version.currency,
      status: pricingVersionStatusLabel(version.status),
      rawStatus: version.status,
      createdAt: version.createdAt.toISOString(),
      publishedAt: date(version.publishedAt),
      retiredAt: date(version.retiredAt),
      stripeBinding: {
        status: version.stripePriceId ? "BOUND" : "UNBOUND",
        stripePriceReference: version.stripePriceId,
        stripeProductReference: version.stripeProductId,
      },
      subscribers,
      grandfatheredSubscribers,
      trialingSubscribers,
    };
  }

  async createMarket(
    input: { countryCode: string; currency: string },
    actor: AdminActor,
    request: WafloRequest,
  ) {
    const market = await this.catalog.createMarket(input);
    await this.record(actor, "admin.pricing.market_created", "pricing_market", market.id, request, {
      code: market.code,
      countryCode: market.countryCode,
      currency: market.configuredCurrency,
    });
    return this.market(market.id);
  }

  async updateMarket(
    marketId: string,
    input: { active?: boolean | undefined; currency?: string | undefined },
    actor: AdminActor,
    sessionId: string,
    request: WafloRequest,
  ) {
    if (input.active === false) await this.requireRecentReauthentication(actor.id, sessionId);
    const previous = await this.prisma.client.pricingMarket.findUniqueOrThrow({
      where: { id: marketId },
    });
    const market = await this.catalog.updateMarket(marketId, input);
    await this.record(
      actor,
      input.active === false ? "admin.pricing.market_deactivated" : "admin.pricing.market_updated",
      "pricing_market",
      market.id,
      request,
      {
        code: market.code,
        previousActive: previous.active,
        active: market.active,
        previousCurrency: previous.configuredCurrency,
        currency: market.configuredCurrency,
      },
    );
    return this.market(market.id);
  }

  async createDraft(
    input: {
      marketId: string;
      plan: PlanCode;
      cadence: PricingCadence;
      amount: string;
      currency: string;
      reason?: string | undefined;
    },
    actor: AdminActor,
    request: WafloRequest,
  ) {
    const market = await this.prisma.client.pricingMarket.findUniqueOrThrow({
      where: { id: input.marketId },
    });
    const version = await this.catalog.createDraft({
      marketCode: market.code,
      plan: input.plan,
      cadence: input.cadence,
      currency: input.currency,
      amountMinor: pricingDecimalToMinor(input.amount, input.currency),
    });
    await this.record(
      actor,
      "admin.pricing.draft_created",
      "pricing_version",
      version.id,
      request,
      {
        market: market.code,
        plan: version.planCode,
        cadence: version.cadence,
        currency: version.currency,
        amountMinor: version.amountMinor.toString(),
        reason: input.reason ?? null,
      },
    );
    return this.version(version.id);
  }

  async validateVersion(versionId: string, actor: AdminActor, request: WafloRequest) {
    const version = await this.catalog.validateDraft(versionId);
    await this.record(
      actor,
      "admin.pricing.version_validated",
      "pricing_version",
      version.id,
      request,
      {
        plan: version.planCode,
        cadence: version.cadence,
        currency: version.currency,
        amountMinor: version.amountMinor.toString(),
      },
    );
    return this.version(version.id);
  }

  async publishVersion(
    versionId: string,
    actor: AdminActor,
    sessionId: string,
    request: WafloRequest,
  ) {
    await this.requireRecentReauthentication(actor.id, sessionId);
    const before = await this.prisma.client.pricingVersion.findUniqueOrThrow({
      where: { id: versionId },
      include: { market: true },
    });
    let resolved: ResolvedPrice;
    try {
      resolved = await this.catalog.publish(versionId);
    } catch (error) {
      await this.record(
        actor,
        "admin.pricing.stripe_binding_failed",
        "pricing_version",
        versionId,
        request,
        {
          market: before.market.code,
          plan: before.planCode,
          cadence: before.cadence,
          code: error instanceof AppError ? error.code : "STRIPE_CATALOG_FAILURE",
        },
      );
      throw error;
    }
    await this.record(
      actor,
      "admin.pricing.price_published",
      "pricing_version",
      versionId,
      request,
      {
        market: resolved.marketCode,
        plan: resolved.plan,
        cadence: resolved.cadence,
        currency: resolved.currency,
        amountMinor: resolved.amountMinor.toString(),
        stripePriceReference: resolved.stripePriceId,
      },
    );
    await this.record(
      actor,
      "admin.pricing.stripe_binding_created",
      "pricing_version",
      versionId,
      request,
      {
        stripePriceReference: resolved.stripePriceId,
      },
    );
    return this.version(versionId);
  }

  async retireVersion(
    versionId: string,
    actor: AdminActor,
    sessionId: string,
    request: WafloRequest,
  ) {
    await this.requireRecentReauthentication(actor.id, sessionId);
    const version = await this.catalog.retire(versionId);
    await this.record(
      actor,
      "admin.pricing.price_retired",
      "pricing_version",
      version.id,
      request,
      {
        plan: version.planCode,
        cadence: version.cadence,
        currency: version.currency,
        amountMinor: version.amountMinor.toString(),
      },
    );
    return this.version(version.id);
  }

  async reauthenticate(
    adminId: string,
    sessionId: string,
    currentPassword: string,
    request: WafloRequest,
  ) {
    const admin = await this.prisma.client.adminUser.findFirst({
      where: { id: adminId, status: "ACTIVE" },
      select: { passwordHash: true },
    });
    if (!admin || !(await verifyPassword(admin.passwordHash, currentPassword))) {
      throw new AppError(
        "ADMIN_PRICING_REAUTH_FAILED",
        "Reauthentication could not be verified.",
        HttpStatus.FORBIDDEN,
      );
    }
    const reauthenticatedAt = new Date();
    const result = await this.prisma.client.adminSession.updateMany({
      where: {
        id: sessionId,
        adminUserId: adminId,
        revokedAt: null,
        expiresAt: { gt: reauthenticatedAt },
      },
      data: { pricingReauthenticatedAt: reauthenticatedAt },
    });
    if (result.count !== 1) {
      throw new AppError(
        "ADMIN_SESSION_EXPIRED",
        "Your administrator session has expired.",
        HttpStatus.UNAUTHORIZED,
      );
    }
    await this.record(
      { id: adminId, displayName: "" },
      "admin.pricing.reauthenticated",
      "admin_session",
      sessionId,
      request,
      {},
    );
    return { expiresAt: new Date(reauthenticatedAt.getTime() + PRICING_REAUTH_TTL_MILLISECONDS) };
  }

  /** Shared session-bound sensitive-action proof for pricing and repricing. */
  async requireRecentReauthentication(adminId: string, sessionId: string) {
    const threshold = new Date(Date.now() - PRICING_REAUTH_TTL_MILLISECONDS);
    const session = await this.prisma.client.adminSession.findFirst({
      where: {
        id: sessionId,
        adminUserId: adminId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        pricingReauthenticatedAt: { gt: threshold },
      },
      select: { id: true },
    });
    if (!session) {
      throw new AppError(
        "ADMIN_PRICING_REAUTH_REQUIRED",
        "Re-enter your administrator password before changing published pricing.",
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private async record(
    actor: AdminActor,
    action: string,
    targetType: string,
    targetId: string,
    request: WafloRequest,
    metadata: Record<string, unknown>,
  ) {
    await this.audit.record(
      { actorAdminUserId: actor.id, action, targetType, targetId, metadata },
      request,
    );
  }
}
