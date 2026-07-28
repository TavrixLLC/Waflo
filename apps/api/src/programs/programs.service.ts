import { HttpStatus, Injectable } from "@nestjs/common";
import { canCreateProgram, canRestoreProgram, programEntitlement } from "@waflo/billing";
import type { ProgramCreateInput, ProgramUpdateInput } from "@waflo/contracts";
import type { Prisma } from "@waflo/database";
import { AuditService } from "../audit/audit.service.js";
import { AppError } from "../common/app-error.js";
import { withOrganizationInvariantLock } from "../common/organization-transaction.js";
import type { WafloRequest } from "../common/request-context.js";
import { PrismaService } from "../database/prisma.service.js";
import { TenantService } from "../tenancy/tenant.service.js";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { renderStampSvg, type StampOutputProfile } from "@waflo/stamp-engine";
import { artworkFor, conceptTemplates } from "./library-artwork.js";

const templates = conceptTemplates();

const includeVersion = {
  translations: true,
  stampRule: true,
  rewards: { include: { translations: true, visualOverride: true } },
  locations: { include: { location: true } },
  visualTheme: true,
} as const;

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function toPlan(value: "STARTER" | "GROWTH" | "SCALE") {
  return value.toLocaleLowerCase("en-US") as "starter" | "growth" | "scale";
}

function templateFor(code?: string) {
  const template = templates.find((item) => item.code === code) ?? templates[0];
  if (!template)
    throw new AppError(
      "PROGRAM_TEMPLATE_NOT_FOUND",
      "Program template not found.",
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  return template;
}

@Injectable()
export class ProgramsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly audit: AuditService,
  ) {}

  list(userId: string, organizationId: string) {
    return this.tenant.requireMembership(userId, organizationId, "programs.view").then(() =>
      this.prisma.client.loyaltyProgram.findMany({
        where: { organizationId },
        orderBy: { updatedAt: "desc" },
        include: {
          currentDraftVersion: {
            select: {
              id: true,
              versionNumber: true,
              status: true,
              editingMode: true,
              revision: true,
            },
          },
          currentPublishedVersion: {
            select: { id: true, versionNumber: true, status: true, publishedAt: true },
          },
          _count: { select: { versions: true } },
        },
      }),
    );
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

  listVersions(userId: string, organizationId: string, programId: string) {
    return this.tenant.requireMembership(userId, organizationId, "programs.view").then(async () => {
      const program = await this.prisma.client.loyaltyProgram.findFirst({
        where: { id: programId, organizationId },
        select: { id: true },
      });
      if (!program)
        throw new AppError("PROGRAM_NOT_FOUND", "Program not found.", HttpStatus.NOT_FOUND);
      return this.prisma.client.loyaltyProgramVersion.findMany({
        where: { programId, organizationId },
        orderBy: { versionNumber: "desc" },
        take: 50,
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

  templates(userId: string, organizationId: string) {
    return this.tenant.requireMembership(userId, organizationId, "programs.view").then(() =>
      templates.map((template) => ({
        ...template,
        artwork: {
          filled: `data:image/svg+xml;base64,${Buffer.from(artworkFor(template.filled)?.content ?? "", "utf8").toString("base64")}`,
          empty: `data:image/svg+xml;base64,${Buffer.from(artworkFor(template.empty)?.content ?? "", "utf8").toString("base64")}`,
        },
      })),
    );
  }

  async preview(
    userId: string,
    organizationId: string,
    programId: string,
    progress: number,
    layout: "ROW" | "GRID" | "PATH" | "RING",
    outputProfile: StampOutputProfile = "CUSTOMER_WEB",
  ) {
    await this.tenant.requireMembership(userId, organizationId, "programs.view");
    const program = await this.prisma.client.loyaltyProgram.findFirst({
      where: { id: programId, organizationId },
      include: {
        currentDraftVersion: {
          include: {
            stampRule: true,
            visualTheme: {
              include: {
                filledStampAsset: true,
                emptyStampAsset: true,
                defaultMilestoneAsset: true,
              },
            },
          },
        },
        currentPublishedVersion: {
          include: {
            stampRule: true,
            visualTheme: {
              include: {
                filledStampAsset: true,
                emptyStampAsset: true,
                defaultMilestoneAsset: true,
              },
            },
          },
        },
      },
    });
    const version = program?.currentDraftVersion ?? program?.currentPublishedVersion;
    if (!version)
      throw new AppError(
        "PROGRAM_VERSION_NOT_FOUND",
        "Program version not found.",
        HttpStatus.NOT_FOUND,
      );
    const goal = version.stampRule?.requiredStampCount ?? 8;
    const visual = version.visualTheme;
    const safeProgress = Math.max(0, Math.min(goal, progress));
    const storedLayout = visual?.layoutType ?? layout;
    const safeLayout = storedLayout === layout ? storedLayout : layout;
    const assetArtwork = async (
      asset:
        | { id: string; originalFilename: string; safeMetadata: unknown; mimeType: string }
        | null
        | undefined,
    ) => {
      const metadata = asset?.safeMetadata;
      if (!asset) return undefined;
      if (
        metadata &&
        typeof metadata === "object" &&
        "inlineSvg" in metadata &&
        typeof metadata.inlineSvg === "string"
      )
        return { kind: "svg" as const, content: metadata.inlineSvg, trusted: true as const };
      if (!asset.mimeType.startsWith("image/")) return undefined;
      try {
        const bytes = await readFile(
          join(
            process.cwd(),
            "tmp",
            "waflo-assets",
            organizationId,
            asset.id,
            asset.originalFilename,
          ),
        );
        return {
          kind: "data-uri" as const,
          value: `data:${asset.mimeType};base64,${bytes.toString("base64")}`,
          mimeType: asset.mimeType as "image/png" | "image/jpeg" | "image/webp",
          trusted: true as const,
        };
      } catch {
        return undefined;
      }
    };
    const [filledArtwork, emptyArtwork, milestoneArtwork] = await Promise.all([
      assetArtwork(visual?.filledStampAsset),
      assetArtwork(visual?.emptyStampAsset),
      assetArtwork(visual?.defaultMilestoneAsset),
    ]);
    const rendered = renderStampSvg({
      goal,
      progress: safeProgress,
      layout: safeLayout,
      outputProfile,
      filledColor: visual?.accentColor ?? "#E4572E",
      emptyColor: visual?.backgroundColor ?? "#F7F4EE",
      accentColor: visual?.foregroundColor ?? "#222222",
      ...(filledArtwork ? { filledArtwork } : {}),
      ...(emptyArtwork ? { emptyArtwork } : {}),
      ...(milestoneArtwork ? { milestoneArtwork } : {}),
      label: `${safeProgress}/${goal}`,
    });
    const objectKey = `previews/${organizationId}/${version.id}/${rendered.digest}.svg`;
    const filePath = join(
      process.cwd(),
      "tmp",
      "waflo-previews",
      organizationId,
      version.id,
      `${rendered.digest}.svg`,
    );
    await mkdir(join(process.cwd(), "tmp", "waflo-previews", organizationId, version.id), {
      recursive: true,
    });
    await writeFile(filePath, rendered.svg, { flag: "w" });
    const previewType =
      outputProfile === "APPLE_WALLET"
        ? "APPLE_WALLET_PREVIEW"
        : outputProfile === "GOOGLE_WALLET"
          ? "GOOGLE_WALLET_PREVIEW"
          : "CUSTOMER_WEB_CARD";
    const preview = await this.prisma.client.generatedProgramPreview.upsert({
      where: {
        versionId_previewType_progressState_configurationHash: {
          versionId: version.id,
          previewType,
          progressState: safeProgress,
          configurationHash: rendered.digest,
        },
      },
      update: { lastAccessedAt: new Date() },
      create: {
        organizationId,
        versionId: version.id,
        previewType,
        progressState: safeProgress,
        configurationHash: rendered.digest,
        objectKey,
        mimeType: "image/svg+xml",
        width: rendered.width,
        height: rendered.height,
      },
    });
    return { ...preview, svg: rendered.svg, digest: rendered.digest };
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
        const themeAssets = await this.ensureBuiltInAssets(
          transaction,
          organizationId,
          userId,
          templateFor(input.templateCode),
        );
        await this.assertAssetReferences(transaction, organizationId, input.visualTheme);
        const versionData = this.versionCreateData(
          input,
          themeAssets,
          locations.map((location) => location.id),
          userId,
        );
        const program = await transaction.loyaltyProgram.create({
          data: {
            organizationId,
            internalName: input.internalName,
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
        const updated = await transaction.loyaltyProgram.update({
          where: { id: program.id },
          data: { currentDraftVersionId: version.id },
        });
        await this.audit.record(
          {
            organizationId,
            actorUserId: userId,
            action: "program.created",
            targetType: "loyalty_program",
            targetId: program.id,
            metadata: { versionId: version.id, templateCode: input.templateCode ?? null },
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
        const next = {
          ...this.inputFromVersion(current, program.internalName),
          ...input,
        } as ProgramCreateInput & { changeSummary?: string };
        await this.assertAssetReferences(transaction, organizationId, next.visualTheme);
        await this.clearDraftChildren(transaction, current.id);
        const assets = await this.ensureBuiltInAssets(
          transaction,
          organizationId,
          userId,
          templateFor(next.templateCode ?? current.baseTemplateCode ?? undefined),
        );
        const versionData = this.versionCreateData(
          next,
          assets,
          next.locationIds ?? current.locations.map((item) => item.locationId),
          userId,
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
          data: { internalName: next.internalName, revision: { increment: 1 } },
          include: { currentDraftVersion: { include: includeVersion } },
        });
        await this.audit.record(
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
    _request: WafloRequest,
  ) {
    await this.tenant.requireMembership(userId, organizationId, "programs.edit");
    return withOrganizationInvariantLock(
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
        return transaction.loyaltyProgram.update({
          where: { id: programId },
          data: { currentDraftVersionId: version.id, latestVersionNumber: { increment: 1 } },
          include: {
            currentDraftVersion: { include: includeVersion },
            currentPublishedVersion: { include: includeVersion },
          },
        });
      },
    );
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
            currentDraftVersion: {
              include: { ...includeVersion, locations: { include: { location: true } } },
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
        const errors: Array<{ code: string; path: string; message: string }> = [];
        const warnings: Array<{ code: string; path: string; message: string }> = [];
        if (
          !version.stampRule ||
          version.stampRule.requiredStampCount < 2 ||
          version.stampRule.requiredStampCount > 30
        )
          errors.push({
            code: "STAMP_GOAL_INVALID",
            path: "stampRule.requiredStampCount",
            message: "Stamp goal must be between 2 and 30.",
          });
        for (const locale of ["EN", "AR"] as const) {
          const translation = version.translations.find((item) => item.locale === locale);
          if (
            !translation?.programName.trim() ||
            !translation.shortDescription.trim() ||
            !translation.rewardSummary.trim() ||
            !translation.termsAndConditions.trim() ||
            !translation.completionMessage.trim() ||
            !translation.rewardUnlockedMessage.trim()
          )
            errors.push({
              code: "TRANSLATION_REQUIRED",
              path: `translations.${locale.toLowerCase()}`,
              message: `${locale} customer content is required.`,
            });
        }
        if (!version.rewards.length)
          errors.push({
            code: "REWARD_REQUIRED",
            path: "rewards",
            message: "Add at least one reward.",
          });
        if (
          version.rewards.some(
            (reward) =>
              reward.thresholdStampCount < 1 ||
              reward.thresholdStampCount > (version.stampRule?.requiredStampCount ?? 0),
          )
        )
          errors.push({
            code: "REWARD_AFTER_GOAL",
            path: "rewards",
            message: "Every reward threshold must be at or before the final stamp goal.",
          });
        if (version.rewards.some((reward) => reward.maximumRedemptionsPerEarned < 1))
          errors.push({
            code: "REWARD_ENTITLEMENT_INVALID",
            path: "rewards",
            message: "Each reward must allow at least one redemption per earned reward.",
          });
        if (
          !version.locations.length ||
          version.locations.some((item) => item.location.status !== "ACTIVE")
        )
          errors.push({
            code: "LOCATION_REQUIRED",
            path: "locations",
            message: "Select at least one active location.",
          });
        if (!version.visualTheme)
          errors.push({
            code: "VISUAL_THEME_REQUIRED",
            path: "visualTheme",
            message: "Choose a visual theme.",
          });
        if (version.stampRule && version.stampRule.maximumStampsPerOperation > 5)
          warnings.push({
            code: "STAMP_OPERATION_LIMIT",
            path: "stampRule.maximumStampsPerOperation",
            message: "Large stamp batches may reduce the clarity of the customer journey.",
          });
        if (
          version.visualTheme &&
          version.visualTheme.layoutType === "RING" &&
          version.stampRule &&
          version.stampRule.requiredStampCount > 20
        )
          warnings.push({
            code: "RING_DENSITY",
            path: "visualTheme.layoutType",
            message: "Ring layouts with more than 20 stamps may be dense on small screens.",
          });
        const fingerprint = digest({
          versionId: version.id,
          revision: version.revision,
          translations: version.translations,
          rule: version.stampRule,
          rewards: version.rewards,
          locations: version.locations,
          visual: version.visualTheme,
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
            errors,
            warnings,
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
        return { ...run, errors, warnings };
      },
    );
    await this.audit.record(
      {
        organizationId,
        actorUserId: userId,
        action: "program.validated",
        targetType: "loyalty_program",
        targetId: programId,
        metadata: { status: result.status },
      },
      request,
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

  async addTestStamps(
    userId: string,
    organizationId: string,
    sessionId: string,
    amount: number,
    idempotencyKey: string,
    request: WafloRequest,
  ) {
    await this.tenant.requireMembership(userId, organizationId, "programs.test");
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
          where: { sessionId_idempotencyKey: { sessionId, idempotencyKey } },
        });
        if (existing)
          return transaction.programTestSession.findUniqueOrThrow({
            where: { id: sessionId },
            include: { events: { orderBy: { createdAt: "desc" }, take: 20 } },
          });
        const goal = session.version.stampRule?.requiredStampCount ?? 8;
        const rawCount = session.currentStampCount + amount;
        const cyclesCompleted = Math.floor(rawCount / goal);
        const nextCount = rawCount % goal;
        await transaction.programTestEvent.create({
          data: {
            sessionId,
            eventType: "TEST_STAMP_EARNED",
            amount,
            idempotencyKey,
            createdByUserId: userId,
          },
        });
        for (
          let cycle = session.cycleCount + 1;
          cycle <= session.cycleCount + cyclesCompleted;
          cycle += 1
        )
          for (const reward of session.version.rewards.filter(
            (item) => item.thresholdStampCount <= goal,
          ))
            await transaction.programTestEvent.create({
              data: {
                sessionId,
                eventType: "TEST_REWARD_UNLOCKED",
                amount: 1,
                rewardDefinitionId: reward.id,
                idempotencyKey: `${idempotencyKey}:${cycle}:${reward.id}`,
                createdByUserId: userId,
                safeMetadata: { cycle },
              },
            });
        return transaction.programTestSession.update({
          where: { id: sessionId },
          data: {
            currentStampCount: nextCount,
            ...(cyclesCompleted ? { cycleCount: { increment: cyclesCompleted } } : {}),
            status: "ACTIVE",
          },
          include: { events: { orderBy: { createdAt: "desc" }, take: 20 } },
        });
      },
    );
    await this.audit.record(
      {
        organizationId,
        actorUserId: userId,
        action: "program.test_stamps_added",
        targetType: "program_test_session",
        targetId: sessionId,
        metadata: { amount },
      },
      request,
    );
    return result;
  }

  async redeemTestReward(
    userId: string,
    organizationId: string,
    sessionId: string,
    rewardId: string,
    idempotencyKey: string,
    _request: WafloRequest,
  ) {
    await this.tenant.requireMembership(userId, organizationId, "programs.test");
    return withOrganizationInvariantLock(
      this.prisma.client,
      organizationId,
      async (transaction) => {
        const session = await transaction.programTestSession.findFirst({
          where: { id: sessionId, organizationId },
          include: { version: { include: { rewards: true } } },
        });
        const reward = session?.version.rewards.find((item) => item.id === rewardId);
        if (!session || !reward)
          throw new AppError(
            "TEST_REWARD_NOT_FOUND",
            "Test reward not found.",
            HttpStatus.NOT_FOUND,
          );
        const existing = await transaction.programTestEvent.findUnique({
          where: { sessionId_idempotencyKey: { sessionId, idempotencyKey } },
        });
        if (existing) return existing;
        const latestReset = await transaction.programTestEvent.findFirst({
          where: { sessionId, eventType: "TEST_SESSION_RESET" },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        });
        const sinceReset = latestReset ? { createdAt: { gt: latestReset.createdAt } } : {};
        const redeemed = await transaction.programTestEvent.count({
          where: {
            sessionId,
            rewardDefinitionId: rewardId,
            eventType: "TEST_REWARD_REDEEMED",
            ...sinceReset,
          },
        });
        if (redeemed >= reward.maximumRedemptionsPerEarned)
          throw new AppError(
            "TEST_REWARD_ALREADY_REDEEMED",
            "This synthetic reward has already been redeemed.",
            HttpStatus.CONFLICT,
          );
        const unlocked = await transaction.programTestEvent.count({
          where: {
            sessionId,
            rewardDefinitionId: rewardId,
            eventType: "TEST_REWARD_UNLOCKED",
            ...sinceReset,
          },
        });
        if (unlocked <= redeemed)
          throw new AppError(
            "TEST_REWARD_NOT_UNLOCKED",
            "Reach this reward threshold in Test Mode first.",
            HttpStatus.CONFLICT,
          );
        const event = await transaction.programTestEvent.create({
          data: {
            sessionId,
            rewardDefinitionId: rewardId,
            eventType: "TEST_REWARD_REDEEMED",
            idempotencyKey,
            amount: 1,
            createdByUserId: userId,
          },
        });
        const rewardIds = session.version.rewards.map((item) => item.id);
        const redeemedRewardIds = await transaction.programTestEvent.findMany({
          where: {
            sessionId,
            eventType: "TEST_REWARD_REDEEMED",
            rewardDefinitionId: { in: rewardIds },
            ...sinceReset,
          },
          distinct: ["rewardDefinitionId"],
          select: { rewardDefinitionId: true },
        });
        if (session.cycleCount > 0 && redeemedRewardIds.length === rewardIds.length) {
          await transaction.programTestSession.update({
            where: { id: sessionId },
            data: { status: "COMPLETED" },
          });
          await transaction.loyaltyProgramVersion.update({
            where: { id: session.versionId },
            data: { status: "TEST_READY", testReadyAt: new Date() },
          });
        }
        return event;
      },
    );
  }

  async resetTestSession(
    userId: string,
    organizationId: string,
    sessionId: string,
    request: WafloRequest,
    idempotencyKey = `reset:${sessionId}`,
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
    await this.tenant.requireMembership(userId, organizationId, "programs.publish");
    let replayed = false;
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
          replayed = true;
          return replay;
        }
        const program = await transaction.loyaltyProgram.findFirst({
          where: { id: programId, organizationId },
          include: { currentDraftVersion: true },
        });
        const version = program?.currentDraftVersion;
        if (
          !program ||
          version?.status !== "TEST_READY" ||
          !version.validationFingerprint ||
          !version.testReadyAt
        )
          throw new AppError(
            "PROGRAM_TEST_REQUIRED",
            "Complete Test Mode after the latest validation before publishing.",
            HttpStatus.CONFLICT,
          );
        const completedTest = await transaction.programTestSession.findFirst({
          where: { organizationId, versionId: version.id, status: "COMPLETED" },
          select: { id: true },
        });
        if (!completedTest)
          throw new AppError(
            "PROGRAM_TEST_REQUIRED",
            "Complete the synthetic customer journey before publishing.",
            HttpStatus.CONFLICT,
          );
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
        const billing = await transaction.organizationBillingProfile.findUniqueOrThrow({
          where: { organizationId },
        });
        const shouldStartTrial =
          billing.subscriptionStatus === "PENDING_ACTIVATION" && billing.trialStart === null;
        const trialEnd = shouldStartTrial
          ? new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000)
          : null;
        if (shouldStartTrial)
          await transaction.organizationBillingProfile.update({
            where: { organizationId },
            data: {
              subscriptionStatus: "TRIALING",
              trialStart: now,
              trialEnd,
              trialTriggeringProgramId: programId,
              trialTriggeringUserId: userId,
            },
          });
        await transaction.loyaltyProgram.update({
          where: { id: programId },
          data: {
            currentPublishedVersionId: version.id,
            currentDraftVersionId: null,
            status: "PUBLISHED",
            publishedAt: now,
            revision: { increment: 1 },
          },
        });
        return transaction.programPublishCommand.update({
          where: { id: command.id },
          data: {
            status: "COMPLETED",
            publishedVersionId: published.id,
            trialStarted: shouldStartTrial,
            trialStart: shouldStartTrial ? now : null,
            trialEnd,
            completedAt: new Date(),
          },
        });
      },
    );
    if (!replayed)
      await this.audit.record(
        {
          organizationId,
          actorUserId: userId,
          action: "program.published",
          targetType: "loyalty_program",
          targetId: programId,
          metadata: { commandId: result.id, trialStarted: result.trialStarted },
        },
        request,
      );
    return result;
  }

  async transition(
    userId: string,
    organizationId: string,
    programId: string,
    action: "pause" | "resume" | "archive" | "restore",
    request: WafloRequest,
  ) {
    await this.tenant.requireMembership(userId, organizationId, "programs.manage_state");
    const state =
      action === "pause"
        ? "PAUSED"
        : action === "resume" || action === "restore"
          ? "PUBLISHED"
          : "ARCHIVED";
    const program = await this.prisma.client.loyaltyProgram.findFirst({
      where: { id: programId, organizationId },
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
    if (action === "archive" && !["PUBLISHED", "PAUSED"].includes(program.status))
      throw new AppError(
        "PROGRAM_STATE_INVALID",
        "Only live programs can be archived.",
        HttpStatus.CONFLICT,
      );
    if (action === "restore") {
      if (program.status !== "ARCHIVED" || !program.currentPublishedVersionId)
        throw new AppError(
          "PROGRAM_STATE_INVALID",
          "Only archived programs with a published version can be restored.",
          HttpStatus.CONFLICT,
        );
      const organization = await this.prisma.client.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { selectedPlan: true },
      });
      const usage = await this.prisma.client.loyaltyProgram.count({
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
    const updated = await this.prisma.client.loyaltyProgram.update({
      where: { id: programId },
      data: {
        status: state,
        pausedAt:
          action === "pause"
            ? new Date()
            : action === "resume" || action === "restore"
              ? null
              : program.pausedAt,
        archivedAt:
          action === "archive" ? new Date() : action === "restore" ? null : program.archivedAt,
      },
    });
    await this.audit.record(
      {
        organizationId,
        actorUserId: userId,
        action: `program.${action}d`,
        targetType: "loyalty_program",
        targetId: programId,
      },
      request,
    );
    return updated;
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
        await transaction.loyaltyProgramVersion.update({
          where: { id: program.currentDraftVersion.id },
          data: { status: "ABANDONED", abandonedAt: new Date() },
        });
        return transaction.loyaltyProgram.update({
          where: { id: programId },
          data: { currentDraftVersionId: null },
        });
      },
    );
    await this.audit.record(
      {
        organizationId,
        actorUserId: userId,
        action: "program.draft_abandoned",
        targetType: "loyalty_program",
        targetId: programId,
      },
      request,
    );
    return result;
  }

  private async ensureBuiltInAssets(
    transaction: Prisma.TransactionClient,
    organizationId: string,
    userId: string,
    template: (typeof templates)[number],
  ) {
    const make = async (key: string, category: "STAMP_FILLED" | "STAMP_EMPTY") => {
      const content = artworkFor(key)?.content ?? "";
      return transaction.merchantAsset.upsert({
        where: { organizationId_sha256Digest: { organizationId, sha256Digest: digest(key) } },
        update: {
          fileSize: Buffer.byteLength(content),
          safeMetadata: {
            storage: "waflo-library",
            inlineSvg: content,
            libraryCode: key,
            license: "Waflo-owned artwork",
          },
        },
        create: {
          organizationId,
          category,
          source: "WAFLO_LIBRARY",
          originalObjectKey: `built-in/${key}.svg`,
          originalFilename: `${key}.svg`,
          mimeType: "image/svg+xml",
          fileSize: Buffer.byteLength(content),
          sha256Digest: digest(key),
          processingStatus: "READY",
          createdByUserId: userId,
          safeMetadata: {
            storage: "waflo-library",
            inlineSvg: content,
            libraryCode: key,
            license: "Waflo-owned artwork",
          },
        },
      });
    };
    const [filled, empty] = await Promise.all([
      make(template.filled, "STAMP_FILLED"),
      make(template.empty, "STAMP_EMPTY"),
    ]);
    return { filledId: filled.id, emptyId: empty.id };
  }

  private async assertAssetReferences(
    transaction: Prisma.TransactionClient,
    organizationId: string,
    visual: ProgramCreateInput["visualTheme"],
  ) {
    const ids = [
      visual.logoAssetId,
      visual.heroAssetId,
      visual.backgroundAssetId,
      visual.filledStampAssetId,
      visual.emptyStampAssetId,
      visual.defaultMilestoneAssetId,
    ].filter((value): value is string => Boolean(value));
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
    input: ProgramCreateInput,
    assets: { filledId: string; emptyId: string },
    locationIds: string[],
    userId: string,
  ) {
    const visual = input.visualTheme;
    return {
      status: "DRAFT" as const,
      editingMode: input.editingMode.toUpperCase() as "QUICK" | "PRO",
      baseTemplateCode: input.templateCode ?? null,
      configurationSchemaVersion: 1,
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
          defaultStampsPerAction: 1,
          maximumStampsPerOperation: 5,
          earningDescription: input.earningDescription,
          resetBehaviorAfterReward: "RESET",
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
          ...(visual.defaultMilestoneAssetId
            ? { defaultMilestoneAssetId: visual.defaultMilestoneAssetId }
            : {}),
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
  ): ProgramCreateInput {
    const en = version.translations.find((item) => item.locale === "EN");
    const ar = version.translations.find((item) => item.locale === "AR");
    return {
      internalName,
      editingMode: version.editingMode.toLowerCase() as "quick" | "pro",
      templateCode: version.baseTemplateCode ?? undefined,
      requiredStampCount: version.stampRule?.requiredStampCount ?? 8,
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
        translations: {
          en: {
            name:
              reward.translations.find((item) => item.locale === "EN")?.name ?? reward.internalName,
            description:
              reward.translations.find((item) => item.locale === "EN")?.description ??
              reward.internalName,
          },
          ar: {
            name:
              reward.translations.find((item) => item.locale === "AR")?.name ?? reward.internalName,
            description:
              reward.translations.find((item) => item.locale === "AR")?.description ??
              reward.internalName,
          },
        },
      })),
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
      configurationSchemaVersion: source.configurationSchemaVersion,
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
              resetBehaviorAfterReward: source.stampRule.resetBehaviorAfterReward,
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
      createdByUserId: userId,
    };
  }
}

export { templates };
