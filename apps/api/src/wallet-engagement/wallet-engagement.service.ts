import { createHash } from "node:crypto";
import { HttpStatus, Injectable } from "@nestjs/common";
import type {
  WalletCampaignCreateInput,
  WalletNearbyUpdateInput,
  WalletPromotionConsentInput,
} from "@waflo/contracts";
import {
  APPLE_NEARBY_DESIRED_MAX_DISTANCE_METERS,
  resolveWalletNearbyText,
} from "@waflo/wallet-core";
import { AuditService } from "../audit/audit.service.js";
import { AppError } from "../common/app-error.js";
import { withInvariantLock } from "../common/organization-transaction.js";
import type { WafloRequest } from "../common/request-context.js";
import { CustomerCardService } from "../customer/customer-card.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { TenantService } from "../tenancy/tenant.service.js";
import { WalletProviderRegistry } from "../wallet/wallet-provider.registry.js";

const DUPLICATE_COOLDOWN_MS = 6 * 60 * 60 * 1_000;
const MERCHANT_CAMPAIGN_LIMIT_24_HOURS = 10;
const MAX_CAMPAIGN_ELIGIBLE_PASSES = 5_000;

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function intendedProviders(value: unknown): Array<"APPLE" | "GOOGLE"> {
  if (!Array.isArray(value)) return [];
  return value.filter((provider): provider is "APPLE" | "GOOGLE" =>
    ["APPLE", "GOOGLE"].includes(String(provider)),
  );
}

function nextPromotionalWindow(timezone: string, now = new Date()): Date {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  const hour = parts.hour ?? 12;
  const minute = parts.minute ?? 0;
  if (hour >= 8 && hour < 21) return now;
  const hoursUntilEight = hour >= 21 ? 24 - hour + 8 : 8 - hour;
  return new Date(now.getTime() + (hoursUntilEight * 60 - minute) * 60_000);
}

@Injectable()
export class WalletEngagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenants: TenantService,
    private readonly audit: AuditService,
    private readonly providers: WalletProviderRegistry,
    private readonly customerCards: CustomerCardService,
  ) {}

  private async program(userId: string, organizationId: string, programId: string, manage = false) {
    await this.tenants.requireMembership(
      userId,
      organizationId,
      manage ? "programs.engagement_manage" : "programs.view",
    );
    const program = await this.prisma.client.loyaltyProgram.findFirst({
      where: { id: programId, organizationId },
      include: {
        organization: true,
        currentPublishedVersion: {
          include: {
            translations: true,
            locations: { include: { location: true }, orderBy: { createdAt: "asc" } },
          },
        },
        walletNearbyConfiguration: {
          include: { locations: { include: { location: true }, orderBy: { sortOrder: "asc" } } },
        },
      },
    });
    if (!program) {
      throw new AppError("PROGRAM_NOT_FOUND", "Loyalty Card not found.", HttpStatus.NOT_FOUND);
    }
    return program;
  }

  private capability(provider: "APPLE" | "GOOGLE") {
    const adapter = this.providers.get(provider);
    const configured = adapter.mode !== "DISABLED";
    return provider === "APPLE"
      ? {
          configured,
          mode: adapter.mode,
          installedPasses: configured ? "AVAILABLE" : "NOT_CONFIGURED",
          operationalUpdates: configured ? "AVAILABLE" : "NOT_CONFIGURED",
          manualPromotion: "PROVIDER_CONFIRMATION_REQUIRED",
          nearbyRelevance: configured ? "AVAILABLE" : "NOT_CONFIGURED",
          customNearbyText: true,
          providerControlsNearbyText: false,
          selectableForManualPromotion: false,
        }
      : {
          configured,
          mode: adapter.mode,
          installedPasses: configured ? "AVAILABLE" : "NOT_CONFIGURED",
          operationalUpdates: configured ? "AVAILABLE" : "NOT_CONFIGURED",
          manualPromotion: configured ? "AVAILABLE" : "NOT_CONFIGURED",
          nearbyRelevance: configured ? "AVAILABLE" : "NOT_CONFIGURED",
          customNearbyText: false,
          providerControlsNearbyText: true,
          selectableForManualPromotion: configured,
        };
  }

  async getMerchantView(userId: string, organizationId: string, programId: string) {
    const program = await this.program(userId, organizationId, programId);
    const configuration = program.walletNearbyConfiguration;
    const published = program.currentPublishedVersion;
    const templateCode = published?.baseTemplateCode ?? null;
    const previewEn = resolveWalletNearbyText({
      templateCode,
      businessCategory: program.organization.businessCategory,
      merchantName: program.organization.name,
      locale: "en",
      customText: configuration?.appleCustomTextEn,
    });
    const previewAr = resolveWalletNearbyText({
      templateCode,
      businessCategory: program.organization.businessCategory,
      merchantName: program.organization.name,
      locale: "ar",
      customText: configuration?.appleCustomTextAr,
    });
    const eligibleLocations = (published?.locations ?? [])
      .filter(({ location }) => location.status === "ACTIVE")
      .map(({ location }) => ({
        id: location.id,
        name: location.name,
        city: location.city,
        latitude: location.latitude === null ? null : Number(location.latitude),
        longitude: location.longitude === null ? null : Number(location.longitude),
        coordinatesConfigured: location.latitude !== null && location.longitude !== null,
      }));
    return {
      program: {
        id: program.id,
        name: program.internalName,
        status: program.status,
        templateCode,
      },
      capabilities: {
        apple: this.capability("APPLE"),
        google: this.capability("GOOGLE"),
      },
      nearby: {
        enabled: configuration?.enabled ?? false,
        revision: configuration?.revision ?? 1,
        locationIds: configuration?.locations.map((item) => item.locationId) ?? [],
        desiredAppleMaxDistanceMeters: APPLE_NEARBY_DESIRED_MAX_DISTANCE_METERS,
        appleCustomTextEn: configuration?.appleCustomTextEn ?? null,
        appleCustomTextAr: configuration?.appleCustomTextAr ?? null,
        preview: {
          en: {
            ...previewEn,
            source: previewEn.usedCustomText ? "CUSTOM" : "CATEGORY_TEMPLATE",
          },
          ar: {
            ...previewAr,
            source: previewAr.usedCustomText ? "CUSTOM" : "CATEGORY_TEMPLATE",
          },
        },
      },
      eligibleLocations,
      disclosures: {
        apple:
          "Apple determines when the pass becomes relevant and uses the smaller of Waflo’s requested maximum and Apple’s default distance.",
        google: "Google Wallet determines nearby distance, dwell time, and the system reminder.",
      },
    };
  }

  async updateNearby(
    userId: string,
    organizationId: string,
    programId: string,
    input: WalletNearbyUpdateInput,
    request: WafloRequest,
  ) {
    const program = await this.program(userId, organizationId, programId, true);
    if (!program.currentPublishedVersion) {
      throw new AppError(
        "WALLET_NEARBY_REQUIRES_PUBLISHED_CARD",
        "Publish this Loyalty Card before configuring Wallet nearby relevance.",
        HttpStatus.CONFLICT,
      );
    }
    const publishedVersionId = program.currentPublishedVersion.id;
    const locations = program.currentPublishedVersion.locations
      .filter(({ location }) => input.locationIds.includes(location.id))
      .map(({ location }) => location);
    if (locations.length !== input.locationIds.length) {
      throw new AppError(
        "WALLET_NEARBY_LOCATION_INVALID",
        "Choose active locations that participate in this Loyalty Card.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (
      input.enabled &&
      locations.some(
        (location) =>
          location.status !== "ACTIVE" || location.latitude === null || location.longitude === null,
      )
    ) {
      throw new AppError(
        "WALLET_NEARBY_COORDINATES_REQUIRED",
        "Every selected location needs verified latitude and longitude.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const updated = await withInvariantLock(
      this.prisma.client,
      `wallet-nearby:${programId}`,
      async (transaction) => {
        const current = await transaction.walletNearbyConfiguration.findUnique({
          where: { programId },
        });
        const currentRevision = current?.revision ?? 1;
        if (current && currentRevision !== input.revision) {
          throw new AppError(
            "WALLET_NEARBY_REVISION_CONFLICT",
            "Nearby settings changed in another session. Reload and try again.",
            HttpStatus.CONFLICT,
            { currentRevision },
          );
        }
        const revision = current ? currentRevision + 1 : 1;
        const configuration = current
          ? await transaction.walletNearbyConfiguration.update({
              where: { id: current.id },
              data: {
                enabled: input.enabled,
                appleCustomTextEn: input.appleCustomTextEn ?? null,
                appleCustomTextAr: input.appleCustomTextAr ?? null,
                updatedByUserId: userId,
                revision,
                locations: { deleteMany: {} },
              },
            })
          : await transaction.walletNearbyConfiguration.create({
              data: {
                organizationId,
                programId,
                enabled: input.enabled,
                appleCustomTextEn: input.appleCustomTextEn ?? null,
                appleCustomTextAr: input.appleCustomTextAr ?? null,
                updatedByUserId: userId,
                revision,
              },
            });
        if (input.locationIds.length) {
          await transaction.walletNearbyLocation.createMany({
            data: input.locationIds.map((locationId, sortOrder) => ({
              configurationId: configuration.id,
              locationId,
              sortOrder,
            })),
          });
        }
        const firstMembership = await transaction.membership.findFirst({
          where: { organizationId, programId },
          select: { id: true },
          orderBy: { createdAt: "asc" },
        });
        const googleBinding = await transaction.walletProgramBinding.findFirst({
          where: {
            organizationId,
            programId,
            provider: "GOOGLE",
            programVersionId: publishedVersionId,
          },
        });
        if (firstMembership && googleBinding) {
          const key = `wallet:google:nearby-template:${programId}:r${revision}`;
          await transaction.walletCommand.create({
            data: {
              organizationId,
              membershipId: firstMembership.id,
              provider: "GOOGLE",
              commandType: "ENSURE_TEMPLATE",
              idempotencyKey: key,
              payloadFingerprint: fingerprint({ programId, revision, input }),
              safePayload: { bindingId: googleBinding.id, reason: "NEARBY_RELEVANCE_CHANGED" },
            },
          });
        }
        await transaction.programWalletSyncJob.create({
          data: {
            organizationId,
            programId,
            action: "update",
            reason: "NEARBY_RELEVANCE_CHANGED",
            commandType: "UPDATE",
            idempotencyKey: `program-wallet-nearby-sync:${programId}:r${revision}`,
            batchSize: 500,
          },
        });
        await this.audit.recordInTransaction(
          transaction,
          {
            organizationId,
            actorUserId: userId,
            action: input.enabled ? "wallet.nearby_enabled" : "wallet.nearby_disabled",
            targetType: "wallet_nearby_configuration",
            targetId: configuration.id,
            metadata: {
              programId,
              locationIds: input.locationIds,
              appleCustomTextChanged:
                (current?.appleCustomTextEn ?? null) !== (input.appleCustomTextEn ?? null) ||
                (current?.appleCustomTextAr ?? null) !== (input.appleCustomTextAr ?? null),
              revision,
            },
          },
          request,
        );
        const previousLocationIds =
          program.walletNearbyConfiguration?.locations.map((item) => item.locationId) ?? [];
        if (JSON.stringify(previousLocationIds) !== JSON.stringify(input.locationIds)) {
          await this.audit.recordInTransaction(
            transaction,
            {
              organizationId,
              actorUserId: userId,
              action: "wallet.nearby_location_selection_changed",
              targetType: "wallet_nearby_configuration",
              targetId: configuration.id,
              metadata: { programId, locationIds: input.locationIds, revision },
            },
            request,
          );
        }
        if (
          (current?.appleCustomTextEn ?? null) !== (input.appleCustomTextEn ?? null) ||
          (current?.appleCustomTextAr ?? null) !== (input.appleCustomTextAr ?? null)
        ) {
          await this.audit.recordInTransaction(
            transaction,
            {
              organizationId,
              actorUserId: userId,
              action: "wallet.apple_nearby_text_changed",
              targetType: "wallet_nearby_configuration",
              targetId: configuration.id,
              metadata: {
                programId,
                localizedValuesChanged: [
                  ...((current?.appleCustomTextEn ?? null) !== (input.appleCustomTextEn ?? null)
                    ? ["EN"]
                    : []),
                  ...((current?.appleCustomTextAr ?? null) !== (input.appleCustomTextAr ?? null)
                    ? ["AR"]
                    : []),
                ],
                revision,
              },
            },
            request,
          );
        }
        return configuration;
      },
    );
    return { enabled: updated.enabled, revision: updated.revision, updateQueued: true };
  }

  private async eligiblePasses(organizationId: string, programId: string) {
    return this.prisma.client.$queryRaw<
      Array<{ id: string; membershipId: string; provider: "GOOGLE" }>
    >`
      SELECT
        pass."id",
        pass."membership_id" AS "membershipId",
        pass."provider"::text AS "provider"
      FROM "wallet_pass_instances" AS pass
      INNER JOIN "membership_credentials" AS credential
        ON credential."id" = pass."membership_credential_id"
      INNER JOIN "memberships" AS membership
        ON membership."id" = pass."membership_id"
      INNER JOIN "customers" AS customer
        ON customer."id" = membership."customer_id"
      INNER JOIN LATERAL (
        SELECT consent."granted", consent."revoked_at"
        FROM "customer_consents" AS consent
        WHERE consent."membership_id" = membership."id"
          AND consent."consent_type" = 'WALLET_PROMOTIONS'
        ORDER BY consent."captured_at" DESC, consent."id" DESC
        LIMIT 1
      ) AS current_consent ON true
      WHERE pass."organization_id" = CAST(${organizationId} AS UUID)
        AND membership."organization_id" = CAST(${organizationId} AS UUID)
        AND customer."organization_id" = CAST(${organizationId} AS UUID)
        AND credential."organization_id" = CAST(${organizationId} AS UUID)
        AND membership."program_id" = CAST(${programId} AS UUID)
        AND pass."provider" = 'GOOGLE'
        AND pass."status" IN ('ISSUED', 'ACTIVE')
        AND credential."status" = 'ACTIVE'
        AND membership."status" = 'ACTIVE'
        AND customer."status" = 'ACTIVE'
        AND current_consent."granted" = true
        AND current_consent."revoked_at" IS NULL
      ORDER BY pass."id" ASC
      LIMIT ${MAX_CAMPAIGN_ELIGIBLE_PASSES + 1}
    `;
  }

  async audienceEstimate(userId: string, organizationId: string, programId: string) {
    await this.program(userId, organizationId, programId);
    const eligible = await this.eligiblePasses(organizationId, programId);
    return {
      audienceRule: "ALL_ELIGIBLE_WALLET_HOLDERS" as const,
      total: eligible.length,
      providers: { apple: 0, google: eligible.length },
      capped: eligible.length > MAX_CAMPAIGN_ELIGIBLE_PASSES,
      exclusions: ["NO_CURRENT_CONSENT", "INACTIVE_MEMBERSHIP", "NO_ELIGIBLE_WALLET_PASS"],
    };
  }

  private async validateDestinationUrl(
    organizationId: string,
    destinationUrl: string | null | undefined,
  ): Promise<string | null> {
    if (!destinationUrl) return null;
    let url: URL;
    try {
      url = new URL(destinationUrl);
    } catch {
      throw new AppError(
        "WALLET_CAMPAIGN_URL_INVALID",
        "Use a valid merchant or Waflo destination URL.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const allowedDomains = await this.prisma.client.organizationDomain.findMany({
      where: { organizationId, status: "ACTIVE" },
      select: { hostname: true },
    });
    const hostname = url.hostname.toLocaleLowerCase("en-US");
    const local = ["localhost", "127.0.0.1"].includes(hostname);
    const allowed =
      hostname === "waflo.app" ||
      hostname.endsWith(".waflo.app") ||
      allowedDomains.some((domain) => domain.hostname.toLocaleLowerCase("en-US") === hostname) ||
      (process.env.NODE_ENV !== "production" && local);
    if ((!local && url.protocol !== "https:") || url.username || url.password || !allowed) {
      throw new AppError(
        "WALLET_CAMPAIGN_URL_NOT_ALLOWED",
        "The destination must use HTTPS and belong to this merchant or Waflo.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    url.hash = "";
    return url.toString();
  }

  async createCampaign(
    userId: string,
    organizationId: string,
    programId: string,
    input: WalletCampaignCreateInput,
    request: WafloRequest,
  ) {
    const program = await this.program(userId, organizationId, programId, true);
    if (!this.capability("GOOGLE").selectableForManualPromotion) {
      throw new AppError(
        "GOOGLE_WALLET_NOT_CONFIGURED",
        "Google Wallet manual notifications are not configured.",
        HttpStatus.CONFLICT,
      );
    }
    if (!program.currentPublishedVersionId || program.status !== "PUBLISHED") {
      throw new AppError(
        "WALLET_CAMPAIGN_CARD_NOT_ACTIVE",
        "Only a published, active Loyalty Card can send promotional Wallet messages.",
        HttpStatus.CONFLICT,
      );
    }
    const eligible = await this.eligiblePasses(organizationId, programId);
    if (eligible.length === 0) {
      throw new AppError(
        "WALLET_CAMPAIGN_NO_ELIGIBLE_AUDIENCE",
        "No active, consented Google Wallet holders are eligible right now.",
        HttpStatus.CONFLICT,
      );
    }
    if (eligible.length > MAX_CAMPAIGN_ELIGIBLE_PASSES) {
      throw new AppError(
        "WALLET_CAMPAIGN_AUDIENCE_LIMIT",
        "This audience exceeds the current safe campaign limit.",
        HttpStatus.CONFLICT,
        { limit: MAX_CAMPAIGN_ELIGIBLE_PASSES },
      );
    }
    const destinationUrl = await this.validateDestinationUrl(organizationId, input.destinationUrl);
    const contentFingerprint = fingerprint({
      programId,
      locale: input.locale,
      title: input.title,
      body: input.body,
      destinationUrl,
      providers: input.providers,
    });
    const now = new Date();
    const scheduledAt = nextPromotionalWindow(program.organization.timezone, now);
    return withInvariantLock(
      this.prisma.client,
      `wallet-campaign:${organizationId}`,
      async (transaction) => {
        const replay = await transaction.walletEngagementCampaign.findUnique({
          where: {
            organizationId_idempotencyKey: { organizationId, idempotencyKey: input.idempotencyKey },
          },
        });
        if (replay) {
          if (replay.contentFingerprint !== contentFingerprint || replay.programId !== programId) {
            throw new AppError(
              "OPERATION_IDEMPOTENCY_CONFLICT",
              "This send command was already used with different content.",
              HttpStatus.CONFLICT,
            );
          }
          return {
            id: replay.id,
            status: replay.status,
            scheduledAt: replay.scheduledAt,
            replayed: true,
          };
        }
        const recentCount = await transaction.walletEngagementCampaign.count({
          where: {
            organizationId,
            kind: "MANUAL_PROMOTION",
            status: { notIn: ["CANCELED", "FAILED"] },
            createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1_000) },
          },
        });
        if (recentCount >= MERCHANT_CAMPAIGN_LIMIT_24_HOURS) {
          throw new AppError(
            "WALLET_CAMPAIGN_MERCHANT_RATE_LIMIT",
            "This merchant has reached the Wallet campaign limit for 24 hours.",
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
        const duplicate = await transaction.walletEngagementCampaign.findFirst({
          where: {
            organizationId,
            programId,
            contentFingerprint,
            status: { notIn: ["CANCELED", "FAILED"] },
            createdAt: { gte: new Date(now.getTime() - DUPLICATE_COOLDOWN_MS) },
          },
        });
        if (duplicate) {
          throw new AppError(
            "WALLET_CAMPAIGN_DUPLICATE_CONTENT",
            "An identical Wallet message was created recently. Wait before sending it again.",
            HttpStatus.CONFLICT,
          );
        }
        const campaign = await transaction.walletEngagementCampaign.create({
          data: {
            organizationId,
            programId,
            locale: input.locale,
            title: input.title,
            body: input.body,
            destinationUrl,
            intendedProviders: input.providers,
            audienceRule: input.audienceRule,
            contentFingerprint,
            idempotencyKey: input.idempotencyKey,
            eligibleCount: eligible.length,
            createdByUserId: userId,
            scheduledAt,
          },
        });
        await this.audit.recordInTransaction(
          transaction,
          {
            organizationId,
            actorUserId: userId,
            action: "wallet.campaign_created",
            targetType: "wallet_engagement_campaign",
            targetId: campaign.id,
            metadata: {
              programId,
              providers: input.providers,
              audienceRule: input.audienceRule,
              eligibleCount: eligible.length,
              quietHoursApplied: scheduledAt > now,
            },
          },
          request,
        );
        return { id: campaign.id, status: campaign.status, scheduledAt, replayed: false };
      },
    );
  }

  async history(userId: string, organizationId: string, programId: string, limit: number) {
    await this.program(userId, organizationId, programId);
    const items = await this.prisma.client.walletEngagementCampaign.findMany({
      where: { organizationId, programId },
      include: { createdBy: { select: { displayName: true } } },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return {
      items: items.map((campaign) => ({
        id: campaign.id,
        createdAt: campaign.createdAt,
        scheduledAt: campaign.scheduledAt,
        title: campaign.title,
        body: campaign.body,
        locale: campaign.locale,
        providers: intendedProviders(campaign.intendedProviders),
        audienceRule: campaign.audienceRule,
        status: campaign.status,
        counts: {
          eligible: campaign.eligibleCount,
          queued: campaign.queuedCount,
          succeeded: campaign.succeededCount,
          skipped: campaign.skippedCount,
          failed: campaign.failedCount,
        },
        creator: campaign.createdBy.displayName,
      })),
    };
  }

  async cancelCampaign(
    userId: string,
    organizationId: string,
    programId: string,
    campaignId: string,
    request: WafloRequest,
  ) {
    await this.program(userId, organizationId, programId, true);
    const canceled = await this.prisma.client.$transaction(async (transaction) => {
      const updated = await transaction.walletEngagementCampaign.updateMany({
        where: {
          id: campaignId,
          organizationId,
          programId,
          status: "PENDING",
          cursorPassInstanceId: null,
        },
        data: { status: "CANCELED", canceledAt: new Date() },
      });
      if (updated.count !== 1) {
        throw new AppError(
          "WALLET_CAMPAIGN_CANNOT_CANCEL",
          "This campaign has already started or is no longer cancelable.",
          HttpStatus.CONFLICT,
        );
      }
      await this.audit.recordInTransaction(
        transaction,
        {
          organizationId,
          actorUserId: userId,
          action: "wallet.campaign_canceled",
          targetType: "wallet_engagement_campaign",
          targetId: campaignId,
          metadata: { programId },
        },
        request,
      );
      return { id: campaignId, status: "CANCELED" as const };
    });
    return canceled;
  }

  async customerConsent(request: WafloRequest, developmentOverride?: string) {
    const context = await this.customerCards.requireSession(request, developmentOverride);
    const membership = context.session.membership;
    const consent = await this.prisma.client.customerConsent.findFirst({
      where: { membershipId: membership.id, consentType: "WALLET_PROMOTIONS" },
      orderBy: [{ capturedAt: "desc" }, { id: "desc" }],
    });
    return {
      scope: "WALLET_PROMOTIONS" as const,
      granted: consent?.granted === true && consent.revokedAt === null,
      grantedAt: consent?.granted && consent.revokedAt === null ? consent.capturedAt : null,
      revokedAt: consent?.revokedAt ?? null,
      noticeVersion: consent?.documentFingerprint ?? null,
      legalReviewRequired: true,
      requiredForLoyalty: false,
      prechecked: false,
    };
  }

  async setCustomerConsent(
    request: WafloRequest,
    input: WalletPromotionConsentInput,
    developmentOverride?: string,
  ) {
    const context = await this.customerCards.requireSession(request, developmentOverride);
    const membership = context.session.membership;
    const now = new Date();
    const consent = await this.prisma.client.$transaction(async (transaction) => {
      const created = await transaction.customerConsent.create({
        data: {
          organizationId: membership.organizationId,
          customerId: membership.customerId,
          membershipId: membership.id,
          consentType: "WALLET_PROMOTIONS",
          granted: input.granted,
          documentFingerprint: input.noticeVersion,
          locale: input.locale,
          capturedAt: now,
          revokedAt: input.granted ? null : now,
          safeMetadata: {
            source: "CUSTOMER_WEB_CARD_SETTINGS",
            separatelyPresented: true,
            prechecked: false,
          },
        },
      });
      await this.audit.recordInTransaction(
        transaction,
        {
          organizationId: membership.organizationId,
          action: input.granted
            ? "customer.wallet_promotions_opted_in"
            : "customer.wallet_promotions_opted_out",
          targetType: "membership",
          targetId: membership.id,
          metadata: { consentId: created.id, noticeVersion: input.noticeVersion },
        },
        request,
      );
      return created;
    });
    return {
      scope: "WALLET_PROMOTIONS" as const,
      granted: consent.granted,
      grantedAt: consent.granted ? consent.capturedAt : null,
      revokedAt: consent.revokedAt,
      noticeVersion: consent.documentFingerprint,
    };
  }
}
