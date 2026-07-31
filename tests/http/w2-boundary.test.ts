import { createHash, randomUUID } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { ProgramCreateInput } from "@waflo/contracts";
import sharp from "../../apps/api/node_modules/sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApplication } from "../../apps/api/src/app";
import { EnvironmentService } from "../../apps/api/src/config/environment.service";
import type { WafloRequest } from "../../apps/api/src/common/request-context";
import { PrismaService } from "../../apps/api/src/database/prisma.service";
import { OBJECT_STORAGE, type ObjectStorage } from "../../apps/api/src/programs/object-storage";
import { ProgramsService } from "../../apps/api/src/programs/programs.service";
import {
  apiDraft,
  createQuickDraft,
} from "../../apps/merchant-dashboard/components/program-studio-types";
import { createOpaqueToken, hashOpaqueToken, hashPassword } from "../../packages/auth/src/index";
import { findProgramTemplate } from "../../packages/contracts/src/index";

const runId = randomUUID().slice(0, 8);
const password = "W2 HTTP Boundary 2026!";
const allowedOrigin = "http://localhost:3001";

interface Identity {
  userId: string;
  sessionCookie: string;
}

interface OrganizationContext {
  organizationId: string;
  locationId: string;
}

let app: NestFastifyApplication;
let prisma: PrismaService;
let environment: EnvironmentService;
let objectStorage: ObjectStorage;
let programs: ProgramsService;
let owner: Identity;
let manager: Identity;
let staff: Identity;
let intruder: Identity;
let growth: OrganizationContext;
let intruderOrganization: OrganizationContext;

const serviceRequest = {
  requestId: `w2-http-service-${runId}`,
  ip: "127.0.0.1",
  headers: { "user-agent": "Waflo W2 HTTP setup" },
} as unknown as WafloRequest;

async function createIdentity(label: string): Promise<Identity> {
  const email = `${label}-${runId}-${randomUUID().slice(0, 6)}@w2-http.waflo.local`;
  const user = await prisma.client.user.create({
    data: {
      email,
      normalizedEmail: email,
      displayName: label,
      passwordHash: await hashPassword(password),
      emailVerifiedAt: new Date(),
      preferredLocale: "EN",
      termsVersion: "test",
      privacyVersion: "test",
      legalAcceptedAt: new Date(),
    },
  });
  const rawSession = createOpaqueToken();
  await prisma.client.session.create({
    data: {
      userId: user.id,
      tokenHash: hashOpaqueToken(rawSession),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  return {
    userId: user.id,
    sessionCookie: `${environment.values.COOKIE_NAME}=${rawSession}`,
  };
}

async function createOrganization(
  ownerId: string,
  plan: "STARTER" | "GROWTH" | "SCALE" = "GROWTH",
): Promise<OrganizationContext> {
  const slug = `w2-http-${runId}-${randomUUID().slice(0, 7)}`.toLowerCase();
  const organization = await prisma.client.organization.create({
    data: {
      name: `W2 HTTP ${slug}`,
      normalizedName: slug,
      merchantSlug: slug,
      defaultLocale: "EN",
      timezone: "UTC",
      selectedPlan: plan,
      members: { create: { userId: ownerId, role: "OWNER" } },
      billingProfile: {
        create: { selectedPlan: plan, subscriptionStatus: "PENDING_ACTIVATION" },
      },
    },
  });
  const location = await prisma.client.location.create({
    data: {
      organizationId: organization.id,
      name: "W2 HTTP location",
      timezone: "UTC",
      status: "ACTIVE",
    },
  });
  return { organizationId: organization.id, locationId: location.id };
}

async function csrf() {
  const response = await app.inject({ method: "GET", url: "/v1/auth/csrf" });
  const setCookie = response.headers["set-cookie"];
  const rawCookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return {
    cookie: rawCookie?.split(";")[0] ?? "",
    token: response.json().data.csrfToken as string,
  };
}

function mutationHeaders(
  csrfState: { cookie: string; token: string },
  identity: Identity,
  contentType = "application/json",
) {
  return {
    origin: allowedOrigin,
    "x-csrf-token": csrfState.token,
    cookie: `${csrfState.cookie}; ${identity.sessionCookie}`,
    "content-type": contentType,
  };
}

function getHeaders(identity: Identity) {
  return { cookie: identity.sessionCookie };
}

function programPayload(
  locationId: string,
  mode: "quick" | "pro" = "pro",
  suffix = randomUUID().slice(0, 6),
): ProgramCreateInput {
  const finalReward = {
    thresholdStampCount: 8,
    rewardType: "FREE_ITEM" as const,
    internalName: "Final reward",
    sortOrder: mode === "pro" ? 1 : 0,
    validityDurationDays: null,
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
    internalName: `HTTP Studio ${suffix}`,
    editingMode: mode,
    templateCode: "COFFEE",
    requiredStampCount: 8,
    translations: {
      en: {
        programName: `Waflo Rewards ${suffix}`,
        shortDescription: "Collect stamps and unlock rewards.",
        fullDescription: "A complete bilingual loyalty card.",
        rewardSummary: "A complimentary signature item",
        joinInstructions: "Join at the counter.",
        termsAndConditions: "One account per customer. Standard terms apply.",
        completionMessage: "You completed the card.",
        rewardUnlockedMessage: "Your reward is ready.",
        pausedMessage: "This program is temporarily paused.",
      },
      ar: {
        programName: `مكافآت وافلو ${suffix}`,
        shortDescription: "اجمع الأختام وافتح المكافآت.",
        fullDescription: "بطاقة ولاء ثنائية اللغة متكاملة.",
        rewardSummary: "منتج مميز مجاني",
        joinInstructions: "انضم عند نقطة البيع.",
        termsAndConditions: "حساب واحد لكل عميل. تطبق الشروط.",
        completionMessage: "أكملت البطاقة.",
        rewardUnlockedMessage: "مكافأتك جاهزة.",
        pausedMessage: "البرنامج متوقف مؤقتًا.",
      },
    },
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
                  name: "Milestone reward",
                  description: "A reward at three stamps.",
                  redemptionInstructions: "Show the unlocked reward.",
                },
                ar: {
                  name: "مكافأة مرحلية",
                  description: "مكافأة عند ثلاثة أختام.",
                  redemptionInstructions: "اعرض المكافأة المفتوحة.",
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
      accentColor: "#B63A18",
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

function data<T>(response: { json(): unknown }): T {
  return (response.json() as { data: T }).data;
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`${label} is required by this test.`);
  return value;
}

async function markHttpPublishReady(
  identity: Identity,
  organizationId: string,
  programId: string,
  version: { id: string; revision: number },
) {
  await Promise.all([
    programs.preview(
      identity.userId,
      organizationId,
      programId,
      0,
      "CUSTOMER_WEB",
      "EN",
      serviceRequest,
    ),
    programs.preview(
      identity.userId,
      organizationId,
      programId,
      0,
      "APPLE_WALLET",
      "EN",
      serviceRequest,
    ),
    programs.preview(
      identity.userId,
      organizationId,
      programId,
      0,
      "GOOGLE_WALLET",
      "EN",
      serviceRequest,
    ),
  ]);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ versionId: version.id, revision: version.revision }))
    .digest("hex");
  await prisma.client.loyaltyProgramVersion.update({
    where: { id: version.id },
    data: {
      status: "TEST_READY",
      validatedAt: new Date(),
      testReadyAt: new Date(),
      validationFingerprint: fingerprint,
    },
  });
  await prisma.client.programValidationRun.create({
    data: {
      organizationId,
      versionId: version.id,
      status: "PASSED",
      configurationFingerprint: fingerprint,
      errors: [],
      warnings: [],
      createdByUserId: identity.userId,
    },
  });
  await prisma.client.programTestSession.create({
    data: {
      organizationId,
      versionId: version.id,
      createdByUserId: identity.userId,
      syntheticDisplayName: "HTTP operational-state customer",
      versionRevision: version.revision,
      validationFingerprint: fingerprint,
      status: "COMPLETED",
      cycleCount: 1,
    },
  });
}

async function uploadAsset(
  csrfState: { cookie: string; token: string },
  identity: Identity,
  organizationId: string,
  category: "LOGO" | "HERO" | "BACKGROUND" | "STAMP_FILLED" | "STAMP_EMPTY" | "STAMP_MILESTONE",
  bytes: Buffer,
) {
  const boundary = `waflo-upload-${randomUUID()}`;
  const metadata = JSON.stringify({
    category,
    crop: { x: 0, y: 0, width: 1, height: 1, zoom: 1 },
  });
  const multipart = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n${metadata}\r\n`,
    ),
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${category.toLowerCase()}.png"\r\nContent-Type: image/png\r\n\r\n`,
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const response = await app.inject({
    method: "POST",
    url: `/v1/organizations/${organizationId}/assets`,
    headers: mutationHeaders(csrfState, identity, `multipart/form-data; boundary=${boundary}`),
    payload: multipart,
  });
  expect(response.statusCode, response.body).toBe(201);
  return data<{ id: string; variants: Array<{ variantCode: string }> }>(response);
}

describe.sequential("Waflo W2 real NestJS/Fastify HTTP boundary", () => {
  beforeAll(async () => {
    app = await createApiApplication({ logger: false });
    prisma = app.get(PrismaService);
    environment = app.get(EnvironmentService);
    objectStorage = app.get<ObjectStorage>(OBJECT_STORAGE);
    programs = app.get(ProgramsService);
    owner = await createIdentity("w2-owner");
    manager = await createIdentity("w2-manager");
    staff = await createIdentity("w2-staff");
    intruder = await createIdentity("w2-intruder");
    growth = await createOrganization(owner.userId);
    intruderOrganization = await createOrganization(intruder.userId);
    await prisma.client.organizationMember.createMany({
      data: [
        {
          organizationId: growth.organizationId,
          userId: manager.userId,
          role: "MANAGER",
        },
        {
          organizationId: growth.organizationId,
          userId: staff.userId,
          role: "STAFF",
        },
      ],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("enforces authentication, role permissions, and cross-tenant isolation", async () => {
    const programsUrl = `/v1/organizations/${growth.organizationId}/programs`;
    const anonymous = await app.inject({ method: "GET", url: programsUrl });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json().error.code).toBe("AUTH_REQUIRED");

    const staffList = await app.inject({
      method: "GET",
      url: programsUrl,
      headers: getHeaders(staff),
    });
    expect(staffList.statusCode).toBe(403);
    expect(staffList.json().error.code).toBe("PERMISSION_DENIED");

    const intruderList = await app.inject({
      method: "GET",
      url: programsUrl,
      headers: getHeaders(intruder),
    });
    expect(intruderList.statusCode).toBe(403);
    expect(intruderList.json().error.code).toBe("ORGANIZATION_ACCESS_DENIED");

    const templates = await app.inject({
      method: "GET",
      url: `${programsUrl}/templates`,
      headers: getHeaders(manager),
    });
    expect(templates.statusCode).toBe(200);
    const templateItems =
      data<Array<{ code: string; version: number; artwork: object }>>(templates);
    expect(new Set(templateItems.map((template) => template.code))).toEqual(
      new Set([
        "COFFEE",
        "COOKIES",
        "CAR_WASH",
        "SALON",
        "BARBERSHOP",
        "RESTAURANT",
        "RETAIL",
        "GENERAL_VISITS",
      ]),
    );
    expect(templateItems.every((template) => template.version >= 2)).toBe(true);

    const csrfState = await csrf();
    const managerCreate = await app.inject({
      method: "POST",
      url: programsUrl,
      headers: mutationHeaders(csrfState, manager),
      payload: programPayload(growth.locationId, "quick", "manager"),
    });
    expect(managerCreate.statusCode).toBe(201);
    const managerProgram = data<{ id: string }>(managerCreate);

    const crossTenantProgram = await app.inject({
      method: "GET",
      url: `/v1/organizations/${intruderOrganization.organizationId}/programs/${managerProgram.id}`,
      headers: getHeaders(intruder),
    });
    expect(crossTenantProgram.statusCode).toBe(404);
    expect(crossTenantProgram.json().error.code).toBe("PROGRAM_NOT_FOUND");
  });

  it("covers create, edit, preview, validation, Test Mode, publication, versions, and lifecycle", async () => {
    const baseUrl = `/v1/organizations/${growth.organizationId}/programs`;
    const csrfState = await csrf();
    const createdResponse = await app.inject({
      method: "POST",
      url: baseUrl,
      headers: mutationHeaders(csrfState, owner),
      payload: programPayload(growth.locationId, "pro", "owner-flow"),
    });
    expect(createdResponse.statusCode, createdResponse.body).toBe(201);
    const created = data<{
      id: string;
      currentDraftVersion: {
        id: string;
        revision: number;
        rewards: Array<{ id: string; thresholdStampCount: number }>;
      };
    }>(createdResponse);

    const listed = await app.inject({
      method: "GET",
      url: baseUrl,
      headers: getHeaders(owner),
    });
    expect(listed.statusCode).toBe(200);
    expect(
      data<{ items: Array<{ id: string }> }>(listed).items.some(
        (program) => program.id === created.id,
      ),
    ).toBe(true);

    const fetched = await app.inject({
      method: "GET",
      url: `${baseUrl}/${created.id}`,
      headers: getHeaders(owner),
    });
    expect(fetched.statusCode).toBe(200);
    expect(
      data<{ currentDraftVersion: { rewards: unknown[] } }>(fetched).currentDraftVersion.rewards,
    ).toHaveLength(2);

    const versionsBefore = await app.inject({
      method: "GET",
      url: `${baseUrl}/${created.id}/versions`,
      headers: getHeaders(owner),
    });
    expect(versionsBefore.statusCode).toBe(200);
    expect(data<{ items: unknown[] }>(versionsBefore).items).toHaveLength(1);
    const versionBefore = await app.inject({
      method: "GET",
      url: `${baseUrl}/${created.id}/versions/${created.currentDraftVersion.id}`,
      headers: getHeaders(owner),
    });
    expect(versionBefore.statusCode).toBe(200);

    const staleEditor = await app.inject({
      method: "PATCH",
      url: `${baseUrl}/${created.id}`,
      headers: mutationHeaders(csrfState, owner),
      payload: { revision: created.currentDraftVersion.revision + 50, internalName: "Stale" },
    });
    expect(staleEditor.statusCode).toBe(409);
    expect(staleEditor.json().error.code).toBe("STALE_PROGRAM_DRAFT");

    const editedResponse = await app.inject({
      method: "PATCH",
      url: `${baseUrl}/${created.id}`,
      headers: mutationHeaders(csrfState, owner),
      payload: {
        revision: created.currentDraftVersion.revision,
        internalName: "HTTP Studio edited",
        changeSummary: "HTTP boundary save",
      },
    });
    expect(editedResponse.statusCode).toBe(200);
    const preservedAfterPartialPatch = await app.inject({
      method: "GET",
      url: `${baseUrl}/${created.id}`,
      headers: getHeaders(owner),
    });
    const preserved = data<{
      currentDraftVersion: {
        changeSummary: string | null;
        translations: Array<{
          locale: "EN" | "AR";
          fullDescription: string | null;
          joinInstructions: string | null;
          pausedMessage: string | null;
        }>;
        rewards: Array<{
          translations: Array<{
            locale: "EN" | "AR";
            redemptionInstructions: string | null;
          }>;
        }>;
        stampRule: {
          defaultStampsPerAction: number;
          maximumStampsPerOperation: number;
          maximumStampsPerCustomerPerDay: number | null;
          minimumPurchaseAmountMinor: number | null;
          minimumPurchaseCurrency: string | null;
          resetBehaviorAfterReward: string;
        };
        visualTheme: {
          defaultMilestoneAssetId: string | null;
          applePreviewConfig: Record<string, unknown>;
          googlePreviewConfig: Record<string, unknown>;
        };
      };
    }>(preservedAfterPartialPatch).currentDraftVersion;
    expect(preserved.changeSummary).toBe("HTTP boundary save");
    expect(preserved.translations.find((item) => item.locale === "EN")).toMatchObject({
      fullDescription: "A complete bilingual loyalty card.",
      joinInstructions: "Join at the counter.",
      pausedMessage: "This program is temporarily paused.",
    });
    expect(
      preserved.rewards[0]?.translations.find((item) => item.locale === "EN")
        ?.redemptionInstructions,
    ).toBe("Show the unlocked reward.");
    expect(preserved.stampRule).toMatchObject({
      defaultStampsPerAction: 1,
      maximumStampsPerOperation: 5,
      maximumStampsPerCustomerPerDay: null,
      minimumPurchaseAmountMinor: null,
      minimumPurchaseCurrency: null,
      resetBehaviorAfterReward: "RESET_ON_FINAL_REWARD_REDEMPTION",
    });
    expect(preserved.visualTheme.defaultMilestoneAssetId).toBeTruthy();
    expect(preserved.visualTheme.applePreviewConfig).toMatchObject({
      headerLabel: "REWARDS",
    });
    expect(preserved.visualTheme.googlePreviewConfig).toMatchObject({
      title: "Waflo Rewards",
    });

    const invalidPreview = await app.inject({
      method: "GET",
      url: `${baseUrl}/${created.id}/preview?progress=-1&layout=GRID`,
      headers: getHeaders(owner),
    });
    expect(invalidPreview.statusCode).toBe(400);
    expect(invalidPreview.json().error.code).toBe("PREVIEW_PARAMETERS_INVALID");
    const conflictingLayoutPreview = await app.inject({
      method: "GET",
      url: `${baseUrl}/${created.id}/preview?progress=4&layout=ROW&profile=CUSTOMER_WEB`,
      headers: getHeaders(owner),
    });
    expect(conflictingLayoutPreview.statusCode).toBe(409);
    expect(conflictingLayoutPreview.json().error.code).toBe("PREVIEW_LAYOUT_OVERRIDE_FORBIDDEN");

    const validationFailure = await app.inject({
      method: "POST",
      url: `${baseUrl}/${created.id}/validate`,
      headers: mutationHeaders(csrfState, owner),
      payload: {},
    });
    expect(validationFailure.statusCode).toBe(201);
    expect(
      data<{ errors: Array<{ code: string }> }>(validationFailure).errors.map(
        (error) => error.code,
      ),
    ).toEqual(expect.arrayContaining(["PREVIEW_STALE", "PREVIEW_PROFILE_MISSING"]));

    const prematureTest = await app.inject({
      method: "POST",
      url: `${baseUrl}/${created.id}/test-sessions`,
      headers: mutationHeaders(csrfState, owner),
      payload: {},
    });
    expect(prematureTest.statusCode).toBe(409);
    expect(prematureTest.json().error.code).toBe("PROGRAM_NOT_TEST_READY");

    const customerPreview = await app.inject({
      method: "GET",
      url: `${baseUrl}/${created.id}/preview?progress=4&profile=CUSTOMER_WEB&locale=EN`,
      headers: getHeaders(owner),
    });
    expect(customerPreview.statusCode).toBe(200);
    expect(data<{ svg: string; profile: string }>(customerPreview)).toMatchObject({
      profile: "CUSTOMER_WEB",
    });
    expect(data<{ svg: string }>(customerPreview).svg).toContain("<svg");
    for (const preview of [
      { profile: "APPLE_WALLET", locale: "EN" },
      { profile: "GOOGLE_WALLET", locale: "AR" },
    ]) {
      const response = await app.inject({
        method: "GET",
        url: `${baseUrl}/${created.id}/preview?progress=4&profile=${preview.profile}&locale=${preview.locale}`,
        headers: getHeaders(owner),
      });
      expect(response.statusCode).toBe(200);
      expect(data<{ profile: string; locale: string }>(response)).toMatchObject(preview);
    }

    const validationPass = await app.inject({
      method: "POST",
      url: `${baseUrl}/${created.id}/validate`,
      headers: mutationHeaders(csrfState, owner),
      payload: {},
    });
    expect(validationPass.statusCode).toBe(201);
    expect(data<{ errors: unknown[] }>(validationPass).errors).toEqual([]);

    const reversibleSessionResponse = await app.inject({
      method: "POST",
      url: `${baseUrl}/${created.id}/test-sessions`,
      headers: mutationHeaders(csrfState, owner),
      payload: {},
    });
    expect(reversibleSessionResponse.statusCode).toBe(201);
    const reversibleSession = data<{ id: string }>(reversibleSessionResponse);
    const addOne = await app.inject({
      method: "POST",
      url: `${baseUrl}/test-sessions/${reversibleSession.id}/stamps`,
      headers: mutationHeaders(csrfState, owner),
      payload: { amount: 1, idempotencyKey: randomUUID() },
    });
    expect(addOne.statusCode).toBe(201);
    const reverse = await app.inject({
      method: "POST",
      url: `${baseUrl}/test-sessions/${reversibleSession.id}/reverse`,
      headers: mutationHeaders(csrfState, owner),
      payload: { idempotencyKey: randomUUID() },
    });
    expect(reverse.statusCode).toBe(201);
    expect(data<{ currentStampCount: number }>(reverse).currentStampCount).toBe(0);
    const resetKey = randomUUID();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const reset = await app.inject({
        method: "POST",
        url: `${baseUrl}/test-sessions/${reversibleSession.id}/reset`,
        headers: mutationHeaders(csrfState, owner),
        payload: { idempotencyKey: resetKey },
      });
      expect(reset.statusCode).toBe(201);
    }

    const testSessionResponse = await app.inject({
      method: "POST",
      url: `${baseUrl}/${created.id}/test-sessions`,
      headers: mutationHeaders(csrfState, owner),
      payload: {},
    });
    expect(testSessionResponse.statusCode).toBe(201);
    const testSession = data<{
      id: string;
      version: { rewards: Array<{ id: string; thresholdStampCount: number }> };
    }>(testSessionResponse);
    const milestone = testSession.version.rewards.find(
      (reward) => reward.thresholdStampCount === 3,
    );
    const finalReward = testSession.version.rewards.find(
      (reward) => reward.thresholdStampCount === 8,
    );
    expect(milestone?.id).toBeTruthy();
    expect(finalReward?.id).toBeTruthy();

    const addThree = await app.inject({
      method: "POST",
      url: `${baseUrl}/test-sessions/${testSession.id}/stamps`,
      headers: mutationHeaders(csrfState, owner),
      payload: { amount: 3, idempotencyKey: randomUUID() },
    });
    expect(addThree.statusCode).toBe(201);
    const redeemMilestone = await app.inject({
      method: "POST",
      url: `${baseUrl}/test-sessions/${testSession.id}/redeem/${milestone?.id}`,
      headers: mutationHeaders(csrfState, owner),
      payload: { idempotencyKey: randomUUID() },
    });
    expect(redeemMilestone.statusCode).toBe(201);
    const addFinal = await app.inject({
      method: "POST",
      url: `${baseUrl}/test-sessions/${testSession.id}/stamps`,
      headers: mutationHeaders(csrfState, owner),
      payload: { amount: 5, idempotencyKey: randomUUID() },
    });
    expect(addFinal.statusCode).toBe(201);
    const redeemFinal = await app.inject({
      method: "POST",
      url: `${baseUrl}/test-sessions/${testSession.id}/redeem/${finalReward?.id}`,
      headers: mutationHeaders(csrfState, owner),
      payload: { idempotencyKey: randomUUID() },
    });
    expect(redeemFinal.statusCode).toBe(201);

    const completedSession = await app.inject({
      method: "GET",
      url: `${baseUrl}/test-sessions/${testSession.id}`,
      headers: getHeaders(owner),
    });
    expect(completedSession.statusCode).toBe(200);
    expect(data<{ status: string }>(completedSession).status).toBe("COMPLETED");

    const publishKey = randomUUID();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const published = await app.inject({
        method: "POST",
        url: `${baseUrl}/${created.id}/publish`,
        headers: mutationHeaders(csrfState, owner),
        payload: { idempotencyKey: publishKey },
      });
      expect(published.statusCode).toBe(201);
      expect(data<{ status: string }>(published).status).toBe("COMPLETED");
    }

    const draftResponse = await app.inject({
      method: "POST",
      url: `${baseUrl}/${created.id}/draft`,
      headers: mutationHeaders(csrfState, owner),
      payload: {},
    });
    expect(draftResponse.statusCode).toBe(201);
    const draft = data<{ currentDraftVersion: { revision: number; versionNumber: number } }>(
      draftResponse,
    );
    expect(draft.currentDraftVersion.versionNumber).toBe(2);
    const updateV2 = await app.inject({
      method: "PATCH",
      url: `${baseUrl}/${created.id}`,
      headers: mutationHeaders(csrfState, owner),
      payload: {
        revision: draft.currentDraftVersion.revision,
        internalName: "HTTP Studio version two",
        changeSummary: "Version two draft",
      },
    });
    expect(updateV2.statusCode).toBe(200);
    const abandon = await app.inject({
      method: "POST",
      url: `${baseUrl}/${created.id}/draft/abandon`,
      headers: mutationHeaders(csrfState, owner),
      payload: {},
    });
    expect(abandon.statusCode).toBe(201);

    for (const action of ["pause", "resume", "archive", "restore"]) {
      const transition = await app.inject({
        method: "POST",
        url: `${baseUrl}/${created.id}/${action}`,
        headers: mutationHeaders(csrfState, owner),
        payload: {},
      });
      expect(transition.statusCode).toBe(201);
    }
    const finalProgram = await app.inject({
      method: "GET",
      url: `${baseUrl}/${created.id}`,
      headers: getHeaders(owner),
    });
    expect(data<{ status: string }>(finalProgram).status).toBe("PUBLISHED");
    const versionsAfter = await app.inject({
      method: "GET",
      url: `${baseUrl}/${created.id}/versions`,
      headers: getHeaders(owner),
    });
    expect(
      data<{ items: Array<{ versionNumber: number; status: string }> }>(versionsAfter).items,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ versionNumber: 1, status: "PUBLISHED" }),
        expect.objectContaining({ versionNumber: 2, status: "ABANDONED" }),
      ]),
    );
  });

  it("enforces publication operational state through the HTTP envelope and explicit Resume", async () => {
    const context = await createOrganization(owner.userId);
    const baseUrl = `/v1/organizations/${context.organizationId}/programs`;
    const csrfState = await csrf();
    const createdResponse = await app.inject({
      method: "POST",
      url: baseUrl,
      headers: mutationHeaders(csrfState, owner),
      payload: programPayload(context.locationId, "quick", "state-policy"),
    });
    expect(createdResponse.statusCode, createdResponse.body).toBe(201);
    const created = data<{
      id: string;
      currentDraftVersion: { id: string; revision: number };
    }>(createdResponse);
    await markHttpPublishReady(
      owner,
      context.organizationId,
      created.id,
      created.currentDraftVersion,
    );

    for (const status of ["ARCHIVED", "SUSPENDED", "SCHEDULED"] as const) {
      await prisma.client.loyaltyProgram.update({
        where: { id: created.id },
        data: {
          status,
          archivedAt: status === "ARCHIVED" ? new Date() : null,
        },
      });
      const blocked = await app.inject({
        method: "POST",
        url: `${baseUrl}/${created.id}/publish`,
        headers: mutationHeaders(csrfState, owner),
        payload: { idempotencyKey: randomUUID() },
      });
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json().error).toMatchObject({
        code: "PROGRAM_PUBLICATION_STATE_BLOCKED",
        details: {
          programStatus: status,
          ...(status === "ARCHIVED" ? { requiredAction: "RESTORE_PROGRAM" } : {}),
        },
      });
      expect(blocked.json().error.details).not.toHaveProperty("suspensionReason");
    }

    await prisma.client.loyaltyProgram.update({
      where: { id: created.id },
      data: { status: "TEST", archivedAt: null },
    });
    const firstPublishKey = randomUUID();
    const firstPublished = await app.inject({
      method: "POST",
      url: `${baseUrl}/${created.id}/publish`,
      headers: mutationHeaders(csrfState, owner),
      payload: { idempotencyKey: firstPublishKey },
    });
    expect(firstPublished.statusCode).toBe(201);
    const firstCommand = data<{ id: string }>(firstPublished);
    const firstReplay = await app.inject({
      method: "POST",
      url: `${baseUrl}/${created.id}/publish`,
      headers: mutationHeaders(csrfState, owner),
      payload: { idempotencyKey: firstPublishKey },
    });
    expect(firstReplay.statusCode).toBe(201);
    expect(data<{ id: string }>(firstReplay).id).toBe(firstCommand.id);

    const replacementResponse = await app.inject({
      method: "POST",
      url: `${baseUrl}/${created.id}/draft`,
      headers: mutationHeaders(csrfState, owner),
      payload: {},
    });
    expect(replacementResponse.statusCode).toBe(201);
    const replacement = data<{
      currentDraftVersion: { id: string; revision: number };
    }>(replacementResponse);
    await markHttpPublishReady(
      owner,
      context.organizationId,
      created.id,
      replacement.currentDraftVersion,
    );
    const paused = await app.inject({
      method: "POST",
      url: `${baseUrl}/${created.id}/pause`,
      headers: mutationHeaders(csrfState, owner),
      payload: {},
    });
    expect(paused.statusCode).toBe(201);
    const pausedAt = data<{ pausedAt: string }>(paused).pausedAt;

    const pausedReplacement = await app.inject({
      method: "POST",
      url: `${baseUrl}/${created.id}/publish`,
      headers: mutationHeaders(csrfState, owner),
      payload: { idempotencyKey: randomUUID() },
    });
    expect(pausedReplacement.statusCode).toBe(201);
    const pausedProgramResponse = await app.inject({
      method: "GET",
      url: `${baseUrl}/${created.id}`,
      headers: getHeaders(owner),
    });
    expect(data<{ status: string; pausedAt: string }>(pausedProgramResponse)).toMatchObject({
      status: "PAUSED",
      pausedAt,
    });
    expect(
      await prisma.client.auditLog.count({
        where: {
          organizationId: context.organizationId,
          targetId: created.id,
          action: "program.resumed",
        },
      }),
    ).toBe(0);

    const resumed = await app.inject({
      method: "POST",
      url: `${baseUrl}/${created.id}/resume`,
      headers: mutationHeaders(csrfState, owner),
      payload: {},
    });
    expect(resumed.statusCode).toBe(201);
    expect(data<{ status: string; pausedAt: string | null }>(resumed)).toMatchObject({
      status: "PUBLISHED",
      pausedAt: null,
    });

    const archivedReplacement = await app.inject({
      method: "POST",
      url: `${baseUrl}/${created.id}/draft`,
      headers: mutationHeaders(csrfState, owner),
      payload: {},
    });
    const archivedDraft = data<{
      currentDraftVersion: { id: string; revision: number };
    }>(archivedReplacement);
    await markHttpPublishReady(
      owner,
      context.organizationId,
      created.id,
      archivedDraft.currentDraftVersion,
    );
    await app.inject({
      method: "POST",
      url: `${baseUrl}/${created.id}/archive`,
      headers: mutationHeaders(csrfState, owner),
      payload: {},
    });
    const blockedReplacement = await app.inject({
      method: "POST",
      url: `${baseUrl}/${created.id}/publish`,
      headers: mutationHeaders(csrfState, owner),
      payload: { idempotencyKey: randomUUID() },
    });
    expect(blockedReplacement.statusCode).toBe(409);
    expect(blockedReplacement.json().error).toMatchObject({
      code: "PROGRAM_PUBLICATION_STATE_BLOCKED",
      details: {
        programStatus: "ARCHIVED",
        requiredAction: "RESTORE_PROGRAM",
      },
    });
  });

  it("covers multipart validation, listing, private reads, archive, and tenant-safe asset errors", async () => {
    const csrfState = await csrf();
    const assetsUrl = `/v1/organizations/${growth.organizationId}/assets`;
    const malformedBoundary = `waflo-malformed-${randomUUID()}`;
    const malformed = await app.inject({
      method: "POST",
      url: assetsUrl,
      headers: mutationHeaders(
        csrfState,
        owner,
        `multipart/form-data; boundary=${malformedBoundary}`,
      ),
      payload: Buffer.from(
        `--${malformedBoundary}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\nnot-json\r\n--${malformedBoundary}--\r\n`,
      ),
    });
    expect(malformed.statusCode).toBe(422);
    expect(malformed.json().error.code).toBe("ASSET_METADATA_INVALID");

    const boundary = `waflo-w2-${randomUUID()}`;
    const metadata = JSON.stringify({
      category: "LOGO",
      crop: { x: 0, y: 0, width: 1, height: 1, zoom: 1 },
    });
    const image = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAARklEQVRYhe3XwQ0AMAhC0U7EOuyfuIfdor28g3cTET5nmv05xwLjBCXCeMNlRMOKK4wijheQDCQrKA0sX8VkVLMqp3mugwtMYqCIQ8Mt0gAAAABJRU5ErkJggg==",
      "base64",
    );
    const multipart = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n${metadata}\r\n`,
      ),
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="logo.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      image,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const uploaded = await app.inject({
      method: "POST",
      url: assetsUrl,
      headers: mutationHeaders(csrfState, owner, `multipart/form-data; boundary=${boundary}`),
      payload: multipart,
    });
    expect(uploaded.statusCode).toBe(201);
    const asset = data<{ id: string; variants: Array<{ variantCode: string }> }>(uploaded);
    expect(asset.variants).toHaveLength(3);

    const listed = await app.inject({
      method: "GET",
      url: assetsUrl,
      headers: getHeaders(owner),
    });
    expect(
      data<{ items: Array<{ id: string }> }>(listed).items.some((item) => item.id === asset.id),
    ).toBe(true);

    const invalidVariant = await app.inject({
      method: "GET",
      url: `${assetsUrl}/${asset.id}/content?variant=RAW`,
      headers: getHeaders(owner),
    });
    expect(invalidVariant.statusCode).toBe(400);
    expect(invalidVariant.json().error.code).toBe("ASSET_VARIANT_INVALID");

    const intruderRead = await app.inject({
      method: "GET",
      url: `${assetsUrl}/${asset.id}/content?variant=THUMBNAIL_96`,
      headers: getHeaders(intruder),
    });
    expect(intruderRead.statusCode).toBe(403);
    expect(intruderRead.json().error.code).toBe("ORGANIZATION_ACCESS_DENIED");

    const archived = await app.inject({
      method: "DELETE",
      url: `${assetsUrl}/${asset.id}`,
      headers: mutationHeaders(csrfState, owner),
      payload: {},
    });
    expect(archived.statusCode).toBe(200);
    const afterArchive = await app.inject({
      method: "GET",
      url: `${assetsUrl}/${asset.id}/content`,
      headers: getHeaders(owner),
    });
    expect(afterArchive.statusCode).toBe(404);
    expect(afterArchive.json().error.code).toBe("ASSET_NOT_FOUND");
  });

  it("persists template defaults, renders backgrounds truthfully, paginates, and rejects foreign visual assets", async () => {
    const csrfState = await csrf();
    const scale = await createOrganization(owner.userId, "SCALE");
    const programsUrl = `/v1/organizations/${scale.organizationId}/programs`;
    const assetsUrl = `/v1/organizations/${scale.organizationId}/assets`;
    const image = await sharp({
      create: {
        width: 180,
        height: 120,
        channels: 4,
        background: { r: 36, g: 132, b: 188, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const background = await uploadAsset(
      csrfState,
      owner,
      scale.organizationId,
      "BACKGROUND",
      image,
    );
    const template = required(findProgramTemplate("CAR_WASH", 2), "Car wash v2");
    const templateDraft = createQuickDraft(template, "quick");
    templateDraft.internalName = `Template defaults ${runId}`;
    templateDraft.locationIds = [scale.locationId];
    templateDraft.visualTheme.backgroundAssetId = background.id;
    const createdResponse = await app.inject({
      method: "POST",
      url: programsUrl,
      headers: mutationHeaders(csrfState, owner),
      payload: apiDraft(templateDraft),
    });
    expect(createdResponse.statusCode, createdResponse.body).toBe(201);
    const created = data<{
      id: string;
      currentDraftVersion: {
        id: string;
        baseTemplateCode: string;
        baseTemplateVersion: number;
      };
    }>(createdResponse);
    const persisted = await prisma.client.loyaltyProgramVersion.findUniqueOrThrow({
      where: { id: created.currentDraftVersion.id },
      include: {
        translations: true,
        stampRule: true,
        rewards: true,
        visualTheme: true,
      },
    });
    expect(persisted).toMatchObject({
      baseTemplateCode: "CAR_WASH",
      baseTemplateVersion: 2,
      stampRule: {
        requiredStampCount: template.recommendedStampGoal,
        earningDescription: template.earningDescription,
      },
      visualTheme: {
        backgroundColor: template.colors.background,
        accentColor: template.colors.accent,
        layoutType: template.layout.type,
        customerWebVariant: template.customerWeb.variant,
        backgroundAssetId: background.id,
      },
    });
    expect(persisted.translations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          locale: "EN",
          programName: template.copy.en.programName,
        }),
        expect.objectContaining({
          locale: "AR",
          programName: template.copy.ar.programName,
        }),
      ]),
    );
    expect(persisted.rewards).toEqual([
      expect.objectContaining({
        thresholdStampCount: template.recommendedStampGoal,
        internalName: template.finalReward.internalName,
      }),
    ]);

    const variant = await prisma.client.merchantAssetVariant.findUniqueOrThrow({
      where: {
        assetId_variantCode: {
          assetId: background.id,
          variantCode: "ORIGINAL_SAFE",
        },
      },
    });
    const backgroundBytes = await objectStorage.get(variant.objectKey);
    const customerPreview = await app.inject({
      method: "GET",
      url: `${programsUrl}/${created.id}/preview?progress=1&profile=CUSTOMER_WEB&locale=EN`,
      headers: getHeaders(owner),
    });
    expect(customerPreview.statusCode, customerPreview.body).toBe(200);
    expect(data<{ svg: string }>(customerPreview).svg).toContain(
      `data:${variant.mimeType};base64,${backgroundBytes.toString("base64")}`,
    );
    for (const platform of ["APPLE_WALLET", "GOOGLE_WALLET"] as const) {
      const preview = await app.inject({
        method: "GET",
        url: `${programsUrl}/${created.id}/preview?progress=1&profile=${platform}&locale=EN`,
        headers: getHeaders(owner),
      });
      expect(preview.statusCode, preview.body).toBe(200);
      expect(
        data<{ warnings: Array<{ code: string }> }>(preview).warnings.map(
          (warning) => warning.code,
        ),
      ).toContain(
        platform === "APPLE_WALLET"
          ? "APPLE_BACKGROUND_ARTWORK_UNSUPPORTED"
          : "GOOGLE_BACKGROUND_ARTWORK_UNSUPPORTED",
      );
    }

    await objectStorage.delete(variant.objectKey);
    const missingObject = await app.inject({
      method: "GET",
      url: `${programsUrl}/${created.id}/preview?progress=2&profile=CUSTOMER_WEB&locale=EN`,
      headers: getHeaders(owner),
    });
    expect(missingObject.statusCode).toBe(503);
    expect(missingObject.json().error.code).toBe("PROGRAM_ASSET_CONTENT_UNAVAILABLE");
    await objectStorage.put(variant.objectKey, Buffer.from("corrupted-object"), variant.mimeType);
    const corruptedObject = await app.inject({
      method: "GET",
      url: `${programsUrl}/${created.id}/preview?progress=3&profile=CUSTOMER_WEB&locale=EN`,
      headers: getHeaders(owner),
    });
    expect(corruptedObject.statusCode).toBe(503);
    expect(corruptedObject.json().error.code).toBe("PROGRAM_ASSET_CONTENT_UNAVAILABLE");
    await objectStorage.put(variant.objectKey, backgroundBytes, variant.mimeType);

    for (const [index, code] of ["COFFEE", "COOKIES"].entries()) {
      const selected = required(findProgramTemplate(code, 2), `${code} v2`);
      const draft = createQuickDraft(selected, "quick");
      draft.internalName = `Pagination ${index} ${runId}`;
      draft.locationIds = [scale.locationId];
      const response = await app.inject({
        method: "POST",
        url: programsUrl,
        headers: mutationHeaders(csrfState, owner),
        payload: apiDraft(draft),
      });
      expect(response.statusCode, response.body).toBe(201);
    }
    const firstProgramsPage = await app.inject({
      method: "GET",
      url: `${programsUrl}?limit=2`,
      headers: getHeaders(owner),
    });
    const firstPrograms = data<{
      items: Array<{ id: string }>;
      nextCursor: string | null;
    }>(firstProgramsPage);
    expect(firstPrograms.items).toHaveLength(2);
    expect(firstPrograms.nextCursor).toBeTruthy();
    const secondProgramsPage = await app.inject({
      method: "GET",
      url: `${programsUrl}?limit=2&cursor=${encodeURIComponent(required(firstPrograms.nextCursor ?? undefined, "program cursor"))}`,
      headers: getHeaders(owner),
    });
    const secondPrograms = data<{
      items: Array<{ id: string }>;
      nextCursor: string | null;
    }>(secondProgramsPage);
    expect(secondPrograms.items.length).toBeGreaterThan(0);
    expect(
      secondPrograms.items.some((item) =>
        firstPrograms.items.some((first) => first.id === item.id),
      ),
    ).toBe(false);

    for (const [index, category] of ["LOGO", "HERO"].entries()) {
      const bytes = await sharp({
        create: {
          width: 90 + index,
          height: 90,
          channels: 4,
          background: { r: 170 - index * 20, g: 80 + index * 20, b: 60, alpha: 1 },
        },
      })
        .png()
        .toBuffer();
      await uploadAsset(csrfState, owner, scale.organizationId, category as "LOGO" | "HERO", bytes);
    }
    const firstAssetsPage = await app.inject({
      method: "GET",
      url: `${assetsUrl}?limit=2`,
      headers: getHeaders(owner),
    });
    const firstAssets = data<{
      items: Array<{ id: string }>;
      nextCursor: string | null;
    }>(firstAssetsPage);
    expect(firstAssets.items).toHaveLength(2);
    expect(firstAssets.nextCursor).toBeTruthy();
    const secondAssetsPage = await app.inject({
      method: "GET",
      url: `${assetsUrl}?limit=2&cursor=${encodeURIComponent(required(firstAssets.nextCursor ?? undefined, "asset cursor"))}`,
      headers: getHeaders(owner),
    });
    const secondAssets = data<{ items: Array<{ id: string }> }>(secondAssetsPage);
    expect(secondAssets.items.length).toBeGreaterThan(0);
    expect(
      secondAssets.items.some((item) => firstAssets.items.some((first) => first.id === item.id)),
    ).toBe(false);

    await prisma.client.loyaltyProgramVersion.createMany({
      data: [2, 3].map((versionNumber) => ({
        programId: created.id,
        organizationId: scale.organizationId,
        versionNumber,
        status: "ABANDONED" as const,
        editingMode: "QUICK" as const,
        baseTemplateCode: "CAR_WASH",
        baseTemplateVersion: 2,
        configurationSchemaVersion: 2,
        createdByUserId: owner.userId,
        abandonedAt: new Date(),
      })),
    });
    await prisma.client.loyaltyProgram.update({
      where: { id: created.id },
      data: { latestVersionNumber: 3 },
    });
    const firstVersionsPage = await app.inject({
      method: "GET",
      url: `${programsUrl}/${created.id}/versions?limit=2`,
      headers: getHeaders(owner),
    });
    const firstVersions = data<{
      items: Array<{ id: string }>;
      nextCursor: string | null;
    }>(firstVersionsPage);
    expect(firstVersions.items).toHaveLength(2);
    expect(firstVersions.nextCursor).toBeTruthy();
    const secondVersionsPage = await app.inject({
      method: "GET",
      url: `${programsUrl}/${created.id}/versions?limit=2&cursor=${encodeURIComponent(required(firstVersions.nextCursor ?? undefined, "version cursor"))}`,
      headers: getHeaders(owner),
    });
    const secondVersions = data<{ items: Array<{ id: string }> }>(secondVersionsPage);
    expect(secondVersions.items).toHaveLength(1);
    expect(firstVersions.items.some((item) => item.id === secondVersions.items[0]?.id)).toBe(false);

    const foreignBackgroundBytes = await sharp({
      create: {
        width: 111,
        height: 83,
        channels: 4,
        background: { r: 80, g: 40, b: 160, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const foreignMilestoneBytes = await sharp({
      create: {
        width: 112,
        height: 84,
        channels: 4,
        background: { r: 180, g: 140, b: 40, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const foreignBackground = await uploadAsset(
      csrfState,
      intruder,
      intruderOrganization.organizationId,
      "BACKGROUND",
      foreignBackgroundBytes,
    );
    const foreignMilestone = await uploadAsset(
      csrfState,
      intruder,
      intruderOrganization.organizationId,
      "STAMP_MILESTONE",
      foreignMilestoneBytes,
    );
    const coffeeTemplate = required(findProgramTemplate("COFFEE", 2), "Coffee v2");
    const foreignOptionalDraft = createQuickDraft(coffeeTemplate, "quick");
    foreignOptionalDraft.internalName = `Foreign optional ${runId}`;
    foreignOptionalDraft.locationIds = [scale.locationId];
    foreignOptionalDraft.visualTheme.backgroundAssetId = foreignBackground.id;
    const foreignOptional = await app.inject({
      method: "POST",
      url: programsUrl,
      headers: mutationHeaders(csrfState, owner),
      payload: apiDraft(foreignOptionalDraft),
    });
    expect(foreignOptional.statusCode).toBe(422);
    expect(foreignOptional.json().error.code).toBe("PROGRAM_ASSET_INVALID");
    const foreignRewardDraft = createQuickDraft(coffeeTemplate, "quick");
    foreignRewardDraft.internalName = `Foreign reward ${runId}`;
    foreignRewardDraft.locationIds = [scale.locationId];
    required(foreignRewardDraft.rewards[0], "Coffee final reward").visualOverride = {
      stampAssetId: foreignMilestone.id,
    };
    const foreignReward = await app.inject({
      method: "POST",
      url: programsUrl,
      headers: mutationHeaders(csrfState, owner),
      payload: apiDraft(foreignRewardDraft),
    });
    expect(foreignReward.statusCode).toBe(422);
    expect(foreignReward.json().error.code).toBe("PROGRAM_ASSET_INVALID");
  });

  it("enforces Starter limits and Pro, milestone, multi-reward, and advanced-layout restrictions", async () => {
    const starter = await createOrganization(owner.userId, "STARTER");
    const csrfState = await csrf();
    const baseUrl = `/v1/organizations/${starter.organizationId}/programs`;
    const proAttempt = await app.inject({
      method: "POST",
      url: baseUrl,
      headers: mutationHeaders(csrfState, owner),
      payload: programPayload(starter.locationId, "pro", "starter-pro"),
    });
    expect(proAttempt.statusCode).toBe(403);
    expect(proAttempt.json().error.code).toBe("PROGRAM_PRO_MODE_UNAVAILABLE");

    const firstQuick = await app.inject({
      method: "POST",
      url: baseUrl,
      headers: mutationHeaders(csrfState, owner),
      payload: programPayload(starter.locationId, "quick", "starter-one"),
    });
    expect(firstQuick.statusCode, firstQuick.body).toBe(201);
    const secondQuick = await app.inject({
      method: "POST",
      url: baseUrl,
      headers: mutationHeaders(csrfState, owner),
      payload: programPayload(starter.locationId, "quick", "starter-two"),
    });
    expect(secondQuick.statusCode).toBe(409);
    expect(secondQuick.json().error.code).toBe("PROGRAM_LIMIT_REACHED");
    expect(secondQuick.json().error.details).toMatchObject({
      limit: 1,
      currentUsage: 1,
      recommendedPlan: "growth",
    });
  });
});
