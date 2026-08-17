import { randomUUID } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApiApplication } from "../../apps/api/src/app.js";
import { EnvironmentService } from "../../apps/api/src/config/environment.service.js";
import { PrismaService } from "../../apps/api/src/database/prisma.service.js";
import { NotificationService } from "../../apps/api/src/notifications/notification.service.js";

const runId = randomUUID().slice(0, 8);
const merchantSlug = `w3-${runId}`.toLowerCase();
const programSlug = `circle-${runId}`.toLowerCase();
const merchantHost = `${merchantSlug}.lvh.me`;
const formBase = {
  preferredLocale: "en",
  programTermsAccepted: true,
  wafloPrivacyAccepted: true,
  marketingEmailConsent: false,
  formStartedAt: Date.now() - 2_000,
  website: "",
} as const;

let app: NestFastifyApplication;
let prisma: PrismaService;
let environment: EnvironmentService;
let organizationId = "";
let programId = "";
let versionId = "";
const messages: Array<{ to: string; kind: string; actionUrl?: string }> = [];

function data<T>(response: { json(): unknown }): T {
  const payload = response.json() as { data: T };
  return payload.data;
}

function cookie(
  response: { headers: Record<string, string | string[] | undefined> },
  name: string,
) {
  const raw = response.headers["set-cookie"];
  const values = Array.isArray(raw) ? raw : [raw ?? ""];
  const selected = values.find((value) => value.startsWith(`${name}=`));
  return selected?.split(";")[0] ?? "";
}

async function enroll(input: { displayName: string; email?: string }, key: string) {
  return app.inject({
    method: "POST",
    url: `/v1/public/programs/${programSlug}/enroll`,
    headers: {
      host: merchantHost,
      "content-type": "application/json",
      "x-idempotency-key": key,
    },
    payload: { ...formBase, ...input },
  });
}

describe.sequential("W3 customer enrollment, card, and transfer HTTP boundary", () => {
  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.APPLE_WALLET_MODE = "TEST_ADAPTER";
    process.env.GOOGLE_WALLET_MODE = "TEST_ADAPTER";
    process.env.GOOGLE_WALLET_ISSUER_ID = "w3-test-issuer";
    process.env.RATE_LIMIT_NAMESPACE = `w3-http-${runId}`;
    app = await createApiApplication({ logger: false });
    prisma = app.get(PrismaService);
    environment = app.get(EnvironmentService);
    const notifications = app.get(NotificationService) as unknown as {
      provider: { send(message: { to: string; subject: string; html: string }): Promise<void> };
    };
    notifications.provider = {
      send: vi.fn(async (message) => {
        const match = /href="([^"]+)"/.exec(message.html);
        messages.push({
          to: message.to,
          kind: message.subject.includes("complete") ? "completed" : "confirmation",
          ...(match?.[1] ? { actionUrl: match[1].replaceAll("&amp;", "&") } : {}),
        });
      }),
    };

    const user = await prisma.client.user.create({
      data: {
        email: `owner-${runId}@w3.test`,
        normalizedEmail: `owner-${runId}@w3.test`,
        displayName: "W3 Owner",
        passwordHash: "not-used",
        emailVerifiedAt: new Date(),
        preferredLocale: "EN",
        termsVersion: "test",
        privacyVersion: "test",
        legalAcceptedAt: new Date(),
      },
    });
    const organization = await prisma.client.organization.create({
      data: {
        name: "Cedar W3 Test",
        normalizedName: `cedar-w3-${runId}`,
        merchantSlug,
        timezone: "UTC",
        selectedPlan: "GROWTH",
        onboardingState: "COMPLETE",
        onboardingCompletedAt: new Date(),
        members: { create: { userId: user.id, role: "OWNER" } },
        billingProfile: {
          create: { selectedPlan: "GROWTH", subscriptionStatus: "ACTIVE" },
        },
      },
    });
    organizationId = organization.id;
    const location = await prisma.client.location.create({
      data: {
        organizationId,
        name: "Cedar Main",
        city: "Baghdad",
        timezone: "Asia/Baghdad",
        status: "ACTIVE",
      },
    });
    const filled = await prisma.client.merchantAsset.create({
      data: {
        organizationId,
        category: "STAMP_FILLED",
        source: "WAFLO_LIBRARY",
        originalObjectKey: `test/${runId}/filled.svg`,
        originalFilename: "filled.svg",
        mimeType: "image/svg+xml",
        fileSize: 32,
        width: 256,
        height: 256,
        sha256Digest: "1".repeat(64),
        processingStatus: "READY",
        safeMetadata: {
          testFixture: true,
          inlineSvg:
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="#AE3115" d="M50 2 63 35 98 50 63 65 50 98 37 65 2 50 37 35Z"/></svg>',
        },
        createdByUserId: user.id,
      },
    });
    const empty = await prisma.client.merchantAsset.create({
      data: {
        organizationId,
        category: "STAMP_EMPTY",
        source: "WAFLO_LIBRARY",
        originalObjectKey: `test/${runId}/empty.svg`,
        originalFilename: "empty.svg",
        mimeType: "image/svg+xml",
        fileSize: 32,
        width: 256,
        height: 256,
        sha256Digest: "2".repeat(64),
        processingStatus: "READY",
        safeMetadata: {
          testFixture: true,
          inlineSvg:
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="#F7F4EE" stroke="#241916" stroke-width="7" d="M50 2 63 35 98 50 63 65 50 98 37 65 2 50 37 35Z"/></svg>',
        },
        createdByUserId: user.id,
      },
    });
    const program = await prisma.client.loyaltyProgram.create({
      data: {
        organizationId,
        internalName: "Cedar Circle",
        publicSlug: programSlug,
        status: "DRAFT",
        createdByUserId: user.id,
      },
    });
    programId = program.id;
    const version = await prisma.client.loyaltyProgramVersion.create({
      data: {
        organizationId,
        programId,
        versionNumber: 1,
        status: "DRAFT",
        createdByUserId: user.id,
        validationFingerprint: "a".repeat(64),
        renderFingerprint: "b".repeat(64),
        translations: {
          create: [
            {
              locale: "EN",
              programName: "Cedar Circle",
              shortDescription: "Collect eight stamps.",
              fullDescription: "A bilingual coffee loyalty card.",
              rewardSummary: "A complimentary drink.",
              joinInstructions: "Join in moments.",
              termsAndConditions: "Test program terms.",
              completionMessage: "Complete",
              rewardUnlockedMessage: "Reward ready",
              pausedMessage: "Temporarily paused",
            },
            {
              locale: "AR",
              programName: "دائرة سيدار",
              shortDescription: "اجمع ثمانية أختام.",
              fullDescription: "بطاقة ولاء ثنائية اللغة.",
              rewardSummary: "مشروب مجاني.",
              joinInstructions: "انضم خلال لحظات.",
              termsAndConditions: "شروط البرنامج التجريبية.",
              completionMessage: "اكتمل",
              rewardUnlockedMessage: "المكافأة جاهزة",
              pausedMessage: "متوقف مؤقتًا",
            },
          ],
        },
        stampRule: {
          create: {
            requiredStampCount: 8,
            earningDescription: "One stamp per qualifying visit.",
          },
        },
        rewards: {
          create: {
            thresholdStampCount: 8,
            rewardType: "FREE_ITEM",
            internalName: "Complimentary drink",
            sortOrder: 1,
            translations: {
              create: [
                { locale: "EN", name: "Complimentary drink", description: "Choose a drink." },
                { locale: "AR", name: "مشروب مجاني", description: "اختر مشروبًا." },
              ],
            },
          },
        },
        locations: { create: { locationId: location.id } },
        visualTheme: {
          create: {
            backgroundColor: "#F7F4EE",
            foregroundColor: "#241916",
            accentColor: "#AE3115",
            secondaryColor: "#F3A712",
            mutedColor: "#76645F",
            filledStampAssetId: filled.id,
            emptyStampAssetId: empty.id,
            layoutConfiguration: { columns: 4 },
          },
        },
        enrollmentPolicy: {
          create: {
            organizationId,
            emailCollectionMode: "OPTIONAL",
            primaryCustomerLocale: "EN",
            allowLocaleSelection: true,
            marketingConsentVisible: true,
            transferWithoutEmailAllowed: true,
            enrollmentOpen: true,
          },
        },
      },
    });
    versionId = version.id;
    await prisma.client.loyaltyProgramVersion.update({
      where: { id: version.id },
      data: { status: "PUBLISHED", publishedAt: new Date() },
    });
    await prisma.client.loyaltyProgram.update({
      where: { id: program.id },
      data: {
        status: "PUBLISHED",
        currentPublishedVersionId: version.id,
        currentDraftVersionId: null,
        publishedAt: new Date(),
      },
    });
  }, 120_000);

  afterAll(async () => {
    await app.close();
  });

  it("discovers a published program without exposing internal identifiers", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/v1/public/programs/${programSlug}`,
      headers: { host: merchantHost },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const body = response.body;
    expect(body).toContain("Cedar Circle");
    expect(body).not.toContain(organizationId);
    expect(body).not.toContain(programId);
    expect(body).not.toContain(versionId);
  });

  it("enrolls idempotently, binds the customer session, and creates Wallet outbox commands", async () => {
    const key = `enroll:${randomUUID()}`;
    const first = await enroll({ displayName: "No Email Member" }, key);
    const replay = await enroll({ displayName: "No Email Member" }, key);
    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    const firstData = data<{
      membership: { publicMembershipId: string };
      replayed: boolean;
      providerStates: {
        apple: { mode: string; status: string };
        google: { mode: string; status: string };
      };
    }>(first);
    const replayData = data<typeof firstData>(replay);
    expect(firstData.membership.publicMembershipId).toBe(replayData.membership.publicMembershipId);
    expect(replayData.replayed).toBe(true);
    expect(firstData.providerStates.apple).toMatchObject({
      mode: "TEST_ADAPTER",
      status: "PREPARING",
    });
    const membership = await prisma.client.membership.findUniqueOrThrow({
      where: { publicMembershipId: firstData.membership.publicMembershipId },
      include: {
        credentials: true,
        walletPassInstances: true,
        walletCommands: true,
        enrollmentProgramVersion: true,
      },
    });
    expect(membership.enrollmentProgramVersion.id).toBe(versionId);
    expect(membership.credentials.filter((item) => item.status === "ACTIVE")).toHaveLength(1);
    expect(membership.walletPassInstances).toHaveLength(2);
    expect(membership.walletCommands.filter((item) => item.commandType === "ISSUE")).toHaveLength(
      2,
    );
    expect(cookie(first, environment.values.CUSTOMER_COOKIE_NAME)).toContain(
      `${environment.values.CUSTOMER_COOKIE_NAME}=`,
    );
  });

  it("binds customer mutation CSRF to the active session and exact customer origin", async () => {
    const enrollment = await enroll({ displayName: "CSRF Member" }, `enroll:${randomUUID()}`);
    const sessionCookie = cookie(enrollment, environment.values.CUSTOMER_COOKIE_NAME);
    const bootstrap = await app.inject({
      method: "GET",
      url: "/v1/customer/csrf",
      headers: { host: merchantHost, cookie: sessionCookie },
    });
    expect(bootstrap.statusCode).toBe(200);
    const csrf = data<{ token: string }>(bootstrap).token;
    const csrfCookie = cookie(bootstrap, environment.customerCsrfCookieName);
    expect(csrfCookie).toContain(environment.customerCsrfCookieName);

    const missingHeader = await app.inject({
      method: "POST",
      url: "/v1/customer/session/rotate",
      headers: {
        host: merchantHost,
        origin: new URL(environment.values.CUSTOMER_WEB_URL).origin,
        cookie: `${sessionCookie}; ${csrfCookie}`,
        "content-type": "application/json",
      },
      payload: {},
    });
    expect(missingHeader.statusCode).toBe(403);
    expect(missingHeader.body).toContain("CUSTOMER_CSRF_INVALID");

    const crossOrigin = await app.inject({
      method: "POST",
      url: "/v1/customer/session/rotate",
      headers: {
        host: merchantHost,
        origin: "https://evil.example",
        cookie: `${sessionCookie}; ${csrfCookie}`,
        "x-csrf-token": csrf,
        "content-type": "application/json",
      },
      payload: {},
    });
    expect(crossOrigin.statusCode).toBe(403);
    expect(crossOrigin.body).toContain("CUSTOMER_CSRF_INVALID");

    const rotated = await app.inject({
      method: "POST",
      url: "/v1/customer/session/rotate",
      headers: {
        host: merchantHost,
        origin: new URL(environment.values.CUSTOMER_WEB_URL).origin,
        cookie: `${sessionCookie}; ${csrfCookie}`,
        "x-csrf-token": csrf,
        "content-type": "application/json",
      },
      payload: {},
    });
    expect(rotated.statusCode).toBe(201);
    const newSessionCookie = cookie(rotated, environment.values.CUSTOMER_COOKIE_NAME);
    expect(newSessionCookie).not.toBe(sessionCookie);

    const staleRotation = await app.inject({
      method: "POST",
      url: "/v1/customer/session/rotate",
      headers: {
        host: merchantHost,
        origin: new URL(environment.values.CUSTOMER_WEB_URL).origin,
        cookie: `${sessionCookie}; ${csrfCookie}`,
        "x-csrf-token": csrf,
        "content-type": "application/json",
      },
      payload: {},
    });
    expect(staleRotation.statusCode).toBe(401);
    expect(staleRotation.body).toContain("CUSTOMER_SESSION_EXPIRED");

    const staleSession = await app.inject({
      method: "GET",
      url: "/v1/customer/csrf",
      headers: { host: merchantHost, cookie: sessionCookie },
    });
    expect(staleSession.statusCode).toBe(401);
  });

  it("rotates a no-email credential exactly once and preserves the old card as transferred", async () => {
    const enrollment = await enroll({ displayName: "Transfer Member" }, `enroll:${randomUUID()}`);
    expect(enrollment.statusCode).toBe(201);
    const enrollmentData = data<{ membership: { publicMembershipId: string } }>(enrollment);
    const oldCookie = cookie(enrollment, environment.values.CUSTOMER_COOKIE_NAME);
    const card = await app.inject({
      method: "GET",
      url: `/v1/customer/card/${enrollmentData.membership.publicMembershipId}`,
      headers: { host: merchantHost, cookie: oldCookie },
    });
    expect(card.statusCode).toBe(200);
    const oldPayload = data<{ membershipQr: { payload: string } }>(card).membershipQr.payload;
    const requested = await app.inject({
      method: "POST",
      url: "/v1/public/transfers/request",
      headers: {
        host: merchantHost,
        "content-type": "application/json",
        "x-idempotency-key": `transfer:${randomUUID()}`,
      },
      payload: { qrPayload: oldPayload, preferredLocale: "en" },
    });
    expect(requested.statusCode).toBe(201);
    const requestData = data<{
      transferPublicId: string;
      method: string;
      challenge: string;
    }>(requested);
    expect(requestData.method).toBe("QR_WITHOUT_EMAIL");
    const browserCookie = cookie(requested, "waflo_transfer_browser");
    const confirmationPayload = {
      transferPublicId: requestData.transferPublicId,
      challenge: requestData.challenge,
      explicitRiskAccepted: true,
    };
    const [confirmed, replayed] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/v1/public/transfers/confirm-without-email",
        headers: {
          host: merchantHost,
          cookie: browserCookie,
          "content-type": "application/json",
        },
        payload: confirmationPayload,
      }),
      app.inject({
        method: "POST",
        url: "/v1/public/transfers/confirm-without-email",
        headers: {
          host: merchantHost,
          cookie: browserCookie,
          "content-type": "application/json",
        },
        payload: confirmationPayload,
      }),
    ]);
    expect(
      [confirmed.statusCode, replayed.statusCode],
      `${confirmed.body}\n${replayed.body}`,
    ).toEqual([201, 201]);
    const newCookie = cookie(confirmed, environment.values.CUSTOMER_COOKIE_NAME);
    const oldCard = await app.inject({
      method: "GET",
      url: "/v1/customer/card",
      headers: { host: merchantHost, cookie: oldCookie },
    });
    const newCard = await app.inject({
      method: "GET",
      url: "/v1/customer/card",
      headers: { host: merchantHost, cookie: newCookie },
    });
    expect(data<{ membership: { state: string }; membershipQr: unknown }>(oldCard)).toMatchObject({
      membership: { state: "TRANSFERRED" },
      membershipQr: null,
    });
    expect(
      data<{ membership: { state: string }; membershipQr: { payload: string } }>(newCard),
    ).toMatchObject({ membership: { state: "ACTIVE" } });
    const membership = await prisma.client.membership.findUniqueOrThrow({
      where: { publicMembershipId: enrollmentData.membership.publicMembershipId },
      include: {
        credentials: true,
        transferEvents: true,
        walletPassInstances: true,
        walletCommands: true,
      },
    });
    expect(membership.credentials.filter((item) => item.status === "ACTIVE")).toHaveLength(1);
    expect(membership.credentials.filter((item) => item.status === "TRANSFERRED")).toHaveLength(1);
    expect(membership.transferEvents).toHaveLength(1);
    expect(membership.walletPassInstances).toHaveLength(4);
    expect(
      membership.walletCommands.filter((item) => item.commandType === "INVALIDATE"),
    ).toHaveLength(2);
  }, 120_000);

  it("uses an encrypted email, fragment confirmation, and verifies contact on transfer", async () => {
    const email = `member-${runId}@customer.test`;
    const enrollment = await enroll(
      { displayName: "Email Member", email },
      `enroll:${randomUUID()}`,
    );
    const oldCookie = cookie(enrollment, environment.values.CUSTOMER_COOKIE_NAME);
    const enrollmentData = data<{ membership: { publicMembershipId: string } }>(enrollment);
    const membership = await prisma.client.membership.findUniqueOrThrow({
      where: { publicMembershipId: enrollmentData.membership.publicMembershipId },
      include: { customer: { include: { contacts: true } }, credentials: true },
    });
    const contact = membership.customer.contacts[0];
    expect(contact?.encryptedValue).not.toContain(email);
    expect(contact?.maskedDisplayValue).not.toBe(email);
    const card = await app.inject({
      method: "GET",
      url: "/v1/customer/card",
      headers: { host: merchantHost, cookie: oldCookie },
    });
    const qrPayload = data<{ membershipQr: { payload: string } }>(card).membershipQr.payload;
    const request = await app.inject({
      method: "POST",
      url: "/v1/public/transfers/request",
      headers: {
        host: merchantHost,
        "content-type": "application/json",
        "x-idempotency-key": `transfer:${randomUUID()}`,
      },
      payload: { qrPayload, preferredLocale: "en" },
    });
    expect(request.statusCode).toBe(201);
    const transfer = data<{ transferPublicId: string; method: string }>(request);
    expect(transfer.method).toBe("EMAIL_CONFIRMED");
    const actionUrl = messages.find((item) => item.to === email && item.actionUrl)?.actionUrl;
    expect(actionUrl, JSON.stringify(messages)).toBeTruthy();
    const url = new URL(actionUrl as string);
    expect(url.searchParams.has("token")).toBe(false);
    const fragment = new URLSearchParams(url.hash.slice(1));
    const confirmation = await app.inject({
      method: "POST",
      url: "/v1/public/transfers/confirm-email",
      headers: { host: merchantHost, "content-type": "application/json" },
      payload: {
        transferPublicId: fragment.get("transfer"),
        token: fragment.get("token"),
      },
    });
    expect(confirmation.statusCode).toBe(201);
    const verified = await prisma.client.customerContact.findUniqueOrThrow({
      where: { id: contact?.id },
    });
    expect(verified.verificationStatus).toBe("VERIFIED");
    expect(verified.verifiedAt).toBeInstanceOf(Date);
  }, 120_000);

  it("keeps existing customer state viewable but blocks new loyalty operations for a restricted merchant", async () => {
    const existing = await enroll(
      { displayName: "Restricted Program Member" },
      `enroll:${randomUUID()}`,
    );
    expect(existing.statusCode).toBe(201);
    const existingCookie = cookie(existing, environment.values.CUSTOMER_COOKIE_NAME);
    const cardBeforeRestriction = await app.inject({
      method: "GET",
      url: "/v1/customer/card",
      headers: { host: merchantHost, cookie: existingCookie },
    });
    const qrPayload = data<{ membershipQr: { payload: string } }>(cardBeforeRestriction)
      .membershipQr.payload;

    await prisma.client.organizationBillingProfile.update({
      where: { organizationId },
      data: { subscriptionStatus: "SUSPENDED", trialEnd: null, gracePeriodEnd: null },
    });
    try {
      const safeView = await app.inject({
        method: "GET",
        url: "/v1/customer/card",
        headers: { host: merchantHost, cookie: existingCookie },
      });
      expect(safeView.statusCode).toBe(200);

      const blockedEnrollment = await enroll(
        { displayName: "Blocked Enrollment" },
        `enroll:${randomUUID()}`,
      );
      expect(blockedEnrollment.statusCode).toBe(402);
      expect(blockedEnrollment.json().error.code).toBe("ORGANIZATION_ENROLLMENT_BILLING_BLOCKED");

      const blockedTransfer = await app.inject({
        method: "POST",
        url: "/v1/public/transfers/request",
        headers: {
          host: merchantHost,
          "content-type": "application/json",
          "x-idempotency-key": `transfer:${randomUUID()}`,
        },
        payload: { qrPayload, preferredLocale: "en" },
      });
      expect(blockedTransfer.statusCode).toBe(402);
      expect(blockedTransfer.json().error).toMatchObject({
        code: "LOYALTY_PROGRAM_TEMPORARILY_UNAVAILABLE",
        message: "This loyalty program is temporarily unavailable.",
      });
      expect(blockedTransfer.json().error.details).toEqual({ accessState: "restricted" });
    } finally {
      await prisma.client.organizationBillingProfile.update({
        where: { organizationId },
        data: { subscriptionStatus: "ACTIVE" },
      });
    }
  });
});
