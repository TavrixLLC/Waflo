import { createHash } from "node:crypto";
import { HttpStatus, Injectable } from "@nestjs/common";
import {
  type WalletCampaignCreateInput,
  type WalletNearbyUpdateInput,
  walletCampaignProviders,
} from "@waflo/contracts";
import {
  APPLE_NEARBY_DESIRED_MAX_DISTANCE_METERS,
  resolveWalletNearbyText,
} from "@waflo/wallet-core";
import { AuditService } from "../audit/audit.service.js";
import { AppError } from "../common/app-error.js";
import { withInvariantLock } from "../common/organization-transaction.js";
import type { WafloRequest } from "../common/request-context.js";
import { EnvironmentService } from "../config/environment.service.js";
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

export function normalizeWalletCampaignDestination(input: {
  destinationUrl: string;
  configuredWafloUrls: readonly string[];
  merchantHostnames: readonly string[];
  allowLocal: boolean;
}): string {
  let url: URL;
  try {
    url = new URL(input.destinationUrl);
  } catch {
    throw new AppError(
      "WALLET_CAMPAIGN_URL_INVALID",
      "Use a valid merchant or Waflo destination URL.",
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  const hostname = url.hostname.toLocaleLowerCase("en-US");
  const local = ["localhost", "127.0.0.1"].includes(hostname);
  const configuredWafloHosts = new Set(
    input.configuredWafloUrls.map((value) => new URL(value).hostname.toLocaleLowerCase("en-US")),
  );
  const allowed =
    configuredWafloHosts.has(hostname) ||
    input.merchantHostnames.some(
      (merchantHostname) => merchantHostname.toLocaleLowerCase("en-US") === hostname,
    ) ||
    (input.allowLocal && local);
  const allowedProtocol =
    url.protocol === "https:" || (input.allowLocal && local && url.protocol === "http:");
  if (!allowedProtocol || url.username || url.password || !allowed) {
    throw new AppError(
      "WALLET_CAMPAIGN_URL_NOT_ALLOWED",
      "The destination must use HTTPS and belong to this merchant or Waflo.",
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  url.hash = "";
  return url.toString();
}

@Injectable()
export class WalletEngagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenants: TenantService,
    private readonly audit: AuditService,
    private readonly providers: WalletProviderRegistry,
    private readonly environment: EnvironmentService,
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
        organization: {
          include: {
            walletNearbyConfiguration: {
              include: {
                locations: { include: { location: true }, orderBy: { sortOrder: "asc" } },
              },
            },
            locations: { where: { status: "ACTIVE" }, orderBy: { createdAt: "asc" } },
          },
        },
        currentPublishedVersion: {
          include: {
            translations: true,
            locations: { include: { location: true }, orderBy: { createdAt: "asc" } },
          },
        },
        walletNearbyProgramCopy: true,
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
          manualPromotion: configured ? "AVAILABLE" : "NOT_CONFIGURED",
          nearbyRelevance: configured ? "AVAILABLE" : "NOT_CONFIGURED",
          customNearbyText: true,
          providerControlsNearbyText: false,
          selectableForManualPromotion: configured,
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

  async notificationPrograms(userId: string, organizationId: string) {
    await this.tenants.requireMembership(userId, organizationId, "programs.engagement_manage");
    const programs = await this.prisma.client.loyaltyProgram.findMany({
      where: { organizationId, status: "PUBLISHED", currentPublishedVersionId: { not: null } },
      select: { id: true, internalName: true, publicSlug: true, status: true },
      orderBy: { internalName: "asc" },
    });
    return { items: programs.map((program) => ({ ...program, notificationCapable: true })) };
  }

  async notificationBranches(userId: string, organizationId: string, programId: string) {
    const program = await this.program(userId, organizationId, programId, true);
    const participating = new Set(
      program.currentPublishedVersion?.locations.map((item) => item.locationId),
    );
    return {
      items: program.organization.locations
        .filter((location) => participating.has(location.id))
        .map((location) => ({ id: location.id, name: location.name, city: location.city })),
      semantics: "RECORDED_LEDGER_EVENT_AT_BRANCH" as const,
    };
  }

  async getMerchantView(userId: string, organizationId: string, programId: string) {
    const program = await this.program(userId, organizationId, programId);
    const configuration = program.organization.walletNearbyConfiguration;
    const programCopy = program.walletNearbyProgramCopy;
    const published = program.currentPublishedVersion;
    const templateCode = published?.baseTemplateCode ?? null;
    const previewEn = resolveWalletNearbyText({
      templateCode,
      businessCategory: program.organization.businessCategory,
      merchantName: program.organization.name,
      locale: "en",
      customText: programCopy?.appleCustomTextEn,
    });
    const previewAr = resolveWalletNearbyText({
      templateCode,
      businessCategory: program.organization.businessCategory,
      merchantName: program.organization.name,
      locale: "ar",
      customText: programCopy?.appleCustomTextAr,
    });
    const publishedLocationIds = new Set(
      (published?.locations ?? []).map(({ locationId }) => locationId),
    );
    const eligibleLocations = program.organization.locations.map((location) => ({
      id: location.id,
      name: location.name,
      city: location.city,
      latitude: location.latitude === null ? null : Number(location.latitude),
      longitude: location.longitude === null ? null : Number(location.longitude),
      coordinatesConfigured: location.latitude !== null && location.longitude !== null,
      participatesInThisCard: publishedLocationIds.has(location.id),
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
        scope: "ORGANIZATION" as const,
        enabled: configuration?.enabled ?? false,
        revision: configuration?.revision ?? 1,
        locationIds: configuration?.locations.map((item) => item.locationId) ?? [],
        desiredAppleMaxDistanceMeters: APPLE_NEARBY_DESIRED_MAX_DISTANCE_METERS,
        appleCustomTextEn: programCopy?.appleCustomTextEn ?? null,
        appleCustomTextAr: programCopy?.appleCustomTextAr ?? null,
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
        policy:
          "Nearby is a business-wide Wallet policy. Participating locations apply to each published Loyalty Card where that location participates.",
        delivery:
          "Apple, Google, and the customer's device settings control whether and when a card is surfaced.",
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
    const locations = program.organization.locations.filter((location) =>
      input.locationIds.includes(location.id),
    );
    if (locations.length !== input.locationIds.length) {
      throw new AppError(
        "WALLET_NEARBY_LOCATION_INVALID",
        "Choose active business locations owned by this organization.",
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
      `wallet-nearby:${organizationId}`,
      async (transaction) => {
        const current = await transaction.walletNearbyConfiguration.findUnique({
          where: { organizationId },
          include: { locations: { orderBy: { sortOrder: "asc" } } },
        });
        const currentProgramCopy = await transaction.walletNearbyProgramCopy.findUnique({
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
                updatedByUserId: userId,
                revision,
                locations: { deleteMany: {} },
              },
            })
          : await transaction.walletNearbyConfiguration.create({
              data: {
                organizationId,
                enabled: input.enabled,
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
        const programCopy = await transaction.walletNearbyProgramCopy.upsert({
          where: { programId },
          create: {
            organizationId,
            programId,
            appleCustomTextEn: input.appleCustomTextEn ?? null,
            appleCustomTextAr: input.appleCustomTextAr ?? null,
            updatedByUserId: userId,
          },
          update: {
            appleCustomTextEn: input.appleCustomTextEn ?? null,
            appleCustomTextAr: input.appleCustomTextAr ?? null,
            updatedByUserId: userId,
          },
        });
        const previousLocationIds = current?.locations.map((item) => item.locationId) ?? [];
        const policyChanged =
          (current?.enabled ?? false) !== input.enabled ||
          JSON.stringify(previousLocationIds) !== JSON.stringify(input.locationIds);
        const copyChanged =
          (currentProgramCopy?.appleCustomTextEn ?? null) !== (input.appleCustomTextEn ?? null) ||
          (currentProgramCopy?.appleCustomTextAr ?? null) !== (input.appleCustomTextAr ?? null);
        const affectedPrograms = policyChanged
          ? await transaction.loyaltyProgram.findMany({
              where: {
                organizationId,
                OR: [
                  { walletBindings: { some: {} } },
                  { memberships: { some: { walletPassInstances: { some: {} } } } },
                ],
              },
              select: { id: true },
            })
          : [{ id: programId }];
        for (const affectedProgram of affectedPrograms) {
          await transaction.programWalletSyncJob.create({
            data: {
              organizationId,
              programId: affectedProgram.id,
              action: "update",
              reason: "NEARBY_RELEVANCE_CHANGED",
              commandType: "UPDATE",
              idempotencyKey: `program-wallet-nearby-sync:${affectedProgram.id}:r${revision}:source:${programId}`,
              batchSize: 500,
            },
          });
        }
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
              scope: "ORGANIZATION",
              locationIds: input.locationIds,
              appleCustomTextChanged: copyChanged,
              affectedProgramIds: affectedPrograms.map((item) => item.id),
              revision,
            },
          },
          request,
        );
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
        if (copyChanged) {
          await this.audit.recordInTransaction(
            transaction,
            {
              organizationId,
              actorUserId: userId,
              action: "wallet.apple_nearby_text_changed",
              targetType: "wallet_nearby_program_copy",
              targetId: programCopy.id,
              metadata: {
                programId,
                localizedValuesChanged: [
                  ...((currentProgramCopy?.appleCustomTextEn ?? null) !==
                  (input.appleCustomTextEn ?? null)
                    ? ["EN"]
                    : []),
                  ...((currentProgramCopy?.appleCustomTextAr ?? null) !==
                  (input.appleCustomTextAr ?? null)
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

  private async eligiblePasses(
    organizationId: string,
    programId: string,
    branchId?: string | null,
  ) {
    return this.prisma.client.$queryRaw<
      Array<{
        id: string;
        membershipId: string;
        provider: "APPLE" | "GOOGLE";
        providerState: unknown;
        lastProviderSyncAt: Date | null;
        lastProviderErrorCode: string | null;
        activeAppleRegistrations: bigint;
      }>
    >`
      SELECT
        pass."id",
        pass."membership_id" AS "membershipId",
        pass."provider"::text AS "provider",
        pass."provider_state" AS "providerState",
        pass."last_provider_sync_at" AS "lastProviderSyncAt",
        pass."last_provider_error_code" AS "lastProviderErrorCode",
        COUNT(registration."id")::bigint AS "activeAppleRegistrations"
      FROM "wallet_pass_instances" AS pass
      INNER JOIN "membership_credentials" AS credential
        ON credential."id" = pass."membership_credential_id"
      INNER JOIN "memberships" AS membership
        ON membership."id" = pass."membership_id"
      INNER JOIN "customers" AS customer
        ON customer."id" = membership."customer_id"
      LEFT JOIN "apple_pass_registrations" AS registration
        ON registration."wallet_pass_instance_id" = pass."id"
        AND registration."unregistered_at" IS NULL
      WHERE pass."organization_id" = CAST(${organizationId} AS UUID)
        AND membership."organization_id" = CAST(${organizationId} AS UUID)
        AND customer."organization_id" = CAST(${organizationId} AS UUID)
        AND credential."organization_id" = CAST(${organizationId} AS UUID)
        AND membership."program_id" = CAST(${programId} AS UUID)
        AND pass."provider" IN ('APPLE', 'GOOGLE')
        AND pass."status" IN ('ISSUED', 'ACTIVE')
        AND credential."status" = 'ACTIVE'
        AND membership."status" = 'ACTIVE'
        AND customer."status" = 'ACTIVE'
        AND (
          ${branchId ?? null}::uuid IS NULL OR EXISTS (
            SELECT 1
            FROM "loyalty_ledger_entries" AS ledger
            WHERE ledger."membership_id" = membership."id"
              AND ledger."organization_id" = CAST(${organizationId} AS UUID)
              AND ledger."location_id" = CAST(${branchId ?? null} AS UUID)
          )
        )
      GROUP BY pass."id"
      ORDER BY pass."id" ASC
      LIMIT ${MAX_CAMPAIGN_ELIGIBLE_PASSES + 1}
    `;
  }

  private googleEligibility(candidate: {
    providerState: unknown;
    lastProviderSyncAt: Date | null;
    lastProviderErrorCode: string | null;
  }) {
    const state =
      candidate.providerState && typeof candidate.providerState === "object"
        ? (candidate.providerState as Record<string, unknown>)
        : {};
    const checkedAt = typeof state.checkedAt === "string" ? Date.parse(state.checkedAt) : NaN;
    const fresh = Number.isFinite(checkedAt) && checkedAt >= Date.now() - 5 * 60_000;
    if (fresh && state.hasUsers === true) return "READY" as const;
    if (fresh && state.hasUsers === false) return "NO_RECIPIENTS" as const;
    if (candidate.lastProviderErrorCode && candidate.lastProviderSyncAt) {
      return "PROVIDER_UNAVAILABLE" as const;
    }
    return "CHECKING" as const;
  }

  private async queueGoogleEligibilityReconciliation(
    organizationId: string,
    candidates: Awaited<ReturnType<typeof this.eligiblePasses>>,
  ) {
    const bucket = Math.floor(Date.now() / (5 * 60_000));
    const stale = candidates.filter(
      (candidate) =>
        candidate.provider === "GOOGLE" && this.googleEligibility(candidate) === "CHECKING",
    );
    await Promise.all(
      stale.slice(0, 50).map((candidate) => {
        const idempotencyKey = `wallet:google:eligibility:${candidate.id}:${bucket}`;
        return this.prisma.client.walletCommand.upsert({
          where: { idempotencyKey },
          create: {
            organizationId,
            membershipId: candidate.membershipId,
            walletPassInstanceId: candidate.id,
            provider: "GOOGLE",
            commandType: "RECONCILE",
            idempotencyKey,
            payloadFingerprint: fingerprint({ candidate: candidate.id, bucket }),
            safePayload: { eligibilityReconciliation: true },
          },
          update: {},
        });
      }),
    );
  }

  async audienceEstimate(
    userId: string,
    organizationId: string,
    programId: string,
    branchId?: string | null,
  ) {
    await this.program(userId, organizationId, programId);
    const eligible = await this.eligiblePasses(organizationId, programId, branchId);
    await this.queueGoogleEligibilityReconciliation(organizationId, eligible);
    const googleConfigured = this.capability("GOOGLE").configured;
    const appleConfigured = this.capability("APPLE").configured;
    const google = eligible.filter((item) => item.provider === "GOOGLE");
    const apple = eligible.filter((item) => item.provider === "APPLE");
    const googleReady = google.filter((item) => this.googleEligibility(item) === "READY").length;
    const googleChecking = google.filter(
      (item) => this.googleEligibility(item) === "CHECKING",
    ).length;
    const googleUnavailable = google.some(
      (item) => this.googleEligibility(item) === "PROVIDER_UNAVAILABLE",
    );
    const applePasses = apple.filter((item) => item.activeAppleRegistrations > 0n);
    const appleDevices = applePasses.reduce(
      (sum, item) => sum + Number(item.activeAppleRegistrations),
      0,
    );
    return {
      audienceRule: "ALL_ELIGIBLE_WALLET_HOLDERS" as const,
      branchId: branchId ?? null,
      // A zero is reserved for a positively verified empty audience. While a
      // Google object is stale or the provider is unavailable, clients get a
      // machine-readable provider state and an unknown total instead.
      total: googleChecking > 0 || googleUnavailable ? null : googleReady + applePasses.length,
      providers: {
        apple: {
          status: !appleConfigured
            ? "MISCONFIGURED"
            : applePasses.length > 0
              ? "READY"
              : "NO_RECIPIENTS",
          eligiblePasses: applePasses.length,
          registeredDevices: appleDevices,
        },
        google: {
          status: !googleConfigured
            ? "MISCONFIGURED"
            : googleUnavailable
              ? "PROVIDER_UNAVAILABLE"
              : googleChecking > 0
                ? "CHECKING"
                : googleReady > 0
                  ? "READY"
                  : "NO_RECIPIENTS",
          eligibleObjects: googleReady,
          checking: googleChecking,
        },
      },
      capped: eligible.length > MAX_CAMPAIGN_ELIGIBLE_PASSES,
      exclusions: ["INACTIVE_MEMBERSHIP", "NO_SAVED_GOOGLE_PASS", "NO_APPLE_DEVICE_REGISTRATION"],
    };
  }

  private async validateDestinationUrl(
    organizationId: string,
    destinationUrl: string | null | undefined,
  ): Promise<string | null> {
    if (!destinationUrl) return null;
    const allowedDomains = await this.prisma.client.organizationDomain.findMany({
      where: { organizationId, status: "ACTIVE" },
      select: { hostname: true },
    });
    return normalizeWalletCampaignDestination({
      destinationUrl,
      configuredWafloUrls: [
        this.environment.values.MARKETING_WEB_URL,
        this.environment.values.MERCHANT_DASHBOARD_URL,
        this.environment.values.CUSTOMER_WEB_URL,
        this.environment.values.API_PUBLIC_URL,
      ],
      merchantHostnames: allowedDomains.map((domain) => domain.hostname),
      allowLocal: process.env.NODE_ENV !== "production",
    });
  }

  async createCampaign(
    userId: string,
    organizationId: string,
    programId: string,
    input: WalletCampaignCreateInput,
    request: WafloRequest,
  ) {
    const program = await this.program(userId, organizationId, programId, true);
    // Provider selection is deliberately absent from the merchant workflow.
    // Normalize here as well as at the HTTP contract boundary so internal
    // callers and legacy payloads cannot create a one-provider campaign.
    const providers = [...walletCampaignProviders];
    if (providers.some((provider) => !this.capability(provider).selectableForManualPromotion)) {
      throw new AppError(
        "WALLET_PROVIDER_MISCONFIGURED",
        "A selected Wallet provider is not configured for notifications.",
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
    if (input.branchId) {
      const branch = program.organization.locations.find(
        (location) => location.id === input.branchId,
      );
      const publishedAtBranch =
        program.currentPublishedVersion?.locations.some(
          (location) => location.locationId === input.branchId,
        ) === true;
      if (!branch || !publishedAtBranch) {
        throw new AppError(
          "BRANCH_OUT_OF_SCOPE",
          "This branch is not available for the selected Loyalty Card.",
          HttpStatus.NOT_FOUND,
        );
      }
    }
    const eligible = await this.eligiblePasses(organizationId, programId, input.branchId);
    const googleCandidates = eligible.filter((candidate) => candidate.provider === "GOOGLE");
    const appleCandidates = eligible.filter(
      (candidate) => candidate.provider === "APPLE" && candidate.activeAppleRegistrations > 0n,
    );
    const googleEligible = googleCandidates.filter(
      (candidate) => this.googleEligibility(candidate) === "READY",
    );
    const googleUnknown = googleCandidates.filter((candidate) => {
      const state = this.googleEligibility(candidate);
      return state === "CHECKING" || state === "PROVIDER_UNAVAILABLE";
    });
    await this.queueGoogleEligibilityReconciliation(organizationId, eligible);
    if (providers.includes("GOOGLE") && googleUnknown.length > 0) {
      throw new AppError(
        "WALLET_PROVIDER_UNAVAILABLE",
        "Google Wallet saved-pass state is still being verified. Try again shortly.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const scopedEligible = [
      ...(providers.includes("APPLE") ? appleCandidates : []),
      ...(providers.includes("GOOGLE") ? googleEligible : []),
    ];
    if (scopedEligible.length === 0) {
      throw new AppError(
        "WALLET_NOTIFICATION_NO_RECIPIENTS",
        "No saved Wallet passes are eligible for the selected scope.",
        HttpStatus.CONFLICT,
      );
    }
    if (scopedEligible.length > MAX_CAMPAIGN_ELIGIBLE_PASSES) {
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
      providers,
      branchId: input.branchId ?? null,
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
            ...(input.branchId ? { branchId: input.branchId } : {}),
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
            intendedProviders: providers,
            audienceRule: input.audienceRule,
            contentFingerprint,
            idempotencyKey: input.idempotencyKey,
            eligibleCount: scopedEligible.length,
            appleEligiblePassCount: providers.includes("APPLE") ? appleCandidates.length : 0,
            appleRegisteredDeviceCount: providers.includes("APPLE")
              ? appleCandidates.reduce(
                  (sum, candidate) => sum + Number(candidate.activeAppleRegistrations),
                  0,
                )
              : 0,
            googleEligibleObjectCount: providers.includes("GOOGLE") ? googleEligible.length : 0,
            unknownCount: providers.includes("GOOGLE") ? googleUnknown.length : 0,
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
              providers,
              audienceRule: input.audienceRule,
              eligibleCount: scopedEligible.length,
              branchId: input.branchId ?? null,
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
        branchId: campaign.branchId,
        providers: intendedProviders(campaign.intendedProviders),
        audienceRule: campaign.audienceRule,
        status: campaign.status,
        counts: {
          eligible: campaign.eligibleCount,
          appleEligiblePasses: campaign.appleEligiblePassCount,
          appleRegisteredDevices: campaign.appleRegisteredDeviceCount,
          googleEligibleObjects: campaign.googleEligibleObjectCount,
          queued: campaign.queuedCount,
          succeeded: campaign.succeededCount,
          skipped: campaign.skippedCount,
          failed: campaign.failedCount,
          throttled: campaign.throttledCount,
          unknown: campaign.unknownCount,
        },
        creator: campaign.createdBy.displayName,
      })),
    };
  }

  async campaignDetail(userId: string, organizationId: string, campaignId: string) {
    await this.tenants.requireMembership(userId, organizationId, "programs.engagement_manage");
    const campaign = await this.prisma.client.walletEngagementCampaign.findFirst({
      where: { id: campaignId, organizationId },
      include: {
        deliveries: {
          select: {
            provider: true,
            status: true,
            safeSkipCode: true,
            safeFailureCode: true,
            completedAt: true,
          },
          orderBy: { createdAt: "asc" },
          take: 200,
        },
      },
    });
    if (!campaign)
      throw new AppError("CAMPAIGN_NOT_FOUND", "Wallet campaign not found.", HttpStatus.NOT_FOUND);
    return {
      id: campaign.id,
      status: campaign.status,
      programId: campaign.programId,
      branchId: campaign.branchId,
      providers: intendedProviders(campaign.intendedProviders),
      counts: {
        eligible: campaign.eligibleCount,
        appleEligiblePasses: campaign.appleEligiblePassCount,
        appleRegisteredDevices: campaign.appleRegisteredDeviceCount,
        googleEligibleObjects: campaign.googleEligibleObjectCount,
        queued: campaign.queuedCount,
        succeeded: campaign.succeededCount,
        skipped: campaign.skippedCount,
        failed: campaign.failedCount,
        throttled: campaign.throttledCount,
        unknown: campaign.unknownCount,
      },
      deliveries: campaign.deliveries,
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
}
