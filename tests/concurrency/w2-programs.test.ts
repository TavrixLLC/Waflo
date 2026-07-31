import { createHash, randomUUID } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { ProgramCreateInput } from "@waflo/contracts";
import sharp from "../../apps/api/node_modules/sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApplication } from "../../apps/api/src/app";
import { AuditService } from "../../apps/api/src/audit/audit.service";
import type { WafloRequest } from "../../apps/api/src/common/request-context";
import { PrismaService } from "../../apps/api/src/database/prisma.service";
import { AssetsService } from "../../apps/api/src/programs/assets.service";
import { OBJECT_STORAGE, type ObjectStorage } from "../../apps/api/src/programs/object-storage";
import { ProgramsService } from "../../apps/api/src/programs/programs.service";

const runId = randomUUID().slice(0, 8);
const request = {
  requestId: `w2-concurrency-${runId}`,
  ip: "127.0.0.1",
  headers: { "user-agent": "Waflo W2 concurrency tests" },
} as unknown as WafloRequest;

let app: NestFastifyApplication;
let prisma: PrismaService;
let programs: ProgramsService;
let assets: AssetsService;
let audit: AuditService;
let objectStorage: ObjectStorage;

type Plan = "STARTER" | "GROWTH" | "SCALE";

interface Scenario {
  ownerId: string;
  organizationId: string;
  locationId: string;
}

interface CreatedProgram {
  id: string;
  currentDraftVersion: {
    id: string;
    revision: number;
    rewards: Array<{ id: string; thresholdStampCount: number }>;
  };
}

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function rejectedCodes(results: PromiseSettledResult<unknown>[]) {
  return results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => String((result.reason as { code?: unknown }).code));
}

function fulfilled<T>(results: PromiseSettledResult<T>[]) {
  return results
    .filter((result): result is PromiseFulfilledResult<T> => result.status === "fulfilled")
    .map((result) => result.value);
}

async function scenario(plan: Plan = "GROWTH"): Promise<Scenario> {
  const owner = await prisma.client.user.create({
    data: {
      email: `w2-${runId}-${randomUUID().slice(0, 8)}@concurrency.waflo.local`,
      normalizedEmail: `w2-${runId}-${randomUUID().slice(0, 8)}@concurrency.waflo.local`,
      displayName: "W2 concurrency owner",
      passwordHash: "not-used-by-service-tests",
      emailVerifiedAt: new Date(),
      preferredLocale: "EN",
      termsVersion: "test",
      privacyVersion: "test",
      legalAcceptedAt: new Date(),
    },
  });
  const slug = `w2-c-${runId}-${randomUUID().slice(0, 8)}`.toLowerCase();
  const organization = await prisma.client.organization.create({
    data: {
      name: `W2 ${slug}`,
      normalizedName: slug,
      merchantSlug: slug,
      defaultLocale: "EN",
      timezone: "UTC",
      selectedPlan: plan,
      members: { create: { userId: owner.id, role: "OWNER" } },
      billingProfile: {
        create: { selectedPlan: plan, subscriptionStatus: "PENDING_ACTIVATION" },
      },
    },
  });
  const location = await prisma.client.location.create({
    data: {
      organizationId: organization.id,
      name: "W2 concurrency location",
      timezone: "UTC",
      status: "ACTIVE",
    },
  });
  return {
    ownerId: owner.id,
    organizationId: organization.id,
    locationId: location.id,
  };
}

function programInput(
  locationId: string,
  suffix = randomUUID().slice(0, 6),
  mode: "quick" | "pro" = "quick",
): ProgramCreateInput {
  const translations = {
    en: {
      programName: `W2 Rewards ${suffix}`,
      shortDescription: "Collect stamps and receive a reward.",
      fullDescription: "A complete test loyalty program.",
      rewardSummary: "A complimentary signature item",
      joinInstructions: "Join at the counter.",
      termsAndConditions: "One account per customer. Standard terms apply.",
      completionMessage: "You completed the card.",
      rewardUnlockedMessage: "Your reward is ready.",
      pausedMessage: "This program is temporarily paused.",
    },
    ar: {
      programName: `مكافآت وافلو ${suffix}`,
      shortDescription: "اجمع الأختام واحصل على مكافأة.",
      fullDescription: "برنامج ولاء متكامل للاختبار.",
      rewardSummary: "منتج مميز مجاني",
      joinInstructions: "انضم عند نقطة البيع.",
      termsAndConditions: "حساب واحد لكل عميل. تطبق الشروط.",
      completionMessage: "أكملت البطاقة.",
      rewardUnlockedMessage: "مكافأتك جاهزة.",
      pausedMessage: "البرنامج متوقف مؤقتًا.",
    },
  };
  const finalReward = {
    thresholdStampCount: 8,
    rewardType: "FREE_ITEM" as const,
    internalName: "Final reward",
    sortOrder: mode === "pro" ? 1 : 0,
    validityDurationDays: 30,
    requiresManagerApproval: false,
    maximumRedemptionsPerEarned: 1,
    translations: {
      en: {
        name: "Complimentary item",
        description: "Choose one signature item.",
        redemptionInstructions: "Show the unlocked reward.",
      },
      ar: {
        name: "منتج مجاني",
        description: "اختر منتجًا مميزًا واحدًا.",
        redemptionInstructions: "اعرض المكافأة المفتوحة.",
      },
    },
  };
  return {
    internalName: `W2 Program ${suffix}`,
    editingMode: mode,
    templateCode: "COFFEE",
    requiredStampCount: 8,
    translations,
    earningDescription: "One stamp per qualifying visit.",
    rewards:
      mode === "pro"
        ? [
            {
              thresholdStampCount: 3,
              rewardType: "TEXT_REWARD",
              internalName: "Milestone reward",
              sortOrder: 0,
              validityDurationDays: 14,
              requiresManagerApproval: false,
              maximumRedemptionsPerEarned: 1,
              translations: {
                en: {
                  name: "Milestone",
                  description: "A milestone reward.",
                  redemptionInstructions: "Show this reward.",
                },
                ar: {
                  name: "مكافأة مرحلية",
                  description: "مكافأة عند نقطة مرحلية.",
                  redemptionInstructions: "اعرض هذه المكافأة.",
                },
              },
            },
            finalReward,
          ]
        : [finalReward],
    locationIds: [locationId],
    visualTheme: {
      backgroundColor: "#F7F4EE",
      foregroundColor: "#222222",
      accentColor: "#E4572E",
      secondaryColor: "#F3A712",
      mutedColor: "#6B7280",
      layoutType: mode === "pro" ? "PATH" : "GRID",
      layoutConfiguration:
        mode === "pro"
          ? { maxPerRow: 4, serpentine: true }
          : { columns: 4, maxPerRow: 4, serpentine: false },
      stampSize: 48,
      stampSpacing: 8,
      borderRadius: 18,
      progressLabelVisible: true,
      rewardLabelVisible: true,
      customerWebVariant: "CARD",
      applePreviewConfig: {
        headerLabel: "REWARDS",
        headerValue: "Waflo",
        secondaryLabel: "NEXT REWARD",
        barcodeLabel: "Preview barcode",
        showBackContent: true,
      },
      googlePreviewConfig: {
        title: "Waflo Rewards",
        subtitle: "Collect stamps and unlock rewards",
        detailsLabel: "Reward progress",
        barcodeLabel: "Preview barcode",
      },
    },
  };
}

async function createProgram(
  context: Scenario,
  mode: "quick" | "pro" = "quick",
): Promise<CreatedProgram> {
  return (await programs.create(
    context.ownerId,
    context.organizationId,
    programInput(context.locationId, undefined, mode),
    request,
  )) as CreatedProgram;
}

async function markValidated(program: CreatedProgram) {
  const fingerprint = digest({
    versionId: program.currentDraftVersion.id,
    revision: program.currentDraftVersion.revision,
  });
  await prisma.client.loyaltyProgramVersion.update({
    where: { id: program.currentDraftVersion.id },
    data: {
      status: "VALIDATED",
      validatedAt: new Date(),
      validationFingerprint: fingerprint,
    },
  });
  await prisma.client.programValidationRun.create({
    data: {
      organizationId: (
        await prisma.client.loyaltyProgramVersion.findUniqueOrThrow({
          where: { id: program.currentDraftVersion.id },
          select: { organizationId: true },
        })
      ).organizationId,
      versionId: program.currentDraftVersion.id,
      status: "PASSED",
      configurationFingerprint: fingerprint,
      errors: [],
      warnings: [],
      createdByUserId: (
        await prisma.client.loyaltyProgram.findUniqueOrThrow({
          where: { id: program.id },
          select: { createdByUserId: true },
        })
      ).createdByUserId,
    },
  });
  return fingerprint;
}

async function markPublishReady(context: Scenario, program: CreatedProgram) {
  await Promise.all([
    programs.preview(
      context.ownerId,
      context.organizationId,
      program.id,
      0,
      "CUSTOMER_WEB",
      "EN",
      request,
    ),
    programs.preview(
      context.ownerId,
      context.organizationId,
      program.id,
      0,
      "APPLE_WALLET",
      "EN",
      request,
    ),
    programs.preview(
      context.ownerId,
      context.organizationId,
      program.id,
      0,
      "GOOGLE_WALLET",
      "EN",
      request,
    ),
  ]);
  const fingerprint = await markValidated(program);
  await prisma.client.loyaltyProgramVersion.update({
    where: { id: program.currentDraftVersion.id },
    data: { status: "TEST_READY", testReadyAt: new Date() },
  });
  await prisma.client.programTestSession.create({
    data: {
      organizationId: context.organizationId,
      versionId: program.currentDraftVersion.id,
      createdByUserId: context.ownerId,
      syntheticDisplayName: "Waflo concurrent customer",
      versionRevision: program.currentDraftVersion.revision,
      validationFingerprint: fingerprint,
      status: "COMPLETED",
      cycleCount: 1,
    },
  });
}

async function createSession(context: Scenario, program: CreatedProgram) {
  await markValidated(program);
  return programs.createTestSession(context.ownerId, context.organizationId, program.id, request);
}

describe.sequential("Waflo W2 database and storage concurrency invariants", () => {
  beforeAll(async () => {
    app = await createApiApplication({ logger: false });
    prisma = app.get(PrismaService);
    programs = app.get(ProgramsService);
    assets = app.get(AssetsService);
    audit = app.get(AuditService);
    objectStorage = app.get<ObjectStorage>(OBJECT_STORAGE);
    await prisma.client.$queryRaw`SELECT 1`;
  });

  afterAll(async () => {
    await app.close();
  });

  it("enforces the Starter program limit under simultaneous creation", async () => {
    const context = await scenario("STARTER");
    const results = await Promise.allSettled([
      programs.create(
        context.ownerId,
        context.organizationId,
        programInput(context.locationId, "starter-a"),
        request,
      ),
      programs.create(
        context.ownerId,
        context.organizationId,
        programInput(context.locationId, "starter-b"),
        request,
      ),
    ]);

    expect(fulfilled(results)).toHaveLength(1);
    expect(rejectedCodes(results)).toEqual(["PROGRAM_LIMIT_REACHED"]);
    expect(
      await prisma.client.loyaltyProgram.count({
        where: { organizationId: context.organizationId, status: { not: "ARCHIVED" } },
      }),
    ).toBe(1);
  });

  it("allows exactly one editor to save a shared draft revision", async () => {
    const context = await scenario();
    const program = await createProgram(context);
    const revision = program.currentDraftVersion.revision;
    const results = await Promise.allSettled([
      programs.update(
        context.ownerId,
        context.organizationId,
        program.id,
        { revision, internalName: "Editor A" },
        request,
      ),
      programs.update(
        context.ownerId,
        context.organizationId,
        program.id,
        { revision, internalName: "Editor B" },
        request,
      ),
    ]);

    expect(fulfilled(results)).toHaveLength(1);
    expect(rejectedCodes(results)).toEqual(["STALE_PROGRAM_DRAFT"]);
    const stored = await prisma.client.loyaltyProgram.findUniqueOrThrow({
      where: { id: program.id },
      include: { currentDraftVersion: true },
    });
    expect(stored.currentDraftVersion?.revision).toBe(revision + 1);
  });

  it("creates one new version when the same published program is drafted concurrently", async () => {
    const context = await scenario();
    const program = await createProgram(context);
    await markPublishReady(context, program);
    await programs.publish(
      context.ownerId,
      context.organizationId,
      program.id,
      randomUUID(),
      request,
    );

    const results = await Promise.allSettled([
      programs.createDraft(context.ownerId, context.organizationId, program.id, request),
      programs.createDraft(context.ownerId, context.organizationId, program.id, request),
    ]);

    expect(fulfilled(results)).toHaveLength(2);
    const stored = await prisma.client.loyaltyProgram.findUniqueOrThrow({
      where: { id: program.id },
      include: { versions: true, currentDraftVersion: true },
    });
    expect(stored.versions).toHaveLength(2);
    expect(stored.currentDraftVersion?.versionNumber).toBe(2);
    expect(
      await prisma.client.auditLog.count({
        where: {
          organizationId: context.organizationId,
          action: "program.version_created",
          targetId: stored.currentDraftVersion?.id,
        },
      }),
    ).toBe(1);
  });

  it("deduplicates simultaneous identical uploads and their real variants", async () => {
    const context = await scenario();
    const png = await sharp({
      create: {
        width: 144,
        height: 112,
        channels: 4,
        background: { r: 228, g: 87, b: 46, alpha: 0.75 },
      },
    })
      .png()
      .toBuffer();
    const metadata = {
      category: "STAMP_FILLED" as const,
      crop: { x: 0, y: 0, width: 1, height: 1, zoom: 1 },
    };
    const upload = () =>
      assets.upload(
        context.ownerId,
        context.organizationId,
        metadata,
        { filename: "concurrent.png", mimeType: "image/png", bytes: png },
        request,
      );
    const results = await Promise.allSettled([upload(), upload()]);
    const saved = fulfilled(results);

    expect(saved).toHaveLength(2);
    expect(new Set(saved.map((asset) => asset.id)).size).toBe(1);
    expect(saved[0]?.variants).toHaveLength(3);
    expect(saved.map((asset) => asset.uploadDisposition).sort()).toEqual(["CREATED", "REPLAYED"]);
    expect(
      await prisma.client.merchantAsset.count({
        where: { organizationId: context.organizationId },
      }),
    ).toBe(1);
  });

  it("stores one concurrent preview miss and performs no write for cache hits", async () => {
    const context = await scenario();
    const program = await createProgram(context);
    const originalPutImmutable = objectStorage.putImmutable.bind(objectStorage);
    let writes = 0;
    objectStorage.putImmutable = async (...arguments_) => {
      writes += 1;
      return originalPutImmutable(...arguments_);
    };
    try {
      const results = await Promise.allSettled([
        programs.preview(
          context.ownerId,
          context.organizationId,
          program.id,
          4,
          "CUSTOMER_WEB",
          "EN",
          request,
        ),
        programs.preview(
          context.ownerId,
          context.organizationId,
          program.id,
          4,
          "CUSTOMER_WEB",
          "EN",
          request,
        ),
      ]);
      const previews = fulfilled(results);

      expect(previews).toHaveLength(2);
      expect(new Set(previews.map((preview) => preview.id)).size).toBe(1);
      expect(new Set(previews.map((preview) => preview.digest)).size).toBe(1);
      expect(previews.map((preview) => preview.cacheStatus).sort()).toEqual(["HIT", "MISS"]);
      expect(writes).toBe(1);
      const hit = await programs.preview(
        context.ownerId,
        context.organizationId,
        program.id,
        4,
        "CUSTOMER_WEB",
        "EN",
        request,
      );
      expect(hit.cacheStatus).toBe("HIT");
      expect(writes).toBe(1);
      expect(
        await prisma.client.generatedProgramPreview.count({
          where: { versionId: program.currentDraftVersion.id },
        }),
      ).toBe(1);
      expect(
        await prisma.client.auditLog.count({
          where: {
            organizationId: context.organizationId,
            action: "program.preview_generated",
          },
        }),
      ).toBe(1);
    } finally {
      objectStorage.putImmutable = originalPutImmutable;
    }
  });

  it("records validation failures with one transactional audit event", async () => {
    const context = await scenario();
    const program = await createProgram(context);
    const result = await programs.validate(
      context.ownerId,
      context.organizationId,
      program.id,
      request,
    );
    expect(result.status).toBe("FAILED");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(
      await prisma.client.auditLog.count({
        where: {
          organizationId: context.organizationId,
          action: "program.validation_failed",
          targetId: program.id,
        },
      }),
    ).toBe(1);
  });

  it("keeps historical template artwork immutable while a draft explicitly adopts version 2", async () => {
    const context = await scenario();
    const legacyInput = programInput(context.locationId, "template-v1");
    legacyInput.templateVersion = 1;
    const legacyProgram = (await programs.create(
      context.ownerId,
      context.organizationId,
      legacyInput,
      request,
    )) as CreatedProgram;
    const legacyPreview = await programs.preview(
      context.ownerId,
      context.organizationId,
      legacyProgram.id,
      4,
      "CUSTOMER_WEB",
      "EN",
      request,
    );
    const legacyVisual = await prisma.client.programVisualTheme.findUniqueOrThrow({
      where: { versionId: legacyProgram.currentDraftVersion.id },
      include: { filledStampAsset: true, emptyStampAsset: true },
    });
    const legacyFilledMetadata = legacyVisual.filledStampAsset.safeMetadata as {
      inlineSvg: string;
    };
    const legacyFilledDigest = legacyVisual.filledStampAsset.sha256Digest;

    await markPublishReady(context, legacyProgram);
    await programs.publish(
      context.ownerId,
      context.organizationId,
      legacyProgram.id,
      randomUUID(),
      request,
    );
    const copied = (await programs.createDraft(
      context.ownerId,
      context.organizationId,
      legacyProgram.id,
      request,
    )) as unknown as CreatedProgram;
    const versionTwoInput = programInput(context.locationId, "template-v2");
    versionTwoInput.templateVersion = 2;
    const adopted = (await programs.update(
      context.ownerId,
      context.organizationId,
      legacyProgram.id,
      {
        ...versionTwoInput,
        revision: copied.currentDraftVersion.revision,
      },
      request,
    )) as unknown as CreatedProgram;
    expect(adopted.currentDraftVersion).toMatchObject({
      revision: copied.currentDraftVersion.revision + 1,
    });
    const adoptedVersion = await prisma.client.loyaltyProgramVersion.findUniqueOrThrow({
      where: { id: adopted.currentDraftVersion.id },
      include: {
        visualTheme: {
          include: { filledStampAsset: true, emptyStampAsset: true },
        },
      },
    });
    expect(adoptedVersion).toMatchObject({
      baseTemplateCode: "COFFEE",
      baseTemplateVersion: 2,
    });
    expect(adoptedVersion.visualTheme?.filledStampAssetId).not.toBe(
      legacyVisual.filledStampAssetId,
    );
    const adoptedPreview = await programs.preview(
      context.ownerId,
      context.organizationId,
      legacyProgram.id,
      4,
      "CUSTOMER_WEB",
      "EN",
      request,
    );
    expect(adoptedPreview.svg).not.toBe(legacyPreview.svg);

    await markPublishReady(context, adopted);
    await programs.publish(
      context.ownerId,
      context.organizationId,
      legacyProgram.id,
      randomUUID(),
      request,
    );
    const historical = await prisma.client.loyaltyProgramVersion.findUniqueOrThrow({
      where: { id: legacyProgram.currentDraftVersion.id },
      include: {
        visualTheme: {
          include: { filledStampAsset: true, emptyStampAsset: true },
        },
      },
    });
    expect(historical.status).toBe("SUPERSEDED");
    expect(historical.baseTemplateVersion).toBe(1);
    if (!historical.visualTheme) throw new Error("Historical visual theme is required.");
    expect(historical.visualTheme.filledStampAsset.sha256Digest).toBe(legacyFilledDigest);
    expect(
      (historical.visualTheme.filledStampAsset.safeMetadata as { inlineSvg: string }).inlineSvg,
    ).toBe(legacyFilledMetadata.inlineSvg);
    expect(await objectStorage.get(legacyPreview.objectKey)).toEqual(
      Buffer.from(legacyPreview.svg),
    );
  });

  it("uses category-aware asset identity and restores or repairs the canonical row", async () => {
    const context = await scenario();
    const png = await sharp({
      create: {
        width: 120,
        height: 120,
        channels: 4,
        background: { r: 41, g: 96, b: 159, alpha: 0.8 },
      },
    })
      .png()
      .toBuffer();
    const crop = { x: 0, y: 0, width: 1, height: 1, zoom: 1 };
    const upload = (category: "STAMP_FILLED" | "STAMP_EMPTY") =>
      assets.upload(
        context.ownerId,
        context.organizationId,
        { category, crop },
        { filename: "semantic.png", mimeType: "image/png", bytes: png },
        request,
      );

    const filled = await upload("STAMP_FILLED");
    const empty = await upload("STAMP_EMPTY");
    expect(filled.id).not.toBe(empty.id);
    expect(filled.uploadDisposition).toBe("CREATED");
    expect(empty.uploadDisposition).toBe("CREATED");

    await assets.archive(context.ownerId, context.organizationId, filled.id, request);
    const restored = await upload("STAMP_FILLED");
    expect(restored.id).toBe(filled.id);
    expect(restored.uploadDisposition).toBe("RESTORED");

    const stampVariant = restored.variants.find((variant) => variant.variantCode === "STAMP_256");
    expect(stampVariant).toBeTruthy();
    await objectStorage.delete(stampVariant?.objectKey as string);
    const repaired = await upload("STAMP_FILLED");
    expect(repaired.id).toBe(filled.id);
    expect(repaired.uploadDisposition).toBe("REPAIRED");
    await expect(objectStorage.get(stampVariant?.objectKey as string)).resolves.toEqual(
      expect.any(Buffer),
    );
    expect(
      await prisma.client.merchantAsset.count({
        where: { organizationId: context.organizationId },
      }),
    ).toBe(2);
  });

  it("archives and restores an initial unpublished program without losing its draft", async () => {
    const context = await scenario();
    const program = await createProgram(context);
    const archived = await programs.transition(
      context.ownerId,
      context.organizationId,
      program.id,
      "archive",
      request,
    );
    expect(archived.status).toBe("ARCHIVED");
    await expect(
      programs.update(
        context.ownerId,
        context.organizationId,
        program.id,
        { revision: program.currentDraftVersion.revision, internalName: "blocked" },
        request,
      ),
    ).rejects.toMatchObject({ code: "PROGRAM_ARCHIVED_READ_ONLY" });
    await expect(
      programs.abandonDraft(context.ownerId, context.organizationId, program.id, request),
    ).rejects.toMatchObject({ code: "PROGRAM_INITIAL_DRAFT_ARCHIVE_REQUIRED" });

    const restored = await programs.transition(
      context.ownerId,
      context.organizationId,
      program.id,
      "restore",
      request,
    );
    expect(restored.status).toBe("DRAFT");
    const stored = await prisma.client.loyaltyProgram.findUniqueOrThrow({
      where: { id: program.id },
      include: { currentDraftVersion: true, versions: true },
    });
    expect(stored.currentDraftVersionId).toBe(program.currentDraftVersion.id);
    expect(stored.currentDraftVersion?.status).toBe("DRAFT");
    expect(stored.versions).toHaveLength(1);
  });

  it("holds an all-filled grid at reward-ready and resets only after final redemption", async () => {
    const context = await scenario();
    const program = await createProgram(context);
    const session = await createSession(context, program);
    const rewardId = program.currentDraftVersion.rewards[0]?.id as string;
    await programs.addTestStamps(
      context.ownerId,
      context.organizationId,
      session.id,
      5,
      randomUUID(),
      request,
    );
    const filled = await programs.addTestStamps(
      context.ownerId,
      context.organizationId,
      session.id,
      3,
      randomUUID(),
      request,
    );
    expect(filled.currentStampCount).toBe(8);
    expect(filled.cycleCount).toBe(0);
    await expect(
      programs.addTestStamps(
        context.ownerId,
        context.organizationId,
        session.id,
        1,
        randomUUID(),
        request,
      ),
    ).rejects.toMatchObject({ code: "TEST_REWARD_READY" });

    await programs.redeemTestReward(
      context.ownerId,
      context.organizationId,
      session.id,
      rewardId,
      randomUUID(),
      request,
    );
    const reset = await prisma.client.programTestSession.findUniqueOrThrow({
      where: { id: session.id },
      include: { events: true },
    });
    expect(reset).toMatchObject({
      currentStampCount: 0,
      cycleCount: 1,
      status: "COMPLETED",
    });
    const earnedEvents = reset.events.filter((event) => event.eventType === "TEST_STAMP_EARNED");
    expect(earnedEvents).toHaveLength(2);
    expect(earnedEvents.reduce((total, event) => total + (event.amount ?? 0), 0)).toBe(8);
    expect(reset.events.filter((event) => event.eventType === "TEST_REWARD_REDEEMED")).toHaveLength(
      1,
    );
    expect(
      await prisma.client.auditLog.count({
        where: {
          organizationId: context.organizationId,
          action: "program.test_reward_redeemed",
          targetId: session.id,
        },
      }),
    ).toBe(1);
  });

  it("blocks publication atomically when billing or persisted preview evidence is stale", async () => {
    const billingContext = await scenario();
    const billingProgram = await createProgram(billingContext);
    await markPublishReady(billingContext, billingProgram);
    await prisma.client.organizationBillingProfile.update({
      where: { organizationId: billingContext.organizationId },
      data: { subscriptionStatus: "SUSPENDED" },
    });
    await expect(
      programs.publish(
        billingContext.ownerId,
        billingContext.organizationId,
        billingProgram.id,
        randomUUID(),
        request,
      ),
    ).rejects.toMatchObject({ code: "PROGRAM_PUBLICATION_BILLING_BLOCKED" });
    expect(
      await prisma.client.programPublishCommand.count({
        where: { organizationId: billingContext.organizationId },
      }),
    ).toBe(0);

    const previewContext = await scenario();
    const previewProgram = await createProgram(previewContext);
    await markPublishReady(previewContext, previewProgram);
    const preview = await prisma.client.generatedProgramPreview.findFirstOrThrow({
      where: {
        versionId: previewProgram.currentDraftVersion.id,
        previewType: "CUSTOMER_WEB_CARD",
      },
    });
    await objectStorage.put(preview.objectKey, Buffer.from("corrupt"), preview.mimeType);
    await expect(
      programs.publish(
        previewContext.ownerId,
        previewContext.organizationId,
        previewProgram.id,
        randomUUID(),
        request,
      ),
    ).rejects.toMatchObject({ code: "PROGRAM_PUBLICATION_PREVIEW_STALE" });
    const stored = await prisma.client.loyaltyProgram.findUniqueOrThrow({
      where: { id: previewProgram.id },
    });
    expect(stored.currentPublishedVersionId).toBeNull();
    expect(
      await prisma.client.programPublishCommand.count({
        where: { programId: previewProgram.id },
      }),
    ).toBe(0);
  });

  it("rejects organization, location, asset, and missing-object changes made after Test Mode", async () => {
    const organizationContext = await scenario();
    const organizationProgram = await createProgram(organizationContext);
    await markPublishReady(organizationContext, organizationProgram);
    await prisma.client.organization.update({
      where: { id: organizationContext.organizationId },
      data: { status: "SUSPENDED" },
    });
    await expect(
      programs.publish(
        organizationContext.ownerId,
        organizationContext.organizationId,
        organizationProgram.id,
        randomUUID(),
        request,
      ),
    ).rejects.toMatchObject({ code: "PROGRAM_PUBLICATION_ORGANIZATION_UNAVAILABLE" });

    const locationContext = await scenario();
    const locationProgram = await createProgram(locationContext);
    await markPublishReady(locationContext, locationProgram);
    await prisma.client.location.update({
      where: { id: locationContext.locationId },
      data: { status: "ARCHIVED" },
    });
    await expect(
      programs.publish(
        locationContext.ownerId,
        locationContext.organizationId,
        locationProgram.id,
        randomUUID(),
        request,
      ),
    ).rejects.toMatchObject({ code: "PROGRAM_PUBLICATION_LOCATION_STALE" });

    const assetContext = await scenario();
    const assetProgram = await createProgram(assetContext);
    const png = await sharp({
      create: {
        width: 144,
        height: 144,
        channels: 4,
        background: { r: 207, g: 71, b: 38, alpha: 0.9 },
      },
    })
      .png()
      .toBuffer();
    const selectedAsset = await assets.upload(
      assetContext.ownerId,
      assetContext.organizationId,
      {
        category: "STAMP_FILLED",
        crop: { x: 0, y: 0, width: 1, height: 1, zoom: 1 },
      },
      { filename: "publication-integrity.png", mimeType: "image/png", bytes: png },
      request,
    );
    await prisma.client.programVisualTheme.update({
      where: { versionId: assetProgram.currentDraftVersion.id },
      data: { filledStampAssetId: selectedAsset.id },
    });
    await markPublishReady(assetContext, assetProgram);
    const selectedVariant = selectedAsset.variants.find(
      (variant) => variant.variantCode === "STAMP_256",
    );
    if (!selectedVariant) throw new Error("STAMP_256 publication asset variant is required.");
    await objectStorage.delete(selectedVariant.objectKey);
    await expect(
      programs.publish(
        assetContext.ownerId,
        assetContext.organizationId,
        assetProgram.id,
        randomUUID(),
        request,
      ),
    ).rejects.toMatchObject({ code: "PROGRAM_PUBLICATION_ASSET_STALE" });

    const archivedAssetContext = await scenario();
    const archivedAssetProgram = await createProgram(archivedAssetContext);
    const archivedAsset = await assets.upload(
      archivedAssetContext.ownerId,
      archivedAssetContext.organizationId,
      {
        category: "STAMP_FILLED",
        crop: { x: 0, y: 0, width: 1, height: 1, zoom: 1 },
      },
      { filename: "publication-archive.png", mimeType: "image/png", bytes: png },
      request,
    );
    await prisma.client.programVisualTheme.update({
      where: { versionId: archivedAssetProgram.currentDraftVersion.id },
      data: { filledStampAssetId: archivedAsset.id },
    });
    await markPublishReady(archivedAssetContext, archivedAssetProgram);
    await assets.archive(
      archivedAssetContext.ownerId,
      archivedAssetContext.organizationId,
      archivedAsset.id,
      request,
    );
    await expect(
      programs.publish(
        archivedAssetContext.ownerId,
        archivedAssetContext.organizationId,
        archivedAssetProgram.id,
        randomUUID(),
        request,
      ),
    ).rejects.toMatchObject({ code: "PROGRAM_PUBLICATION_ASSET_STALE" });

    const missingPreviewContext = await scenario();
    const missingPreviewProgram = await createProgram(missingPreviewContext);
    await markPublishReady(missingPreviewContext, missingPreviewProgram);
    const missingPreview = await prisma.client.generatedProgramPreview.findFirstOrThrow({
      where: {
        versionId: missingPreviewProgram.currentDraftVersion.id,
        previewType: "GOOGLE_WALLET_PREVIEW",
      },
    });
    await objectStorage.delete(missingPreview.objectKey);
    await expect(
      programs.publish(
        missingPreviewContext.ownerId,
        missingPreviewContext.organizationId,
        missingPreviewProgram.id,
        randomUUID(),
        request,
      ),
    ).rejects.toMatchObject({ code: "PROGRAM_PUBLICATION_PREVIEW_STALE" });
  });

  it("rechecks downgraded plan limits and features at publication time", async () => {
    const featureContext = await scenario("GROWTH");
    const featureProgram = await createProgram(featureContext, "pro");
    await markPublishReady(featureContext, featureProgram);
    await prisma.client.organization.update({
      where: { id: featureContext.organizationId },
      data: { selectedPlan: "STARTER" },
    });
    await prisma.client.organizationBillingProfile.update({
      where: { organizationId: featureContext.organizationId },
      data: { selectedPlan: "STARTER" },
    });
    await expect(
      programs.publish(
        featureContext.ownerId,
        featureContext.organizationId,
        featureProgram.id,
        randomUUID(),
        request,
      ),
    ).rejects.toMatchObject({ code: "PROGRAM_PUBLICATION_PLAN_BLOCKED" });

    const limitContext = await scenario("GROWTH");
    const first = await createProgram(limitContext);
    await createProgram(limitContext);
    await markPublishReady(limitContext, first);
    await prisma.client.organization.update({
      where: { id: limitContext.organizationId },
      data: { selectedPlan: "STARTER" },
    });
    await prisma.client.organizationBillingProfile.update({
      where: { organizationId: limitContext.organizationId },
      data: { selectedPlan: "STARTER" },
    });
    await expect(
      programs.publish(
        limitContext.ownerId,
        limitContext.organizationId,
        first.id,
        randomUUID(),
        request,
      ),
    ).rejects.toMatchObject({ code: "PROGRAM_PUBLICATION_PROGRAM_LIMIT_EXCEEDED" });
  });

  it("replays simultaneous stamp requests with the same idempotency key once", async () => {
    const context = await scenario();
    const program = await createProgram(context, "pro");
    const session = await createSession(context, program);
    const key = randomUUID();
    const add = () =>
      programs.addTestStamps(context.ownerId, context.organizationId, session.id, 1, key, request);
    const results = await Promise.allSettled([add(), add()]);

    expect(fulfilled(results)).toHaveLength(2);
    const stored = await prisma.client.programTestSession.findUniqueOrThrow({
      where: { id: session.id },
      include: { events: true },
    });
    expect(stored.currentStampCount).toBe(1);
    expect(stored.events.filter((event) => event.eventType === "TEST_STAMP_EARNED")).toHaveLength(
      1,
    );
  });

  it("unlocks a crossed threshold exactly once under simultaneous additions", async () => {
    const context = await scenario();
    const program = await createProgram(context, "pro");
    const session = await createSession(context, program);
    await programs.addTestStamps(
      context.ownerId,
      context.organizationId,
      session.id,
      2,
      randomUUID(),
      request,
    );
    const results = await Promise.allSettled([
      programs.addTestStamps(
        context.ownerId,
        context.organizationId,
        session.id,
        1,
        randomUUID(),
        request,
      ),
      programs.addTestStamps(
        context.ownerId,
        context.organizationId,
        session.id,
        1,
        randomUUID(),
        request,
      ),
    ]);

    expect(fulfilled(results)).toHaveLength(2);
    const stored = await prisma.client.programTestSession.findUniqueOrThrow({
      where: { id: session.id },
      include: { events: true },
    });
    expect(stored.currentStampCount).toBe(4);
    expect(
      stored.events.filter(
        (event) =>
          event.eventType === "TEST_REWARD_UNLOCKED" &&
          event.rewardDefinitionId === program.currentDraftVersion.rewards[0]?.id,
      ),
    ).toHaveLength(1);
  });

  it("linearizes reverse versus add without losing or inventing stamps", async () => {
    const context = await scenario();
    const program = await createProgram(context, "pro");
    const session = await createSession(context, program);
    await programs.addTestStamps(
      context.ownerId,
      context.organizationId,
      session.id,
      2,
      randomUUID(),
      request,
    );
    const results = await Promise.allSettled([
      programs.reverseTestStamp(
        context.ownerId,
        context.organizationId,
        session.id,
        randomUUID(),
        request,
      ),
      programs.addTestStamps(
        context.ownerId,
        context.organizationId,
        session.id,
        1,
        randomUUID(),
        request,
      ),
    ]);

    expect(fulfilled(results)).toHaveLength(2);
    const stored = await prisma.client.programTestSession.findUniqueOrThrow({
      where: { id: session.id },
      include: { events: true },
    });
    expect(stored.currentStampCount).toBe(2);
    expect(stored.cycleCount).toBe(0);
    expect(stored.events.filter((event) => event.eventType === "TEST_STAMP_REVERSED")).toHaveLength(
      1,
    );
  });

  it("permits only one concurrent redemption for one earned reward", async () => {
    const context = await scenario();
    const program = await createProgram(context, "pro");
    const session = await createSession(context, program);
    await programs.addTestStamps(
      context.ownerId,
      context.organizationId,
      session.id,
      3,
      randomUUID(),
      request,
    );
    const rewardId = program.currentDraftVersion.rewards[0]?.id;
    expect(rewardId).toBeTruthy();
    const results = await Promise.allSettled([
      programs.redeemTestReward(
        context.ownerId,
        context.organizationId,
        session.id,
        rewardId as string,
        randomUUID(),
        request,
      ),
      programs.redeemTestReward(
        context.ownerId,
        context.organizationId,
        session.id,
        rewardId as string,
        randomUUID(),
        request,
      ),
    ]);

    expect(fulfilled(results)).toHaveLength(1);
    expect(rejectedCodes(results)).toEqual(["TEST_REWARD_NOT_UNLOCKED"]);
    expect(
      await prisma.client.programTestEvent.count({
        where: {
          sessionId: session.id,
          eventType: "TEST_REWARD_REDEEMED",
          rewardDefinitionId: rewardId,
        },
      }),
    ).toBe(1);
  });

  it("publishes once across different keys and starts the deferred trial exactly once", async () => {
    const context = await scenario();
    const program = await createProgram(context);
    await markPublishReady(context, program);
    const results = await Promise.allSettled([
      programs.publish(context.ownerId, context.organizationId, program.id, randomUUID(), request),
      programs.publish(context.ownerId, context.organizationId, program.id, randomUUID(), request),
    ]);

    expect(fulfilled(results)).toHaveLength(1);
    expect(rejectedCodes(results)).toEqual(["PROGRAM_TEST_REQUIRED"]);
    const commands = await prisma.client.programPublishCommand.findMany({
      where: { organizationId: context.organizationId, programId: program.id },
    });
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ status: "COMPLETED", trialStarted: true });
    const billing = await prisma.client.organizationBillingProfile.findUniqueOrThrow({
      where: { organizationId: context.organizationId },
    });
    expect(billing.subscriptionStatus).toBe("TRIALING");
    expect(billing.trialStart).not.toBeNull();
    expect(billing.trialTriggeringProgramId).toBe(program.id);
  });

  it("replays the same simultaneous publish key as one completed command", async () => {
    const context = await scenario();
    const program = await createProgram(context);
    await markPublishReady(context, program);
    const key = randomUUID();
    const publish = () =>
      programs.publish(context.ownerId, context.organizationId, program.id, key, request);
    const results = await Promise.allSettled([publish(), publish()]);
    const commands = fulfilled(results);

    expect(commands).toHaveLength(2);
    expect(new Set(commands.map((command) => command.id)).size).toBe(1);
    expect(
      await prisma.client.programPublishCommand.count({
        where: { organizationId: context.organizationId, programId: program.id },
      }),
    ).toBe(1);
    expect(
      await prisma.client.auditLog.groupBy({
        by: ["action"],
        where: {
          organizationId: context.organizationId,
          action: {
            in: [
              "program.published",
              "program.version_superseded",
              "trial.started_by_program_publication",
            ],
          },
        },
        _count: true,
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "program.published", _count: 1 }),
        expect.objectContaining({
          action: "trial.started_by_program_publication",
          _count: 1,
        }),
      ]),
    );
  });

  it("blocks archived, suspended, and scheduled operational states before publication mutation", async () => {
    for (const status of ["ARCHIVED", "SUSPENDED", "SCHEDULED"] as const) {
      const context = await scenario();
      const program = await createProgram(context);
      await markPublishReady(context, program);
      await prisma.client.loyaltyProgram.update({
        where: { id: program.id },
        data: {
          status,
          ...(status === "ARCHIVED" ? { archivedAt: new Date() } : {}),
        },
      });

      await expect(
        programs.publish(
          context.ownerId,
          context.organizationId,
          program.id,
          randomUUID(),
          request,
        ),
      ).rejects.toMatchObject({
        code: "PROGRAM_PUBLICATION_STATE_BLOCKED",
        details: {
          programStatus: status,
          ...(status === "ARCHIVED" ? { requiredAction: "RESTORE_PROGRAM" } : {}),
        },
      });
      expect(
        await prisma.client.programPublishCommand.count({
          where: { organizationId: context.organizationId, programId: program.id },
        }),
      ).toBe(0);
    }

    const replacementContext = await scenario();
    const first = await createProgram(replacementContext);
    await markPublishReady(replacementContext, first);
    await programs.publish(
      replacementContext.ownerId,
      replacementContext.organizationId,
      first.id,
      randomUUID(),
      request,
    );
    const replacement = (await programs.createDraft(
      replacementContext.ownerId,
      replacementContext.organizationId,
      first.id,
      request,
    )) as unknown as CreatedProgram;
    await markPublishReady(replacementContext, replacement);
    await programs.transition(
      replacementContext.ownerId,
      replacementContext.organizationId,
      first.id,
      "archive",
      request,
    );
    await expect(
      programs.publish(
        replacementContext.ownerId,
        replacementContext.organizationId,
        first.id,
        randomUUID(),
        request,
      ),
    ).rejects.toMatchObject({
      code: "PROGRAM_PUBLICATION_STATE_BLOCKED",
      details: {
        programStatus: "ARCHIVED",
        requiredAction: "RESTORE_PROGRAM",
      },
    });
    expect(
      await prisma.client.loyaltyProgramVersion.findUniqueOrThrow({
        where: { id: replacement.currentDraftVersion.id },
        select: { status: true },
      }),
    ).toEqual({ status: "TEST_READY" });
  });

  it("publishes replacements without changing PAUSED or PUBLISHED operational state", async () => {
    const context = await scenario();
    const first = await createProgram(context);
    await markPublishReady(context, first);
    await programs.publish(
      context.ownerId,
      context.organizationId,
      first.id,
      randomUUID(),
      request,
    );
    const firstPublished = await prisma.client.loyaltyProgram.findUniqueOrThrow({
      where: { id: first.id },
    });
    expect(firstPublished.status).toBe("PUBLISHED");
    const firstAudit = await prisma.client.auditLog.findFirstOrThrow({
      where: {
        organizationId: context.organizationId,
        targetId: first.id,
        action: "program.published",
      },
      orderBy: { createdAt: "desc" },
    });
    expect(firstAudit.metadata).toMatchObject({
      previousOperationalState: "DRAFT",
      resultingOperationalState: "PUBLISHED",
      publicationType: "FIRST_PUBLICATION",
      remainedPaused: false,
    });

    const pausedReplacement = (await programs.createDraft(
      context.ownerId,
      context.organizationId,
      first.id,
      request,
    )) as unknown as CreatedProgram;
    await markPublishReady(context, pausedReplacement);
    await programs.transition(context.ownerId, context.organizationId, first.id, "pause", request);
    const pausedBeforePublication = await prisma.client.loyaltyProgram.findUniqueOrThrow({
      where: { id: first.id },
    });
    expect(pausedBeforePublication.pausedAt).not.toBeNull();

    await programs.publish(
      context.ownerId,
      context.organizationId,
      first.id,
      randomUUID(),
      request,
    );
    const pausedAfterPublication = await prisma.client.loyaltyProgram.findUniqueOrThrow({
      where: { id: first.id },
      include: { currentPublishedVersion: true },
    });
    expect(pausedAfterPublication).toMatchObject({
      status: "PAUSED",
      currentDraftVersionId: null,
      currentPublishedVersion: { status: "PUBLISHED" },
    });
    expect(pausedAfterPublication.pausedAt?.getTime()).toBe(
      pausedBeforePublication.pausedAt?.getTime(),
    );
    expect(pausedAfterPublication.publishedAt?.getTime()).toBe(
      firstPublished.publishedAt?.getTime(),
    );
    expect(
      await prisma.client.auditLog.count({
        where: {
          organizationId: context.organizationId,
          targetId: first.id,
          action: "program.resumed",
        },
      }),
    ).toBe(0);
    const pausedAudit = await prisma.client.auditLog.findFirstOrThrow({
      where: {
        organizationId: context.organizationId,
        targetId: first.id,
        action: "program.published",
      },
      orderBy: { createdAt: "desc" },
    });
    expect(pausedAudit.metadata).toMatchObject({
      previousOperationalState: "PAUSED",
      resultingOperationalState: "PAUSED",
      publicationType: "REPLACEMENT_PUBLICATION",
      remainedPaused: true,
    });

    await programs.transition(context.ownerId, context.organizationId, first.id, "resume", request);
    const resumed = await prisma.client.loyaltyProgram.findUniqueOrThrow({
      where: { id: first.id },
    });
    expect(resumed).toMatchObject({ status: "PUBLISHED", pausedAt: null });
    expect(
      await prisma.client.auditLog.count({
        where: {
          organizationId: context.organizationId,
          targetId: first.id,
          action: "program.resumed",
        },
      }),
    ).toBe(1);

    const publishedReplacement = (await programs.createDraft(
      context.ownerId,
      context.organizationId,
      first.id,
      request,
    )) as unknown as CreatedProgram;
    await markPublishReady(context, publishedReplacement);
    const replayKey = randomUUID();
    const completed = await programs.publish(
      context.ownerId,
      context.organizationId,
      first.id,
      replayKey,
      request,
    );
    const publishedAfterReplacement = await prisma.client.loyaltyProgram.findUniqueOrThrow({
      where: { id: first.id },
    });
    expect(publishedAfterReplacement).toMatchObject({
      status: "PUBLISHED",
      pausedAt: null,
    });
    expect(publishedAfterReplacement.publishedAt?.getTime()).toBe(
      firstPublished.publishedAt?.getTime(),
    );
    const publishedReplacementAudit = await prisma.client.auditLog.findFirstOrThrow({
      where: {
        organizationId: context.organizationId,
        targetId: first.id,
        action: "program.published",
      },
      orderBy: { createdAt: "desc" },
    });
    expect(publishedReplacementAudit.metadata).toMatchObject({
      previousOperationalState: "PUBLISHED",
      resultingOperationalState: "PUBLISHED",
      publicationType: "REPLACEMENT_PUBLICATION",
      remainedPaused: false,
    });

    await programs.transition(
      context.ownerId,
      context.organizationId,
      first.id,
      "archive",
      request,
    );
    const replay = await programs.publish(
      context.ownerId,
      context.organizationId,
      first.id,
      replayKey,
      request,
    );
    expect(replay.id).toBe(completed.id);
    expect(
      await prisma.client.loyaltyProgram.findUniqueOrThrow({
        where: { id: first.id },
        select: { status: true },
      }),
    ).toEqual({ status: "ARCHIVED" });
    expect(
      await prisma.client.auditLog.count({
        where: {
          organizationId: context.organizationId,
          targetId: first.id,
          action: "program.published",
        },
      }),
    ).toBe(3);
  });

  it("serializes archive or system suspension against publication without reviving the program", async () => {
    const archiveContext = await scenario();
    const archiveProgram = await createProgram(archiveContext);
    await markPublishReady(archiveContext, archiveProgram);
    const archiveResults = await Promise.allSettled([
      programs.publish(
        archiveContext.ownerId,
        archiveContext.organizationId,
        archiveProgram.id,
        randomUUID(),
        request,
      ),
      programs.transition(
        archiveContext.ownerId,
        archiveContext.organizationId,
        archiveProgram.id,
        "archive",
        request,
      ),
    ]);
    expect(archiveResults[1]?.status).toBe("fulfilled");
    expect(
      await prisma.client.loyaltyProgram.findUniqueOrThrow({
        where: { id: archiveProgram.id },
        select: { status: true },
      }),
    ).toEqual({ status: "ARCHIVED" });
    if (archiveResults[0]?.status === "rejected")
      expect(archiveResults[0].reason).toMatchObject({
        code: "PROGRAM_PUBLICATION_STATE_BLOCKED",
      });

    const suspensionContext = await scenario();
    const suspensionProgram = await createProgram(suspensionContext);
    await markPublishReady(suspensionContext, suspensionProgram);
    const suspensionResults = await Promise.allSettled([
      programs.publish(
        suspensionContext.ownerId,
        suspensionContext.organizationId,
        suspensionProgram.id,
        randomUUID(),
        request,
      ),
      prisma.client.loyaltyProgram.update({
        where: { id: suspensionProgram.id },
        data: { status: "SUSPENDED" },
      }),
    ]);
    expect(suspensionResults[1]?.status).toBe("fulfilled");
    expect(
      await prisma.client.loyaltyProgram.findUniqueOrThrow({
        where: { id: suspensionProgram.id },
        select: { status: true },
      }),
    ).toEqual({ status: "SUSPENDED" });
    if (suspensionResults[0]?.status === "rejected")
      expect(suspensionResults[0].reason).toMatchObject({
        code: "PROGRAM_PUBLICATION_STATE_BLOCKED",
      });
  });

  it("rolls publication, trial, command, and audit state back when audit insertion fails", async () => {
    const context = await scenario();
    const program = await createProgram(context);
    await markPublishReady(context, program);
    const originalRecordInTransaction = audit.recordInTransaction.bind(audit);
    audit.recordInTransaction = async () => {
      throw new Error("injected atomic audit failure");
    };
    try {
      await expect(
        programs.publish(
          context.ownerId,
          context.organizationId,
          program.id,
          randomUUID(),
          request,
        ),
      ).rejects.toThrow("injected atomic audit failure");
    } finally {
      audit.recordInTransaction = originalRecordInTransaction;
    }

    const [storedProgram, storedVersion, billing, commandCount, publicationAuditCount] =
      await Promise.all([
        prisma.client.loyaltyProgram.findUniqueOrThrow({ where: { id: program.id } }),
        prisma.client.loyaltyProgramVersion.findUniqueOrThrow({
          where: { id: program.currentDraftVersion.id },
        }),
        prisma.client.organizationBillingProfile.findUniqueOrThrow({
          where: { organizationId: context.organizationId },
        }),
        prisma.client.programPublishCommand.count({
          where: { organizationId: context.organizationId, programId: program.id },
        }),
        prisma.client.auditLog.count({
          where: {
            organizationId: context.organizationId,
            action: {
              in: [
                "program.published",
                "program.version_superseded",
                "trial.started_by_program_publication",
              ],
            },
          },
        }),
      ]);
    expect(storedProgram).toMatchObject({
      status: "DRAFT",
      currentDraftVersionId: program.currentDraftVersion.id,
      currentPublishedVersionId: null,
    });
    expect(storedVersion.status).toBe("TEST_READY");
    expect(billing).toMatchObject({
      subscriptionStatus: "PENDING_ACTIVATION",
      trialStart: null,
      trialEnd: null,
      trialTriggeringProgramId: null,
    });
    expect(commandCount).toBe(0);
    expect(publicationAuditCount).toBe(0);
  });

  it("enforces optional, milestone, reward, and organization-version tenant guards in PostgreSQL", async () => {
    const home = await scenario("SCALE");
    const foreign = await scenario("SCALE");
    const program = await createProgram(home, "pro");
    const foreignAssets = new Map<string, string>();
    const foreignAsset = (category: string) => {
      const assetId = foreignAssets.get(category);
      if (!assetId) throw new Error(`${category} foreign asset was not created.`);
      return assetId;
    };
    for (const [index, category] of ["LOGO", "HERO", "BACKGROUND", "STAMP_MILESTONE"].entries()) {
      const bytes = await sharp({
        create: {
          width: 80 + index,
          height: 80,
          channels: 4,
          background: {
            r: 30 + index * 20,
            g: 90 + index * 15,
            b: 160 - index * 10,
            alpha: 1,
          },
        },
      })
        .png()
        .toBuffer();
      const asset = await assets.upload(
        foreign.ownerId,
        foreign.organizationId,
        {
          category: category as "LOGO" | "HERO" | "BACKGROUND" | "STAMP_MILESTONE",
          crop: { x: 0, y: 0, width: 1, height: 1, zoom: 1 },
        },
        { filename: `${category}.png`, mimeType: "image/png", bytes },
        request,
      );
      foreignAssets.set(category, asset.id);
    }

    const visualUpdates = [
      { logoAssetId: foreignAsset("LOGO") },
      { heroAssetId: foreignAsset("HERO") },
      { backgroundAssetId: foreignAsset("BACKGROUND") },
      { defaultMilestoneAssetId: foreignAsset("STAMP_MILESTONE") },
    ];
    for (const data of visualUpdates) {
      await expect(
        prisma.client.programVisualTheme.update({
          where: { versionId: program.currentDraftVersion.id },
          data,
        }),
      ).rejects.toThrow(/tenant|organization/i);
    }

    const reward = await prisma.client.rewardDefinition.findFirstOrThrow({
      where: { versionId: program.currentDraftVersion.id },
    });
    await prisma.client.rewardVisualOverride.upsert({
      where: { rewardId: reward.id },
      create: { rewardId: reward.id },
      update: {},
    });
    await expect(
      prisma.client.rewardVisualOverride.update({
        where: { rewardId: reward.id },
        data: { stampAssetId: foreignAsset("STAMP_MILESTONE") },
      }),
    ).rejects.toThrow(/tenant|organization/i);

    const mismatchOperations = [
      () =>
        prisma.client.generatedProgramPreview.create({
          data: {
            organizationId: foreign.organizationId,
            versionId: program.currentDraftVersion.id,
            previewType: "THUMBNAIL",
            progressState: 0,
            configurationHash: "a".repeat(64),
            contentDigest: "b".repeat(64),
            warnings: [],
            objectKey: "forbidden/preview.svg",
            mimeType: "image/svg+xml",
            width: 10,
            height: 10,
          },
        }),
      () =>
        prisma.client.programValidationRun.create({
          data: {
            organizationId: foreign.organizationId,
            versionId: program.currentDraftVersion.id,
            status: "PASSED",
            configurationFingerprint: "c".repeat(64),
            errors: [],
            warnings: [],
            createdByUserId: home.ownerId,
          },
        }),
      () =>
        prisma.client.programTestSession.create({
          data: {
            organizationId: foreign.organizationId,
            versionId: program.currentDraftVersion.id,
            createdByUserId: home.ownerId,
            syntheticDisplayName: "Forbidden tenant session",
          },
        }),
      () =>
        prisma.client.programPublishCommand.create({
          data: {
            organizationId: foreign.organizationId,
            programId: program.id,
            versionId: program.currentDraftVersion.id,
            idempotencyKey: randomUUID(),
          },
        }),
    ];
    for (const operation of mismatchOperations) {
      await expect(operation()).rejects.toThrow(/organization|version|program/i);
    }
  });

  it("rejects direct mutation or destructive child changes for published and superseded versions", async () => {
    const context = await scenario();
    const program = await createProgram(context, "pro");
    await markPublishReady(context, program);
    await programs.publish(
      context.ownerId,
      context.organizationId,
      program.id,
      randomUUID(),
      request,
    );
    const publishedTranslation = await prisma.client.programTranslation.findFirstOrThrow({
      where: { versionId: program.currentDraftVersion.id },
    });
    const publishedRewardTranslation = await prisma.client.rewardTranslation.findFirstOrThrow({
      where: { reward: { versionId: program.currentDraftVersion.id } },
    });
    const publishedVisual = await prisma.client.programVisualTheme.findUniqueOrThrow({
      where: { versionId: program.currentDraftVersion.id },
      include: { filledStampAsset: true },
    });
    await expect(
      prisma.client.programTranslation.update({
        where: { id: publishedTranslation.id },
        data: { programName: "Forbidden published edit" },
      }),
    ).rejects.toThrow(/published|superseded|immutable/i);
    await expect(
      prisma.client.stampRule.delete({
        where: { versionId: program.currentDraftVersion.id },
      }),
    ).rejects.toThrow(/published|superseded|immutable/i);
    await expect(
      prisma.client.loyaltyProgramVersion.update({
        where: { id: program.currentDraftVersion.id },
        data: { baseTemplateCode: "FORBIDDEN" },
      }),
    ).rejects.toThrow(/published|superseded|immutable/i);
    await expect(
      prisma.client.loyaltyProgramVersion.delete({
        where: { id: program.currentDraftVersion.id },
      }),
    ).rejects.toThrow(/published|superseded|immutable/i);
    await expect(
      prisma.client.merchantAsset.update({
        where: { id: publishedVisual.filledStampAssetId },
        data: { originalFilename: "forbidden.svg" },
      }),
    ).rejects.toThrow(/library|immutable/i);
    await expect(
      prisma.client.merchantAsset.delete({
        where: { id: publishedVisual.filledStampAssetId },
      }),
    ).rejects.toThrow(/library|immutable/i);

    const secondDraft = (await programs.createDraft(
      context.ownerId,
      context.organizationId,
      program.id,
      request,
    )) as unknown as CreatedProgram;
    await markPublishReady(context, secondDraft);
    await programs.publish(
      context.ownerId,
      context.organizationId,
      program.id,
      randomUUID(),
      request,
    );
    expect(
      await prisma.client.loyaltyProgramVersion.findUniqueOrThrow({
        where: { id: program.currentDraftVersion.id },
        select: { status: true },
      }),
    ).toEqual({ status: "SUPERSEDED" });
    await expect(
      prisma.client.rewardTranslation.delete({
        where: { id: publishedRewardTranslation.id },
      }),
    ).rejects.toThrow(/published|superseded|immutable/i);
  });

  it("allows only one simultaneous restore when a downgraded plan has one slot", async () => {
    const context = await scenario("GROWTH");
    const first = await createProgram(context);
    const second = await createProgram(context);
    for (const program of [first, second]) {
      await markPublishReady(context, program);
      await programs.publish(
        context.ownerId,
        context.organizationId,
        program.id,
        randomUUID(),
        request,
      );
      await programs.transition(
        context.ownerId,
        context.organizationId,
        program.id,
        "archive",
        request,
      );
    }
    await prisma.client.organization.update({
      where: { id: context.organizationId },
      data: { selectedPlan: "STARTER" },
    });
    await prisma.client.organizationBillingProfile.update({
      where: { organizationId: context.organizationId },
      data: { selectedPlan: "STARTER" },
    });

    const results = await Promise.allSettled([
      programs.transition(context.ownerId, context.organizationId, first.id, "restore", request),
      programs.transition(context.ownerId, context.organizationId, second.id, "restore", request),
    ]);

    expect(fulfilled(results)).toHaveLength(1);
    expect(rejectedCodes(results)).toEqual(["PROGRAM_LIMIT_REACHED"]);
    expect(
      await prisma.client.loyaltyProgram.count({
        where: { organizationId: context.organizationId, status: { not: "ARCHIVED" } },
      }),
    ).toBe(1);
  });
});
