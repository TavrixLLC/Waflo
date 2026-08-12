import { randomUUID } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApiApplication } from "../../apps/api/src/app.js";
import { EnvironmentService } from "../../apps/api/src/config/environment.service.js";
import { PrismaService } from "../../apps/api/src/database/prisma.service.js";
import { WalletEngagementService } from "../../apps/api/src/wallet-engagement/wallet-engagement.service.js";
import { WalletWorker } from "../../apps/wallet-worker/src/main.js";
import { WalletProviderError } from "../../packages/wallet-core/dist/index.js";
import type { WalletProvider } from "../../packages/wallet-core/src/index.js";
import {
  createW3CustomerWalletFixture,
  type W3CustomerWalletFixture,
  w3EnrollmentBase,
} from "../helpers/w3-customer-wallet-fixture.js";

let app: NestFastifyApplication;
let prisma: PrismaService;
let environment: EnvironmentService;
let engagement: WalletEngagementService;
let fixture: W3CustomerWalletFixture;
let tenantFixture: W3CustomerWalletFixture;
let membershipId = "";
let customerSessionCookie = "";
let customerCsrfCookie = "";
let customerCsrfToken = "";

const requestContext = { headers: {}, ip: "127.0.0.1", id: "wallet-engagement-test" } as never;

function data<T>(response: { json(): unknown }): T {
  return (response.json() as { data: T }).data;
}

function cookie(response: { headers: Record<string, unknown> }, name: string): string {
  const raw = response.headers["set-cookie"];
  const values = Array.isArray(raw) ? raw.map(String) : [String(raw ?? "")];
  const match = values
    .flatMap((value) => value.split(/,(?=[^;]+?=)/u))
    .find((value) => value.trim().startsWith(`${name}=`));
  return match?.trim().split(";")[0] ?? "";
}

async function setConsent(granted: boolean) {
  return app.inject({
    method: "POST",
    url: "/v1/customer/wallet-engagement/consent",
    headers: {
      host: fixture.merchantHost,
      origin: new URL(environment.values.CUSTOMER_WEB_URL).origin,
      cookie: `${customerSessionCookie}; ${customerCsrfCookie}`,
      "x-csrf-token": customerCsrfToken,
      "content-type": "application/json",
    },
    payload: {
      granted,
      locale: "EN",
      noticeVersion: "wallet-promotions-v1-LEGAL_REVIEW_REQUIRED",
    },
  });
}

function campaignInput(title: string) {
  return {
    idempotencyKey: randomUUID(),
    locale: "EN" as const,
    title,
    body: `${title} body`,
    destinationUrl: null,
    providers: ["GOOGLE" as const],
    audienceRule: "ALL_ELIGIBLE_WALLET_HOLDERS" as const,
  };
}

describe.sequential("Wallet Engagement durable integration", () => {
  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.APPLE_WALLET_MODE = "TEST_ADAPTER";
    process.env.GOOGLE_WALLET_MODE = "TEST_ADAPTER";
    process.env.GOOGLE_WALLET_ISSUER_ID = "wallet-engagement-test-issuer";
    app = await createApiApplication({ logger: false });
    prisma = app.get(PrismaService);
    environment = app.get(EnvironmentService);
    engagement = app.get(WalletEngagementService);
    fixture = await createW3CustomerWalletFixture(prisma.client, "wallet-engagement");

    const enrollment = await app.inject({
      method: "POST",
      url: `/v1/public/programs/${fixture.programSlug}/enroll`,
      headers: {
        host: fixture.merchantHost,
        "content-type": "application/json",
        "x-idempotency-key": `enroll:${randomUUID()}`,
      },
      payload: {
        ...w3EnrollmentBase,
        displayName: "Wallet Engagement Member",
        formStartedAt: Date.now() - 2_000,
      },
    });
    expect(enrollment.statusCode).toBe(201);
    customerSessionCookie = cookie(enrollment, environment.values.CUSTOMER_COOKIE_NAME);
    const publicMembershipId = data<{ membership: { publicMembershipId: string } }>(enrollment)
      .membership.publicMembershipId;
    const membership = await prisma.client.membership.findUniqueOrThrow({
      where: { publicMembershipId },
      include: { walletPassInstances: true },
    });
    membershipId = membership.id;
    const googlePass = membership.walletPassInstances.find((pass) => pass.provider === "GOOGLE");
    if (!googlePass) throw new Error("Google Wallet fixture pass was not created.");
    await prisma.client.walletPassInstance.update({
      where: { id: googlePass.id },
      data: { status: "ACTIVE", providerState: { testFixture: true } },
    });
    await prisma.client.location.update({
      where: { id: fixture.locationId },
      data: { latitude: 33.3024, longitude: 44.3882 },
    });
    const csrf = await app.inject({
      method: "GET",
      url: "/v1/customer/csrf",
      headers: { host: fixture.merchantHost, cookie: customerSessionCookie },
    });
    customerCsrfCookie = cookie(csrf, environment.customerCsrfCookieName);
    customerCsrfToken = data<{ token: string }>(csrf).token;
  }, 120_000);

  afterAll(async () => {
    await app.close();
  });

  it("defaults consent off and supports opt-in, revoke, and re-opt-in without changing loyalty or Wallet state", async () => {
    const initial = await app.inject({
      method: "GET",
      url: "/v1/customer/wallet-engagement/consent",
      headers: { host: fixture.merchantHost, cookie: customerSessionCookie },
    });
    expect(initial.statusCode).toBe(200);
    expect(
      data<{ granted: boolean; requiredForLoyalty: boolean; prechecked: boolean }>(initial),
    ).toMatchObject({ granted: false, requiredForLoyalty: false, prechecked: false });

    const optedIn = await setConsent(true);
    expect(optedIn.statusCode).toBe(201);
    expect(data<{ granted: boolean; grantedAt: string }>(optedIn)).toMatchObject({ granted: true });
    const revoked = await setConsent(false);
    expect(revoked.statusCode).toBe(201);
    expect(data<{ granted: boolean; revokedAt: string }>(revoked)).toMatchObject({
      granted: false,
    });
    const reOpted = await setConsent(true);
    expect(reOpted.statusCode).toBe(201);

    const membership = await prisma.client.membership.findUniqueOrThrow({
      where: { id: membershipId },
      include: { progress: true, walletPassInstances: true, consents: true },
    });
    expect(membership.status).toBe("ACTIVE");
    expect(membership.progress?.currentCycleStampCount).toBe(0);
    expect(membership.walletPassInstances.some((pass) => pass.status === "ACTIVE")).toBe(true);
    expect(
      membership.consents.filter((consent) => consent.consentType === "WALLET_PROMOTIONS"),
    ).toHaveLength(3);
  });

  it("enforces merchant authorization and tenant isolation for nearby and campaign changes", async () => {
    const staff = await prisma.client.user.create({
      data: {
        email: `staff-${randomUUID()}@wallet.test`,
        normalizedEmail: `staff-${randomUUID()}@wallet.test`,
        displayName: "Wallet Staff",
        passwordHash: "not-used",
        emailVerifiedAt: new Date(),
        preferredLocale: "EN",
        termsVersion: "test",
        privacyVersion: "test",
        legalAcceptedAt: new Date(),
      },
    });
    await prisma.client.organizationMember.create({
      data: { organizationId: fixture.organizationId, userId: staff.id, role: "STAFF" },
    });
    await expect(
      engagement.updateNearby(
        staff.id,
        fixture.organizationId,
        fixture.programId,
        { enabled: true, locationIds: [fixture.locationId], revision: 1 },
        requestContext,
      ),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED", status: 403 });
    await expect(
      engagement.createCampaign(
        staff.id,
        fixture.organizationId,
        fixture.programId,
        campaignInput("Unauthorized"),
        requestContext,
      ),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED", status: 403 });

    tenantFixture = await createW3CustomerWalletFixture(prisma.client, "wallet-engagement-tenant");
    await expect(
      engagement.audienceEstimate(
        fixture.ownerId,
        tenantFixture.organizationId,
        tenantFixture.programId,
      ),
    ).rejects.toMatchObject({ code: "ORGANIZATION_ACCESS_DENIED", status: 403 });
  });

  it("stores nearby configuration deterministically, audits it, and queues provider refreshes", async () => {
    await expect(
      engagement.updateNearby(
        fixture.ownerId,
        fixture.organizationId,
        fixture.programId,
        {
          enabled: true,
          locationIds: [fixture.locationId],
          appleCustomTextEn: "Your card is ready near Cedar.",
          appleCustomTextAr: "بطاقتك جاهزة بالقرب من سيدار.",
          revision: 1,
        },
        requestContext,
      ),
    ).resolves.toMatchObject({ enabled: true, revision: 1, updateQueued: true });

    const configuration = await prisma.client.walletNearbyConfiguration.findUniqueOrThrow({
      where: { organizationId: fixture.organizationId },
      include: { locations: true },
    });
    const programCopy = await prisma.client.walletNearbyProgramCopy.findUniqueOrThrow({
      where: { programId: fixture.programId },
    });
    expect(configuration.locations.map((item) => item.locationId)).toEqual([fixture.locationId]);
    expect(programCopy.appleCustomTextEn).toBe("Your card is ready near Cedar.");
    await expect(
      prisma.client.walletNearbyLocation.create({
        data: {
          configurationId: configuration.id,
          locationId: tenantFixture.locationId,
          sortOrder: 1,
        },
      }),
    ).rejects.toThrow(/tenant mismatch/u);
    expect(
      await prisma.client.programWalletSyncJob.count({
        where: { programId: fixture.programId, reason: "NEARBY_RELEVANCE_CHANGED" },
      }),
    ).toBe(1);
    expect(
      await prisma.client.auditLog.count({
        where: {
          organizationId: fixture.organizationId,
          action: {
            in: [
              "wallet.nearby_enabled",
              "wallet.nearby_location_selection_changed",
              "wallet.apple_nearby_text_changed",
            ],
          },
        },
      }),
    ).toBe(3);
  });

  it("applies Nearby to consent-off and consent-on holders while manual promotion targets only consent-on", async () => {
    expect((await setConsent(false)).statusCode).toBe(201);
    const secondEnrollment = await app.inject({
      method: "POST",
      url: `/v1/public/programs/${fixture.programSlug}/enroll`,
      headers: {
        host: fixture.merchantHost,
        "content-type": "application/json",
        "x-idempotency-key": `enroll:${randomUUID()}`,
      },
      payload: {
        ...w3EnrollmentBase,
        displayName: "Nearby Consent On Member",
        formStartedAt: Date.now() - 2_000,
      },
    });
    expect(secondEnrollment.statusCode).toBe(201);
    const secondPublicMembershipId = data<{ membership: { publicMembershipId: string } }>(
      secondEnrollment,
    ).membership.publicMembershipId;
    const secondMembership = await prisma.client.membership.findUniqueOrThrow({
      where: { publicMembershipId: secondPublicMembershipId },
      include: { walletPassInstances: true },
    });
    const secondGooglePass = secondMembership.walletPassInstances.find(
      (pass) => pass.provider === "GOOGLE",
    );
    if (!secondGooglePass) throw new Error("Second Google Wallet fixture pass was not created.");
    await prisma.client.walletPassInstance.update({
      where: { id: secondGooglePass.id },
      data: { status: "ACTIVE", providerState: { testFixture: true } },
    });
    await prisma.client.customerConsent.create({
      data: {
        organizationId: fixture.organizationId,
        customerId: secondMembership.customerId,
        membershipId: secondMembership.id,
        consentType: "WALLET_PROMOTIONS",
        granted: true,
        documentFingerprint: "wallet-promotions-v1-LEGAL_REVIEW_REQUIRED",
        locale: "EN",
      },
    });
    const secondEligibilityState = await prisma.client.membership.findUniqueOrThrow({
      where: { id: secondMembership.id },
      include: {
        customer: true,
        credentials: true,
        walletPassInstances: true,
        consents: { orderBy: [{ capturedAt: "desc" }, { id: "desc" }] },
      },
    });
    expect(secondEligibilityState).toMatchObject({
      status: "ACTIVE",
      customer: { status: "ACTIVE" },
      credentials: [expect.objectContaining({ status: "ACTIVE" })],
      walletPassInstances: expect.arrayContaining([
        expect.objectContaining({ provider: "GOOGLE", status: "ACTIVE" }),
      ]),
      consents: expect.arrayContaining([
        expect.objectContaining({
          consentType: "WALLET_PROMOTIONS",
          granted: true,
          revokedAt: null,
        }),
      ]),
    });

    const nearbyJob = await prisma.client.programWalletSyncJob.findFirstOrThrow({
      where: {
        organizationId: fixture.organizationId,
        programId: fixture.programId,
        reason: "NEARBY_RELEVANCE_CHANGED",
        status: "PENDING",
      },
      orderBy: { createdAt: "asc" },
    });
    const worker = new WalletWorker(prisma.client, {} as never, environment.values);
    await worker.processOneProgramSyncJob(nearbyJob.id);
    const nearbyUpdates = await prisma.client.walletCommand.findMany({
      where: {
        commandType: "UPDATE",
        safePayload: { path: ["programSyncJobId"], equals: nearbyJob.id },
      },
      select: { membershipId: true, provider: true },
    });
    expect(new Set(nearbyUpdates.map((command) => command.membershipId))).toEqual(
      new Set([membershipId, secondMembership.id]),
    );
    expect(new Set(nearbyUpdates.map((command) => command.provider))).toEqual(
      new Set(["APPLE", "GOOGLE"]),
    );
    await prisma.client.walletPassInstance.updateMany({
      where: {
        membershipId: { in: [membershipId, secondMembership.id] },
        provider: "GOOGLE",
        status: "UPDATE_PENDING",
      },
      data: { status: "ACTIVE" },
    });

    await expect(
      engagement.audienceEstimate(fixture.ownerId, fixture.organizationId, fixture.programId),
    ).resolves.toMatchObject({ total: 1, providers: { apple: 0, google: 1 } });
    const manualCampaign = await engagement.createCampaign(
      fixture.ownerId,
      fixture.organizationId,
      fixture.programId,
      campaignInput("Nearby consent distinction"),
      requestContext,
    );
    await prisma.client.walletEngagementCampaign.update({
      where: { id: manualCampaign.id },
      data: { scheduledAt: new Date(0) },
    });
    await worker.processOneWalletCampaign(manualCampaign.id);
    const deliveries = await prisma.client.walletCampaignDelivery.findMany({
      where: { campaignId: manualCampaign.id },
      select: { membershipId: true, status: true, safeSkipCode: true },
    });
    expect(deliveries).toContainEqual({
      membershipId,
      status: "SKIPPED",
      safeSkipCode: "CONSENT_REVOKED",
    });
    expect(deliveries).toContainEqual({
      membershipId: secondMembership.id,
      status: "QUEUED",
      safeSkipCode: null,
    });

    await prisma.client.customerConsent.create({
      data: {
        organizationId: fixture.organizationId,
        customerId: secondMembership.customerId,
        membershipId: secondMembership.id,
        consentType: "WALLET_PROMOTIONS",
        granted: false,
        revokedAt: new Date(),
        documentFingerprint: "wallet-promotions-v1-LEGAL_REVIEW_REQUIRED",
        locale: "EN",
      },
    });
    await prisma.client.membership.update({
      where: { id: secondMembership.id },
      data: { status: "REVOKED" },
    });
    expect((await setConsent(true)).statusCode).toBe(201);
    worker.close();
  });

  it("disables Nearby across every current and historical Google class binding", async () => {
    const historicalVersion = await prisma.client.loyaltyProgramVersion.create({
      data: {
        organizationId: fixture.organizationId,
        programId: fixture.programId,
        versionNumber: 999,
        status: "DRAFT",
        baseTemplateCode: "COFFEE_WARM_LATTE",
        createdByUserId: fixture.ownerId,
        locations: {
          create: { locationId: fixture.locationId },
        },
      },
    });
    await prisma.client.loyaltyProgramVersion.update({
      where: { id: historicalVersion.id },
      data: {
        status: "SUPERSEDED",
        publishedAt: new Date(Date.now() - 86_400_000),
        supersededAt: new Date(),
      },
    });
    const historicalBinding = await prisma.client.walletProgramBinding.create({
      data: {
        organizationId: fixture.organizationId,
        programId: fixture.programId,
        programVersionId: historicalVersion.id,
        provider: "GOOGLE",
        providerTemplateId: `historical-${historicalVersion.id}`,
        status: "READY",
        configurationFingerprint: "f".repeat(64),
      },
    });
    const currentBinding = await prisma.client.walletProgramBinding.findFirstOrThrow({
      where: {
        organizationId: fixture.organizationId,
        programId: fixture.programId,
        provider: "GOOGLE",
        id: { not: historicalBinding.id },
      },
    });
    const currentConfiguration = await prisma.client.walletNearbyConfiguration.findUniqueOrThrow({
      where: { organizationId: fixture.organizationId },
    });
    await engagement.updateNearby(
      fixture.ownerId,
      fixture.organizationId,
      fixture.programId,
      {
        enabled: false,
        locationIds: [fixture.locationId],
        appleCustomTextEn: "Your card is ready near Cedar.",
        appleCustomTextAr: "بطاقتك جاهزة بالقرب من سيدار.",
        revision: currentConfiguration.revision,
      },
      requestContext,
    );
    const disableJob = await prisma.client.programWalletSyncJob.findFirstOrThrow({
      where: {
        organizationId: fixture.organizationId,
        programId: fixture.programId,
        reason: "NEARBY_RELEVANCE_CHANGED",
        idempotencyKey: { contains: `r${currentConfiguration.revision + 1}` },
      },
      orderBy: { createdAt: "desc" },
    });
    const worker = new WalletWorker(prisma.client, {} as never, environment.values);
    await worker.processOneProgramSyncJob(disableJob.id);
    const classRefreshes = await prisma.client.walletCommand.findMany({
      where: {
        commandType: "ENSURE_TEMPLATE",
        safePayload: { path: ["reason"], equals: "NEARBY_RELEVANCE_CHANGED" },
        idempotencyKey: { contains: disableJob.id },
      },
      select: { safePayload: true },
    });
    const refreshedBindingIds = classRefreshes.map(
      (command) => (command.safePayload as { bindingId: string }).bindingId,
    );
    expect(new Set(refreshedBindingIds)).toEqual(
      new Set([currentBinding.id, historicalBinding.id]),
    );
    await expect(
      prisma.client.walletNearbyConfiguration.findUniqueOrThrow({
        where: { organizationId: fixture.organizationId },
      }),
    ).resolves.toMatchObject({ enabled: false });
    expect(
      await prisma.client.walletCommand.count({
        where: {
          commandType: "UPDATE",
          safePayload: { path: ["programSyncJobId"], equals: disableJob.id },
        },
      }),
    ).toBeGreaterThanOrEqual(2);
    await prisma.client.walletPassInstance.updateMany({
      where: {
        organizationId: fixture.organizationId,
        provider: "GOOGLE",
        status: "UPDATE_PENDING",
      },
      data: { status: "ACTIVE" },
    });
    worker.close();
  });

  it("creates idempotent campaigns without provider calls in HTTP work and dispatches a tenant-authoritative audience", async () => {
    const input = campaignInput("A safe Wallet message");
    const created = await engagement.createCampaign(
      fixture.ownerId,
      fixture.organizationId,
      fixture.programId,
      input,
      requestContext,
    );
    const replay = await engagement.createCampaign(
      fixture.ownerId,
      fixture.organizationId,
      fixture.programId,
      input,
      requestContext,
    );
    expect(replay).toMatchObject({ id: created.id, replayed: true });
    await expect(
      engagement.createCampaign(
        fixture.ownerId,
        fixture.organizationId,
        fixture.programId,
        { ...input, idempotencyKey: randomUUID() },
        requestContext,
      ),
    ).rejects.toMatchObject({ code: "WALLET_CAMPAIGN_DUPLICATE_CONTENT", status: 409 });
    await expect(
      engagement.createCampaign(
        fixture.ownerId,
        fixture.organizationId,
        fixture.programId,
        {
          ...campaignInput("Unsafe destination"),
          destinationUrl: "https://evil.example/collect",
        },
        requestContext,
      ),
    ).rejects.toMatchObject({ code: "WALLET_CAMPAIGN_URL_NOT_ALLOWED", status: 422 });
    expect(
      await prisma.client.walletCampaignDelivery.count({ where: { campaignId: created.id } }),
    ).toBe(0);
    expect(
      await prisma.client.walletCommand.count({
        where: {
          commandType: "SEND_PROMOTION",
          safePayload: { path: ["campaignId"], equals: created.id },
        },
      }),
    ).toBe(0);

    await prisma.client.walletEngagementCampaign.update({
      where: { id: created.id },
      data: { scheduledAt: new Date(0) },
    });
    const sendPromotionalMessage = vi.fn().mockResolvedValue({
      state: "STORED_AND_NOTIFIED",
      providerRequestId: "provider-request-1",
    });
    const provider = {
      provider: "GOOGLE",
      mode: "TEST_ADAPTER",
      sendPromotionalMessage,
    } as unknown as WalletProvider;
    const worker = new WalletWorker(
      prisma.client,
      {} as never,
      environment.values,
      new Map([["GOOGLE", provider]]),
    );
    const firstClaim = await worker.processOneWalletCampaign(created.id);
    const secondClaim = await worker.processOneWalletCampaign(created.id);
    expect(firstClaim).toMatchObject({ queued: 1, skipped: 0, finished: true });
    expect(secondClaim).toBeNull();
    const command = await prisma.client.walletCommand.findFirstOrThrow({
      where: { commandType: "SEND_PROMOTION", campaignDelivery: { campaignId: created.id } },
    });
    expect(await worker.processCommandById(command.id)).toBe(true);
    expect(await worker.processCommandById(command.id)).toBe(false);
    expect(sendPromotionalMessage).toHaveBeenCalledTimes(1);
    expect(sendPromotionalMessage).toHaveBeenCalledWith(
      expect.objectContaining({ providerIdentity: expect.any(String) }),
      expect.objectContaining({
        messageId: expect.stringMatching(/^wfl_[a-f0-9]+_[a-f0-9]+$/),
        title: input.title,
      }),
    );
    expect(
      await prisma.client.walletEngagementCampaign.findUniqueOrThrow({ where: { id: created.id } }),
    ).toMatchObject({ status: "COMPLETED", succeededCount: 1, failedCount: 0 });
    worker.close();
  });

  it("skips manual Google delivery when the authoritative object has no Wallet holder", async () => {
    const campaign = await engagement.createCampaign(
      fixture.ownerId,
      fixture.organizationId,
      fixture.programId,
      campaignInput("No saved Wallet holder"),
      requestContext,
    );
    await prisma.client.walletEngagementCampaign.update({
      where: { id: campaign.id },
      data: { scheduledAt: new Date(0) },
    });
    const sendPromotionalMessage = vi.fn().mockResolvedValue({
      state: "NO_ACTIVE_WALLET_HOLDER",
      providerRequestId: "google-object-lookup-1",
    });
    const worker = new WalletWorker(
      prisma.client,
      {} as never,
      environment.values,
      new Map([
        [
          "GOOGLE",
          {
            provider: "GOOGLE",
            mode: "TEST_ADAPTER",
            sendPromotionalMessage,
          } as unknown as WalletProvider,
        ],
      ]),
    );
    await worker.processOneWalletCampaign(campaign.id);
    const command = await prisma.client.walletCommand.findFirstOrThrow({
      where: { campaignDelivery: { campaignId: campaign.id } },
    });
    expect(await worker.processCommandById(command.id)).toBe(true);
    await expect(
      prisma.client.walletCampaignDelivery.findFirstOrThrow({
        where: { campaignId: campaign.id },
      }),
    ).resolves.toMatchObject({
      status: "SKIPPED",
      safeSkipCode: "NO_ACTIVE_WALLET_HOLDER",
      providerRequestId: "google-object-lookup-1",
      logicalSentAt: null,
    });
    await expect(
      prisma.client.walletEngagementCampaign.findUniqueOrThrow({ where: { id: campaign.id } }),
    ).resolves.toMatchObject({ status: "COMPLETED", succeededCount: 0 });
    worker.close();
  });

  it("rechecks revoked consent, enforces two sends per pass per day, and stores quota retry state", async () => {
    const revokeCampaign = await engagement.createCampaign(
      fixture.ownerId,
      fixture.organizationId,
      fixture.programId,
      campaignInput("Consent recheck"),
      requestContext,
    );
    expect((await setConsent(false)).statusCode).toBe(201);
    await expect(
      engagement.audienceEstimate(fixture.ownerId, fixture.organizationId, fixture.programId),
    ).resolves.toMatchObject({ total: 0, providers: { apple: 0, google: 0 } });
    await prisma.client.walletEngagementCampaign.update({
      where: { id: revokeCampaign.id },
      data: { scheduledAt: new Date(0) },
    });
    const noSend = vi.fn();
    const provider = {
      provider: "GOOGLE",
      mode: "TEST_ADAPTER",
      sendPromotionalMessage: noSend,
    } as unknown as WalletProvider;
    const worker = new WalletWorker(
      prisma.client,
      {} as never,
      environment.values,
      new Map([["GOOGLE", provider]]),
    );
    await worker.processOneWalletCampaign(revokeCampaign.id);
    expect(noSend).not.toHaveBeenCalled();
    expect(
      await prisma.client.walletCampaignDelivery.findFirstOrThrow({
        where: { campaignId: revokeCampaign.id },
      }),
    ).toMatchObject({ status: "SKIPPED", safeSkipCode: "CONSENT_REVOKED" });

    expect((await setConsent(true)).statusCode).toBe(201);
    const secondSend = await engagement.createCampaign(
      fixture.ownerId,
      fixture.organizationId,
      fixture.programId,
      campaignInput("Second logical send"),
      requestContext,
    );
    await prisma.client.walletEngagementCampaign.update({
      where: { id: secondSend.id },
      data: { scheduledAt: new Date(0) },
    });
    const successfulSend = vi.fn().mockResolvedValue({ state: "STORED_AND_NOTIFIED" });
    const successWorker = new WalletWorker(
      prisma.client,
      {} as never,
      environment.values,
      new Map([
        [
          "GOOGLE",
          {
            provider: "GOOGLE",
            mode: "TEST_ADAPTER",
            sendPromotionalMessage: successfulSend,
          } as unknown as WalletProvider,
        ],
      ]),
    );
    await successWorker.processOneWalletCampaign(secondSend.id);
    const secondCommand = await prisma.client.walletCommand.findFirstOrThrow({
      where: { campaignDelivery: { campaignId: secondSend.id } },
    });
    await successWorker.processCommandById(secondCommand.id);

    const limited = await engagement.createCampaign(
      fixture.ownerId,
      fixture.organizationId,
      fixture.programId,
      campaignInput("Third logical send"),
      requestContext,
    );
    await prisma.client.walletEngagementCampaign.update({
      where: { id: limited.id },
      data: { scheduledAt: new Date(0) },
    });
    await successWorker.processOneWalletCampaign(limited.id);
    expect(
      await prisma.client.walletCampaignDelivery.findFirstOrThrow({
        where: { campaignId: limited.id },
      }),
    ).toMatchObject({ status: "SKIPPED", safeSkipCode: "WAFLO_PASS_LIMIT_24H" });

    await prisma.client.walletCampaignDelivery.updateMany({
      where: { membershipId, status: "SUCCEEDED" },
      data: { logicalSentAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1_000) },
    });
    const quotaCampaign = await engagement.createCampaign(
      fixture.ownerId,
      fixture.organizationId,
      fixture.programId,
      campaignInput("Provider quota retry"),
      requestContext,
    );
    await prisma.client.walletEngagementCampaign.update({
      where: { id: quotaCampaign.id },
      data: { scheduledAt: new Date(0) },
    });
    const quotaWorker = new WalletWorker(
      prisma.client,
      {} as never,
      environment.values,
      new Map([
        [
          "GOOGLE",
          {
            provider: "GOOGLE",
            mode: "TEST_ADAPTER",
            sendPromotionalMessage: vi.fn().mockRejectedValue(
              new WalletProviderError("RATE_LIMITED", "Provider quota reached.", {
                retryable: true,
              }),
            ),
          } as unknown as WalletProvider,
        ],
      ]),
    );
    await quotaWorker.processOneWalletCampaign(quotaCampaign.id);
    const quotaCommand = await prisma.client.walletCommand.findFirstOrThrow({
      where: { campaignDelivery: { campaignId: quotaCampaign.id } },
    });
    await quotaWorker.processCommandById(quotaCommand.id);
    const failedCommand = await prisma.client.walletCommand.findUniqueOrThrow({
      where: { id: quotaCommand.id },
    });
    const quotaDelivery = await prisma.client.walletCampaignDelivery.findFirstOrThrow({
      where: { campaignId: quotaCampaign.id },
    });
    expect(failedCommand).toMatchObject({ status: "FAILED", safeErrorCode: "RATE_LIMITED" });
    expect(failedCommand.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 5 * 60 * 60 * 1_000);
    expect(quotaDelivery).toMatchObject({ status: "QUEUED", safeFailureCode: "RATE_LIMITED" });
    worker.close();
    successWorker.close();
    quotaWorker.close();
  });
});
