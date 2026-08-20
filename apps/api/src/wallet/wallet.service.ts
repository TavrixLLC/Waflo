import { createHash } from "node:crypto";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@waflo/database";
import type {
  WalletMembershipInput,
  WalletProgramInput,
  WalletProviderCode,
} from "@waflo/wallet-core";
import { resolveCardLocale } from "@waflo/contracts";
import {
  APPLE_NEARBY_DESIRED_MAX_DISTANCE_METERS,
  resolveWalletNearbyText,
} from "@waflo/wallet-core";
import { AuditService } from "../audit/audit.service.js";
import { AppError } from "../common/app-error.js";
import { withProgramLifecycleInvariantLock } from "../common/organization-transaction.js";
import type { WafloRequest } from "../common/request-context.js";
import { CustomerCardService } from "../customer/customer-card.service.js";
import { CustomerSecurityService } from "../customer/customer-security.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { OBJECT_STORAGE, type ObjectStorage } from "../programs/object-storage.js";
import {
  publishedVisualThemeInclude,
  renderPublishedStampArtwork,
} from "../programs/published-stamp-render.js";
import { TenantService } from "../tenancy/tenant.service.js";
import { WalletProviderRegistry } from "./wallet-provider.registry.js";

const walletPassInclude = {
  walletProgramBinding: true,
  membershipCredential: true,
  membership: {
    include: {
      organization: {
        include: {
          walletNearbyConfiguration: {
            include: {
              locations: { include: { location: true }, orderBy: { sortOrder: "asc" } },
            },
          },
        },
      },
      customer: true,
      program: { include: { walletNearbyProgramCopy: true } },
      progress: true,
      enrollmentProgramVersion: {
        include: {
          translations: true,
          cardLocales: {
            where: { enabled: true },
            orderBy: [{ position: "asc" }, { locale: "asc" }],
          },
          stampRule: true,
          locations: { select: { locationId: true } },
          visualTheme: publishedVisualThemeInclude,
        },
      },
    },
  },
} satisfies Prisma.WalletPassInstanceInclude;

@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: WalletProviderRegistry,
    private readonly security: CustomerSecurityService,
    private readonly cards: CustomerCardService,
    private readonly tenant: TenantService,
    private readonly audit: AuditService,
    @Inject(OBJECT_STORAGE) private readonly objectStorage: ObjectStorage,
  ) {}

  async providerHealth(userId: string, organizationId: string, request: WafloRequest) {
    await this.tenant.requireMembership(userId, organizationId, "programs.view");
    const health = await Promise.all(this.registry.all().map((provider) => provider.healthCheck()));
    await Promise.allSettled(
      health
        .filter((provider) => !["HEALTHY", "NOT_CONFIGURED"].includes(provider.status))
        .map((provider) =>
          this.audit.record(
            {
              organizationId,
              actorUserId: userId,
              action: "wallet.provider_health_degraded",
              targetType: "wallet_provider",
              targetId: provider.provider,
              metadata: {
                mode: provider.mode,
                status: provider.status,
                configured: provider.configured ?? false,
                providerReachable: provider.providerReachable ?? false,
                externallyCertified: provider.externallyCertified ?? false,
              },
            },
            request,
          ),
        ),
    );
    return health;
  }

  async programStatus(userId: string, organizationId: string, programId: string) {
    await this.tenant.requireMembership(userId, organizationId, "programs.view");
    const program = await this.prisma.client.loyaltyProgram.findFirst({
      where: { id: programId, organizationId },
      include: {
        walletBindings: { orderBy: { provider: "asc" } },
        memberships: {
          select: { id: true },
          take: 1,
        },
      },
    });
    if (!program)
      throw new AppError("PROGRAM_NOT_FOUND", "Program not found.", HttpStatus.NOT_FOUND);
    const [commands, passes] = await Promise.all([
      this.prisma.client.walletCommand.groupBy({
        by: ["provider", "status"],
        where: { organizationId, membership: { programId } },
        _count: { _all: true },
      }),
      this.prisma.client.walletPassInstance.groupBy({
        by: ["provider", "status"],
        where: { organizationId, membership: { programId } },
        _count: { _all: true },
      }),
    ]);
    return {
      programId,
      bindings: program.walletBindings.map((binding) => ({
        provider: binding.provider,
        status: binding.status,
        lastSyncedAt: binding.lastSyncedAt,
        configurationFingerprint: binding.configurationFingerprint,
      })),
      commands: commands.map((item) => ({
        provider: item.provider,
        status: item.status,
        count: item._count._all,
      })),
      passes: passes.map((item) => ({
        provider: item.provider,
        status: item.status,
        count: item._count._all,
      })),
    };
  }

  async reconcile(
    userId: string,
    organizationId: string,
    programId: string,
    request: WafloRequest,
  ) {
    await this.tenant.requireMembership(userId, organizationId, "programs.manage_state");
    const job = await withProgramLifecycleInvariantLock(
      this.prisma.client,
      organizationId,
      programId,
      async (transaction) => {
        const program = await transaction.loyaltyProgram.findFirst({
          where: { id: programId, organizationId },
          select: { id: true },
        });
        if (!program) {
          throw new AppError("PROGRAM_NOT_FOUND", "Program not found.", HttpStatus.NOT_FOUND);
        }
        const compatible = await transaction.programWalletSyncJob.findFirst({
          where: {
            organizationId,
            programId,
            action: "reconcile",
            status: { in: ["PENDING", "PROCESSING", "FAILED"] },
          },
          orderBy: { createdAt: "desc" },
        });
        if (compatible) return compatible;
        const runNumber =
          (await transaction.programWalletSyncJob.count({
            where: { organizationId, programId, action: "reconcile" },
          })) + 1;
        const idempotencyKey = `program-wallet-reconcile:${programId}:run${runNumber}`;
        const created = await transaction.programWalletSyncJob.upsert({
          where: { idempotencyKey },
          create: {
            organizationId,
            programId,
            action: "reconcile",
            reason: "RECONCILIATION",
            commandType: "RECONCILE",
            idempotencyKey,
            batchSize: 500,
          },
          update: {},
        });
        await this.audit.recordInTransaction(
          transaction,
          {
            organizationId,
            actorUserId: userId,
            action: "wallet.program_reconciliation_job_created",
            targetType: "program_wallet_sync_job",
            targetId: created.id,
            metadata: { programId, runNumber },
          },
          request,
        );
        return created;
      },
    );
    return this.safeSyncJob(job);
  }

  async reconciliationStatus(
    userId: string,
    organizationId: string,
    programId: string,
    jobId: string,
  ) {
    await this.tenant.requireMembership(userId, organizationId, "programs.view");
    const job = await this.prisma.client.programWalletSyncJob.findFirst({
      where: { id: jobId, organizationId, programId },
    });
    if (!job) {
      throw new AppError(
        "PROGRAM_WALLET_SYNC_JOB_NOT_FOUND",
        "Wallet synchronization job not found.",
        HttpStatus.NOT_FOUND,
      );
    }
    return this.safeSyncJob(job);
  }

  private safeSyncJob(job: {
    id: string;
    status: string;
    processedCount: number;
    safeErrorCode: string | null;
  }) {
    return {
      jobId: job.id,
      status: job.status,
      processedCount: job.processedCount,
      safeErrorCode: job.safeErrorCode,
    };
  }

  async customerApplePass(request: WafloRequest, developmentOverride?: string): Promise<Buffer> {
    const session = await this.cards.requireSession(request, developmentOverride);
    if (session.session.membershipCredential?.status !== "ACTIVE") {
      throw new AppError(
        "APPLE_PASS_UNAVAILABLE",
        "Apple Wallet is unavailable for this card.",
        HttpStatus.CONFLICT,
      );
    }
    const membershipCredentialId = session.session.membershipCredential.id;
    const pass = await this.prisma.client.walletPassInstance.findFirst({
      where: {
        membershipId: session.session.membershipId,
        membershipCredentialId,
        provider: "APPLE",
        status: { in: ["ISSUED", "ACTIVE"] },
      },
      include: walletPassInclude,
    });
    if (!pass) {
      throw new AppError(
        "APPLE_PASS_PREPARING",
        "The Apple Wallet pass is not ready yet.",
        HttpStatus.CONFLICT,
      );
    }
    const result = await this.registry.get("APPLE").issueMembershipPass(await this.mapPass(pass));
    if (!result.artifact) {
      throw new AppError(
        "APPLE_PASS_SIGNING_FAILED",
        "The Apple Wallet pass could not be generated.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return Buffer.from(result.artifact);
  }

  async customerGoogleAction(request: WafloRequest, developmentOverride?: string) {
    const session = await this.cards.requireSession(request, developmentOverride);
    if (session.session.membershipCredential?.status !== "ACTIVE") {
      throw new AppError(
        "GOOGLE_WALLET_UNAVAILABLE",
        "Google Wallet is unavailable for this card.",
        HttpStatus.CONFLICT,
      );
    }
    const membershipCredentialId = session.session.membershipCredential.id;
    const pass = await this.prisma.client.walletPassInstance.findFirst({
      where: {
        membershipId: session.session.membershipId,
        membershipCredentialId,
        provider: "GOOGLE",
        status: { in: ["ISSUED", "ACTIVE"] },
      },
      include: walletPassInclude,
    });
    if (!pass) {
      throw new AppError(
        "GOOGLE_WALLET_PREPARING",
        "The Google Wallet object is not ready yet.",
        HttpStatus.CONFLICT,
      );
    }
    return this.registry.get("GOOGLE").createAddToWalletAction(await this.mapPass(pass));
  }

  async passByIdentity(provider: WalletProviderCode, identity: string) {
    const pass = await this.prisma.client.walletPassInstance.findUnique({
      where: { provider_providerIdentity: { provider, providerIdentity: identity } },
      include: walletPassInclude,
    });
    return pass ? { record: pass, input: await this.mapPass(pass) } : null;
  }

  async mapPass(
    pass: Prisma.WalletPassInstanceGetPayload<{ include: typeof walletPassInclude }>,
  ): Promise<WalletMembershipInput> {
    const membership = pass.membership;
    const version = membership.enrollmentProgramVersion;
    const nearbyLocale = membership.customer.preferredLocale === "AR" ? "ar" : "en";
    const localizedContent = version.cardLocales.length
      ? version.cardLocales.map((item) => ({
          locale: item.locale,
          programName: item.programName ?? membership.program.internalName,
          description: item.shortDescription ?? "",
          rewardSummary: item.rewardSummary ?? "",
        }))
      : version.translations.map((item) => ({
          locale: item.locale === "AR" ? "ar" : "en",
          programName: item.programName,
          description: item.shortDescription,
          rewardSummary: item.rewardSummary,
        }));
    const enabledLocales = localizedContent.map((item) => item.locale);
    const defaultLocale = enabledLocales.includes(version.defaultCardLocale)
      ? version.defaultCardLocale
      : (enabledLocales[0] ?? "en");
    const locale = resolveCardLocale({
      enabledLocales,
      defaultLocale,
      explicitLocale: nearbyLocale,
    });
    const translation =
      localizedContent.find((item) => item.locale === locale) ?? localizedContent[0];
    const goal = version.stampRule?.requiredStampCount ?? 8;
    const progress = membership.progress?.currentCycleStampCount ?? 0;
    if (!version.visualTheme) throw new Error("Published Wallet stamp artwork is unavailable.");
    const stampRender = await renderPublishedStampArtwork({
      storage: this.objectStorage,
      organizationId: membership.organizationId,
      programId: membership.programId,
      programVersionId: version.id,
      membershipId: membership.id,
      locale,
      requiredStampCount: goal,
      currentStampCount: progress,
      rewardReady: membership.progress?.rewardReady ?? false,
      theme: version.visualTheme,
      outputProfile: pass.provider === "APPLE" ? "APPLE_WALLET" : "GOOGLE_WALLET",
    });
    const programInput: WalletProgramInput = {
      organizationId: membership.organizationId,
      organizationName: membership.organization.name,
      programId: membership.programId,
      programVersionId: version.id,
      programName: translation?.programName ?? membership.program.internalName,
      description: translation?.description ?? "",
      rewardSummary: translation?.rewardSummary ?? "",
      backgroundColor: version.visualTheme?.backgroundColor ?? "#F7F4EE",
      foregroundColor: version.visualTheme?.foregroundColor ?? "#241916",
      configurationFingerprint:
        pass.walletProgramBinding?.configurationFingerprint ??
        version.renderFingerprint ??
        createHash("sha256").update(version.id).digest("hex"),
      locale,
      defaultLocale,
      localizedContent,
      nearbyRelevance: walletNearbyRelevance({
        enabled: membership.organization.walletNearbyConfiguration?.enabled ?? false,
        locations: membership.organization.walletNearbyConfiguration?.locations ?? [],
        allowedLocationIds: new Set(version.locations.map((item) => item.locationId)),
        templateCode: version.baseTemplateCode,
        businessCategory: membership.organization.businessCategory,
        merchantName: membership.organization.name,
        locale: nearbyLocale,
        customText:
          nearbyLocale === "ar"
            ? membership.program.walletNearbyProgramCopy?.appleCustomTextAr
            : membership.program.walletNearbyProgramCopy?.appleCustomTextEn,
      }),
    };
    return {
      ...programInput,
      walletPassInstanceId: pass.id,
      providerIdentity: pass.providerIdentity,
      publicMembershipId: membership.publicMembershipId,
      displayName: membership.customer.displayName,
      credentialPayload: this.security.payloadForCredential(pass.membershipCredential),
      currentStampCount: progress,
      requiredStampCount: goal,
      rewardReady: membership.progress?.rewardReady ?? false,
      membershipStatus: membership.status,
      programStatus: membership.program.status,
      transferred: pass.membershipCredential.status === "TRANSFERRED",
      stampRenderInput: stampRender.renderInput,
    };
  }
}

function walletNearbyRelevance(input: {
  enabled: boolean;
  allowedLocationIds: ReadonlySet<string>;
  locations: ReadonlyArray<{
    location: {
      id: string;
      name: string;
      status: "ACTIVE" | "ARCHIVED";
      latitude: unknown;
      longitude: unknown;
    };
  }>;
  templateCode?: string | null | undefined;
  businessCategory?: string | null | undefined;
  merchantName: string;
  locale: "en" | "ar";
  customText?: string | null | undefined;
}) {
  const locations = input.locations
    .filter(
      ({ location }) =>
        input.allowedLocationIds.has(location.id) &&
        location.status === "ACTIVE" &&
        location.latitude !== null &&
        location.longitude !== null,
    )
    .slice(0, 10)
    .map(({ location }) => ({
      locationId: location.id,
      displayName: location.name,
      latitude: Number(location.latitude),
      longitude: Number(location.longitude),
      relevantText: resolveWalletNearbyText({
        templateCode: input.templateCode,
        businessCategory: input.businessCategory,
        merchantName: input.merchantName,
        locationName: location.name,
        locale: input.locale,
        customText: input.customText,
      }).text,
    }));
  return {
    enabled: input.enabled && locations.length > 0,
    desiredAppleMaxDistanceMeters: APPLE_NEARBY_DESIRED_MAX_DISTANCE_METERS,
    locations,
  };
}
