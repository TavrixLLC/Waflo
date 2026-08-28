import { HttpStatus, Injectable } from "@nestjs/common";
import type { PlanCode } from "@waflo/contracts";
import { AppError } from "../common/app-error.js";
import { withInvariantLock } from "../common/organization-transaction.js";
import { PrismaService } from "../database/prisma.service.js";
import type { PricingCadence } from "./pricing-catalog.service.js";

const PREVIEW_TTL_MS = 15 * 60 * 1000;
const ELIGIBLE_STATUSES = ["ACTIVE", "TRIALING"] as const;

export type AnnualRepricingPreviewInput = {
  marketId: string;
  plan: PlanCode;
  cadence: PricingCadence;
  targetPricingVersionId: string;
  effectiveOnOrAfter: Date;
  noticeDays: number;
  replacesCampaignPublicId?: string | undefined;
};

type Candidate = {
  id: string;
  organizationId: string;
  planCode: string;
  cadence: PricingCadence;
  status: string;
  grandfathered: boolean;
  pricingMarketCode: string | null;
  pricingVersionId: string | null;
  pricingCurrency: string | null;
  pricingAmountMinor: bigint | null;
  currentPeriodEnd: Date | null;
};

type CampaignForMap = {
  publicId: string;
  status: string;
  market: { id: string; code: string; countryCode: string | null };
  planCode: string;
  cadence: string;
  targetPricingVersionId: string;
  currency: string;
  effectiveOnOrAfter: Date;
  noticeDays: number;
  previewSnapshot: unknown;
  previewedAt: Date;
  previewExpiresAt: Date;
  scheduledAt: Date | null;
  canceledAt: Date | null;
  targetPricingVersion: { version: number; amountMinor: bigint };
  commands: Array<{ id?: string; status: string; failureCode?: string | null; effectiveAt?: Date }>;
  replacesCampaign?: { publicId: string } | null;
  replacedByCampaign?: { publicId: string } | null;
};

function minor(value: bigint): string {
  return value.toString();
}

export function nextRenewalAfter(renewal: Date, cadence: PricingCadence, threshold: Date): Date {
  const candidate = new Date(renewal);
  while (candidate < threshold) {
    if (cadence === "YEARLY") candidate.setUTCFullYear(candidate.getUTCFullYear() + 1);
    else candidate.setUTCMonth(candidate.getUTCMonth() + 1);
  }
  return candidate;
}

export function monthlyEquivalent(amount: bigint, cadence: PricingCadence): bigint {
  return cadence === "YEARLY" ? (amount + 6n) / 12n : amount;
}

export function campaignStatus(
  status: string,
  commands: Array<{ status: string }>,
):
  | "PREVIEWED"
  | "SCHEDULED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "PARTIAL_FAILURE"
  | "CANCELED"
  | "SUPERSEDED" {
  if (status === "PREVIEWED" || status === "CANCELED" || status === "SUPERSEDED") return status;
  if (!commands.length) return "SCHEDULED";
  const applied = commands.filter((command) => command.status === "APPLIED").length;
  const failed = commands.filter((command) => command.status === "FAILED").length;
  const pending = commands.filter((command) => command.status === "SCHEDULED").length;
  if (failed) return "PARTIAL_FAILURE";
  if (pending && applied) return "IN_PROGRESS";
  if (applied === commands.length) return "COMPLETED";
  return "SCHEDULED";
}

@Injectable()
export class AnnualRepricingOperationsService {
  constructor(private readonly prisma: PrismaService) {}

  async preview(input: AnnualRepricingPreviewInput, adminUserId: string) {
    const now = new Date();
    // A policy date can legitimately already be in force. The per-subscriber
    // resolver still chooses the first normal renewal on or after it.
    const [market, target] = await Promise.all([
      this.prisma.client.pricingMarket.findUniqueOrThrow({ where: { id: input.marketId } }),
      this.prisma.client.pricingVersion.findUniqueOrThrow({
        where: { id: input.targetPricingVersionId },
        include: { market: true },
      }),
    ]);
    this.assertTarget(input, market, target);
    const original = input.replacesCampaignPublicId
      ? await this.prisma.client.repricingCampaign.findUniqueOrThrow({
          where: { publicId: input.replacesCampaignPublicId },
        })
      : null;
    if (original) this.assertReplacementSource(original, input);

    const candidates = await this.candidates(market.code, original?.id);
    const review = await this.reviewCandidates(
      candidates,
      market.code,
      input,
      target,
      now,
      Boolean(original),
    );
    const previewSnapshot = this.snapshot(input, market.code, target, review, now);
    const campaign = await withInvariantLock(
      this.prisma.client,
      `repricing-campaign:${market.id}:${input.plan}:${input.cadence}:${target.id}`,
      async (tx) => {
        const created = await tx.repricingCampaign.create({
          data: {
            marketId: market.id,
            planCode: input.plan.toUpperCase() as "STARTER" | "GROWTH" | "SCALE",
            cadence: input.cadence,
            targetPricingVersionId: target.id,
            currency: target.currency,
            effectiveOnOrAfter: input.effectiveOnOrAfter,
            noticeDays: input.noticeDays,
            status: "PREVIEWED",
            previewSnapshot,
            previewedAt: now,
            previewExpiresAt: new Date(now.getTime() + PREVIEW_TTL_MS),
            createdByAdminUserId: adminUserId,
            ...(original ? { replacesCampaignId: original.id } : {}),
          },
        });
        if (review.members.length) {
          await tx.repricingCampaignMember.createMany({
            data: review.members.map((member) => ({
              campaignId: created.id,
              subscriptionId: member.subscriptionId,
              disposition: member.disposition,
              exclusionCode: member.exclusionCode,
              expectedRenewalAt: member.expectedRenewalAt,
            })),
          });
        }
        return created;
      },
    );
    return this.previewResponse(
      campaign.publicId,
      previewSnapshot,
      new Date(now.getTime() + PREVIEW_TTL_MS),
    );
  }

  async schedule(campaignPublicId: string) {
    return withInvariantLock(
      this.prisma.client,
      `repricing-campaign:${campaignPublicId}`,
      async (tx) => {
        const campaign = await tx.repricingCampaign.findUniqueOrThrow({
          where: { publicId: campaignPublicId },
          include: {
            market: true,
            targetPricingVersion: true,
            members: { include: { subscription: true } },
            replacesCampaign: true,
          },
        });
        if (campaign.status !== "PREVIEWED") {
          throw new AppError(
            "REPRICING_PREVIEW_CONSUMED",
            "This repricing preview cannot be scheduled again.",
            HttpStatus.CONFLICT,
          );
        }
        if (campaign.previewExpiresAt <= new Date()) {
          throw new AppError(
            "REPRICING_PREVIEW_EXPIRED",
            "This repricing preview expired. Create a new preview.",
            HttpStatus.CONFLICT,
          );
        }
        const input: AnnualRepricingPreviewInput = {
          marketId: campaign.marketId,
          plan: campaign.planCode.toLowerCase() as PlanCode,
          cadence: campaign.cadence,
          targetPricingVersionId: campaign.targetPricingVersionId,
          effectiveOnOrAfter: campaign.effectiveOnOrAfter,
          noticeDays: campaign.noticeDays,
        };
        this.assertTarget(input, campaign.market, campaign.targetPricingVersion);
        const eligible = campaign.members.filter((member) => member.disposition === "ELIGIBLE");
        if (!eligible.length) {
          throw new AppError(
            "REPRICING_COHORT_EMPTY",
            "No eligible subscribers are available to schedule.",
            HttpStatus.CONFLICT,
          );
        }
        this.assertMembersStillValid(
          eligible.map((member) => member.subscription),
          campaign,
          campaign.targetPricingVersion,
        );

        if (campaign.replacesCampaign) {
          const original = await tx.repricingCampaign.findUniqueOrThrow({
            where: { id: campaign.replacesCampaign.id },
          });
          if (original.status !== "SCHEDULED") {
            throw new AppError(
              "REPRICING_REPLACEMENT_STALE",
              "The original campaign is no longer replaceable.",
              HttpStatus.CONFLICT,
            );
          }
          await tx.subscriptionRepricing.updateMany({
            where: { campaignId: original.id, status: "SCHEDULED" },
            data: { status: "SUPERSEDED", noticeStatus: "CANCELED" },
          });
          await tx.repricingCampaign.update({
            where: { id: original.id },
            data: { status: "SUPERSEDED" },
          });
        }

        const scheduledAt = new Date();
        for (const member of eligible) {
          const subscription = member.subscription;
          const target = campaign.targetPricingVersion;
          const expectedRenewalAt = member.expectedRenewalAt;
          if (!expectedRenewalAt) {
            throw new AppError(
              "REPRICING_PREVIEW_STALE",
              "A subscriber is missing the reviewed renewal date.",
              HttpStatus.CONFLICT,
            );
          }
          const noticeAt = new Date(expectedRenewalAt.getTime() - campaign.noticeDays * 86_400_000);
          await tx.subscriptionRepricing.create({
            data: {
              campaignId: campaign.id,
              subscriptionId: subscription.id,
              targetPricingVersionId: target.id,
              effectiveAt: expectedRenewalAt,
              noticeSentAt: scheduledAt >= noticeAt ? scheduledAt : null,
              noticeStatus: scheduledAt >= noticeAt ? "CREATED" : "SCHEDULED",
              noticeSnapshot: {
                campaignPublicId: campaign.publicId,
                marketCode: campaign.market.code,
                plan: campaign.planCode,
                cadence: campaign.cadence,
                sourcePricingVersionId: subscription.pricingVersionId,
                targetPricingVersionId: target.id,
                sourceCurrency: subscription.pricingCurrency,
                sourceAmountMinor: subscription.pricingAmountMinor?.toString() ?? null,
                targetCurrency: target.currency,
                targetAmountMinor: target.amountMinor.toString(),
                noticeDays: campaign.noticeDays,
                scheduledAt: scheduledAt.toISOString(),
                effectiveOnOrAfter: campaign.effectiveOnOrAfter.toISOString(),
                expectedRenewalAt: expectedRenewalAt.toISOString(),
              },
              idempotencyKey: `admin-repricing:${campaign.id}:${subscription.id}`,
            },
          });
        }
        await tx.repricingCampaign.update({
          where: { id: campaign.id },
          data: { status: "SCHEDULED", scheduledAt },
        });
        return { campaignPublicId: campaign.publicId, scheduled: eligible.length, scheduledAt };
      },
    );
  }

  async cancel(campaignPublicId: string) {
    return withInvariantLock(
      this.prisma.client,
      `repricing-campaign:${campaignPublicId}`,
      async (tx) => {
        const campaign = await tx.repricingCampaign.findUniqueOrThrow({
          where: { publicId: campaignPublicId },
        });
        if (!["PREVIEWED", "SCHEDULED"].includes(campaign.status)) {
          throw new AppError(
            "REPRICING_CAMPAIGN_NOT_CANCELABLE",
            "This repricing campaign can no longer be canceled.",
            HttpStatus.CONFLICT,
          );
        }
        const result = await tx.subscriptionRepricing.updateMany({
          where: { campaignId: campaign.id, status: "SCHEDULED" },
          data: { status: "CANCELED", noticeStatus: "CANCELED" },
        });
        await tx.repricingCampaign.update({
          where: { id: campaign.id },
          data: { status: "CANCELED", canceledAt: new Date() },
        });
        return { campaignPublicId, canceledCommands: result.count };
      },
    );
  }

  async overview() {
    const [subscriptions, campaigns, commands, markets] = await Promise.all([
      this.prisma.client.subscription.findMany({
        select: {
          grandfathered: true,
          status: true,
          currentPeriodEnd: true,
          pricingMarketCode: true,
        },
      }),
      this.prisma.client.repricingCampaign.findMany({
        include: {
          market: true,
          targetPricingVersion: true,
          commands: { select: { status: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      this.prisma.client.subscriptionRepricing.findMany({
        select: { status: true, effectiveAt: true },
      }),
      this.prisma.client.pricingMarket.findMany({ select: { code: true } }),
    ]);
    const grandfathered = subscriptions.filter((subscription) => subscription.grandfathered);
    const statuses = { pending: 0, executed: 0, failed: 0, canceled: 0, superseded: 0 };
    for (const command of commands) {
      if (command.status === "SCHEDULED") statuses.pending += 1;
      if (command.status === "APPLIED") statuses.executed += 1;
      if (command.status === "FAILED") statuses.failed += 1;
      if (command.status === "CANCELED") statuses.canceled += 1;
      if (command.status === "SUPERSEDED") statuses.superseded += 1;
    }
    return {
      generatedAt: new Date().toISOString(),
      summary: {
        grandfatheredSubscribers: grandfathered.length,
        eligibleForRepricing: grandfathered.filter((subscription) =>
          ELIGIBLE_STATUSES.includes(subscription.status as (typeof ELIGIBLE_STATUSES)[number]),
        ).length,
        scheduled: campaigns.filter((campaign) => campaign.status === "SCHEDULED").length,
        pending: statuses.pending,
        executed: statuses.executed,
        failed: statuses.failed,
        canceled: statuses.canceled,
        superseded: statuses.superseded,
        upcomingRenewals: commands.filter(
          (command) => command.status === "SCHEDULED" && command.effectiveAt >= new Date(),
        ).length,
        marketsWithGrandfatheredSubscribers: new Set(
          grandfathered.map((subscription) => subscription.pricingMarketCode).filter(Boolean),
        ).size,
        knownMarkets: markets.length,
      },
      campaigns: campaigns.map((campaign) => this.mapCampaign(campaign)),
    };
  }

  async campaigns() {
    return (await this.overview()).campaigns;
  }

  async campaign(campaignPublicId: string) {
    const campaign = await this.prisma.client.repricingCampaign.findUnique({
      where: { publicId: campaignPublicId },
      include: {
        market: true,
        targetPricingVersion: true,
        commands: {
          include: { subscription: true, targetPricingVersion: true },
          orderBy: { createdAt: "desc" },
        },
        replacesCampaign: true,
        replacedByCampaign: true,
      },
    });
    if (!campaign)
      throw new AppError(
        "REPRICING_CAMPAIGN_NOT_FOUND",
        "The repricing campaign was not found.",
        HttpStatus.NOT_FOUND,
      );
    return this.mapCampaign(campaign, true);
  }

  async subscribers(
    campaignPublicId: string,
    query: {
      page: number;
      pageSize: number;
      status?: string | undefined;
      noticeStatus?: string | undefined;
      sourcePricingVersionId?: string | undefined;
      renewalFrom?: Date | undefined;
      renewalTo?: Date | undefined;
    },
  ) {
    const campaign = await this.prisma.client.repricingCampaign.findUnique({
      where: { publicId: campaignPublicId },
      include: {
        members: {
          include: { subscription: { include: { organization: true, pricingVersion: true } } },
          orderBy: { createdAt: "desc" },
        },
        commands: { include: { targetPricingVersion: true } },
      },
    });
    if (!campaign)
      throw new AppError(
        "REPRICING_CAMPAIGN_NOT_FOUND",
        "The repricing campaign was not found.",
        HttpStatus.NOT_FOUND,
      );
    const commandsBySubscription = new Map(
      campaign.commands.map((command) => [command.subscriptionId, command]),
    );
    let rows = campaign.members.map((member) => ({
      member,
      command: commandsBySubscription.get(member.subscriptionId) ?? null,
    }));
    rows = rows.filter(({ member, command }) => {
      const status = command?.status === "SCHEDULED" ? "PENDING" : (command?.status ?? "EXCLUDED");
      if (query.status && status !== query.status) return false;
      if (query.noticeStatus && command?.noticeStatus !== query.noticeStatus) return false;
      if (
        query.sourcePricingVersionId &&
        member.subscription.pricingVersionId !== query.sourcePricingVersionId
      )
        return false;
      if (
        query.renewalFrom &&
        (!member.expectedRenewalAt || member.expectedRenewalAt < query.renewalFrom)
      )
        return false;
      if (
        query.renewalTo &&
        (!member.expectedRenewalAt || member.expectedRenewalAt > query.renewalTo)
      )
        return false;
      return true;
    });
    const total = rows.length;
    rows = rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
    return {
      page: query.page,
      pageSize: query.pageSize,
      total,
      rows: rows.map(({ member, command }) => ({
        customer: {
          publicId: member.subscription.organization.id,
          name: member.subscription.organization.name,
        },
        currentPricingVersionId: member.subscription.pricingVersionId,
        targetPricingVersionId: command?.targetPricingVersionId ?? campaign.targetPricingVersionId,
        currentVersion: member.subscription.pricingVersion?.version ?? null,
        targetVersion: command?.targetPricingVersion.version ?? null,
        currentAmountMinor: member.subscription.pricingAmountMinor?.toString() ?? null,
        targetAmountMinor: command?.targetPricingVersion.amountMinor.toString() ?? null,
        currency: member.subscription.pricingCurrency,
        status: command?.status === "SCHEDULED" ? "PENDING" : (command?.status ?? "EXCLUDED"),
        noticeStatus: command?.noticeStatus ?? null,
        expectedRenewalAt: member.expectedRenewalAt?.toISOString() ?? null,
        executedAt: command?.status === "APPLIED" ? command.updatedAt.toISOString() : null,
        failureCode: command?.failureCode ?? member.exclusionCode,
      })),
    };
  }

  private async candidates(marketCode: string, replacementCampaignId?: string) {
    if (!replacementCampaignId) {
      return this.prisma.client.subscription.findMany({
        where: { pricingMarketCode: marketCode },
      }) as Promise<Candidate[]>;
    }
    const commands = await this.prisma.client.subscriptionRepricing.findMany({
      where: { campaignId: replacementCampaignId, status: "SCHEDULED" },
      include: { subscription: true },
    });
    return commands.map((command) => command.subscription) as Candidate[];
  }

  private async reviewCandidates(
    candidates: Candidate[],
    marketCode: string,
    input: AnnualRepricingPreviewInput,
    target: { id: string; currency: string; amountMinor: bigint },
    now: Date,
    replacing: boolean,
  ) {
    const members: Array<{
      subscriptionId: string;
      disposition: "ELIGIBLE" | "EXCLUDED";
      exclusionCode: string | null;
      expectedRenewalAt: Date | null;
      sourceVersionId: string | null;
      sourceAmountMinor: bigint | null;
    }> = [];
    for (const subscription of candidates) {
      let exclusionCode: string | null = null;
      if (!ELIGIBLE_STATUSES.includes(subscription.status as (typeof ELIGIBLE_STATUSES)[number]))
        exclusionCode = "SUBSCRIPTION_NOT_ELIGIBLE";
      else if (!subscription.grandfathered) exclusionCode = "ALREADY_CURRENT";
      else if (subscription.pricingMarketCode !== marketCode) exclusionCode = "MARKET_MISMATCH";
      else if (subscription.planCode !== input.plan.toUpperCase()) exclusionCode = "PLAN_MISMATCH";
      else if (subscription.cadence !== input.cadence) exclusionCode = "CADENCE_MISMATCH";
      else if (
        !subscription.pricingVersionId ||
        !subscription.pricingCurrency ||
        subscription.pricingAmountMinor === null
      )
        exclusionCode = "MISSING_PRICING_SNAPSHOT";
      else if (subscription.pricingCurrency !== target.currency)
        exclusionCode = "CURRENCY_MISMATCH";
      else if (subscription.pricingVersionId === target.id) exclusionCode = "ALREADY_CURRENT";
      else if (!subscription.currentPeriodEnd) exclusionCode = "MISSING_RENEWAL";
      else if (!replacing && (await this.hasScheduledCommand(subscription.id)))
        exclusionCode = "ALREADY_SCHEDULED";
      const expectedRenewalAt =
        exclusionCode || !subscription.currentPeriodEnd
          ? null
          : nextRenewalAfter(
              nextRenewalAfter(
                subscription.currentPeriodEnd,
                subscription.cadence,
                input.effectiveOnOrAfter,
              ),
              subscription.cadence,
              new Date(now.getTime() + input.noticeDays * 86_400_000),
            );
      members.push({
        subscriptionId: subscription.id,
        disposition: exclusionCode ? "EXCLUDED" : "ELIGIBLE",
        exclusionCode,
        expectedRenewalAt,
        sourceVersionId: subscription.pricingVersionId,
        sourceAmountMinor: subscription.pricingAmountMinor,
      });
    }
    const eligible = members.filter((member) => member.disposition === "ELIGIBLE");
    const oldMrr = eligible.reduce((sum, member) => {
      if (member.sourceAmountMinor === null) {
        throw new AppError(
          "REPRICING_PREVIEW_INVALID",
          "An eligible subscriber is missing price evidence.",
          HttpStatus.CONFLICT,
        );
      }
      return sum + monthlyEquivalent(member.sourceAmountMinor, input.cadence);
    }, 0n);
    const targetMrr =
      monthlyEquivalent(target.amountMinor, input.cadence) * BigInt(eligible.length);
    const bySourceVersion = new Map<string, { subscribers: number; amountMinor: bigint }>();
    for (const member of eligible) {
      if (!member.sourceVersionId || member.sourceAmountMinor === null) {
        throw new AppError(
          "REPRICING_PREVIEW_INVALID",
          "An eligible subscriber is missing version evidence.",
          HttpStatus.CONFLICT,
        );
      }
      const key = member.sourceVersionId;
      const group = bySourceVersion.get(key) ?? {
        subscribers: 0,
        amountMinor: member.sourceAmountMinor,
      };
      group.subscribers += 1;
      bySourceVersion.set(key, group);
    }
    return { members, eligible, oldMrr, targetMrr, bySourceVersion };
  }

  private async hasScheduledCommand(subscriptionId: string): Promise<boolean> {
    return Boolean(
      await this.prisma.client.subscriptionRepricing.findFirst({
        where: { subscriptionId, status: "SCHEDULED" },
        select: { id: true },
      }),
    );
  }

  private assertTarget(
    input: AnnualRepricingPreviewInput,
    market: { id: string; code: string; active: boolean; configuredCurrency: string | null },
    target: {
      marketId: string;
      planCode: string;
      cadence: PricingCadence;
      currency: string;
      status: string;
      stripePriceId: string | null;
    },
  ) {
    if (
      !market.active ||
      target.status !== "ACTIVE_FOR_NEW_SUBSCRIPTIONS" ||
      !target.stripePriceId
    ) {
      throw new AppError(
        "REPRICING_TARGET_UNAVAILABLE",
        "Select an active, Stripe-bound published price.",
        HttpStatus.CONFLICT,
      );
    }
    if (
      target.marketId !== input.marketId ||
      target.planCode !== input.plan.toUpperCase() ||
      target.cadence !== input.cadence
    ) {
      throw new AppError(
        "REPRICING_TARGET_MISMATCH",
        "The target must match the selected market, plan, and cadence.",
        HttpStatus.CONFLICT,
      );
    }
    if (market.configuredCurrency && market.configuredCurrency !== target.currency) {
      throw new AppError(
        "REPRICING_TARGET_CURRENCY_MISMATCH",
        "The target currency does not match the market contract.",
        HttpStatus.CONFLICT,
      );
    }
  }

  private assertReplacementSource(
    campaign: { status: string; marketId: string; planCode: string; cadence: PricingCadence },
    input: AnnualRepricingPreviewInput,
  ) {
    if (campaign.status !== "SCHEDULED")
      throw new AppError(
        "REPRICING_REPLACEMENT_STALE",
        "Only a scheduled campaign can be replaced.",
        HttpStatus.CONFLICT,
      );
    if (
      campaign.marketId !== input.marketId ||
      campaign.planCode !== input.plan.toUpperCase() ||
      campaign.cadence !== input.cadence
    ) {
      throw new AppError(
        "REPRICING_REPLACEMENT_MISMATCH",
        "The replacement must preserve the campaign market, plan, and cadence.",
        HttpStatus.CONFLICT,
      );
    }
  }

  private assertMembersStillValid(
    subscriptions: Candidate[],
    campaign: {
      market: { code: string };
      planCode: string;
      cadence: PricingCadence;
      targetPricingVersionId: string;
      currency: string;
    },
    target: { id: string; currency: string },
  ) {
    for (const subscription of subscriptions) {
      if (
        !subscription.grandfathered ||
        !ELIGIBLE_STATUSES.includes(subscription.status as (typeof ELIGIBLE_STATUSES)[number]) ||
        subscription.pricingMarketCode !== campaign.market.code ||
        subscription.planCode !== campaign.planCode ||
        subscription.cadence !== campaign.cadence ||
        subscription.pricingCurrency !== campaign.currency ||
        !subscription.pricingVersionId ||
        subscription.pricingVersionId === target.id ||
        !subscription.currentPeriodEnd
      ) {
        throw new AppError(
          "REPRICING_PREVIEW_STALE",
          "A subscriber changed after preview. Create a new preview.",
          HttpStatus.CONFLICT,
        );
      }
    }
  }

  private snapshot(
    input: AnnualRepricingPreviewInput,
    marketCode: string,
    target: { id: string; currency: string; amountMinor: bigint; version: number },
    review: Awaited<ReturnType<AnnualRepricingOperationsService["reviewCandidates"]>>,
    previewedAt: Date,
  ) {
    const renewals = review.eligible
      .map((member) => member.expectedRenewalAt)
      .filter((value): value is Date => Boolean(value));
    const exclusions: Record<string, number> = {};
    for (const member of review.members) {
      if (member.disposition !== "EXCLUDED") continue;
      const key = member.exclusionCode ?? "EXCLUDED";
      exclusions[key] = (exclusions[key] ?? 0) + 1;
    }
    return {
      marketCode,
      plan: input.plan.toUpperCase(),
      cadence: input.cadence,
      targetPricingVersionId: target.id,
      targetVersion: target.version,
      currency: target.currency,
      targetAmountMinor: minor(target.amountMinor),
      effectiveOnOrAfter: input.effectiveOnOrAfter.toISOString(),
      noticeDays: input.noticeDays,
      previewedAt: previewedAt.toISOString(),
      eligibleCount: review.eligible.length,
      excludedCount: review.members.length - review.eligible.length,
      monthlySubscribers: review.eligible.filter(
        (member) => member.expectedRenewalAt && input.cadence === "MONTHLY",
      ).length,
      annualSubscribers: review.eligible.filter(
        (member) => member.expectedRenewalAt && input.cadence === "YEARLY",
      ).length,
      earliestEffectiveRenewal: renewals.length
        ? new Date(Math.min(...renewals.map((date) => date.getTime()))).toISOString()
        : null,
      latestKnownRenewal: renewals.length
        ? new Date(Math.max(...renewals.map((date) => date.getTime()))).toISOString()
        : null,
      currentMrrMinor: minor(review.oldMrr),
      projectedMrrMinor: minor(review.targetMrr),
      monthlyDeltaMinor: minor(review.targetMrr - review.oldMrr),
      annualizedDeltaMinor: minor((review.targetMrr - review.oldMrr) * 12n),
      sourceVersions: [...review.bySourceVersion.entries()].map(([versionId, group]) => ({
        versionId,
        subscribers: group.subscribers,
        amountMinor: minor(group.amountMinor),
      })),
      exclusions,
    };
  }

  private previewResponse(
    previewId: string,
    snapshot: ReturnType<AnnualRepricingOperationsService["snapshot"]>,
    expiresAt: Date,
  ) {
    return { previewId, ...snapshot, expiresAt: expiresAt.toISOString() };
  }

  private mapCampaign(campaign: CampaignForMap, detail = false) {
    const snapshot = campaign.previewSnapshot as Record<string, unknown>;
    return {
      campaignId: campaign.publicId,
      status: campaignStatus(campaign.status, campaign.commands),
      market: {
        id: campaign.market.id,
        code: campaign.market.code,
        countryCode: campaign.market.countryCode,
      },
      plan: campaign.planCode,
      cadence: campaign.cadence,
      target: {
        pricingVersionId: campaign.targetPricingVersionId,
        version: campaign.targetPricingVersion.version,
        currency: campaign.currency,
        amountMinor: campaign.targetPricingVersion.amountMinor.toString(),
      },
      effectiveOnOrAfter: campaign.effectiveOnOrAfter.toISOString(),
      noticeDays: campaign.noticeDays,
      previewedAt: campaign.previewedAt.toISOString(),
      previewExpiresAt: campaign.previewExpiresAt.toISOString(),
      scheduledAt: campaign.scheduledAt?.toISOString() ?? null,
      canceledAt: campaign.canceledAt?.toISOString() ?? null,
      replacesCampaignId: campaign.replacesCampaign?.publicId ?? null,
      replacedByCampaignId: campaign.replacedByCampaign?.publicId ?? null,
      impact: snapshot,
      ...(detail
        ? {
            commands: campaign.commands.map((command) => ({
              id: command.id,
              status: command.status,
              failureCode: command.failureCode,
              effectiveAt: command.effectiveAt?.toISOString() ?? null,
            })),
          }
        : {}),
    };
  }
}
