import { createHash, randomUUID } from "node:crypto";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import {
  canCreateProgram,
  canPublishForBillingStatus,
  canPublishWithinProgramLimit,
  canRestoreProgram,
  programEntitlement,
  programPublicationFeatureViolations,
} from "@waflo/billing";
import {
  decideProgramPublicationState,
  findProgramTemplate,
  type ProgramCreateInput,
  type ProgramTemplateDefinition,
  type ProgramTestRedeemInput,
  type ProgramTestReverseInput,
  type ProgramTestStampInput,
  type ProgramUpdateInput,
  W2_STAMP_POLICY_DEFAULTS,
} from "@waflo/contracts";
import type { Prisma } from "@waflo/database";
import {
  evaluateStampPolicy,
  LoyaltyPolicyError,
  operationalLocalDate,
  type StampPolicyDecision,
} from "@waflo/loyalty-policy";
import { slugifyProgramName } from "@waflo/qr-core";
import { renderStampSvg, type StampOutputProfile } from "@waflo/stamp-engine";
import { AuditService } from "../audit/audit.service.js";
import { AppError } from "../common/app-error.js";
import {
  decodeNumberCursor,
  decodeTimestampCursor,
  encodeCursor,
} from "../common/cursor-pagination.js";
import {
  withOrganizationCacheLock,
  withOrganizationInvariantLock,
  withProgramLifecycleInvariantLock,
} from "../common/organization-transaction.js";
import type { WafloRequest } from "../common/request-context.js";
import { PrismaService } from "../database/prisma.service.js";
import { TenantService } from "../tenancy/tenant.service.js";
import {
  artworkFor,
  canonicalArtworkBytes,
  conceptTemplates,
  LIBRARY_ARTWORK_SCHEMA_VERSION,
  libraryArtworkDigest,
} from "./library-artwork.js";
import { OBJECT_STORAGE, type ObjectStorage } from "./object-storage.js";
import {
  type PreviewAsset,
  previewAssetCacheIdentity,
  resolvePreviewAssetContent,
} from "./preview-assets.js";
import { createProgramPreviewCacheKey, PREVIEW_RENDERER_SCHEMA_VERSION } from "./preview-cache.js";
import { composeProgramPreview } from "./preview-composer.js";
import {
  absoluteTestPosition,
  canRedeemEarnedReward,
  crossedRewardThresholds,
  projectTestStampAddition,
} from "./program-rules.js";
import {
  renderTemplateGalleryPreviews,
  renderTemplateGalleryThumbnail,
} from "./template-gallery-preview.js";
import { validateProgramConfiguration } from "./validation-engine.js";

const templates = conceptTemplates();

interface PersistedStampPolicy {
  defaultStampsPerAction: number;
  maximumStampsPerOperation: number;
  maximumStampsPerCustomerPerDay: number | null;
  minimumPurchaseAmountMinor: number | null;
  minimumPurchaseCurrency: string | null;
  resetBehaviorAfterReward: string;
}

interface PublicationAsset {
  id: string;
  organizationId: string;
  category: string;
  source: string;
  processingStatus: string;
  archivedAt: Date | null;
  sha256Digest: string;
  safeMetadata: unknown;
  variants: Array<{
    variantCode: string;
    objectKey: string;
    digest: string;
  }>;
}

type CanonicalMutableProgramInput = ProgramCreateInput & {
  changeSummary?: string;
  persistedStampPolicy: PersistedStampPolicy;
};

const requiredPublicationPreviews = [
  "CUSTOMER_WEB_CARD",
  "APPLE_WALLET_PREVIEW",
  "GOOGLE_WALLET_PREVIEW",
] as const;

const includeVersion = {
  translations: true,
  stampRule: true,
  rewards: { include: { translations: true, visualOverride: true } },
  locations: { include: { location: true } },
  visualTheme: true,
  enrollmentPolicy: true,
} as const;

const reservedProgramSlugs = new Set([
  "admin",
  "api",
  "card",
  "join",
  "privacy",
  "program",
  "support",
  "terms",
  "transfer",
  "wallet",
  "waflo",
]);

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function toPlan(value: "STARTER" | "GROWTH" | "SCALE") {
  return value.toLocaleLowerCase("en-US") as "starter" | "growth" | "scale";
}

function templateFor(code?: string, version?: number) {
  const template =
    (code ? findProgramTemplate(code, version) : templates[0]) ??
    (code && version === undefined ? findProgramTemplate(code) : undefined);
  if (!template)
    throw new AppError(
      "PROGRAM_TEMPLATE_NOT_FOUND",
      "Program template not found.",
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  return template;
}

function previewTypeFor(profile: StampOutputProfile) {
  return profile === "APPLE_WALLET"
    ? ("APPLE_WALLET_PREVIEW" as const)
    : profile === "GOOGLE_WALLET"
      ? ("GOOGLE_WALLET_PREVIEW" as const)
      : ("CUSTOMER_WEB_CARD" as const);
}

function sha256Bytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

@Injectable()
export class ProgramsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly audit: AuditService,
    @Inject(OBJECT_STORAGE) private readonly objectStorage: ObjectStorage,
  ) {}

  async list(userId: string, organizationId: string, cursor?: string, limit = 20) {
    await this.tenant.requireMembership(userId, organizationId, "programs.view");
    const decoded = decodeTimestampCursor(cursor);
    const rows = await this.prisma.client.loyaltyProgram.findMany({
      where: {
        organizationId,
        ...(decoded
          ? {
              OR: [
                { updatedAt: { lt: new Date(decoded.timestamp) } },
                { updatedAt: new Date(decoded.timestamp), id: { lt: decoded.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      include: {
        currentDraftVersion: {
          select: {
            id: true,
            versionNumber: true,
            status: true,
            editingMode: true,
            revision: true,
            stampRule: { select: { requiredStampCount: true } },
            translations: { select: { locale: true, programName: true, rewardSummary: true } },
            visualTheme: {
              select: {
                backgroundColor: true,
                foregroundColor: true,
                accentColor: true,
                layoutType: true,
              },
            },
          },
        },
        currentPublishedVersion: {
          select: {
            id: true,
            versionNumber: true,
            status: true,
            publishedAt: true,
            stampRule: { select: { requiredStampCount: true } },
            translations: { select: { locale: true, programName: true, rewardSummary: true } },
            visualTheme: {
              select: {
                backgroundColor: true,
                foregroundColor: true,
                accentColor: true,
                layoutType: true,
              },
            },
          },
        },
        _count: { select: { versions: true } },
      },
    });
    const items = rows.slice(0, limit);
    const last = rows.length > limit ? items.at(-1) : undefined;
    return {
      items,
      nextCursor: last
        ? encodeCursor({ id: last.id, timestamp: last.updatedAt.toISOString() })
        : null,
    };
  }

  get(userId: string, organizationId: string, programId: string) {
    return this.tenant.requireMembership(userId, organizationId, "programs.view").then(async () => {
      const program = await this.prisma.client.loyaltyProgram.findFirst({
        where: { id: programId, organizationId },
        include: {
          currentDraftVersion: { include: includeVersion },
          currentPublishedVersion: { include: includeVersion },
          versions: { orderBy: { versionNumber: "desc" }, take: 20, include: includeVersion },
        },
      });
      if (!program)
        throw new AppError("PROGRAM_NOT_FOUND", "Program not found.", HttpStatus.NOT_FOUND);
      return program;
    });
  }

  listVersions(
    userId: string,
    organizationId: string,
    programId: string,
    cursor?: string,
    limit = 20,
  ) {
    return this.tenant.requireMembership(userId, organizationId, "programs.view").then(async () => {
      const decoded = decodeNumberCursor(cursor);
      const program = await this.prisma.client.loyaltyProgram.findFirst({
        where: { id: programId, organizationId },
        select: { id: true },
      });
      if (!program)
        throw new AppError("PROGRAM_NOT_FOUND", "Program not found.", HttpStatus.NOT_FOUND);
      const rows = await this.prisma.client.loyaltyProgramVersion.findMany({
        where: {
          programId,
          organizationId,
          ...(decoded
            ? {
                OR: [
                  { versionNumber: { lt: decoded.value } },
                  { versionNumber: decoded.value, id: { lt: decoded.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ versionNumber: "desc" }, { id: "desc" }],
        take: limit + 1,
        select: {
          id: true,
          versionNumber: true,
          status: true,
          editingMode: true,
          revision: true,
          changeSummary: true,
          createdAt: true,
          publishedAt: true,
          supersededAt: true,
          validatedAt: true,
          testReadyAt: true,
        },
      });
      const items = rows.slice(0, limit);
      const last = rows.length > limit ? items.at(-1) : undefined;
      return {
        items,
        nextCursor: last ? encodeCursor({ id: last.id, value: last.versionNumber }) : null,
      };
    });
  }

  version(userId: string, organizationId: string, programId: string, versionId: string) {
    return this.tenant.requireMembership(userId, organizationId, "programs.view").then(async () => {
      const result = await this.prisma.client.loyaltyProgramVersion.findFirst({
        where: { id: versionId, programId, organizationId },
        include: includeVersion,
      });
      if (!result)
        throw new AppError(
          "PROGRAM_VERSION_NOT_FOUND",
          "Program version not found.",
          HttpStatus.NOT_FOUND,
        );
      return result;
    });
  }

  templates(userId: string, organizationId: string, locale: "EN" | "AR" = "EN") {
    return this.tenant.requireMembership(userId, organizationId, "programs.view").then(() =>
      templates.map((template) => ({
        ...template,
        availableOnPlans: ["STARTER", "GROWTH", "SCALE"] as const,
        galleryThumbnail: renderTemplateGalleryThumbnail(template, locale),
        ...(template.code === "GENERAL_VISITS"
          ? { blankGalleryThumbnail: renderTemplateGalleryThumbnail(template, locale, "BLANK") }
          : {}),
        artwork: {
          filled: {
            ...template.artwork.filled,
            previewUrl: `data:image/svg+xml;base64,${Buffer.from(artworkFor(template.artwork.filled)?.content ?? "", "utf8").toString("base64")}`,
          },
          empty: {
            ...template.artwork.empty,
            previewUrl: `data:image/svg+xml;base64,${Buffer.from(artworkFor(template.artwork.empty)?.content ?? "", "utf8").toString("base64")}`,
          },
          milestone: {
            ...template.artwork.milestone,
            previewUrl: `data:image/svg+xml;base64,${Buffer.from(artworkFor(template.artwork.milestone)?.content ?? "", "utf8").toString("base64")}`,
          },
        },
      })),
    );
  }

  async templatePreviews(
    userId: string,
    organizationId: string,
    templateCode: string,
    version: number | undefined,
    locale: "EN" | "AR",
    presentation: "TEMPLATE" | "BLANK",
  ) {
    await this.tenant.requireMembership(userId, organizationId, "programs.view");
    const template = findProgramTemplate(templateCode, version);
    if (!template) {
      throw new AppError(
        "PROGRAM_TEMPLATE_NOT_FOUND",
        "Program template not found.",
        HttpStatus.NOT_FOUND,
      );
    }
    if (presentation === "BLANK" && template.code !== "GENERAL_VISITS") {
      throw new AppError(
        "PROGRAM_TEMPLATE_PRESENTATION_INVALID",
        "Blank presentation is only available for the safe default template.",
        HttpStatus.BAD_REQUEST,
      );
    }
    return renderTemplateGalleryPreviews(template, locale, presentation);
  }

  async preview(
    userId: string,
    organizationId: string,
    programId: string,
    progress: number,
    outputProfile: StampOutputProfile,
    locale: "EN" | "AR",
    request: WafloRequest,
  ) {
    await this.tenant.requireMembership(userId, organizationId, "programs.view");
    return withOrganizationCacheLock(this.prisma.client, organizationId, async (transaction) => {
      const program = await transaction.loyaltyProgram.findFirst({
        where: { id: programId, organizationId },
        include: {
          organization: { select: { name: true } },
          currentDraftVersion: {
            include: {
              translations: true,
              stampRule: true,
              rewards: {
                include: {
                  translations: true,
                  visualOverride: { include: { stampAsset: { include: { variants: true } } } },
                },
              },
              visualTheme: {
                include: {
                  filledStampAsset: { include: { variants: true } },
                  emptyStampAsset: { include: { variants: true } },
                  defaultMilestoneAsset: { include: { variants: true } },
                  logoAsset: { include: { variants: true } },
                  heroAsset: { include: { variants: true } },
                  backgroundAsset: { include: { variants: true } },
                },
              },
            },
          },
          currentPublishedVersion: {
            include: {
              translations: true,
              stampRule: true,
              rewards: {
                include: {
                  translations: true,
                  visualOverride: { include: { stampAsset: { include: { variants: true } } } },
                },
              },
              visualTheme: {
                include: {
                  filledStampAsset: { include: { variants: true } },
                  emptyStampAsset: { include: { variants: true } },
                  defaultMilestoneAsset: { include: { variants: true } },
                  logoAsset: { include: { variants: true } },
                  heroAsset: { include: { variants: true } },
                  backgroundAsset: { include: { variants: true } },
                },
              },
            },
          },
        },
      });
      const version = program?.currentDraftVersion ?? program?.currentPublishedVersion;
      if (!program || !version)
        throw new AppError(
          "PROGRAM_VERSION_NOT_FOUND",
          "Program version not found.",
          HttpStatus.NOT_FOUND,
        );
      const goal = version.stampRule?.requiredStampCount ?? 8;
      const baseTemplate = version.baseTemplateCode
        ? findProgramTemplate(version.baseTemplateCode, version.baseTemplateVersion ?? undefined)
        : undefined;
      const visual = version.visualTheme;
      const safeProgress = Math.max(0, Math.min(goal, progress));
      const safeLayout = visual?.layoutType ?? "GRID";
      const previewType = previewTypeFor(outputProfile);
      const configurationFingerprint = digest({
        versionId: version.id,
        revision: version.revision,
      });
      const previewCacheKey = createProgramPreviewCacheKey({
        rendererSchemaVersion: PREVIEW_RENDERER_SCHEMA_VERSION,
        organizationName: program.organization.name,
        template: {
          code: version.baseTemplateCode,
          version: version.baseTemplateVersion,
          presentation: baseTemplate?.presentation ?? null,
        },
        version: { id: version.id, revision: version.revision },
        progress: safeProgress,
        locale,
        profile: outputProfile,
        goal,
        translations: version.translations
          .toSorted((left, right) => left.locale.localeCompare(right.locale))
          .map((item) => ({
            locale: item.locale,
            programName: item.programName,
            shortDescription: item.shortDescription,
            rewardSummary: item.rewardSummary,
            termsAndConditions: item.termsAndConditions,
          })),
        rewards: version.rewards
          .toSorted((left, right) => left.id.localeCompare(right.id))
          .map((reward) => ({
            id: reward.id,
            threshold: reward.thresholdStampCount,
            internalName: reward.internalName,
            translations: reward.translations.toSorted((left, right) =>
              left.locale.localeCompare(right.locale),
            ),
            asset: previewAssetCacheIdentity(reward.visualOverride?.stampAsset, "STAMP_256"),
          })),
        visual: visual
          ? {
              colors: [
                visual.backgroundColor,
                visual.foregroundColor,
                visual.accentColor,
                visual.secondaryColor,
                visual.mutedColor,
              ],
              layout: visual.layoutType,
              layoutConfiguration: visual.layoutConfiguration,
              stampSize: visual.stampSize,
              stampSpacing: visual.stampSpacing,
              progressLabelVisible: visual.progressLabelVisible,
              rewardLabelVisible: visual.rewardLabelVisible,
              customerWebVariant: visual.customerWebVariant,
              applePreviewConfig: visual.applePreviewConfig,
              googlePreviewConfig: visual.googlePreviewConfig,
            }
          : null,
        assets: {
          filled: previewAssetCacheIdentity(visual?.filledStampAsset, "STAMP_256"),
          empty: previewAssetCacheIdentity(visual?.emptyStampAsset, "STAMP_256"),
          milestone: previewAssetCacheIdentity(visual?.defaultMilestoneAsset, "STAMP_256"),
          logo: previewAssetCacheIdentity(visual?.logoAsset, "ORIGINAL_SAFE"),
          hero: previewAssetCacheIdentity(visual?.heroAsset, "ORIGINAL_SAFE"),
          background: previewAssetCacheIdentity(visual?.backgroundAsset, "ORIGINAL_SAFE"),
        },
      });
      const cached = await transaction.generatedProgramPreview.findUnique({
        where: {
          versionId_previewType_progressState_configurationHash: {
            versionId: version.id,
            previewType,
            progressState: safeProgress,
            configurationHash: previewCacheKey,
          },
        },
      });
      if (cached) {
        let cachedBytes: Buffer;
        try {
          cachedBytes = await this.objectStorage.get(cached.objectKey);
        } catch {
          throw new AppError(
            "PROGRAM_PREVIEW_CONTENT_UNAVAILABLE",
            "The cached preview content is unavailable.",
            HttpStatus.SERVICE_UNAVAILABLE,
            { previewId: cached.id },
          );
        }
        const cachedDigest = sha256Bytes(cachedBytes);
        if (cached.contentDigest !== cachedDigest)
          throw new AppError(
            "PROGRAM_PREVIEW_CONTENT_UNAVAILABLE",
            "The cached preview content failed its integrity check.",
            HttpStatus.SERVICE_UNAVAILABLE,
            { previewId: cached.id },
          );
        await transaction.generatedProgramPreview.update({
          where: { id: cached.id },
          data: { lastAccessedAt: new Date() },
        });
        await transaction.loyaltyProgramVersion.updateMany({
          where: { id: version.id, revision: version.revision },
          data: { renderFingerprint: configurationFingerprint },
        });
        return {
          ...cached,
          svg: cachedBytes.toString("utf8"),
          digest: cachedDigest,
          warnings: cached.warnings,
          profile: outputProfile,
          locale,
          cacheStatus: "HIT" as const,
        };
      }
      const assetData = (
        asset: PreviewAsset | null | undefined,
        preferredVariant: "STAMP_256" | "ORIGINAL_SAFE",
        role: string,
        required = false,
      ) => resolvePreviewAssetContent(this.objectStorage, asset, preferredVariant, role, required);
      const [
        filledAsset,
        emptyAsset,
        defaultMilestoneAsset,
        logoAsset,
        heroAsset,
        backgroundAsset,
      ] = await Promise.all([
        assetData(visual?.filledStampAsset, "STAMP_256", "filled stamp", true),
        assetData(visual?.emptyStampAsset, "STAMP_256", "empty stamp", true),
        assetData(visual?.defaultMilestoneAsset, "STAMP_256", "default milestone"),
        assetData(visual?.logoAsset, "ORIGINAL_SAFE", "logo"),
        assetData(visual?.heroAsset, "ORIGINAL_SAFE", "hero"),
        assetData(visual?.backgroundAsset, "ORIGINAL_SAFE", "background"),
      ]);
      await Promise.all(
        version.rewards.map(async (reward) => ({
          reward,
          asset:
            (await assetData(
              reward.visualOverride?.stampAsset,
              "STAMP_256",
              `reward milestone ${reward.id}`,
            )) ?? defaultMilestoneAsset,
        })),
      );
      const translation =
        version.translations.find((item) => item.locale === locale) ??
        version.translations.find((item) => item.locale === "EN");
      if (!translation)
        throw new AppError(
          "PROGRAM_TRANSLATION_NOT_FOUND",
          "Program translation not found.",
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      const visualInput = visual ?? {
        backgroundColor: "#F7F4EE",
        foregroundColor: "#222222",
        accentColor: "#E4572E",
        secondaryColor: "#F3A712",
        layoutConfiguration: {},
        stampSize: 48,
        stampSpacing: 8,
        progressLabelVisible: true,
        rewardLabelVisible: true,
        customerWebVariant: "CARD",
        applePreviewConfig: {},
        googlePreviewConfig: {},
      };
      const rewardReady = safeProgress >= goal;
      const rewardReadyText =
        locale === "AR"
          ? `المكافأة جاهزة: ${translation.rewardSummary}`
          : `Reward ready: ${translation.rewardSummary}`;
      const rendered = renderStampSvg({
        goal,
        progress: safeProgress,
        layout: safeLayout,
        layoutConfiguration: visualInput.layoutConfiguration as {
          columns?: number;
          maxPerRow?: number;
          serpentine?: boolean;
          startAngle?: number;
        },
        outputProfile,
        filledColor: visualInput.accentColor,
        emptyColor:
          outputProfile === "CUSTOMER_WEB"
            ? visualInput.backgroundColor
            : visualInput.secondaryColor,
        accentColor:
          outputProfile === "CUSTOMER_WEB" ? visualInput.foregroundColor : visualInput.accentColor,
        backgroundColor: visualInput.backgroundColor,
        foregroundColor: visualInput.foregroundColor,
        stampSize: visualInput.stampSize,
        spacing: visualInput.stampSpacing,
        ...(filledAsset ? { filledArtwork: filledAsset.artwork } : {}),
        ...(emptyAsset ? { emptyArtwork: emptyAsset.artwork } : {}),
        label: `${safeProgress}/${goal}`,
        rewardLabel: rewardReady ? rewardReadyText : translation.rewardSummary,
        rewardReady,
        progressLabelVisible: outputProfile === "CUSTOMER_WEB" && visualInput.progressLabelVisible,
        rewardLabelVisible: outputProfile === "CUSTOMER_WEB" && visualInput.rewardLabelVisible,
      });
      const appleConfig = visualInput.applePreviewConfig as Partial<{
        headerLabel: string;
        headerValue: string;
        secondaryLabel: string;
        barcodeLabel: string;
        showBackContent: boolean;
      }>;
      const googleConfig = visualInput.googlePreviewConfig as Partial<{
        title: string;
        subtitle: string;
        detailsLabel: string;
        barcodeLabel: string;
      }>;
      const composed = composeProgramPreview({
        profile: outputProfile,
        locale,
        organizationName: program.organization.name,
        programName: translation.programName,
        shortDescription: translation.shortDescription,
        rewardSummary: translation.rewardSummary,
        terms: translation.termsAndConditions,
        progress: safeProgress,
        goal,
        stampSvg: rendered.svg,
        stampLayout: safeLayout as "ROW" | "GRID" | "PATH" | "RING",
        backgroundColor: visualInput.backgroundColor,
        foregroundColor: visualInput.foregroundColor,
        accentColor: visualInput.accentColor,
        secondaryColor: visualInput.secondaryColor,
        ...(logoAsset ? { logoDataUri: logoAsset.dataUri } : {}),
        ...(filledAsset ? { identityDataUri: filledAsset.dataUri } : {}),
        ...(heroAsset ? { heroDataUri: heroAsset.dataUri } : {}),
        ...(backgroundAsset ? { backgroundDataUri: backgroundAsset.dataUri } : {}),
        customerWebVariant: visualInput.customerWebVariant as "CARD" | "MINIMAL" | "HERO",
        ...(baseTemplate?.presentation ? { presentation: baseTemplate.presentation } : {}),
        apple: {
          headerLabel: appleConfig.headerLabel ?? "REWARDS",
          headerValue: appleConfig.headerValue ?? program.internalName,
          secondaryLabel: appleConfig.secondaryLabel ?? "NEXT REWARD",
          barcodeLabel: appleConfig.barcodeLabel ?? "Preview barcode",
          showBackContent: appleConfig.showBackContent ?? true,
        },
        google: {
          title: googleConfig.title ?? translation.programName,
          subtitle: googleConfig.subtitle ?? translation.shortDescription,
          detailsLabel: googleConfig.detailsLabel ?? "Reward progress",
          barcodeLabel: googleConfig.barcodeLabel ?? "Preview barcode",
        },
      });
      const objectKey = `organizations/${organizationId}/previews/${version.id}/${outputProfile.toLowerCase()}-${locale.toLowerCase()}-${previewCacheKey}.svg`;
      await this.objectStorage.ensureReady();
      const previewBytes = Buffer.from(composed.svg);
      const storageResult = await this.objectStorage.putImmutable(
        objectKey,
        previewBytes,
        "image/svg+xml",
      );
      if (storageResult === "EXISTS") {
        const existingBytes = await this.objectStorage.get(objectKey);
        if (sha256Bytes(existingBytes) !== composed.digest)
          throw new AppError(
            "PROGRAM_PREVIEW_CONTENT_CONFLICT",
            "An immutable preview key already contains different content.",
            HttpStatus.CONFLICT,
          );
      }
      const renderUpdate = await transaction.loyaltyProgramVersion.updateMany({
        where: {
          id: version.id,
          revision: version.revision,
          OR: [
            { renderFingerprint: null },
            { renderFingerprint: { not: configurationFingerprint } },
          ],
        },
        data: { renderFingerprint: configurationFingerprint },
      });
      if (renderUpdate.count === 0) {
        const latestVersion = await transaction.loyaltyProgramVersion.findUniqueOrThrow({
          where: { id: version.id },
          select: { revision: true, renderFingerprint: true },
        });
        if (
          latestVersion.revision !== version.revision ||
          latestVersion.renderFingerprint !== configurationFingerprint
        ) {
          await this.objectStorage.delete(objectKey);
          throw new AppError(
            "PREVIEW_DRAFT_CHANGED",
            "The draft changed while this preview was rendering. Generate it again.",
            HttpStatus.CONFLICT,
          );
        }
      }
      const preview = await transaction.generatedProgramPreview.create({
        data: {
          organizationId,
          versionId: version.id,
          versionRevision: version.revision,
          previewType,
          progressState: safeProgress,
          configurationHash: previewCacheKey,
          contentDigest: composed.digest,
          warnings: composed.warnings,
          objectKey,
          mimeType: "image/svg+xml",
          width: composed.width,
          height: composed.height,
        },
      });
      await this.audit.recordInTransaction(
        transaction,
        {
          organizationId,
          actorUserId: userId,
          action: "program.preview_generated",
          targetType: "generated_program_preview",
          targetId: preview.id,
          metadata: {
            programId,
            versionId: version.id,
            versionRevision: version.revision,
            profile: outputProfile,
            locale,
            progress: safeProgress,
          },
        },
        request,
      );
      return {
        ...preview,
        svg: composed.svg,
        digest: composed.digest,
        warnings: composed.warnings,
        profile: outputProfile,
        locale,
        cacheStatus: "MISS" as const,
      };
    });
  }

  async create(
    userId: string,
    organizationId: string,
    input: ProgramCreateInput,
    request: WafloRequest,
  ) {
    await this.tenant.requireMembership(userId, organizationId, "programs.create");
    return withOrganizationInvariantLock(
      this.prisma.client,
      organizationId,
      async (transaction) => {
        const organization = await transaction.organization.findUniqueOrThrow({
          where: { id: organizationId },
        });
        const usage = await transaction.loyaltyProgram.count({
          where: { organizationId, status: { not: "ARCHIVED" } },
        });
        const plan = toPlan(organization.selectedPlan);
        const decision = canCreateProgram(plan, usage);
        if (!decision.allowed) {
          throw new AppError(
            "PROGRAM_LIMIT_REACHED",
            "Your plan has reached its active program limit.",
            HttpStatus.CONFLICT,
            {
              limit: decision.limit,
              currentUsage: decision.currentUsage,
              recommendedPlan: decision.recommendedPlan,
            },
          );
        }
        const locations = await transaction.location.findMany({
          where: { id: { in: input.locationIds }, organizationId, status: "ACTIVE" },
          select: { id: true },
        });
        if (locations.length !== input.locationIds.length) {
          throw new AppError(
            "PROGRAM_LOCATION_INVALID",
            "Select active locations from this organization.",
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }
        if (!programEntitlement(plan, "canUseProMode") && input.editingMode === "pro") {
          throw new AppError(
            "PROGRAM_PRO_MODE_UNAVAILABLE",
            "Pro Mode requires Growth or Scale.",
            HttpStatus.FORBIDDEN,
            { recommendedPlan: "growth" },
          );
        }
        if (input.rewards.length > 1 && !programEntitlement(plan, "canUseMultipleRewards")) {
          throw new AppError(
            "PROGRAM_MULTIPLE_REWARDS_UNAVAILABLE",
            "Multiple rewards require Growth or Scale.",
            HttpStatus.FORBIDDEN,
            { recommendedPlan: "growth" },
          );
        }
        if (
          input.rewards.some((reward) => reward.thresholdStampCount < input.requiredStampCount) &&
          !programEntitlement(plan, "canUseMilestoneRewards")
        ) {
          throw new AppError(
            "PROGRAM_MILESTONES_UNAVAILABLE",
            "Milestone rewards require Growth or Scale.",
            HttpStatus.FORBIDDEN,
            { recommendedPlan: "growth" },
          );
        }
        if (
          ["PATH", "RING"].includes(input.visualTheme.layoutType) &&
          !programEntitlement(plan, "canUseAdvancedLayouts")
        ) {
          throw new AppError(
            "PROGRAM_ADVANCED_LAYOUT_UNAVAILABLE",
            "Advanced layouts require Growth or Scale.",
            HttpStatus.FORBIDDEN,
            { recommendedPlan: "growth" },
          );
        }
        const selectedTemplate = templateFor(input.templateCode, input.templateVersion);
        const themeAssets = await this.ensureBuiltInAssets(
          transaction,
          organizationId,
          userId,
          selectedTemplate,
        );
        await this.assertAssetReferences(
          transaction,
          organizationId,
          input.visualTheme,
          input.rewards,
        );
        const versionData = this.versionCreateData(
          input,
          themeAssets,
          locations.map((location) => location.id),
          userId,
          selectedTemplate,
        );
        const publicSlug = await this.allocatePublicSlug(
          transaction,
          organizationId,
          input.translations.en.programName || input.internalName,
        );
        const program = await transaction.loyaltyProgram.create({
          data: {
            organizationId,
            internalName: input.internalName,
            publicSlug,
            programType: "STAMP",
            status: "DRAFT",
            createdByUserId: userId,
            versions: { create: { ...versionData, versionNumber: 1, organizationId } as never },
          },
        });
        const version = await transaction.loyaltyProgramVersion.findFirst({
          where: { programId: program.id },
          orderBy: { versionNumber: "desc" },
          include: includeVersion,
        });
        if (!version)
          throw new AppError(
            "PROGRAM_CREATE_FAILED",
            "Unable to create program.",
            HttpStatus.INTERNAL_SERVER_ERROR,
          );
        await transaction.programEnrollmentPolicy.create({
          data: {
            organizationId,
            programVersionId: version.id,
            emailCollectionMode: "OPTIONAL",
            primaryCustomerLocale: organization.defaultLocale,
            allowLocaleSelection: true,
            marketingConsentVisible: false,
            marketingConsentDefault: false,
            customerTermsRequired: true,
            transferWithoutEmailAllowed: true,
            enrollmentOpen: true,
          },
        });
        const updated = await transaction.loyaltyProgram.update({
          where: { id: program.id },
          data: { currentDraftVersionId: version.id },
        });
        await this.audit.recordInTransaction(
          transaction,
          {
            organizationId,
            actorUserId: userId,
            action: "program.created",
            targetType: "loyalty_program",
            targetId: program.id,
            metadata: {
              versionId: version.id,
              templateCode: selectedTemplate.code,
              templateVersion: selectedTemplate.version,
            },
          },
          request,
        );
        return { ...updated, currentDraftVersion: version };
      },
    );
  }

  async update(
    userId: string,
    organizationId: string,
    programId: string,
    input: ProgramUpdateInput,
    request: WafloRequest,
  ) {
    await this.tenant.requireMembership(userId, organizationId, "programs.edit");
    return withOrganizationInvariantLock(
      this.prisma.client,
      organizationId,
      async (transaction) => {
        const program = await transaction.loyaltyProgram.findFirst({
          where: { id: programId, organizationId },
          include: { currentDraftVersion: { include: includeVersion } },
        });
        if (!program)
          throw new AppError("PROGRAM_NOT_FOUND", "Program not found.", HttpStatus.NOT_FOUND);
        if (program.status === "ARCHIVED")
          throw new AppError(
            "PROGRAM_ARCHIVED_READ_ONLY",
            "Restore this program before editing its draft.",
            HttpStatus.CONFLICT,
          );
        if (
          !program.currentDraftVersion ||
          ["PUBLISHED", "SUPERSEDED", "ABANDONED"].includes(program.currentDraftVersion.status)
        ) {
          throw new AppError(
            "PROGRAM_DRAFT_REQUIRED",
            "Create a draft version before editing.",
            HttpStatus.CONFLICT,
          );
        }
        if (program.currentDraftVersion.revision !== input.revision) {
          throw new AppError(
            "STALE_PROGRAM_DRAFT",
            "This draft changed in another editor. Reload before saving.",
            HttpStatus.CONFLICT,
            {
              expectedRevision: program.currentDraftVersion.revision,
              receivedRevision: input.revision,
            },
          );
        }
        if (input.locationIds) {
          const locations = await transaction.location.count({
            where: { id: { in: input.locationIds }, organizationId, status: "ACTIVE" },
          });
          if (locations !== input.locationIds.length)
            throw new AppError(
              "PROGRAM_LOCATION_INVALID",
              "Select active locations from this organization.",
              HttpStatus.UNPROCESSABLE_ENTITY,
            );
        }
        const current = program.currentDraftVersion;
        const persisted = this.inputFromVersion(current, program.internalName);
        const next = {
          ...persisted,
          ...input,
          persistedStampPolicy: persisted.persistedStampPolicy,
          changeSummary: input.changeSummary ?? current.changeSummary ?? undefined,
        } as CanonicalMutableProgramInput;
        const organization = await transaction.organization.findUniqueOrThrow({
          where: { id: organizationId },
          select: { selectedPlan: true },
        });
        const plan = toPlan(organization.selectedPlan);
        if (!programEntitlement(plan, "canUseProMode") && next.editingMode === "pro")
          throw new AppError(
            "PROGRAM_PRO_MODE_UNAVAILABLE",
            "Pro Mode requires Growth or Scale.",
            HttpStatus.FORBIDDEN,
            { recommendedPlan: "growth" },
          );
        if (next.rewards.length > 1 && !programEntitlement(plan, "canUseMultipleRewards"))
          throw new AppError(
            "PROGRAM_MULTIPLE_REWARDS_UNAVAILABLE",
            "Multiple rewards require Growth or Scale.",
            HttpStatus.FORBIDDEN,
            { recommendedPlan: "growth" },
          );
        if (
          next.rewards.some((reward) => reward.thresholdStampCount < next.requiredStampCount) &&
          !programEntitlement(plan, "canUseMilestoneRewards")
        )
          throw new AppError(
            "PROGRAM_MILESTONES_UNAVAILABLE",
            "Milestone rewards require Growth or Scale.",
            HttpStatus.FORBIDDEN,
            { recommendedPlan: "growth" },
          );
        if (
          ["PATH", "RING"].includes(next.visualTheme.layoutType) &&
          !programEntitlement(plan, "canUseAdvancedLayouts")
        )
          throw new AppError(
            "PROGRAM_ADVANCED_LAYOUT_UNAVAILABLE",
            "Advanced layouts require Growth or Scale.",
            HttpStatus.FORBIDDEN,
            { recommendedPlan: "growth" },
          );
        await this.assertAssetReferences(
          transaction,
          organizationId,
          next.visualTheme,
          next.rewards,
        );
        await this.clearDraftChildren(transaction, current.id);
        const selectedTemplate = templateFor(
          next.templateCode ?? current.baseTemplateCode ?? undefined,
          next.templateVersion ?? current.baseTemplateVersion ?? undefined,
        );
        const assets = await this.ensureBuiltInAssets(
          transaction,
          organizationId,
          userId,
          selectedTemplate,
        );
        const versionData = this.versionCreateData(
          next,
          assets,
          next.locationIds ?? current.locations.map((item) => item.locationId),
          userId,
          selectedTemplate,
        );
        await transaction.loyaltyProgramVersion.update({
          where: { id: current.id },
          data: {
            ...versionData,
            revision: { increment: 1 },
            status: "DRAFT",
            validatedAt: null,
            testReadyAt: null,
            validationFingerprint: null,
            renderFingerprint: null,
            changeSummary: next.changeSummary ?? null,
          } as never,
        });
        const updated = await transaction.loyaltyProgram.update({
          where: { id: programId },
          data: {
            internalName: next.internalName,
            revision: { increment: 1 },
            ...(program.currentPublishedVersionId ? {} : { status: "DRAFT" as const }),
          },
          include: { currentDraftVersion: { include: includeVersion } },
        });
        await this.audit.recordInTransaction(
          transaction,
          {
            organizationId,
            actorUserId: userId,
            action: "program.draft_updated",
            targetType: "loyalty_program_version",
            targetId: current.id,
            metadata: { revision: current.revision + 1 },
          },
          request,
        );
        return updated;
      },
    );
  }

  async createDraft(
    userId: string,
    organizationId: string,
    programId: string,
    request: WafloRequest,
  ) {
    await this.tenant.requireMembership(userId, organizationId, "programs.edit");
    try {
      return await withOrganizationInvariantLock(
        this.prisma.client,
        organizationId,
        async (transaction) => {
          const program = await transaction.loyaltyProgram.findFirst({
            where: { id: programId, organizationId },
            include: {
              currentPublishedVersion: { include: includeVersion },
              currentDraftVersion: true,
            },
          });
          if (!program)
            throw new AppError("PROGRAM_NOT_FOUND", "Program not found.", HttpStatus.NOT_FOUND);
          if (program.currentDraftVersion) return program;
          if (!program.currentPublishedVersion)
            throw new AppError(
              "PROGRAM_DRAFT_REQUIRED",
              "Program has no published version to copy.",
              HttpStatus.CONFLICT,
            );
          const source = program.currentPublishedVersion;
          const data = await this.cloneVersionData(transaction, source.id, userId);
          const version = await transaction.loyaltyProgramVersion.create({
            data: {
              ...data,
              programId,
              organizationId,
              versionNumber: program.latestVersionNumber + 1,
              createdByUserId: userId,
              status: "DRAFT",
              publishedAt: null,
              supersededAt: null,
            } as never,
          });
          const updated = await transaction.loyaltyProgram.update({
            where: { id: programId },
            data: { currentDraftVersionId: version.id, latestVersionNumber: { increment: 1 } },
            include: {
              currentDraftVersion: { include: includeVersion },
              currentPublishedVersion: { include: includeVersion },
            },
          });
          await this.audit.recordInTransaction(
            transaction,
            {
              organizationId,
              actorUserId: userId,
              action: "program.version_created",
              targetType: "loyalty_program_version",
              targetId: version.id,
              metadata: {
                programId,
                versionNumber: version.versionNumber,
                sourceVersionId: source.id,
              },
            },
            request,
          );
          return updated;
        },
      );
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      if (code === "P2002" || code === "CONCURRENT_MODIFICATION_RETRY") {
        const replay = await this.prisma.client.loyaltyProgram.findFirst({
          where: { id: programId, organizationId, currentDraftVersionId: { not: null } },
          include: {
            currentDraftVersion: { include: includeVersion },
            currentPublishedVersion: { include: includeVersion },
          },
        });
        if (replay) return replay;
      }
      throw error;
    }
  }

  async validate(userId: string, organizationId: string, programId: string, request: WafloRequest) {
    await this.tenant.requireMembership(userId, organizationId, "programs.validate");
    const result = await withOrganizationInvariantLock(
      this.prisma.client,
      organizationId,
      async (transaction) => {
        const program = await transaction.loyaltyProgram.findFirst({
          where: { id: programId, organizationId },
          include: {
            organization: { select: { selectedPlan: true } },
            currentDraftVersion: {
              include: {
                translations: true,
                stampRule: true,
                rewards: {
                  include: {
                    translations: true,
                    visualOverride: { include: { stampAsset: true } },
                  },
                },
                locations: { include: { location: true } },
                visualTheme: {
                  include: {
                    logoAsset: true,
                    heroAsset: true,
                    backgroundAsset: true,
                    filledStampAsset: true,
                    emptyStampAsset: true,
                    defaultMilestoneAsset: true,
                  },
                },
                testSessions: {
                  where: { status: "COMPLETED" },
                  select: {
                    versionRevision: true,
                    validationFingerprint: true,
                  },
                },
                previews: {
                  select: {
                    previewType: true,
                    versionRevision: true,
                  },
                },
              },
            },
          },
        });
        if (!program?.currentDraftVersion)
          throw new AppError(
            "PROGRAM_DRAFT_REQUIRED",
            "Create a draft before validating.",
            HttpStatus.CONFLICT,
          );
        const version = program.currentDraftVersion;
        const fingerprint = digest({
          versionId: version.id,
          revision: version.revision,
        });
        const visual = version.visualTheme;
        const { errors, warnings } = validateProgramConfiguration({
          plan: program.organization.selectedPlan,
          goal: version.stampRule?.requiredStampCount ?? 0,
          translations: version.translations,
          rewards: version.rewards.map((reward) => ({
            thresholdStampCount: reward.thresholdStampCount,
            maximumRedemptionsPerEarned: reward.maximumRedemptionsPerEarned,
            validityDurationDays: reward.validityDurationDays,
            stampAsset: reward.visualOverride?.stampAsset ?? null,
          })),
          operationalPolicy: {
            operationalTimezone: version.operationalTimezone,
            maximumStampsPerOperation: version.stampRule?.maximumStampsPerOperation ?? 0,
            maximumStampsPerCustomerPerDay:
              version.stampRule?.maximumStampsPerCustomerPerDay ?? null,
            minimumPurchaseAmountMinor: version.stampRule?.minimumPurchaseAmountMinor ?? null,
            minimumPurchaseCurrency: version.stampRule?.minimumPurchaseCurrency ?? null,
            staffOwnReversalWindowSeconds: version.staffOwnReversalWindowSeconds,
            managerReversalWindowMinutes: version.managerReversalWindowMinutes,
            managerOverrideAllowed: version.managerOverrideAllowed,
            resetBehaviorAfterReward:
              version.stampRule?.resetBehaviorAfterReward ?? "RESET_ON_FINAL_REWARD_REDEMPTION",
          },
          locations: version.locations.map((location) => ({
            status: location.location.status,
          })),
          visual: visual
            ? {
                backgroundColor: visual.backgroundColor,
                foregroundColor: visual.foregroundColor,
                accentColor: visual.accentColor,
                layoutType: visual.layoutType,
                stampSize: visual.stampSize,
                stampSpacing: visual.stampSpacing,
                applePreviewConfig: visual.applePreviewConfig,
                googlePreviewConfig: visual.googlePreviewConfig,
                assets: [
                  {
                    role: "filledStamp",
                    expectedCategory: "STAMP_FILLED",
                    asset: visual.filledStampAsset,
                    required: true,
                  },
                  {
                    role: "emptyStamp",
                    expectedCategory: "STAMP_EMPTY",
                    asset: visual.emptyStampAsset,
                    required: true,
                  },
                  {
                    role: "logo",
                    expectedCategory: "LOGO",
                    asset: visual.logoAsset,
                    required: false,
                  },
                  {
                    role: "hero",
                    expectedCategory: "HERO",
                    asset: visual.heroAsset,
                    required: false,
                  },
                  {
                    role: "background",
                    expectedCategory: "BACKGROUND",
                    asset: visual.backgroundAsset,
                    required: false,
                  },
                  {
                    role: "milestone",
                    expectedCategory: "STAMP_MILESTONE",
                    asset: visual.defaultMilestoneAsset,
                    required: false,
                  },
                ],
              }
            : null,
          expectedFingerprint: fingerprint,
          renderFingerprint: version.renderFingerprint,
          previewProfiles: version.previews
            .filter((preview) => preview.versionRevision === version.revision)
            .map((preview) => preview.previewType),
          completedTestSessions: version.testSessions,
          versionRevision: version.revision,
        });
        const status = errors.length
          ? "FAILED"
          : warnings.length
            ? "VALID_WITH_WARNINGS"
            : "PASSED";
        const run = await transaction.programValidationRun.create({
          data: {
            organizationId,
            versionId: version.id,
            status,
            configurationFingerprint: fingerprint,
            errors: errors as unknown as Prisma.InputJsonValue,
            warnings: warnings as unknown as Prisma.InputJsonValue,
            createdByUserId: userId,
          },
        });
        await transaction.loyaltyProgramVersion.update({
          where: { id: version.id },
          data: {
            status: errors.length ? "DRAFT" : "VALIDATED",
            validatedAt: errors.length ? null : new Date(),
            validationFingerprint: fingerprint,
          },
        });
        if (
          !errors.length &&
          !["PUBLISHED", "PAUSED", "ARCHIVED", "SUSPENDED"].includes(program.status)
        )
          await transaction.loyaltyProgram.update({
            where: { id: programId },
            data: { status: "VALIDATED" },
          });
        await this.audit.recordInTransaction(
          transaction,
          {
            organizationId,
            actorUserId: userId,
            action: errors.length ? "program.validation_failed" : "program.validated",
            targetType: "loyalty_program",
            targetId: programId,
            metadata: {
              versionId: version.id,
              revision: version.revision,
              status,
              errorCount: errors.length,
              warningCount: warnings.length,
            },
          },
          request,
        );
        return { ...run, errors, warnings };
      },
    );
    return result;
  }

  async createTestSession(
    userId: string,
    organizationId: string,
    programId: string,
    request: WafloRequest,
  ) {
    await this.tenant.requireMembership(userId, organizationId, "programs.test");
    const program = await this.prisma.client.loyaltyProgram.findFirst({
      where: { id: programId, organizationId },
      include: { currentDraftVersion: true },
    });
    if (
      !program?.currentDraftVersion ||
      !["VALIDATED", "TEST_READY"].includes(program.currentDraftVersion.status)
    )
      throw new AppError(
        "PROGRAM_NOT_TEST_READY",
        "Validate the draft before entering Test Mode.",
        HttpStatus.CONFLICT,
      );
    const session = await this.prisma.client.programTestSession.create({
      data: {
        organizationId,
        versionId: program.currentDraftVersion.id,
        createdByUserId: userId,
        syntheticDisplayName: "Waflo test customer",
        versionRevision: program.currentDraftVersion.revision,
        validationFingerprint: program.currentDraftVersion.validationFingerprint,
      },
      include: {
        version: {
          include: {
            stampRule: true,
            rewards: { include: { translations: true } },
          },
        },
        events: true,
      },
    });
    await this.audit.record(
      {
        organizationId,
        actorUserId: userId,
        action: "program.test_session_started",
        targetType: "program_test_session",
        targetId: session.id,
      },
      request,
    );
    return session;
  }

  async getTestSession(userId: string, organizationId: string, sessionId: string) {
    await this.tenant.requireMembership(userId, organizationId, "programs.test");
    const session = await this.prisma.client.programTestSession.findFirst({
      where: { id: sessionId, organizationId },
      include: {
        version: {
          include: {
            stampRule: true,
            rewards: { include: { translations: true } },
          },
        },
        events: { orderBy: { createdAt: "desc" }, take: 100 },
      },
    });
    if (!session)
      throw new AppError("TEST_SESSION_NOT_FOUND", "Test session not found.", HttpStatus.NOT_FOUND);
    return session;
  }

  async addTestStamps(
    userId: string,
    organizationId: string,
    sessionId: string,
    input: ProgramTestStampInput | number,
    requestOrIdempotencyKey: WafloRequest | string,
    legacyRequest?: WafloRequest,
  ) {
    await this.tenant.requireMembership(userId, organizationId, "programs.test");
    const commandInput: ProgramTestStampInput =
      typeof input === "number"
        ? {
            amount: input,
            idempotencyKey:
              typeof requestOrIdempotencyKey === "string" ? requestOrIdempotencyKey : randomUUID(),
            managerApproved: false,
          }
        : input;
    const request = (
      typeof input === "number" ? legacyRequest : requestOrIdempotencyKey
    ) as WafloRequest;
    // Keep the service compatible with pre-W4 Test Mode callers. HTTP clients
    // still supply a validated key, while direct legacy callers receive a fresh
    // command identity instead of failing inside Prisma's compound unique key.
    const idempotencyKey = commandInput.idempotencyKey ?? randomUUID();
    const result = await withOrganizationInvariantLock(
      this.prisma.client,
      organizationId,
      async (transaction) => {
        const session = await transaction.programTestSession.findFirst({
          where: { id: sessionId, organizationId },
          include: { version: { include: { stampRule: true, rewards: true } } },
        });
        if (!session)
          throw new AppError(
            "TEST_SESSION_NOT_FOUND",
            "Test session not found.",
            HttpStatus.NOT_FOUND,
          );
        const existing = await transaction.programTestEvent.findUnique({
          where: {
            sessionId_idempotencyKey: {
              sessionId,
              idempotencyKey,
            },
          },
        });
        if (existing)
          return transaction.programTestSession.findUniqueOrThrow({
            where: { id: sessionId },
            include: {
              version: {
                include: {
                  stampRule: true,
                  rewards: { include: { translations: true } },
                },
              },
              events: { orderBy: { createdAt: "desc" }, take: 100 },
            },
          });
        if (session.version.revision !== session.versionRevision)
          throw new AppError(
            "TEST_SESSION_STALE",
            "This Test Mode session belongs to an older draft revision.",
            HttpStatus.CONFLICT,
          );
        const goal = session.version.stampRule?.requiredStampCount ?? 8;
        if (session.currentStampCount >= goal)
          throw new AppError(
            "TEST_REWARD_READY",
            "Redeem the final reward before adding stamps to a new cycle.",
            HttpStatus.CONFLICT,
            { currentStampCount: session.currentStampCount, goal },
          );
        const simulatedAt = commandInput.simulatedOccurredAt
          ? new Date(commandInput.simulatedOccurredAt)
          : new Date();
        const localDate = operationalLocalDate(simulatedAt, session.version.operationalTimezone);
        const issuedEvents = await transaction.programTestEvent.findMany({
          where: { sessionId, eventType: "TEST_STAMP_EARNED" },
          select: { amount: true, safeMetadata: true },
        });
        const grossPositiveStampsIssuedToday = issuedEvents.reduce((total, event) => {
          const metadata =
            event.safeMetadata &&
            typeof event.safeMetadata === "object" &&
            !Array.isArray(event.safeMetadata)
              ? (event.safeMetadata as { operationalLocalDate?: unknown })
              : null;
          return metadata?.operationalLocalDate === localDate ? total + (event.amount ?? 0) : total;
        }, 0);
        let decision: StampPolicyDecision;
        try {
          decision = evaluateStampPolicy(
            {
              requiredStampCount: goal,
              maximumStampsPerOperation: session.version.stampRule?.maximumStampsPerOperation ?? 5,
              maximumStampsPerCustomerPerDay:
                session.version.stampRule?.maximumStampsPerCustomerPerDay ?? null,
              minimumPurchaseAmountMinor:
                session.version.stampRule?.minimumPurchaseAmountMinor ?? null,
              minimumPurchaseCurrency: session.version.stampRule?.minimumPurchaseCurrency ?? null,
              operationalTimezone: session.version.operationalTimezone,
              resetBehaviorAfterReward: "RESET_ON_FINAL_REWARD_REDEMPTION",
            },
            {
              requestedStamps: commandInput.amount,
              currentCycleStampCount: session.currentStampCount,
              rewardReady: session.currentStampCount >= goal,
              grossPositiveStampsIssuedToday,
              ...(commandInput.purchaseAmountMinor !== undefined
                ? { purchaseAmountMinor: commandInput.purchaseAmountMinor }
                : {}),
              ...(commandInput.purchaseCurrency !== undefined
                ? { purchaseCurrency: commandInput.purchaseCurrency }
                : {}),
              managerOverride: commandInput.managerApproved
                ? {
                    dailyCap: true,
                    purchasePolicy: true,
                    reason: commandInput.managerReason ?? "Synthetic manager approval.",
                    permitted: session.version.managerOverrideAllowed,
                  }
                : null,
            },
          );
        } catch (error) {
          if (error instanceof LoyaltyPolicyError) {
            throw new AppError(error.code, error.message, HttpStatus.CONFLICT);
          }
          throw error;
        }
        const previousAbsolute = absoluteTestPosition(
          session.cycleCount,
          session.currentStampCount,
          goal,
        );
        const projection = projectTestStampAddition(
          session.currentStampCount,
          decision.nextCycleStampCount - session.currentStampCount,
          goal,
        );
        const nextAbsolute = previousAbsolute + projection.appliedAmount;
        const crossed = crossedRewardThresholds(
          previousAbsolute,
          projection.appliedAmount,
          goal,
          session.version.rewards,
        );
        await transaction.programTestEvent.create({
          data: {
            sessionId,
            eventType: "TEST_STAMP_EARNED",
            amount: projection.appliedAmount,
            idempotencyKey,
            createdByUserId: userId,
            safeMetadata: {
              previousAbsolute,
              nextAbsolute,
              cycle: session.cycleCount + 1,
              requestedAmount: commandInput.amount,
              appliedAmount: projection.appliedAmount,
              rewardReady: projection.rewardReady,
              operationalTimezone: session.version.operationalTimezone,
              operationalLocalDate: localDate,
              simulatedOccurredAt: simulatedAt.toISOString(),
              purchaseAmountMinor: commandInput.purchaseAmountMinor ?? null,
              purchaseCurrency: commandInput.purchaseCurrency ?? null,
              managerApproved: commandInput.managerApproved,
              dailyCapOverridden: decision.dailyCapOverridden,
              purchasePolicyOverridden: decision.purchasePolicyOverridden,
            },
          },
        });
        for (const threshold of crossed)
          await transaction.programTestEvent.create({
            data: {
              sessionId,
              eventType: "TEST_REWARD_UNLOCKED",
              amount: 1,
              rewardDefinitionId: threshold.rewardId,
              idempotencyKey: `${idempotencyKey}:unlock:${threshold.cycle}:${threshold.rewardId}`,
              createdByUserId: userId,
              safeMetadata: {
                cycle: threshold.cycle,
                thresholdStampCount: threshold.thresholdStampCount,
                absolutePosition: threshold.absolutePosition,
              },
            },
          });
        const updated = await transaction.programTestSession.update({
          where: { id: sessionId },
          data: {
            currentStampCount: projection.currentStampCount,
            status: "ACTIVE",
          },
          include: {
            version: {
              include: {
                stampRule: true,
                rewards: { include: { translations: true } },
              },
            },
            events: { orderBy: { createdAt: "desc" }, take: 100 },
          },
        });
        await this.audit.recordInTransaction(
          transaction,
          {
            organizationId,
            actorUserId: userId,
            action: "program.test_stamps_added",
            targetType: "program_test_session",
            targetId: sessionId,
            metadata: {
              requestedAmount: commandInput.amount,
              appliedAmount: projection.appliedAmount,
              rewardReady: projection.rewardReady,
              cycle: session.cycleCount + 1,
            },
          },
          request,
        );
        return updated;
      },
    );
    return result;
  }

  async redeemTestReward(
    userId: string,
    organizationId: string,
    sessionId: string,
    rewardId: string,
    input: ProgramTestRedeemInput | string,
    request: WafloRequest,
  ) {
    await this.tenant.requireMembership(userId, organizationId, "programs.test");
    const commandInput: ProgramTestRedeemInput =
      typeof input === "string" ? { idempotencyKey: input, managerApproved: false } : input;
    return withOrganizationInvariantLock(
      this.prisma.client,
      organizationId,
      async (transaction) => {
        const session = await transaction.programTestSession.findFirst({
          where: { id: sessionId, organizationId },
          include: { version: { include: { rewards: true, stampRule: true } } },
        });
        const reward = session?.version.rewards.find((item) => item.id === rewardId);
        if (!session || !reward)
          throw new AppError(
            "TEST_REWARD_NOT_FOUND",
            "Test reward not found.",
            HttpStatus.NOT_FOUND,
          );
        const existing = await transaction.programTestEvent.findUnique({
          where: {
            sessionId_idempotencyKey: {
              sessionId,
              idempotencyKey: commandInput.idempotencyKey,
            },
          },
        });
        if (existing) return existing;
        const latestReset = await transaction.programTestEvent.findFirst({
          where: { sessionId, eventType: "TEST_SESSION_RESET" },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        });
        const sinceReset = latestReset ? { createdAt: { gt: latestReset.createdAt } } : {};
        const rewardEvents = await transaction.programTestEvent.findMany({
          where: {
            sessionId,
            rewardDefinitionId: rewardId,
            eventType: {
              in: ["TEST_REWARD_UNLOCKED", "TEST_REWARD_RELOCKED", "TEST_REWARD_REDEEMED"],
            },
            ...sinceReset,
          },
          orderBy: { createdAt: "asc" },
        });
        const cycleCounts = new Map<
          number,
          { unlocked: number; relocked: number; redeemed: number }
        >();
        for (const rewardEvent of rewardEvents) {
          const metadata =
            rewardEvent.safeMetadata && typeof rewardEvent.safeMetadata === "object"
              ? (rewardEvent.safeMetadata as { cycle?: unknown })
              : null;
          const cycle = typeof metadata?.cycle === "number" ? metadata.cycle : 1;
          const counts = cycleCounts.get(cycle) ?? {
            unlocked: 0,
            relocked: 0,
            redeemed: 0,
          };
          if (rewardEvent.eventType === "TEST_REWARD_UNLOCKED") counts.unlocked += 1;
          if (rewardEvent.eventType === "TEST_REWARD_RELOCKED") counts.relocked += 1;
          if (rewardEvent.eventType === "TEST_REWARD_REDEEMED") counts.redeemed += 1;
          cycleCounts.set(cycle, counts);
        }
        const availableCycle = [...cycleCounts.entries()]
          .sort(([left], [right]) => left - right)
          .find(([, counts]) =>
            canRedeemEarnedReward(
              counts.unlocked,
              counts.relocked,
              counts.redeemed,
              reward.maximumRedemptionsPerEarned,
            ),
          )?.[0];
        if (!availableCycle)
          throw new AppError(
            "TEST_REWARD_NOT_UNLOCKED",
            "Earn another unlock for this reward before redeeming it again.",
            HttpStatus.CONFLICT,
          );
        if (reward.requiresManagerApproval && !commandInput.managerApproved) {
          throw new AppError(
            "TEST_MANAGER_APPROVAL_REQUIRED",
            "Synthetic manager approval is required for this reward.",
            HttpStatus.CONFLICT,
          );
        }
        const event = await transaction.programTestEvent.create({
          data: {
            sessionId,
            rewardDefinitionId: rewardId,
            eventType: "TEST_REWARD_REDEEMED",
            idempotencyKey: commandInput.idempotencyKey,
            amount: 1,
            createdByUserId: userId,
            safeMetadata: {
              cycle: availableCycle,
              finalReward:
                reward.thresholdStampCount === (session.version.stampRule?.requiredStampCount ?? 8),
              managerApproved: commandInput.managerApproved,
            },
          },
        });
        const rewardIds = session.version.rewards.map((item) => item.id);
        const redemptionEvents = await transaction.programTestEvent.findMany({
          where: {
            sessionId,
            eventType: "TEST_REWARD_REDEEMED",
            rewardDefinitionId: { in: rewardIds },
            ...sinceReset,
          },
          select: { rewardDefinitionId: true, safeMetadata: true },
        });
        const redeemedRewardIds = new Set(
          redemptionEvents
            .filter((redemption) => {
              const metadata =
                redemption.safeMetadata && typeof redemption.safeMetadata === "object"
                  ? (redemption.safeMetadata as { cycle?: unknown })
                  : null;
              return metadata?.cycle === availableCycle;
            })
            .map((redemption) => redemption.rewardDefinitionId)
            .filter((id): id is string => Boolean(id)),
        );
        const finalReward =
          reward.thresholdStampCount === (session.version.stampRule?.requiredStampCount ?? 8);
        const completedCycle =
          redeemedRewardIds.size === rewardIds.length &&
          session.version.revision === session.versionRevision &&
          session.version.validationFingerprint === session.validationFingerprint;
        if (completedCycle)
          await transaction.loyaltyProgramVersion.update({
            where: { id: session.versionId },
            data: { status: "TEST_READY", testReadyAt: new Date() },
          });
        if (finalReward)
          await transaction.programTestSession.update({
            where: { id: sessionId },
            data: {
              currentStampCount: 0,
              cycleCount: { increment: 1 },
              status: completedCycle ? "COMPLETED" : "ACTIVE",
            },
          });
        else if (completedCycle)
          await transaction.programTestSession.update({
            where: { id: sessionId },
            data: { status: "COMPLETED" },
          });
        await this.audit.recordInTransaction(
          transaction,
          {
            organizationId,
            actorUserId: userId,
            action: "program.test_reward_redeemed",
            targetType: "program_test_session",
            targetId: sessionId,
            metadata: {
              rewardId,
              eventId: event.id,
              cycle: availableCycle,
              finalReward,
              currentStampCount: finalReward ? 0 : session.currentStampCount,
              cycleCount: finalReward ? session.cycleCount + 1 : session.cycleCount,
              completedCycle,
            },
          },
          request,
        );
        return event;
      },
    );
  }

  async reverseTestStamp(
    userId: string,
    organizationId: string,
    sessionId: string,
    input: ProgramTestReverseInput | string,
    request: WafloRequest,
  ) {
    await this.tenant.requireMembership(userId, organizationId, "programs.test");
    const commandInput: ProgramTestReverseInput =
      typeof input === "string" ? { idempotencyKey: input, managerActor: false } : input;
    const result = await withOrganizationInvariantLock(
      this.prisma.client,
      organizationId,
      async (transaction) => {
        const session = await transaction.programTestSession.findFirst({
          where: { id: sessionId, organizationId },
          include: {
            version: {
              include: {
                stampRule: true,
                rewards: { include: { translations: true } },
              },
            },
          },
        });
        if (!session)
          throw new AppError(
            "TEST_SESSION_NOT_FOUND",
            "Test session not found.",
            HttpStatus.NOT_FOUND,
          );
        const replay = await transaction.programTestEvent.findUnique({
          where: {
            sessionId_idempotencyKey: {
              sessionId,
              idempotencyKey: commandInput.idempotencyKey,
            },
          },
        });
        if (replay)
          return transaction.programTestSession.findUniqueOrThrow({
            where: { id: sessionId },
            include: {
              version: {
                include: {
                  stampRule: true,
                  rewards: { include: { translations: true } },
                },
              },
              events: { orderBy: { createdAt: "desc" }, take: 100 },
            },
          });
        const goal = session.version.stampRule?.requiredStampCount ?? 8;
        if (session.currentStampCount === 0)
          throw new AppError(
            "TEST_STAMP_REVERSE_EMPTY",
            "There is no synthetic stamp to reverse.",
            HttpStatus.CONFLICT,
          );
        const latestStamp = await transaction.programTestEvent.findFirst({
          where: { sessionId, eventType: "TEST_STAMP_EARNED" },
          orderBy: { createdAt: "desc" },
        });
        const simulatedAt = commandInput.simulatedOccurredAt
          ? new Date(commandInput.simulatedOccurredAt)
          : new Date();
        const latestStampMetadata =
          latestStamp?.safeMetadata &&
          typeof latestStamp.safeMetadata === "object" &&
          !Array.isArray(latestStamp.safeMetadata)
            ? (latestStamp.safeMetadata as { simulatedOccurredAt?: unknown })
            : null;
        const latestStampOccurredAt =
          typeof latestStampMetadata?.simulatedOccurredAt === "string"
            ? new Date(latestStampMetadata.simulatedOccurredAt)
            : latestStamp?.createdAt;
        const reversalWindowMs = commandInput.managerActor
          ? session.version.managerReversalWindowMinutes * 60_000
          : session.version.staffOwnReversalWindowSeconds * 1_000;
        const elapsedMs = latestStampOccurredAt
          ? simulatedAt.getTime() - latestStampOccurredAt.getTime()
          : Number.POSITIVE_INFINITY;
        if (!latestStampOccurredAt || elapsedMs < 0 || elapsedMs > reversalWindowMs) {
          throw new AppError(
            "TEST_REVERSAL_WINDOW_EXPIRED",
            "The synthetic reversal window has expired.",
            HttpStatus.CONFLICT,
          );
        }
        const currentAbsolute = absoluteTestPosition(
          session.cycleCount,
          session.currentStampCount,
          goal,
        );
        const cycle = session.cycleCount + 1;
        const positionInCycle = session.currentStampCount;
        const affectedRewards = session.version.rewards.filter(
          (reward) => reward.thresholdStampCount === positionInCycle,
        );
        const latestReset = await transaction.programTestEvent.findFirst({
          where: { sessionId, eventType: "TEST_SESSION_RESET" },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        });
        if (affectedRewards.length) {
          const redemptions = await transaction.programTestEvent.findMany({
            where: {
              sessionId,
              eventType: "TEST_REWARD_REDEEMED",
              rewardDefinitionId: { in: affectedRewards.map((reward) => reward.id) },
              ...(latestReset ? { createdAt: { gt: latestReset.createdAt } } : {}),
            },
            select: { safeMetadata: true },
          });
          const crossesRedeemedReward = redemptions.some((redemption) => {
            const metadata =
              redemption.safeMetadata && typeof redemption.safeMetadata === "object"
                ? (redemption.safeMetadata as { cycle?: unknown })
                : null;
            return metadata?.cycle === cycle;
          });
          if (crossesRedeemedReward)
            throw new AppError(
              "TEST_STAMP_REVERSE_REDEEMED_REWARD",
              "This stamp unlocked a reward that was already redeemed. Reset Test Mode instead.",
              HttpStatus.CONFLICT,
            );
        }
        const nextAbsolute = currentAbsolute - 1;
        await transaction.programTestEvent.create({
          data: {
            sessionId,
            eventType: "TEST_STAMP_REVERSED",
            amount: 1,
            idempotencyKey: commandInput.idempotencyKey,
            createdByUserId: userId,
            safeMetadata: {
              cycle,
              positionInCycle,
              previousAbsolute: currentAbsolute,
              nextAbsolute,
              simulatedOccurredAt: simulatedAt.toISOString(),
              actor: commandInput.managerActor ? "MANAGER" : "STAFF",
            },
          },
        });
        for (const reward of affectedRewards)
          await transaction.programTestEvent.create({
            data: {
              sessionId,
              eventType: "TEST_REWARD_RELOCKED",
              amount: 1,
              rewardDefinitionId: reward.id,
              idempotencyKey: `${commandInput.idempotencyKey}:relock:${cycle}:${reward.id}`,
              createdByUserId: userId,
              safeMetadata: { cycle, thresholdStampCount: positionInCycle },
            },
          });
        await transaction.loyaltyProgramVersion.update({
          where: { id: session.versionId },
          data: { status: "VALIDATED", testReadyAt: null },
        });
        return transaction.programTestSession.update({
          where: { id: sessionId },
          data: {
            currentStampCount: session.currentStampCount - 1,
            status: "ACTIVE",
          },
          include: {
            version: {
              include: {
                stampRule: true,
                rewards: { include: { translations: true } },
              },
            },
            events: { orderBy: { createdAt: "desc" }, take: 100 },
          },
        });
      },
    );
    await this.audit.record(
      {
        organizationId,
        actorUserId: userId,
        action: "program.test_stamp_reversed",
        targetType: "program_test_session",
        targetId: sessionId,
      },
      request,
    );
    return result;
  }

  async resetTestSession(
    userId: string,
    organizationId: string,
    sessionId: string,
    request: WafloRequest,
    idempotencyKey: string,
  ) {
    await this.tenant.requireMembership(userId, organizationId, "programs.test");
    const session = await withOrganizationInvariantLock(
      this.prisma.client,
      organizationId,
      async (transaction) => {
        const found = await transaction.programTestSession.findFirst({
          where: { id: sessionId, organizationId },
        });
        if (!found)
          throw new AppError(
            "TEST_SESSION_NOT_FOUND",
            "Test session not found.",
            HttpStatus.NOT_FOUND,
          );
        const existing = await transaction.programTestEvent.findUnique({
          where: { sessionId_idempotencyKey: { sessionId, idempotencyKey } },
        });
        if (existing)
          return transaction.programTestSession.findUniqueOrThrow({
            where: { id: sessionId },
            include: { events: { orderBy: { createdAt: "desc" }, take: 20 } },
          });
        await transaction.programTestEvent.create({
          data: {
            sessionId,
            eventType: "TEST_SESSION_RESET",
            idempotencyKey,
            createdByUserId: userId,
          },
        });
        await transaction.loyaltyProgramVersion.update({
          where: { id: found.versionId },
          data: { status: "VALIDATED", testReadyAt: null },
        });
        return transaction.programTestSession.update({
          where: { id: sessionId },
          data: { currentStampCount: 0, cycleCount: 0, status: "RESET", resetAt: new Date() },
          include: { events: { orderBy: { createdAt: "desc" }, take: 20 } },
        });
      },
    );
    await this.audit.record(
      {
        organizationId,
        actorUserId: userId,
        action: "program.test_session_reset",
        targetType: "program_test_session",
        targetId: sessionId,
      },
      request,
    );
    return session;
  }

  async publish(
    userId: string,
    organizationId: string,
    programId: string,
    idempotencyKey: string,
    request: WafloRequest,
  ) {
    try {
      await this.tenant.requireMembership(userId, organizationId, "programs.publish");
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      if (code === "ORGANIZATION_ACCESS_DENIED") {
        const membership = await this.prisma.client.organizationMember.findUnique({
          where: { organizationId_userId: { organizationId, userId } },
          include: { organization: { select: { status: true } } },
        });
        if (membership?.status === "ACTIVE" && membership.organization.status !== "ACTIVE")
          throw new AppError(
            "PROGRAM_PUBLICATION_ORGANIZATION_UNAVAILABLE",
            "This organization cannot publish programs in its current state.",
            HttpStatus.CONFLICT,
            { organizationStatus: membership.organization.status },
          );
      }
      throw error;
    }
    const result = await withOrganizationInvariantLock(
      this.prisma.client,
      organizationId,
      async (transaction) => {
        const replay = await transaction.programPublishCommand.findUnique({
          where: { organizationId_idempotencyKey: { organizationId, idempotencyKey } },
        });
        if (replay) {
          if (replay.programId !== programId)
            throw new AppError(
              "IDEMPOTENCY_KEY_REUSED",
              "This publish idempotency key belongs to another program.",
              HttpStatus.CONFLICT,
            );
          return replay;
        }
        const program = await transaction.loyaltyProgram.findFirst({
          where: { id: programId, organizationId },
          include: {
            organization: {
              select: {
                status: true,
                selectedPlan: true,
                billingProfile: true,
              },
            },
            currentDraftVersion: {
              include: {
                stampRule: true,
                rewards: {
                  include: {
                    visualOverride: {
                      include: { stampAsset: { include: { variants: true } } },
                    },
                  },
                },
                locations: { include: { location: true } },
                visualTheme: {
                  include: {
                    logoAsset: { include: { variants: true } },
                    heroAsset: { include: { variants: true } },
                    backgroundAsset: { include: { variants: true } },
                    filledStampAsset: { include: { variants: true } },
                    emptyStampAsset: { include: { variants: true } },
                    defaultMilestoneAsset: { include: { variants: true } },
                  },
                },
                validationRuns: { orderBy: { createdAt: "desc" }, take: 1 },
              },
            },
          },
        });
        if (!program)
          throw new AppError("PROGRAM_NOT_FOUND", "Program not found.", HttpStatus.NOT_FOUND);
        const publicationState = decideProgramPublicationState({
          programStatus: program.status,
          hasCurrentPublishedVersion: program.currentPublishedVersionId !== null,
        });
        if (!publicationState.allowed)
          throw new AppError(
            "PROGRAM_PUBLICATION_STATE_BLOCKED",
            program.status === "ARCHIVED"
              ? "Restore this program before publishing."
              : program.status === "SUSPENDED"
                ? "Publishing is unavailable for this program. Contact support for assistance."
                : program.status === "SCHEDULED"
                  ? "Scheduled publication is not available yet."
                  : "This program cannot be published from its current operational state.",
            HttpStatus.CONFLICT,
            {
              programStatus: program.status,
              ...(publicationState.requiredAction
                ? { requiredAction: publicationState.requiredAction }
                : {}),
            },
          );
        const version = program.currentDraftVersion;
        if (
          !version ||
          !["VALIDATED", "TEST_READY"].includes(version.status) ||
          !version.validationFingerprint ||
          !version.validatedAt
        )
          throw new AppError(
            "PROGRAM_PUBLICATION_VALIDATION_REQUIRED",
            "Validate the latest draft before publishing.",
            HttpStatus.CONFLICT,
          );
        if (program.organization.status !== "ACTIVE")
          throw new AppError(
            "PROGRAM_PUBLICATION_ORGANIZATION_UNAVAILABLE",
            "This organization cannot publish programs in its current state.",
            HttpStatus.CONFLICT,
            { organizationStatus: program.organization.status },
          );
        const billing = program.organization.billingProfile;
        if (!billing)
          throw new AppError(
            "PROGRAM_PUBLICATION_BILLING_BLOCKED",
            "A current billing profile is required before publication.",
            HttpStatus.CONFLICT,
            { billingStatus: null },
          );
        const billingStatus = billing.subscriptionStatus
          .toLocaleLowerCase("en-US")
          .replaceAll("_", "_") as Parameters<typeof canPublishForBillingStatus>[0];
        if (!canPublishForBillingStatus(billingStatus))
          throw new AppError(
            "PROGRAM_PUBLICATION_BILLING_BLOCKED",
            "The current billing state does not allow publication.",
            HttpStatus.CONFLICT,
            { billingStatus },
          );
        const currentProgramUsage = await transaction.loyaltyProgram.count({
          where: { organizationId, status: { not: "ARCHIVED" } },
        });
        const currentPlan = toPlan(program.organization.selectedPlan);
        const publicationLimit = canPublishWithinProgramLimit(currentPlan, currentProgramUsage);
        if (!publicationLimit.allowed)
          throw new AppError(
            "PROGRAM_PUBLICATION_PROGRAM_LIMIT_EXCEEDED",
            "Reduce program usage or upgrade the plan before publishing.",
            HttpStatus.CONFLICT,
            {
              currentPlan,
              currentUsage: publicationLimit.currentUsage,
              limit: publicationLimit.limit,
              recommendedPlan: publicationLimit.recommendedPlan,
            },
          );
        const stampGoal = version.stampRule?.requiredStampCount ?? 0;
        const featureViolations = programPublicationFeatureViolations(currentPlan, {
          editingMode: version.editingMode,
          rewardThresholds: version.rewards.map((reward) => reward.thresholdStampCount),
          requiredStampCount: stampGoal,
          layoutType: version.visualTheme?.layoutType ?? "GRID",
        });
        if (featureViolations.length)
          throw new AppError(
            "PROGRAM_PUBLICATION_PLAN_BLOCKED",
            "The draft uses features that are unavailable on the current plan.",
            HttpStatus.CONFLICT,
            {
              currentPlan,
              recommendedPlan: currentPlan === "starter" ? "growth" : "scale",
              violations: featureViolations,
            },
          );
        const staleLocation = version.locations.find(
          ({ location }) =>
            location.organizationId !== organizationId || location.status !== "ACTIVE",
        );
        if (staleLocation)
          throw new AppError(
            "PROGRAM_PUBLICATION_LOCATION_STALE",
            "Every selected location must still belong to the organization and be active.",
            HttpStatus.CONFLICT,
            {
              locationId: staleLocation.locationId,
              locationStatus: staleLocation.location.status,
            },
          );
        if (!version.locations.length)
          throw new AppError(
            "PROGRAM_PUBLICATION_LOCATION_STALE",
            "At least one active location is required before publication.",
            HttpStatus.CONFLICT,
            { locationId: null, locationStatus: null },
          );
        const visual = version.visualTheme;
        if (!visual)
          throw new AppError(
            "PROGRAM_PUBLICATION_ASSET_STALE",
            "The current draft has no visual theme.",
            HttpStatus.CONFLICT,
            { role: "visualTheme", reason: "MISSING" },
          );
        const publicationAssets: Array<{
          asset: PublicationAsset | null;
          role: string;
          category: string;
          variant: "STAMP_256" | "ORIGINAL_SAFE";
          required: boolean;
        }> = [
          {
            asset: visual.filledStampAsset,
            role: "filledStamp",
            category: "STAMP_FILLED",
            variant: "STAMP_256",
            required: true,
          },
          {
            asset: visual.emptyStampAsset,
            role: "emptyStamp",
            category: "STAMP_EMPTY",
            variant: "STAMP_256",
            required: true,
          },
          {
            asset: visual.defaultMilestoneAsset,
            role: "defaultMilestone",
            category: "STAMP_MILESTONE",
            variant: "STAMP_256",
            required: false,
          },
          {
            asset: visual.logoAsset,
            role: "logo",
            category: "LOGO",
            variant: "ORIGINAL_SAFE",
            required: false,
          },
          {
            asset: visual.heroAsset,
            role: "hero",
            category: "HERO",
            variant: "ORIGINAL_SAFE",
            required: false,
          },
          {
            asset: visual.backgroundAsset,
            role: "background",
            category: "BACKGROUND",
            variant: "ORIGINAL_SAFE",
            required: false,
          },
          ...version.rewards.map((reward) => ({
            asset: reward.visualOverride?.stampAsset ?? null,
            role: `reward:${reward.id}`,
            category: "STAMP_MILESTONE",
            variant: "STAMP_256" as const,
            required: false,
          })),
        ];
        for (const selected of publicationAssets)
          await this.assertPublicationAsset(
            organizationId,
            selected.asset,
            selected.role,
            selected.category,
            selected.variant,
            selected.required,
          );
        const expectedFingerprint = digest({ versionId: version.id, revision: version.revision });
        const validation = version.validationRuns[0];
        const validationErrors = Array.isArray(validation?.errors) ? validation.errors : [];
        if (
          !validation ||
          validation.configurationFingerprint !== expectedFingerprint ||
          version.validationFingerprint !== expectedFingerprint ||
          !["PASSED", "VALID_WITH_WARNINGS"].includes(validation.status) ||
          validationErrors.length > 0
        )
          throw new AppError(
            "PROGRAM_PUBLICATION_VALIDATION_STALE",
            "Run validation again for the current draft revision.",
            HttpStatus.CONFLICT,
            {
              revision: version.revision,
              expectedFingerprint,
              validationStatus: validation?.status ?? null,
            },
          );
        const currentPreviews = await transaction.generatedProgramPreview.findMany({
          where: {
            organizationId,
            versionId: version.id,
            versionRevision: version.revision,
            previewType: { in: [...requiredPublicationPreviews] },
          },
          orderBy: { createdAt: "desc" },
        });
        for (const previewType of requiredPublicationPreviews) {
          const preview = currentPreviews.find((item) => item.previewType === previewType);
          if (!preview)
            throw new AppError(
              "PROGRAM_PUBLICATION_PREVIEW_STALE",
              "Generate every required preview for the current draft revision.",
              HttpStatus.CONFLICT,
              { profile: previewType, reason: "MISSING", revision: version.revision },
            );
          try {
            const bytes = await this.objectStorage.get(preview.objectKey);
            if (!preview.contentDigest || sha256Bytes(bytes) !== preview.contentDigest)
              throw new Error("preview digest mismatch");
          } catch {
            throw new AppError(
              "PROGRAM_PUBLICATION_PREVIEW_STALE",
              "A required preview is missing or corrupted and must be regenerated.",
              HttpStatus.CONFLICT,
              { profile: previewType, reason: "CONTENT_INVALID", revision: version.revision },
            );
          }
        }
        const now = new Date();
        const command = await transaction.programPublishCommand.create({
          data: {
            organizationId,
            programId,
            versionId: version.id,
            idempotencyKey,
            status: "PROCESSING",
          },
        });
        const published = await transaction.loyaltyProgramVersion.update({
          where: { id: version.id },
          data: { status: "PUBLISHED", publishedAt: now },
        });
        if (program.currentPublishedVersionId)
          await transaction.loyaltyProgramVersion.update({
            where: { id: program.currentPublishedVersionId },
            data: { status: "SUPERSEDED", supersededAt: now },
          });
        await transaction.loyaltyProgram.update({
          where: { id: programId },
          data: {
            currentPublishedVersionId: version.id,
            currentDraftVersionId: null,
            status: publicationState.resultingOperationalState,
            publishedAt:
              publicationState.publicationType === "FIRST_PUBLICATION"
                ? now
                : (program.publishedAt ?? now),
            pausedAt: publicationState.preservePausedAt ? program.pausedAt : null,
            revision: { increment: 1 },
          },
        });
        const completedCommand = await transaction.programPublishCommand.update({
          where: { id: command.id },
          data: {
            status: "COMPLETED",
            publishedVersionId: published.id,
            trialStarted: false,
            trialStart: null,
            trialEnd: null,
            completedAt: new Date(),
          },
        });
        await this.audit.recordInTransaction(
          transaction,
          {
            organizationId,
            actorUserId: userId,
            action: "program.published",
            targetType: "loyalty_program",
            targetId: programId,
            metadata: {
              commandId: completedCommand.id,
              versionId: version.id,
              trialStarted: false,
              previousOperationalState: publicationState.previousOperationalState,
              resultingOperationalState: publicationState.resultingOperationalState,
              publicationType: publicationState.publicationType,
              remainedPaused: publicationState.remainedPaused,
            },
          },
          request,
        );
        if (program.currentPublishedVersionId)
          await this.audit.recordInTransaction(
            transaction,
            {
              organizationId,
              actorUserId: userId,
              action: "program.version_superseded",
              targetType: "loyalty_program_version",
              targetId: program.currentPublishedVersionId,
              metadata: {
                commandId: completedCommand.id,
                replacementVersionId: version.id,
              },
            },
            request,
          );
        return completedCommand;
      },
    );
    return result;
  }

  private async assertPublicationAsset(
    organizationId: string,
    asset: PublicationAsset | null,
    role: string,
    expectedCategory: string,
    requiredVariant: "STAMP_256" | "ORIGINAL_SAFE",
    required: boolean,
  ) {
    if (!asset) {
      if (!required) return;
      throw new AppError(
        "PROGRAM_PUBLICATION_ASSET_STALE",
        `The selected ${role} asset is missing.`,
        HttpStatus.CONFLICT,
        { role, reason: "MISSING" },
      );
    }
    const fail = (reason: string): never => {
      throw new AppError(
        "PROGRAM_PUBLICATION_ASSET_STALE",
        `The selected ${role} asset is no longer publication-ready.`,
        HttpStatus.CONFLICT,
        { role, assetId: asset.id, reason },
      );
    };
    if (asset.organizationId !== organizationId) fail("TENANT_MISMATCH");
    if (asset.archivedAt || asset.processingStatus !== "READY") fail("NOT_READY");
    if (asset.category !== expectedCategory) fail("CATEGORY_MISMATCH");
    if (asset.source === "WAFLO_LIBRARY") {
      const metadata =
        asset.safeMetadata && typeof asset.safeMetadata === "object"
          ? (asset.safeMetadata as {
              inlineSvg?: unknown;
              contentDigest?: unknown;
              libraryCode?: unknown;
              libraryVersion?: unknown;
            })
          : null;
      if (
        !metadata ||
        typeof metadata?.inlineSvg !== "string" ||
        metadata.contentDigest !== asset.sha256Digest ||
        typeof metadata.libraryCode !== "string" ||
        typeof metadata.libraryVersion !== "number"
      )
        fail("LIBRARY_METADATA_INVALID");
      const validMetadata = metadata as {
        inlineSvg: string;
        contentDigest: string;
        libraryCode: string;
        libraryVersion: number;
      };
      const libraryCode = validMetadata.libraryCode;
      const libraryVersion = validMetadata.libraryVersion;
      const inlineSvg = validMetadata.inlineSvg;
      const artwork = artworkFor(libraryCode, libraryVersion);
      if (
        !artwork ||
        libraryArtworkDigest(artwork) !== asset.sha256Digest ||
        canonicalArtworkBytes(artwork).toString("utf8") !==
          canonicalArtworkBytes({ ...artwork, content: inlineSvg }).toString("utf8")
      )
        fail("LIBRARY_DIGEST_INVALID");
      return;
    }
    if (asset.source !== "MERCHANT_UPLOAD") fail("SOURCE_INVALID");
    const variant = asset.variants.find((item) => item.variantCode === requiredVariant);
    if (!variant) fail("VARIANT_MISSING");
    const selectedVariant = variant as PublicationAsset["variants"][number];
    try {
      const bytes = await this.objectStorage.get(selectedVariant.objectKey);
      if (!selectedVariant.digest || sha256Bytes(bytes) !== selectedVariant.digest)
        fail("OBJECT_DIGEST_INVALID");
    } catch (error) {
      if (error instanceof AppError) throw error;
      fail("OBJECT_MISSING");
    }
  }

  async transition(
    userId: string,
    organizationId: string,
    programId: string,
    action: "pause" | "resume" | "archive" | "restore",
    request: WafloRequest,
  ) {
    await this.tenant.requireMembership(userId, organizationId, "programs.manage_state");
    return withProgramLifecycleInvariantLock(
      this.prisma.client,
      organizationId,
      programId,
      async (transaction) => {
        const program = await transaction.loyaltyProgram.findFirst({
          where: { id: programId, organizationId },
          include: { currentDraftVersion: true },
        });
        if (!program)
          throw new AppError("PROGRAM_NOT_FOUND", "Program not found.", HttpStatus.NOT_FOUND);
        if (action === "pause" && program.status !== "PUBLISHED")
          throw new AppError(
            "PROGRAM_STATE_INVALID",
            "Only published programs can be paused.",
            HttpStatus.CONFLICT,
          );
        if (action === "resume" && program.status !== "PAUSED")
          throw new AppError(
            "PROGRAM_STATE_INVALID",
            "Only paused programs can be resumed.",
            HttpStatus.CONFLICT,
          );
        if (
          action === "archive" &&
          !["DRAFT", "VALIDATED", "TEST", "PUBLISHED", "PAUSED"].includes(program.status)
        )
          throw new AppError(
            "PROGRAM_STATE_INVALID",
            "Only editable or live programs can be archived.",
            HttpStatus.CONFLICT,
          );
        let nextStatus: "DRAFT" | "VALIDATED" | "TEST" | "PUBLISHED" | "PAUSED" | "ARCHIVED";
        if (action === "pause") nextStatus = "PAUSED";
        else if (action === "resume") nextStatus = "PUBLISHED";
        else if (action === "archive") nextStatus = "ARCHIVED";
        else if (program.currentPublishedVersionId) nextStatus = "PUBLISHED";
        else if (program.currentDraftVersion?.status === "VALIDATED") nextStatus = "VALIDATED";
        else if (program.currentDraftVersion?.status === "TEST_READY") nextStatus = "TEST";
        else nextStatus = "DRAFT";
        if (action === "restore") {
          if (
            program.status !== "ARCHIVED" ||
            (!program.currentPublishedVersionId && !program.currentDraftVersionId)
          )
            throw new AppError(
              "PROGRAM_STATE_INVALID",
              "Only archived programs with a preserved version can be restored.",
              HttpStatus.CONFLICT,
            );
          const organization = await transaction.organization.findUniqueOrThrow({
            where: { id: organizationId },
            select: { selectedPlan: true },
          });
          const usage = await transaction.loyaltyProgram.count({
            where: { organizationId, status: { not: "ARCHIVED" } },
          });
          const decision = canRestoreProgram(toPlan(organization.selectedPlan), usage);
          if (!decision.allowed)
            throw new AppError(
              "PROGRAM_LIMIT_REACHED",
              "Your plan cannot restore another active program.",
              HttpStatus.CONFLICT,
              { limit: decision.limit, currentUsage: decision.currentUsage },
            );
        }
        const updated = await transaction.loyaltyProgram.update({
          where: { id: programId },
          data: {
            status: nextStatus,
            pausedAt:
              action === "pause"
                ? new Date()
                : action === "resume" || action === "restore"
                  ? null
                  : program.pausedAt,
            archivedAt:
              action === "archive" ? new Date() : action === "restore" ? null : program.archivedAt,
            revision: { increment: 1 },
          },
        });
        const walletSyncJob = await this.queueProgramWalletStateSync(
          transaction,
          organizationId,
          programId,
          action,
          updated.revision,
        );
        await this.audit.recordInTransaction(
          transaction,
          {
            organizationId,
            actorUserId: userId,
            action: "program.wallet_sync_job_created",
            targetType: "program_wallet_sync_job",
            targetId: walletSyncJob.id,
            metadata: { programId, programRevision: updated.revision, programAction: action },
          },
          request,
        );
        await this.audit.recordInTransaction(
          transaction,
          {
            organizationId,
            actorUserId: userId,
            action: `program.${action}d`,
            targetType: "loyalty_program",
            targetId: programId,
            metadata: {
              previousStatus: program.status,
              nextStatus,
              preservedDraftVersionId: program.currentDraftVersionId,
              preservedPublishedVersionId: program.currentPublishedVersionId,
            },
          },
          request,
        );
        return updated;
      },
    );
  }

  async abandonDraft(
    userId: string,
    organizationId: string,
    programId: string,
    request: WafloRequest,
  ) {
    await this.tenant.requireMembership(userId, organizationId, "programs.edit");
    const result = await withOrganizationInvariantLock(
      this.prisma.client,
      organizationId,
      async (transaction) => {
        const program = await transaction.loyaltyProgram.findFirst({
          where: { id: programId, organizationId },
          include: { currentDraftVersion: true },
        });
        if (!program?.currentDraftVersion)
          throw new AppError(
            "PROGRAM_DRAFT_REQUIRED",
            "There is no editable draft to abandon.",
            HttpStatus.CONFLICT,
          );
        if (!program.currentPublishedVersionId)
          throw new AppError(
            "PROGRAM_INITIAL_DRAFT_ARCHIVE_REQUIRED",
            "Archive an unpublished program instead of abandoning its only draft.",
            HttpStatus.CONFLICT,
          );
        await transaction.loyaltyProgramVersion.update({
          where: { id: program.currentDraftVersion.id },
          data: { status: "ABANDONED", abandonedAt: new Date() },
        });
        const updated = await transaction.loyaltyProgram.update({
          where: { id: programId },
          data: { currentDraftVersionId: null },
        });
        await this.audit.recordInTransaction(
          transaction,
          {
            organizationId,
            actorUserId: userId,
            action: "program.draft_abandoned",
            targetType: "loyalty_program",
            targetId: programId,
            metadata: { draftVersionId: program.currentDraftVersion.id },
          },
          request,
        );
        return updated;
      },
    );
    return result;
  }

  private async queueProgramWalletStateSync(
    transaction: Prisma.TransactionClient,
    organizationId: string,
    programId: string,
    action: "pause" | "resume" | "archive" | "restore",
    programRevision: number,
  ) {
    const reason =
      action === "pause"
        ? "PROGRAM_PAUSED"
        : action === "resume" || action === "restore"
          ? "PROGRAM_RESUMED"
          : "PROGRAM_ARCHIVED";
    const idempotencyKey = `program-wallet-sync:${programId}:r${programRevision}:${action}`;
    return transaction.programWalletSyncJob.upsert({
      where: { idempotencyKey },
      create: {
        organizationId,
        programId,
        action,
        reason,
        commandType: action === "archive" ? "INVALIDATE" : "UPDATE",
        idempotencyKey,
        batchSize: 500,
      },
      update: {},
    });
  }

  private async ensureBuiltInAssets(
    transaction: Prisma.TransactionClient,
    organizationId: string,
    userId: string,
    template: ProgramTemplateDefinition,
  ) {
    const make = async (
      reference: ProgramTemplateDefinition["artwork"]["filled"],
      category: "STAMP_FILLED" | "STAMP_EMPTY" | "STAMP_MILESTONE",
    ) => {
      const artwork = artworkFor(reference);
      if (!artwork)
        throw new AppError(
          "PROGRAM_LIBRARY_ARTWORK_NOT_FOUND",
          "The selected template artwork version is unavailable.",
          HttpStatus.UNPROCESSABLE_ENTITY,
          { ...reference },
        );
      const bytes = canonicalArtworkBytes(artwork);
      const contentDigest = libraryArtworkDigest(artwork);
      const existing = await transaction.merchantAsset.findUnique({
        where: {
          organizationId_sha256Digest_category: {
            organizationId,
            sha256Digest: contentDigest,
            category,
          },
        },
      });
      if (existing) return existing;
      return transaction.merchantAsset.create({
        data: {
          organizationId,
          category,
          source: "WAFLO_LIBRARY",
          originalObjectKey: `built-in/v${reference.version}/${contentDigest}.svg`,
          originalFilename: `${reference.code}-v${reference.version}.svg`,
          mimeType: "image/svg+xml",
          fileSize: bytes.length,
          sha256Digest: contentDigest,
          processingStatus: "READY",
          createdByUserId: userId,
          safeMetadata: {
            storage: "waflo-library",
            inlineSvg: bytes.toString("utf8"),
            libraryCode: reference.code,
            libraryVersion: reference.version,
            librarySchemaVersion: LIBRARY_ARTWORK_SCHEMA_VERSION,
            contentDigest,
            license: "Waflo-owned artwork",
          },
        },
      });
    };
    const [filled, empty, milestone] = await Promise.all([
      make(template.artwork.filled, "STAMP_FILLED"),
      make(template.artwork.empty, "STAMP_EMPTY"),
      make(template.artwork.milestone, "STAMP_MILESTONE"),
    ]);
    return { filledId: filled.id, emptyId: empty.id, milestoneId: milestone.id };
  }

  private async assertAssetReferences(
    transaction: Prisma.TransactionClient,
    organizationId: string,
    visual: ProgramCreateInput["visualTheme"],
    rewards: ProgramCreateInput["rewards"] = [],
  ) {
    const ids = [
      ...new Set(
        [
          visual.logoAssetId,
          visual.heroAssetId,
          visual.backgroundAssetId,
          visual.filledStampAssetId,
          visual.emptyStampAssetId,
          visual.defaultMilestoneAssetId,
          ...rewards.map((reward) => reward.visualOverride?.stampAssetId),
        ].filter((value): value is string => Boolean(value)),
      ),
    ];
    if (!ids.length) return;
    const assets = await transaction.merchantAsset.findMany({
      where: { id: { in: ids }, organizationId, archivedAt: null, processingStatus: "READY" },
      select: { id: true, category: true },
    });
    if (assets.length !== ids.length)
      throw new AppError(
        "PROGRAM_ASSET_INVALID",
        "Every selected asset must belong to this organization and be ready.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    const categoryById = new Map(assets.map((asset) => [asset.id, asset.category]));
    const expected: Array<[string | undefined, string[]]> = [
      [visual.logoAssetId ?? undefined, ["LOGO"]],
      [visual.heroAssetId ?? undefined, ["HERO"]],
      [visual.backgroundAssetId ?? undefined, ["BACKGROUND"]],
      [visual.filledStampAssetId ?? undefined, ["STAMP_FILLED"]],
      [visual.emptyStampAssetId ?? undefined, ["STAMP_EMPTY"]],
      [visual.defaultMilestoneAssetId ?? undefined, ["STAMP_MILESTONE"]],
      ...rewards.map(
        (reward) =>
          [reward.visualOverride?.stampAssetId ?? undefined, ["STAMP_MILESTONE"]] as [
            string | undefined,
            string[],
          ],
      ),
    ];
    for (const [id, categories] of expected)
      if (id && !categories.includes(categoryById.get(id) ?? ""))
        throw new AppError(
          "PROGRAM_ASSET_CATEGORY_INVALID",
          "The selected asset does not match the visual role.",
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
  }

  private versionCreateData(
    input: ProgramCreateInput & { persistedStampPolicy?: PersistedStampPolicy },
    assets: { filledId: string; emptyId: string; milestoneId: string },
    locationIds: string[],
    userId: string,
    template: ProgramTemplateDefinition,
  ) {
    const visual = input.visualTheme;
    const policy = input.persistedStampPolicy ?? {
      defaultStampsPerAction: W2_STAMP_POLICY_DEFAULTS.defaultStampsPerAction,
      maximumStampsPerOperation: W2_STAMP_POLICY_DEFAULTS.maximumStampsPerOperation,
      maximumStampsPerCustomerPerDay: W2_STAMP_POLICY_DEFAULTS.maximumStampsPerCustomerPerDay,
      minimumPurchaseAmountMinor: W2_STAMP_POLICY_DEFAULTS.minimumPurchaseAmountMinor,
      minimumPurchaseCurrency: W2_STAMP_POLICY_DEFAULTS.minimumPurchaseCurrency,
      resetBehaviorAfterReward: W2_STAMP_POLICY_DEFAULTS.resetBehaviorAfterFinalReward,
    };
    return {
      status: "DRAFT" as const,
      operationalTimezone: input.operationalTimezone,
      staffOwnReversalWindowSeconds: input.staffOwnReversalWindowSeconds,
      managerReversalWindowMinutes: input.managerReversalWindowMinutes,
      managerOverrideAllowed: input.managerOverrideAllowed,
      editingMode: input.editingMode.toUpperCase() as "QUICK" | "PRO",
      baseTemplateCode: template.code,
      baseTemplateVersion: template.version,
      configurationSchemaVersion: 2,
      createdByUserId: userId,
      translations: {
        create: (["en", "ar"] as const).map((locale) => {
          const translation = input.translations[locale];
          return {
            locale: locale.toUpperCase() as "EN" | "AR",
            programName: translation.programName,
            shortDescription: translation.shortDescription,
            fullDescription: translation.fullDescription ?? null,
            rewardSummary: translation.rewardSummary,
            joinInstructions: translation.joinInstructions ?? null,
            termsAndConditions: translation.termsAndConditions,
            completionMessage: translation.completionMessage,
            rewardUnlockedMessage: translation.rewardUnlockedMessage,
            pausedMessage: translation.pausedMessage ?? null,
          };
        }),
      },
      stampRule: {
        create: {
          requiredStampCount: input.requiredStampCount,
          defaultStampsPerAction: policy.defaultStampsPerAction,
          maximumStampsPerOperation: input.maximumStampsPerOperation,
          maximumStampsPerCustomerPerDay: input.maximumStampsPerCustomerPerDay,
          minimumPurchaseAmountMinor: input.minimumPurchaseAmountMinor,
          minimumPurchaseCurrency: input.minimumPurchaseCurrency,
          earningDescription: input.earningDescription,
          resetBehaviorAfterReward: input.resetBehaviorAfterReward,
        },
      },
      rewards: {
        create: input.rewards.map((reward) => ({
          thresholdStampCount: reward.thresholdStampCount,
          rewardType: reward.rewardType,
          internalName: reward.internalName,
          sortOrder: reward.sortOrder,
          validityDurationDays: reward.validityDurationDays ?? null,
          requiresManagerApproval: reward.requiresManagerApproval,
          maximumRedemptionsPerEarned: reward.maximumRedemptionsPerEarned,
          translations: {
            create: (["en", "ar"] as const).map((locale) => {
              const translation = reward.translations[locale];
              return {
                locale: locale.toUpperCase() as "EN" | "AR",
                name: translation.name,
                description: translation.description,
                redemptionInstructions: translation.redemptionInstructions ?? null,
              };
            }),
          },
          ...(reward.visualOverride
            ? {
                visualOverride: {
                  create: {
                    stampAssetId: reward.visualOverride.stampAssetId ?? null,
                    accentOverride: reward.visualOverride.accentOverride ?? null,
                  },
                },
              }
            : {}),
        })),
      },
      locations: { create: locationIds.map((locationId) => ({ locationId })) },
      visualTheme: {
        create: {
          backgroundColor: visual.backgroundColor,
          foregroundColor: visual.foregroundColor,
          accentColor: visual.accentColor,
          secondaryColor: visual.secondaryColor,
          mutedColor: visual.mutedColor,
          filledStampAssetId: visual.filledStampAssetId ?? assets.filledId,
          emptyStampAssetId: visual.emptyStampAssetId ?? assets.emptyId,
          ...(visual.logoAssetId ? { logoAssetId: visual.logoAssetId } : {}),
          ...(visual.heroAssetId ? { heroAssetId: visual.heroAssetId } : {}),
          ...(visual.backgroundAssetId ? { backgroundAssetId: visual.backgroundAssetId } : {}),
          defaultMilestoneAssetId:
            visual.defaultMilestoneAssetId === undefined
              ? assets.milestoneId
              : visual.defaultMilestoneAssetId,
          layoutType: visual.layoutType,
          layoutConfiguration: visual.layoutConfiguration,
          stampSize: visual.stampSize,
          stampSpacing: visual.stampSpacing,
          borderRadius: visual.borderRadius,
          progressLabelVisible: visual.progressLabelVisible,
          rewardLabelVisible: visual.rewardLabelVisible,
          customerWebVariant: visual.customerWebVariant,
          applePreviewConfig: visual.applePreviewConfig,
          googlePreviewConfig: visual.googlePreviewConfig,
        },
      },
    };
  }

  private inputFromVersion(
    version: NonNullable<Awaited<ReturnType<ProgramsService["get"]>>["currentDraftVersion"]>,
    internalName: string,
  ): CanonicalMutableProgramInput {
    const en = version.translations.find((item) => item.locale === "EN");
    const ar = version.translations.find((item) => item.locale === "AR");
    return {
      internalName,
      editingMode: version.editingMode.toLowerCase() as "quick" | "pro",
      templateCode: version.baseTemplateCode ?? undefined,
      templateVersion: version.baseTemplateVersion ?? undefined,
      requiredStampCount: version.stampRule?.requiredStampCount ?? 8,
      operationalTimezone: version.operationalTimezone,
      maximumStampsPerOperation:
        version.stampRule?.maximumStampsPerOperation ??
        W2_STAMP_POLICY_DEFAULTS.maximumStampsPerOperation,
      maximumStampsPerCustomerPerDay: version.stampRule?.maximumStampsPerCustomerPerDay ?? null,
      minimumPurchaseAmountMinor: version.stampRule?.minimumPurchaseAmountMinor ?? null,
      minimumPurchaseCurrency: version.stampRule?.minimumPurchaseCurrency ?? null,
      staffOwnReversalWindowSeconds: version.staffOwnReversalWindowSeconds,
      managerReversalWindowMinutes: version.managerReversalWindowMinutes,
      managerOverrideAllowed: version.managerOverrideAllowed,
      resetBehaviorAfterReward: "RESET_ON_FINAL_REWARD_REDEMPTION",
      earningDescription:
        version.stampRule?.earningDescription ?? "One stamp per qualifying visit.",
      locationIds: version.locations.map((item) => item.locationId),
      translations: {
        en: {
          programName: en?.programName ?? internalName,
          shortDescription: en?.shortDescription ?? "",
          fullDescription: en?.fullDescription ?? undefined,
          rewardSummary: en?.rewardSummary ?? "",
          joinInstructions: en?.joinInstructions ?? undefined,
          termsAndConditions: en?.termsAndConditions ?? "",
          completionMessage: en?.completionMessage ?? "",
          rewardUnlockedMessage: en?.rewardUnlockedMessage ?? "",
          pausedMessage: en?.pausedMessage ?? undefined,
        },
        ar: {
          programName: ar?.programName ?? internalName,
          shortDescription: ar?.shortDescription ?? "",
          fullDescription: ar?.fullDescription ?? undefined,
          rewardSummary: ar?.rewardSummary ?? "",
          joinInstructions: ar?.joinInstructions ?? undefined,
          termsAndConditions: ar?.termsAndConditions ?? "",
          completionMessage: ar?.completionMessage ?? "",
          rewardUnlockedMessage: ar?.rewardUnlockedMessage ?? "",
          pausedMessage: ar?.pausedMessage ?? undefined,
        },
      },
      rewards: version.rewards.map((reward) => ({
        thresholdStampCount: reward.thresholdStampCount,
        rewardType: reward.rewardType,
        internalName: reward.internalName,
        sortOrder: reward.sortOrder,
        validityDurationDays: reward.validityDurationDays,
        requiresManagerApproval: reward.requiresManagerApproval,
        maximumRedemptionsPerEarned: reward.maximumRedemptionsPerEarned,
        visualOverride: reward.visualOverride
          ? {
              stampAssetId: reward.visualOverride.stampAssetId,
              accentOverride: reward.visualOverride.accentOverride,
            }
          : undefined,
        translations: {
          en: {
            name:
              reward.translations.find((item) => item.locale === "EN")?.name ?? reward.internalName,
            description:
              reward.translations.find((item) => item.locale === "EN")?.description ??
              reward.internalName,
            redemptionInstructions:
              reward.translations.find((item) => item.locale === "EN")?.redemptionInstructions ??
              undefined,
          },
          ar: {
            name:
              reward.translations.find((item) => item.locale === "AR")?.name ?? reward.internalName,
            description:
              reward.translations.find((item) => item.locale === "AR")?.description ??
              reward.internalName,
            redemptionInstructions:
              reward.translations.find((item) => item.locale === "AR")?.redemptionInstructions ??
              undefined,
          },
        },
      })),
      persistedStampPolicy: {
        defaultStampsPerAction:
          version.stampRule?.defaultStampsPerAction ??
          W2_STAMP_POLICY_DEFAULTS.defaultStampsPerAction,
        maximumStampsPerOperation:
          version.stampRule?.maximumStampsPerOperation ??
          W2_STAMP_POLICY_DEFAULTS.maximumStampsPerOperation,
        maximumStampsPerCustomerPerDay: version.stampRule?.maximumStampsPerCustomerPerDay ?? null,
        minimumPurchaseAmountMinor: version.stampRule?.minimumPurchaseAmountMinor ?? null,
        minimumPurchaseCurrency: version.stampRule?.minimumPurchaseCurrency ?? null,
        resetBehaviorAfterReward:
          version.stampRule?.resetBehaviorAfterReward ??
          W2_STAMP_POLICY_DEFAULTS.resetBehaviorAfterFinalReward,
      },
      ...(version.changeSummary ? { changeSummary: version.changeSummary } : {}),
      visualTheme: (version.visualTheme
        ? {
            backgroundColor: version.visualTheme.backgroundColor,
            foregroundColor: version.visualTheme.foregroundColor,
            accentColor: version.visualTheme.accentColor,
            secondaryColor: version.visualTheme.secondaryColor,
            mutedColor: version.visualTheme.mutedColor,
            filledStampAssetId: version.visualTheme.filledStampAssetId,
            emptyStampAssetId: version.visualTheme.emptyStampAssetId,
            logoAssetId: version.visualTheme.logoAssetId,
            heroAssetId: version.visualTheme.heroAssetId,
            backgroundAssetId: version.visualTheme.backgroundAssetId,
            defaultMilestoneAssetId: version.visualTheme.defaultMilestoneAssetId,
            layoutType: version.visualTheme.layoutType,
            layoutConfiguration: version.visualTheme.layoutConfiguration as Record<string, unknown>,
            stampSize: version.visualTheme.stampSize,
            stampSpacing: version.visualTheme.stampSpacing,
            borderRadius: version.visualTheme.borderRadius,
            progressLabelVisible: version.visualTheme.progressLabelVisible,
            rewardLabelVisible: version.visualTheme.rewardLabelVisible,
            customerWebVariant: version.visualTheme.customerWebVariant as
              | "CARD"
              | "MINIMAL"
              | "HERO",
            applePreviewConfig: version.visualTheme.applePreviewConfig as Record<string, unknown>,
            googlePreviewConfig: version.visualTheme.googlePreviewConfig as Record<string, unknown>,
          }
        : {}) as never,
    };
  }

  private async clearDraftChildren(transaction: Prisma.TransactionClient, versionId: string) {
    const rewards = await transaction.rewardDefinition.findMany({
      where: { versionId },
      select: { id: true },
    });
    const rewardIds = rewards.map((reward) => reward.id);
    if (rewardIds.length) {
      await transaction.rewardTranslation.deleteMany({ where: { rewardId: { in: rewardIds } } });
      await transaction.rewardVisualOverride.deleteMany({ where: { rewardId: { in: rewardIds } } });
      await transaction.rewardDefinition.deleteMany({ where: { versionId } });
    }
    await transaction.programTranslation.deleteMany({ where: { versionId } });
    await transaction.programLocation.deleteMany({ where: { versionId } });
    await transaction.stampRule.deleteMany({ where: { versionId } });
    await transaction.programVisualTheme.deleteMany({ where: { versionId } });
  }

  private async cloneVersionData(
    transaction: Prisma.TransactionClient,
    versionId: string,
    userId: string,
  ) {
    const source = await transaction.loyaltyProgramVersion.findUniqueOrThrow({
      where: { id: versionId },
      include: includeVersion,
    });
    const theme = source.visualTheme;
    return {
      editingMode: source.editingMode,
      baseTemplateCode: source.baseTemplateCode,
      baseTemplateVersion: source.baseTemplateVersion,
      configurationSchemaVersion: source.configurationSchemaVersion,
      operationalTimezone: source.operationalTimezone,
      staffOwnReversalWindowSeconds: source.staffOwnReversalWindowSeconds,
      managerReversalWindowMinutes: source.managerReversalWindowMinutes,
      managerOverrideAllowed: source.managerOverrideAllowed,
      stampRule: source.stampRule
        ? {
            create: {
              requiredStampCount: source.stampRule.requiredStampCount,
              defaultStampsPerAction: source.stampRule.defaultStampsPerAction,
              maximumStampsPerOperation: source.stampRule.maximumStampsPerOperation,
              maximumStampsPerCustomerPerDay: source.stampRule.maximumStampsPerCustomerPerDay,
              minimumPurchaseAmountMinor: source.stampRule.minimumPurchaseAmountMinor,
              minimumPurchaseCurrency: source.stampRule.minimumPurchaseCurrency,
              earningDescription: source.stampRule.earningDescription,
              resetBehaviorAfterReward: "RESET_ON_FINAL_REWARD_REDEMPTION",
            },
          }
        : undefined,
      translations: {
        create: source.translations.map((item) => ({
          locale: item.locale,
          programName: item.programName,
          shortDescription: item.shortDescription,
          fullDescription: item.fullDescription,
          rewardSummary: item.rewardSummary,
          joinInstructions: item.joinInstructions,
          termsAndConditions: item.termsAndConditions,
          completionMessage: item.completionMessage,
          rewardUnlockedMessage: item.rewardUnlockedMessage,
          pausedMessage: item.pausedMessage,
        })),
      },
      rewards: {
        create: source.rewards.map((reward) => ({
          thresholdStampCount: reward.thresholdStampCount,
          rewardType: reward.rewardType,
          internalName: reward.internalName,
          sortOrder: reward.sortOrder,
          validityDurationDays: reward.validityDurationDays,
          requiresManagerApproval: reward.requiresManagerApproval,
          maximumRedemptionsPerEarned: reward.maximumRedemptionsPerEarned,
          translations: {
            create: reward.translations.map((item) => ({
              locale: item.locale,
              name: item.name,
              description: item.description,
              redemptionInstructions: item.redemptionInstructions,
            })),
          },
          ...(reward.visualOverride
            ? {
                visualOverride: {
                  create: {
                    stampAssetId: reward.visualOverride.stampAssetId,
                    accentOverride: reward.visualOverride.accentOverride,
                  },
                },
              }
            : {}),
        })),
      },
      locations: {
        create: source.locations.map((item) => ({
          locationId: item.locationId,
          earningEnabled: item.earningEnabled,
          redemptionEnabled: item.redemptionEnabled,
        })),
      },
      visualTheme: theme
        ? {
            create: {
              backgroundColor: theme.backgroundColor,
              foregroundColor: theme.foregroundColor,
              accentColor: theme.accentColor,
              secondaryColor: theme.secondaryColor,
              mutedColor: theme.mutedColor,
              logoAssetId: theme.logoAssetId,
              heroAssetId: theme.heroAssetId,
              backgroundAssetId: theme.backgroundAssetId,
              filledStampAssetId: theme.filledStampAssetId,
              emptyStampAssetId: theme.emptyStampAssetId,
              defaultMilestoneAssetId: theme.defaultMilestoneAssetId,
              layoutType: theme.layoutType,
              layoutConfiguration: theme.layoutConfiguration as object,
              stampSize: theme.stampSize,
              stampSpacing: theme.stampSpacing,
              borderRadius: theme.borderRadius,
              progressLabelVisible: theme.progressLabelVisible,
              rewardLabelVisible: theme.rewardLabelVisible,
              customerWebVariant: theme.customerWebVariant,
              applePreviewConfig: theme.applePreviewConfig as object,
              googlePreviewConfig: theme.googlePreviewConfig as object,
            },
          }
        : undefined,
      enrollmentPolicy: {
        create: {
          organizationId: source.organizationId,
          emailCollectionMode: source.enrollmentPolicy?.emailCollectionMode ?? "OPTIONAL",
          primaryCustomerLocale: source.enrollmentPolicy?.primaryCustomerLocale ?? "EN",
          allowLocaleSelection: source.enrollmentPolicy?.allowLocaleSelection ?? true,
          marketingConsentVisible: source.enrollmentPolicy?.marketingConsentVisible ?? false,
          marketingConsentDefault: false,
          customerTermsRequired: true,
          transferWithoutEmailAllowed: source.enrollmentPolicy?.transferWithoutEmailAllowed ?? true,
          enrollmentOpen: source.enrollmentPolicy?.enrollmentOpen ?? true,
        },
      },
      createdByUserId: userId,
    };
  }

  private async allocatePublicSlug(
    transaction: Prisma.TransactionClient,
    organizationId: string,
    customerFacingName: string,
  ): Promise<string> {
    const rawBase = slugifyProgramName(customerFacingName, "program");
    const base = reservedProgramSlugs.has(rawBase) ? `program-${rawBase}` : rawBase;
    for (let suffix = 1; suffix <= 200; suffix += 1) {
      const addition = suffix === 1 ? "" : `-${suffix}`;
      const candidate = `${base.slice(0, 50 - addition.length).replace(/-+$/g, "")}${addition}`;
      const [current, reserved] = await Promise.all([
        transaction.loyaltyProgram.findFirst({
          where: { organizationId, publicSlug: candidate },
          select: { id: true },
        }),
        transaction.programPublicSlugHistory.findFirst({
          where: { organizationId, slug: candidate, reservedUntil: { gt: new Date() } },
          select: { id: true },
        }),
      ]);
      if (!current && !reserved) return candidate;
    }
    throw new AppError(
      "PROGRAM_PUBLIC_SLUG_UNAVAILABLE",
      "Unable to allocate a public program URL.",
      HttpStatus.CONFLICT,
    );
  }
}

export { templates };
