import { randomUUID } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApplication } from "../../apps/api/src/app.js";
import { EnvironmentService } from "../../apps/api/src/config/environment.service.js";
import { CustomerSecurityService } from "../../apps/api/src/customer/customer-security.service.js";
import { PrismaService } from "../../apps/api/src/database/prisma.service.js";
import { LoyaltyOperationService } from "../../apps/api/src/loyalty/loyalty-operation.service.js";
import type { WafloRequest } from "../../apps/api/src/common/request-context.js";
import { createOpaqueToken, hashOpaqueToken, hashPassword } from "../../packages/auth/src/index.js";
import { createPairingToken } from "../../packages/staff-device-security/src/index.js";
import {
  createEphemeralStaffDeviceKeypair,
  type PairedStaffTestClient,
  signPairingMessage,
  signedStaffInject,
} from "../helpers/w4-staff-test-client.js";

const ORGANIZATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const MANAGER_ID = "22222222-2222-4222-8222-222222222222";
const STAFF_USER_ID = "33333333-3333-4333-8333-333333333333";
const LOCATION_ID = "a1111111-1111-4111-8111-111111111111";
const SECOND_ORGANIZATION_LOCATION_ID = "b1111111-1111-4111-8111-111111111111";
const LOCATION_TWO_ID = "a2222222-2222-4222-8222-222222222222";
const SECOND_ORGANIZATION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TEST_PROGRAM_ID = "e0000000-0000-4000-8000-000000000001";
const TEST_VERSION_ID = "e1000000-0000-4000-8000-000000000001";

function responseData<T>(response: { json(): unknown }): T {
  return (response.json() as { data: T }).data;
}

function responseCode(response: { json(): unknown }): string | undefined {
  const body = response.json() as {
    error?: { code?: string };
    code?: string;
  };
  return body.error?.code ?? body.code;
}

describe.sequential("W4 signed Staff HTTP operations", () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let environment: EnvironmentService;
  let customerSecurity: CustomerSecurityService;
  let loyalty: LoyaltyOperationService;
  let client: PairedStaffTestClient;
  let otherDeviceClient: PairedStaffTestClient;
  let otherLocationClient: PairedStaffTestClient;
  let otherOrganizationClient: PairedStaffTestClient;
  let membershipQr = "";
  let membershipId = "";
  let membershipPublicId = "";
  let customerId = "";
  let completedCommandId = "";
  let ownerCookie = "";
  let managerCookie = "";
  let ownerMemberId = "";
  const startingProgress = 0;

  async function pairDevice(input: {
    organizationId: string;
    organizationMemberId: string;
    locationId: string;
    label: string;
  }): Promise<PairedStaffTestClient & { refreshToken: string }> {
    const pairingPublicId = randomUUID();
    const pairing = createPairingToken({
      publicId: pairingPublicId,
      environmentId: environment.values.DEPLOYMENT_ENVIRONMENT,
    });
    await prisma.client.devicePairingSession.create({
      data: {
        publicId: pairingPublicId,
        organizationId: input.organizationId,
        intendedStaffMemberId: input.organizationMemberId,
        pairingTokenHash: pairing.tokenHash,
        requestedLocationAssignments: [
          {
            locationId: input.locationId,
            earningAllowed: true,
            redemptionAllowed: true,
          },
        ],
        deviceLabelSuggestion: input.label,
        createdByUserId: OWNER_ID,
        expiresAt: new Date(Date.now() + 10 * 60_000),
      },
    });

    const keypair = createEphemeralStaffDeviceKeypair();
    const claim = await app.inject({
      method: "POST",
      url: "/v1/staff/devices/pairing/claim",
      headers: { "content-type": "application/json" },
      payload: {
        pairingToken: pairing.token,
        installationId: `${input.label}-${randomUUID()}`,
        publicKey: keypair.publicKeyPem,
        platform: "TEST_CLIENT",
        appVersion: "1.0.0",
        osVersion: "Node.js",
        model: "Vitest",
      },
    });
    expect(claim.statusCode).toBe(200);
    const challenge = responseData<{
      pairingPublicId: string;
      challenge: string;
      message: string;
    }>(claim);
    const complete = await app.inject({
      method: "POST",
      url: "/v1/staff/devices/pairing/complete",
      headers: { "content-type": "application/json" },
      payload: {
        pairingPublicId: challenge.pairingPublicId,
        challenge: challenge.challenge,
        signature: signPairingMessage(keypair.privateKey, challenge.message),
        displayName: input.label,
      },
    });
    expect(complete.statusCode).toBe(200);
    const paired = responseData<{
      device: { publicId: string };
      session: { id: string; token: string; refreshToken: string };
      context: { organizationId: string; locationId: string };
    }>(complete);
    return {
      ...keypair,
      devicePublicId: paired.device.publicId,
      deviceSessionId: paired.session.id,
      accessToken: paired.session.token,
      refreshToken: paired.session.refreshToken,
      organizationId: paired.context.organizationId,
      locationId: paired.context.locationId,
    };
  }

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.TEST_STAFF_CLIENT_ENABLED = "true";
    process.env.APPLE_WALLET_MODE = "TEST_ADAPTER";
    process.env.GOOGLE_WALLET_MODE = "TEST_ADAPTER";
    app = await createApiApplication({ logger: false });
    prisma = app.get(PrismaService);
    environment = app.get(EnvironmentService);
    customerSecurity = app.get(CustomerSecurityService);
    loyalty = app.get(LoyaltyOperationService);
    const ownerToken = createOpaqueToken();
    const managerToken = createOpaqueToken();
    await prisma.client.session.createMany({
      data: [
        {
          userId: OWNER_ID,
          tokenHash: hashOpaqueToken(ownerToken),
          expiresAt: new Date(Date.now() + 60 * 60_000),
        },
        {
          userId: MANAGER_ID,
          tokenHash: hashOpaqueToken(managerToken),
          expiresAt: new Date(Date.now() + 60 * 60_000),
        },
      ],
    });
    ownerCookie = `${environment.values.COOKIE_NAME}=${ownerToken}`;
    managerCookie = `${environment.values.COOKIE_NAME}=${managerToken}`;
    ownerMemberId = (
      await prisma.client.organizationMember.findUniqueOrThrow({
        where: { organizationId_userId: { organizationId: ORGANIZATION_ID, userId: OWNER_ID } },
      })
    ).id;
    customerId = randomUUID();
    membershipId = randomUUID();
    membershipPublicId = `mem_${randomUUID().replaceAll("-", "")}`;
    const membershipCredential = customerSecurity.createCredential(1);
    await prisma.client.$transaction(async (transaction) => {
      await transaction.customer.create({
        data: {
          id: customerId,
          organizationId: ORGANIZATION_ID,
          displayName: "W4 HTTP isolated fixture",
          preferredLocale: "EN",
        },
      });
      await transaction.membership.create({
        data: {
          id: membershipId,
          organizationId: ORGANIZATION_ID,
          customerId,
          programId: TEST_PROGRAM_ID,
          enrollmentProgramVersionId: TEST_VERSION_ID,
          publicMembershipId: membershipPublicId,
        },
      });
      await transaction.membershipProgressProjection.create({
        data: {
          membershipId,
          organizationId: ORGANIZATION_ID,
          currentCycleStampCount: 0,
          completedCycleCount: 0,
          currentCycleNumber: 1,
          rewardReady: false,
          projectionVersion: 0,
          lastLedgerSequence: 0,
        },
      });
      await transaction.membershipCredential.create({
        data: {
          organizationId: ORGANIZATION_ID,
          membershipId,
          credentialVersion: 1,
          publicCredentialId: membershipCredential.publicCredentialId,
          secretVersion: membershipCredential.secretVersion,
          secretHash: membershipCredential.secretHash,
          status: "ACTIVE",
        },
      });
    });
    membershipQr = membershipCredential.payload;

    const staff = await prisma.client.organizationMember.findFirstOrThrow({
      where: { organizationId: ORGANIZATION_ID, userId: STAFF_USER_ID },
    });
    await prisma.client.devicePairingSession.updateMany({
      where: {
        intendedStaffMemberId: staff.id,
        status: { in: ["PENDING", "CLAIMED"] },
      },
      data: { status: "CANCELED" },
    });
    client = await pairDevice({
      organizationId: ORGANIZATION_ID,
      organizationMemberId: staff.id,
      locationId: LOCATION_ID,
      label: "m2-primary-http-client",
    });
    otherDeviceClient = await pairDevice({
      organizationId: ORGANIZATION_ID,
      organizationMemberId: staff.id,
      locationId: LOCATION_ID,
      label: "m2-other-device-client",
    });
    otherLocationClient = await pairDevice({
      organizationId: ORGANIZATION_ID,
      organizationMemberId: staff.id,
      locationId: LOCATION_TWO_ID,
      label: "m2-other-location-client",
    });
    const otherOrganizationMember = await prisma.client.organizationMember.findFirstOrThrow({
      where: { organizationId: SECOND_ORGANIZATION_ID, userId: OWNER_ID },
    });
    await prisma.client.staffLocationAssignment.upsert({
      where: {
        organizationMemberId_locationId: {
          organizationMemberId: otherOrganizationMember.id,
          locationId: SECOND_ORGANIZATION_LOCATION_ID,
        },
      },
      update: { active: true, earningAllowed: true, redemptionAllowed: true, revokedAt: null },
      create: {
        organizationId: SECOND_ORGANIZATION_ID,
        organizationMemberId: otherOrganizationMember.id,
        locationId: SECOND_ORGANIZATION_LOCATION_ID,
        earningAllowed: true,
        redemptionAllowed: true,
        assignedByUserId: OWNER_ID,
      },
    });
    otherOrganizationClient = await pairDevice({
      organizationId: SECOND_ORGANIZATION_ID,
      organizationMemberId: otherOrganizationMember.id,
      locationId: SECOND_ORGANIZATION_LOCATION_ID,
      label: "m2-other-tenant-client",
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  async function merchantMutationHeaders(cookie = ownerCookie) {
    const response = await app.inject({
      method: "GET",
      url: "/v1/auth/csrf",
      headers: { cookie },
    });
    const setCookie = response.headers["set-cookie"];
    const rawCookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    return {
      origin: "http://localhost:3001",
      cookie: `${rawCookie?.split(";")[0] ?? ""}; ${cookie}`,
      "x-csrf-token": responseData<{ csrfToken: string }>(response).csrfToken,
      "content-type": "application/json",
    };
  }

  async function createStaffIdentity(label: string) {
    const userId = randomUUID();
    const password = "Waflo-Lifecycle-Test-2026";
    await prisma.client.user.create({
      data: {
        id: userId,
        displayName: label,
        email: `${label}-${userId}@waflo.test`,
        normalizedEmail: `${label}-${userId}@waflo.test`,
        emailVerifiedAt: new Date(),
        passwordHash: await hashPassword(password),
        preferredLocale: "EN",
        termsVersion: "test",
        privacyVersion: "test",
        legalAcceptedAt: new Date(),
      },
    });
    const member = await prisma.client.organizationMember.create({
      data: { organizationId: ORGANIZATION_ID, userId, role: "STAFF" },
    });
    return { userId, memberId: member.id, password };
  }

  async function createApprovalRewardFixture(label: string) {
    const credential = customerSecurity.createCredential(1);
    const customerId = randomUUID();
    const fixtureMembershipId = randomUUID();
    await prisma.client.$transaction(async (transaction) => {
      await transaction.customer.create({
        data: {
          id: customerId,
          organizationId: ORGANIZATION_ID,
          displayName: label,
          preferredLocale: "EN",
        },
      });
      await transaction.membership.create({
        data: {
          id: fixtureMembershipId,
          organizationId: ORGANIZATION_ID,
          customerId,
          programId: "c0000000-0000-4000-8000-000000000001",
          enrollmentProgramVersionId: "c1000000-0000-4000-8000-000000000001",
          publicMembershipId: `mem_${randomUUID().replaceAll("-", "")}`,
        },
      });
      await transaction.membershipProgressProjection.create({
        data: { membershipId: fixtureMembershipId, organizationId: ORGANIZATION_ID },
      });
      await transaction.membershipCredential.create({
        data: {
          organizationId: ORGANIZATION_ID,
          membershipId: fixtureMembershipId,
          credentialVersion: 1,
          publicCredentialId: credential.publicCredentialId,
          secretVersion: credential.secretVersion,
          secretHash: credential.secretHash,
          status: "ACTIVE",
        },
      });
    });
    const request = {
      id: `approval-${label}`,
      requestId: `approval-${label}`,
      headers: {},
      cookies: {},
      ip: "127.0.0.1",
    } as unknown as WafloRequest;
    await loyalty.manualAdjustment({
      organizationId: ORGANIZATION_ID,
      membershipId: fixtureMembershipId,
      actorUserId: OWNER_ID,
      actorMemberId: ownerMemberId,
      actorRole: "OWNER",
      locationId: LOCATION_ID,
      commandId: randomUUID(),
      stampDelta: 4,
      reason: "Create an approval-required HTTP fixture.",
      request,
    });
    const entitlement = await prisma.client.rewardEntitlement.findFirstOrThrow({
      where: { membershipId: fixtureMembershipId, threshold: 4 },
    });
    return { qrPayload: credential.payload, membershipId: fixtureMembershipId, entitlement };
  }

  async function requestApproval(
    fixture: Awaited<ReturnType<typeof createApprovalRewardFixture>>,
    commandId = randomUUID(),
    note = "Bound approval intent",
  ) {
    const payload = {
      qrPayload: fixture.qrPayload,
      rewardEntitlementPublicId: fixture.entitlement.publicId,
      note,
    };
    const response = await signedStaffInject(app, client, {
      method: "POST",
      url: "/v1/staff/operations/redeem",
      idempotencyKey: commandId,
      payload,
    });
    expect(responseCode(response)).toBe("MANAGER_APPROVAL_REQUIRED");
    const publicId = (
      response.json() as { error: { details: { approvalRequest: { publicId: string } } } }
    ).error.details.approvalRequest.publicId;
    return { commandId, payload, publicId };
  }

  it("pairs an ephemeral key and resolves localized mobile-safe operational data", async () => {
    const context = await signedStaffInject(app, client, {
      method: "GET",
      url: "/v1/staff/device-context",
    });
    expect(context.statusCode).toBe(200);
    expect(responseData<Record<string, unknown>>(context)).toMatchObject({
      locationId: LOCATION_ID,
      appVersion: "1.0.0",
      minimumSupportedAppVersion: "1.0.0",
      appVersionSupported: true,
    });
    expect(responseData<Record<string, unknown>>(context)).not.toHaveProperty("deviceId");
    expect(responseData<Record<string, unknown>>(context)).not.toHaveProperty(
      "organizationMemberId",
    );

    for (const locale of ["EN", "AR"] as const) {
      await prisma.client.customer.update({
        where: { id: customerId },
        data: { preferredLocale: locale },
      });
      const resolved = await signedStaffInject(app, client, {
        method: "POST",
        url: "/v1/staff/memberships/resolve",
        payload: { qrPayload: membershipQr },
      });
      expect(resolved.statusCode).toBe(200);
      const body = responseData<Record<string, unknown>>(resolved);
      const expectedTranslation = await prisma.client.programTranslation.findUniqueOrThrow({
        where: { versionId_locale: { versionId: TEST_VERSION_ID, locale } },
      });
      expect(body).toMatchObject({
        membershipPublicId,
        membershipStatus: "ACTIVE",
        programName: expectedTranslation.programName,
        locale: locale.toLocaleLowerCase("en-US"),
        progress: startingProgress,
        goal: 6,
        rewardReady: false,
        projectionVersion: 0,
        operationLimits: {
          maximumStampsPerCustomerPerDay: 6,
          dailyRemainingStamps: 6,
        },
        purchaseRequirement: {
          required: true,
          minimumAmountMinor: 10_000,
          currency: "IQD",
        },
        stampVisuals: {
          filled: { state: "FILLED" },
          empty: { state: "EMPTY" },
        },
      });
      const serialized = JSON.stringify(body).toLocaleLowerCase("en-US");
      expect(serialized).not.toMatch(/email|phone|rewarddefinitionid|databaseid/u);
      expect(JSON.stringify(body)).not.toContain(membershipQr);
    }
    await prisma.client.customer.update({
      where: { id: customerId },
      data: { preferredLocale: "EN" },
    });
  });

  it("issues atomically, supports compatible idempotent replay, and rejects conflicts", async () => {
    const commandId = randomUUID();
    completedCommandId = commandId;
    const payload = {
      qrPayload: membershipQr,
      amount: 1,
      purchaseAmountMinor: 10_000,
      purchaseCurrency: "iqd",
    };
    const issued = await signedStaffInject(app, client, {
      method: "POST",
      url: "/v1/staff/operations/stamps",
      idempotencyKey: commandId,
      payload,
    });
    expect(issued.statusCode).toBe(200);
    expect(responseData<Record<string, unknown>>(issued)).toMatchObject({
      commandId,
      beforeProgress: startingProgress,
      progress: startingProgress + 1,
      requestId: expect.any(String),
    });

    const replayed = await signedStaffInject(app, client, {
      method: "POST",
      url: "/v1/staff/operations/stamps",
      idempotencyKey: commandId,
      payload,
    });
    expect(replayed.statusCode).toBe(200);
    expect(responseData<{ replayed: boolean }>(replayed).replayed).toBe(true);

    const conflict = await signedStaffInject(app, client, {
      method: "POST",
      url: "/v1/staff/operations/stamps",
      idempotencyKey: commandId,
      payload: {
        qrPayload: membershipQr,
        amount: 2,
        purchaseAmountMinor: 10_000,
        purchaseCurrency: "IQD",
      },
    });
    expect(conflict.statusCode).toBe(409);
    expect(responseCode(conflict)).toBe("OPERATION_IDEMPOTENCY_CONFLICT");
    expect(
      await prisma.client.loyaltyLedgerEntry.count({
        where: {
          membershipId,
          eventType: "STAMP_ISSUED",
          operationCommand: { idempotencyKey: commandId },
        },
      }),
    ).toBe(1);
  });

  it("recovers PROCESSING, COMPLETED, and FAILED commands without device or tenant leakage", async () => {
    const device = await prisma.client.staffDevice.findUniqueOrThrow({
      where: { publicId: client.devicePublicId },
    });
    const processingCommandId = randomUUID();
    const failedCommandId = randomUUID();
    for (const item of [
      { commandId: processingCommandId, status: "PROCESSING" as const, safeFailureCode: null },
      {
        commandId: failedCommandId,
        status: "FAILED" as const,
        safeFailureCode: "PURCHASE_CURRENCY_MISMATCH",
      },
    ]) {
      await prisma.client.loyaltyOperationCommand.create({
        data: {
          organizationId: ORGANIZATION_ID,
          membershipId,
          operationType: "ISSUE_STAMP",
          idempotencyKey: item.commandId,
          requestFingerprint: item.commandId.replaceAll("-", "").repeat(2),
          status: item.status,
          safeFailureCode: item.safeFailureCode,
          actorMemberId: device.organizationMemberId,
          actorDeviceId: device.id,
          locationId: LOCATION_ID,
          ...(item.status === "FAILED" ? { completedAt: new Date() } : {}),
        },
      });
    }

    for (const [commandId, status] of [
      [processingCommandId, "PROCESSING"],
      [completedCommandId, "COMPLETED"],
      [failedCommandId, "FAILED"],
    ] as const) {
      const response = await signedStaffInject(app, client, {
        method: "GET",
        url: `/v1/staff/operations/commands/${commandId}`,
      });
      expect(response.statusCode).toBe(200);
      expect(responseData<Record<string, unknown>>(response)).toMatchObject({ commandId, status });
    }

    for (const isolatedClient of [otherDeviceClient, otherOrganizationClient]) {
      const hidden = await signedStaffInject(app, isolatedClient, {
        method: "GET",
        url: `/v1/staff/operations/commands/${completedCommandId}`,
      });
      expect(hidden.statusCode).toBe(404);
      expect(responseCode(hidden)).toBe("OPERATION_NOT_FOUND");
    }
  });

  it("rejects nonce replay, stale time, and a body-digest substitution", async () => {
    const nonce = randomUUID();
    const first = await signedStaffInject(app, client, {
      method: "GET",
      url: "/v1/staff/device-context",
      nonce,
    });
    expect(first.statusCode).toBe(200);
    const replay = await signedStaffInject(app, client, {
      method: "GET",
      url: "/v1/staff/device-context",
      nonce,
    });
    expect(replay.statusCode).toBe(409);
    expect(responseCode(replay)).toBe("STAFF_DEVICE_NONCE_REPLAYED");

    const stale = await signedStaffInject(app, client, {
      method: "GET",
      url: "/v1/staff/device-context",
      timestamp: "2025-01-01T00:00:00.000Z",
    });
    expect(stale.statusCode).toBe(401);
    expect(responseCode(stale)).toBe("STAFF_DEVICE_CLOCK_SKEW");

    const digestMismatch = await signedStaffInject(app, client, {
      method: "POST",
      url: "/v1/staff/memberships/resolve",
      payload: { qrPayload: membershipQr },
      bodyDigest: "0".repeat(64),
    });
    expect(digestMismatch.statusCode).toBe(401);
    expect(responseCode(digestMismatch)).toBe("STAFF_DEVICE_BODY_DIGEST_INVALID");
  });

  it("rejects an iOS pairing below the configured semantic minimum version", async () => {
    const staff = await prisma.client.organizationMember.findFirstOrThrow({
      where: { organizationId: ORGANIZATION_ID, userId: STAFF_USER_ID },
    });
    const pairingPublicId = randomUUID();
    const pairing = createPairingToken({
      publicId: pairingPublicId,
      environmentId: environment.values.DEPLOYMENT_ENVIRONMENT,
    });
    await prisma.client.devicePairingSession.create({
      data: {
        publicId: pairingPublicId,
        organizationId: ORGANIZATION_ID,
        intendedStaffMemberId: staff.id,
        pairingTokenHash: pairing.tokenHash,
        requestedLocationAssignments: [
          { locationId: LOCATION_ID, earningAllowed: true, redemptionAllowed: true },
        ],
        createdByUserId: OWNER_ID,
        expiresAt: new Date(Date.now() + 10 * 60_000),
      },
    });
    const keypair = createEphemeralStaffDeviceKeypair();
    const response = await app.inject({
      method: "POST",
      url: "/v1/staff/devices/pairing/claim",
      headers: { "content-type": "application/json" },
      payload: {
        pairingToken: pairing.token,
        installationId: `m2-unsupported-ios-${randomUUID()}`,
        publicKey: keypair.publicKeyPem,
        platform: "IOS",
        appVersion: "0.9.9",
      },
    });
    expect(response.statusCode).toBe(426);
    expect(responseCode(response)).toBe("STAFF_APP_VERSION_UNSUPPORTED");
  });

  it("provisions, views, updates, and revokes Staff Location assignments over Merchant HTTP", async () => {
    const staff = await createStaffIdentity("assignment-contract");
    const headers = await merchantMutationHeaders();
    const route = `/v1/organizations/${ORGANIZATION_ID}/members/${staff.memberId}/location-assignments/${LOCATION_ID}`;
    const created = await app.inject({
      method: "PUT",
      url: route,
      headers,
      payload: { earningAllowed: true, redemptionAllowed: true },
    });
    expect(created.statusCode).toBe(200);
    expect(responseData<Record<string, unknown>>(created)).toMatchObject({
      organizationId: ORGANIZATION_ID,
      staffMemberId: staff.memberId,
      locationId: LOCATION_ID,
      active: true,
      changed: true,
    });
    const duplicate = await app.inject({
      method: "PUT",
      url: route,
      headers,
      payload: { earningAllowed: true, redemptionAllowed: true },
    });
    expect(duplicate.statusCode).toBe(200);
    expect(responseData<{ changed: boolean }>(duplicate).changed).toBe(false);
    const managerHeaders = await merchantMutationHeaders(managerCookie);
    const managerUpdated = await app.inject({
      method: "PUT",
      url: route,
      headers: managerHeaders,
      payload: { earningAllowed: true, redemptionAllowed: false },
    });
    expect(managerUpdated.statusCode).toBe(200);
    expect(responseData<Record<string, unknown>>(managerUpdated)).toMatchObject({
      earningAllowed: true,
      redemptionAllowed: false,
      changed: true,
    });
    const managerCannotAssignOwner = await app.inject({
      method: "PUT",
      url: `/v1/organizations/${ORGANIZATION_ID}/members/${ownerMemberId}/location-assignments/${LOCATION_TWO_ID}`,
      headers: managerHeaders,
      payload: { earningAllowed: true, redemptionAllowed: true },
    });
    expect(managerCannotAssignOwner.statusCode).toBe(422);
    expect(responseCode(managerCannotAssignOwner)).toBe("STAFF_MEMBER_NOT_ASSIGNABLE");
    const noAuthority = await app.inject({
      method: "PUT",
      url: route,
      headers,
      payload: { earningAllowed: false, redemptionAllowed: false },
    });
    expect(responseCode(noAuthority)).toBe("VALIDATION_FAILED");
    const listed = await app.inject({
      method: "GET",
      url: `/v1/organizations/${ORGANIZATION_ID}/members/${staff.memberId}/location-assignments`,
      headers: { cookie: ownerCookie },
    });
    expect(listed.statusCode).toBe(200);
    expect(responseData<{ items: unknown[] }>(listed).items).toHaveLength(1);

    const crossOrganization = await app.inject({
      method: "PUT",
      url: `/v1/organizations/${ORGANIZATION_ID}/members/${staff.memberId}/location-assignments/${SECOND_ORGANIZATION_LOCATION_ID}`,
      headers,
      payload: { earningAllowed: true, redemptionAllowed: true },
    });
    expect(crossOrganization.statusCode).toBe(422);
    expect(responseCode(crossOrganization)).toBe("STAFF_LOCATION_INVALID");

    const revoked = await app.inject({ method: "DELETE", url: route, headers, payload: {} });
    expect(revoked.statusCode).toBe(200);
    expect(responseData<Record<string, unknown>>(revoked)).toMatchObject({
      status: "REVOKED",
      changed: true,
    });
    const repeatedRevoke = await app.inject({
      method: "DELETE",
      url: route,
      headers,
      payload: {},
    });
    expect(responseData<{ changed: boolean }>(repeatedRevoke).changed).toBe(false);
    const pairingDenied = await app.inject({
      method: "POST",
      url: `/v1/organizations/${ORGANIZATION_ID}/device-pairing-sessions`,
      headers,
      payload: {
        staffMemberId: staff.memberId,
        locations: [{ locationId: LOCATION_ID, earningAllowed: true, redemptionAllowed: true }],
        expiresInMinutes: 10,
      },
    });
    expect(pairingDenied.statusCode).toBe(403);
    expect(responseCode(pairingDenied)).toBe("LOCATION_NOT_AUTHORIZED");
    await prisma.client.organizationMember.update({
      where: { id: staff.memberId },
      data: { status: "SUSPENDED" },
    });
    const inactiveTarget = await app.inject({
      method: "PUT",
      url: route,
      headers,
      payload: { earningAllowed: true, redemptionAllowed: true },
    });
    expect(inactiveTarget.statusCode).toBe(422);
    expect(responseCode(inactiveTarget)).toBe("STAFF_MEMBER_NOT_ASSIGNABLE");
  });

  it("executes the server-owned HTTP manager approval protocol end to end", async () => {
    const unlock = await signedStaffInject(app, client, {
      method: "POST",
      url: "/v1/staff/operations/stamps",
      idempotencyKey: randomUUID(),
      payload: {
        qrPayload: membershipQr,
        amount: 2,
        purchaseAmountMinor: 10_000,
        purchaseCurrency: "IQD",
      },
    });
    expect(unlock.statusCode).toBe(200);
    const entitlement = await prisma.client.rewardEntitlement.findFirstOrThrow({
      where: { membershipId, threshold: 3 },
    });
    const commandId = randomUUID();
    const payload = {
      qrPayload: membershipQr,
      rewardEntitlementPublicId: entitlement.publicId,
      note: "Exact approved redeem",
    };
    const required = await signedStaffInject(app, client, {
      method: "POST",
      url: "/v1/staff/operations/redeem",
      idempotencyKey: commandId,
      payload,
    });
    expect(required.statusCode).toBe(409);
    expect(responseCode(required)).toBe("MANAGER_APPROVAL_REQUIRED");
    const approvalRequest = (
      required.json() as {
        error: {
          details: { approvalRequest: { publicId: string; status: string; expiresAt: string } };
        };
      }
    ).error.details.approvalRequest;
    expect(approvalRequest).toMatchObject({ status: "PENDING" });
    const pendingCommand = await prisma.client.loyaltyOperationCommand.findUniqueOrThrow({
      where: {
        organizationId_idempotencyKey: {
          organizationId: ORGANIZATION_ID,
          idempotencyKey: commandId,
        },
      },
    });
    expect(pendingCommand).toMatchObject({ status: "PROCESSING", leaseOwner: null });
    const pendingRetry = await signedStaffInject(app, client, {
      method: "POST",
      url: "/v1/staff/operations/redeem",
      idempotencyKey: commandId,
      payload: { ...payload, managerApprovalPublicId: approvalRequest.publicId },
    });
    expect(responseCode(pendingRetry)).toBe("MANAGER_APPROVAL_PENDING");

    const headers = await merchantMutationHeaders();
    const removedIssuance = await app.inject({
      method: "POST",
      url: `/v1/organizations/${ORGANIZATION_ID}/operation-approvals`,
      headers,
      payload: {},
    });
    expect(removedIssuance.statusCode).toBe(404);
    const approved = await app.inject({
      method: "POST",
      url: `/v1/organizations/${ORGANIZATION_ID}/operation-approvals/${approvalRequest.publicId}/approve`,
      headers,
      payload: { reason: "Verified at the counter" },
    });
    expect(approved.statusCode).toBe(201);
    expect(responseData<{ status: string }>(approved).status).toBe("APPROVED");

    const redeemed = await signedStaffInject(app, client, {
      method: "POST",
      url: "/v1/staff/operations/redeem",
      idempotencyKey: commandId,
      payload: { ...payload, managerApprovalPublicId: approvalRequest.publicId },
    });
    expect(redeemed.statusCode).toBe(200);
    expect(responseData<Record<string, unknown>>(redeemed)).toMatchObject({
      commandId,
      replayed: false,
    });
    expect(
      await prisma.client.managerApprovalChallenge.findUniqueOrThrow({
        where: { publicId: approvalRequest.publicId },
      }),
    ).toMatchObject({ status: "CONSUMED", pendingOperationId: pendingCommand.id });

    const timeoutRecovery = await signedStaffInject(app, client, {
      method: "POST",
      url: "/v1/staff/operations/redeem",
      idempotencyKey: commandId,
      payload: { ...payload, managerApprovalPublicId: approvalRequest.publicId },
    });
    expect(timeoutRecovery.statusCode).toBe(200);
    expect(responseData<{ replayed: boolean }>(timeoutRecovery).replayed).toBe(true);

    const changed = await signedStaffInject(app, client, {
      method: "POST",
      url: "/v1/staff/operations/redeem",
      idempotencyKey: commandId,
      payload: {
        ...payload,
        note: "Materially changed redeem",
        managerApprovalPublicId: approvalRequest.publicId,
      },
    });
    expect(responseCode(changed)).toBe("OPERATION_IDEMPOTENCY_CONFLICT");

    const stampCannotConsume = await signedStaffInject(app, client, {
      method: "POST",
      url: "/v1/staff/operations/stamps",
      idempotencyKey: randomUUID(),
      payload: {
        qrPayload: membershipQr,
        amount: 4,
        purchaseAmountMinor: 10_000,
        purchaseCurrency: "IQD",
        managerOverride: {
          approvalPublicId: approvalRequest.publicId,
          dailyCap: true,
          purchasePolicy: false,
          reason: "A redeem approval must never authorize stamps.",
        },
      },
    });
    expect(stampCannotConsume.statusCode).toBe(422);
    expect(
      (
        await prisma.client.managerApprovalChallenge.findUniqueOrThrow({
          where: { publicId: approvalRequest.publicId },
        })
      ).status,
    ).toBe("CONSUMED");
  });

  it("rejects approval relocation, terminal states, stale policy, and lost Manager authority", async () => {
    const boundFixture = await createApprovalRewardFixture("approval-bindings");
    const bound = await requestApproval(boundFixture);
    const wrongDevice = await signedStaffInject(app, otherDeviceClient, {
      method: "POST",
      url: "/v1/staff/operations/redeem",
      idempotencyKey: randomUUID(),
      payload: { ...bound.payload, managerApprovalPublicId: bound.publicId },
    });
    expect(responseCode(wrongDevice)).toBe("MANAGER_APPROVAL_MISMATCH");
    const wrongLocation = await signedStaffInject(app, otherLocationClient, {
      method: "POST",
      url: "/v1/staff/operations/redeem",
      idempotencyKey: randomUUID(),
      payload: { ...bound.payload, managerApprovalPublicId: bound.publicId },
    });
    expect(responseCode(wrongLocation)).toBe("MANAGER_APPROVAL_MISMATCH");
    const wrongOrganization = await signedStaffInject(app, otherOrganizationClient, {
      method: "POST",
      url: "/v1/staff/operations/redeem",
      idempotencyKey: randomUUID(),
      payload: { ...bound.payload, managerApprovalPublicId: bound.publicId },
    });
    expect(responseCode(wrongOrganization)).toBe("MEMBERSHIP_CREDENTIAL_INVALID");
    const otherMembership = await createApprovalRewardFixture("approval-other-membership");
    const wrongMembership = await signedStaffInject(app, client, {
      method: "POST",
      url: "/v1/staff/operations/redeem",
      idempotencyKey: randomUUID(),
      payload: {
        qrPayload: otherMembership.qrPayload,
        rewardEntitlementPublicId: otherMembership.entitlement.publicId,
        note: bound.payload.note,
        managerApprovalPublicId: bound.publicId,
      },
    });
    expect(responseCode(wrongMembership)).toBe("MANAGER_APPROVAL_MISMATCH");

    const rejectedFixture = await createApprovalRewardFixture("approval-rejected");
    const rejected = await requestApproval(rejectedFixture);
    const ownerHeaders = await merchantMutationHeaders();
    const rejectedDecision = await app.inject({
      method: "POST",
      url: `/v1/organizations/${ORGANIZATION_ID}/operation-approvals/${rejected.publicId}/reject`,
      headers: ownerHeaders,
      payload: { reason: "Reject this exact intent" },
    });
    expect(rejectedDecision.statusCode).toBe(201);
    expect(
      responseCode(
        await signedStaffInject(app, client, {
          method: "POST",
          url: "/v1/staff/operations/redeem",
          idempotencyKey: rejected.commandId,
          payload: { ...rejected.payload, managerApprovalPublicId: rejected.publicId },
        }),
      ),
    ).toBe("MANAGER_APPROVAL_REJECTED");

    const expiredFixture = await createApprovalRewardFixture("approval-expired");
    const expired = await requestApproval(expiredFixture);
    await prisma.client.managerApprovalChallenge.update({
      where: { publicId: expired.publicId },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    expect(
      responseCode(
        await signedStaffInject(app, client, {
          method: "POST",
          url: "/v1/staff/operations/redeem",
          idempotencyKey: expired.commandId,
          payload: { ...expired.payload, managerApprovalPublicId: expired.publicId },
        }),
      ),
    ).toBe("MANAGER_APPROVAL_EXPIRED");
    expect(
      (
        await prisma.client.managerApprovalChallenge.findUniqueOrThrow({
          where: { publicId: expired.publicId },
        })
      ).status,
    ).toBe("EXPIRED");

    const staleFixture = await createApprovalRewardFixture("approval-stale");
    const stale = await requestApproval(staleFixture);
    await prisma.client.rewardEntitlement.update({
      where: { id: staleFixture.entitlement.id },
      data: { status: "VOIDED", voidedAt: new Date() },
    });
    const staleDecision = await app.inject({
      method: "POST",
      url: `/v1/organizations/${ORGANIZATION_ID}/operation-approvals/${stale.publicId}/approve`,
      headers: ownerHeaders,
      payload: { reason: "This must be revalidated" },
    });
    expect(responseCode(staleDecision)).toBe("MANAGER_APPROVAL_STALE");

    const managerMember = await prisma.client.organizationMember.findUniqueOrThrow({
      where: { organizationId_userId: { organizationId: ORGANIZATION_ID, userId: MANAGER_ID } },
    });
    const permissionFixture = await createApprovalRewardFixture("approval-permission");
    const permission = await requestApproval(permissionFixture);
    const managerHeaders = await merchantMutationHeaders(managerCookie);
    await prisma.client.organizationMember.update({
      where: { id: managerMember.id },
      data: { status: "SUSPENDED" },
    });
    const lostBeforeApproval = await app.inject({
      method: "POST",
      url: `/v1/organizations/${ORGANIZATION_ID}/operation-approvals/${permission.publicId}/approve`,
      headers: managerHeaders,
      payload: { reason: "Permission has been removed" },
    });
    expect(responseCode(lostBeforeApproval)).toBe("ORGANIZATION_ACCESS_DENIED");
    await prisma.client.organizationMember.update({
      where: { id: managerMember.id },
      data: { status: "ACTIVE" },
    });

    const consumptionFixture = await createApprovalRewardFixture("approval-consumption-permission");
    const consumption = await requestApproval(consumptionFixture);
    const managerApproved = await app.inject({
      method: "POST",
      url: `/v1/organizations/${ORGANIZATION_ID}/operation-approvals/${consumption.publicId}/approve`,
      headers: await merchantMutationHeaders(managerCookie),
      payload: { reason: "Approval before permission loss" },
    });
    expect(managerApproved.statusCode).toBe(201);
    await prisma.client.organizationMember.update({
      where: { id: managerMember.id },
      data: { status: "SUSPENDED" },
    });
    const lostBeforeConsumption = await signedStaffInject(app, client, {
      method: "POST",
      url: "/v1/staff/operations/redeem",
      idempotencyKey: consumption.commandId,
      payload: { ...consumption.payload, managerApprovalPublicId: consumption.publicId },
    });
    expect(responseCode(lostBeforeConsumption)).toBe("MANAGER_APPROVAL_APPROVER_INACTIVE");
    await prisma.client.organizationMember.update({
      where: { id: managerMember.id },
      data: { status: "ACTIVE" },
    });
  });

  it("serializes duplicate approved redeem and two-manager decision races", async () => {
    const duplicateFixture = await createApprovalRewardFixture("approval-concurrent-redeem");
    const duplicate = await requestApproval(duplicateFixture);
    const approved = await app.inject({
      method: "POST",
      url: `/v1/organizations/${ORGANIZATION_ID}/operation-approvals/${duplicate.publicId}/approve`,
      headers: await merchantMutationHeaders(),
      payload: { reason: "Approve concurrent exact retries" },
    });
    expect(approved.statusCode).toBe(201);
    const exactPayload = { ...duplicate.payload, managerApprovalPublicId: duplicate.publicId };
    const redemptions = await Promise.all([
      signedStaffInject(app, client, {
        method: "POST",
        url: "/v1/staff/operations/redeem",
        idempotencyKey: duplicate.commandId,
        payload: exactPayload,
      }),
      signedStaffInject(app, client, {
        method: "POST",
        url: "/v1/staff/operations/redeem",
        idempotencyKey: duplicate.commandId,
        payload: exactPayload,
      }),
    ]);
    expect(redemptions.map((response) => response.statusCode)).toEqual([200, 200]);
    expect(
      await prisma.client.rewardRedemption.count({
        where: { rewardEntitlementId: duplicateFixture.entitlement.id },
      }),
    ).toBe(1);
    expect(
      redemptions.map((response) => responseData<{ replayed: boolean }>(response).replayed).sort(),
    ).toEqual([false, true]);

    const raceFixture = await createApprovalRewardFixture("approval-manager-race");
    const race = await requestApproval(raceFixture);
    const [ownerHeaders, managerHeaders] = await Promise.all([
      merchantMutationHeaders(),
      merchantMutationHeaders(managerCookie),
    ]);
    const decisions = await Promise.all([
      app.inject({
        method: "POST",
        url: `/v1/organizations/${ORGANIZATION_ID}/operation-approvals/${race.publicId}/approve`,
        headers: ownerHeaders,
        payload: { reason: "Owner decision" },
      }),
      app.inject({
        method: "POST",
        url: `/v1/organizations/${ORGANIZATION_ID}/operation-approvals/${race.publicId}/reject`,
        headers: managerHeaders,
        payload: { reason: "Manager decision" },
      }),
    ]);
    expect(decisions.filter((response) => response.statusCode === 201)).toHaveLength(1);
    expect(decisions.filter((response) => response.statusCode === 409)).toHaveLength(1);
    expect(
      await prisma.client.auditLog.count({
        where: {
          targetId: (
            await prisma.client.managerApprovalChallenge.findUniqueOrThrow({
              where: { publicId: race.publicId },
            })
          ).id,
          action: {
            in: ["operation.manager_approval_granted", "operation.manager_approval_rejected"],
          },
        },
      }),
    ).toBe(1);
  });

  it("denies the next signed request and refresh after Staff user deactivation", async () => {
    const staff = await createStaffIdentity("deactivated-device-principal");
    await prisma.client.staffLocationAssignment.create({
      data: {
        organizationId: ORGANIZATION_ID,
        organizationMemberId: staff.memberId,
        locationId: LOCATION_ID,
        assignedByUserId: OWNER_ID,
      },
    });
    const lifecycleClient = await pairDevice({
      organizationId: ORGANIZATION_ID,
      organizationMemberId: staff.memberId,
      locationId: LOCATION_ID,
      label: `deactivation-${randomUUID()}`,
    });
    expect(
      (
        await signedStaffInject(app, lifecycleClient, {
          method: "GET",
          url: "/v1/staff/device-context",
        })
      ).statusCode,
    ).toBe(200);

    const browserToken = createOpaqueToken();
    await prisma.client.session.create({
      data: {
        userId: staff.userId,
        tokenHash: hashOpaqueToken(browserToken),
        expiresAt: new Date(Date.now() + 60 * 60_000),
      },
    });
    const browserCookie = `${environment.values.COOKIE_NAME}=${browserToken}`;
    const csrf = await app.inject({
      method: "GET",
      url: "/v1/auth/csrf",
      headers: { cookie: browserCookie },
    });
    const setCookie = csrf.headers["set-cookie"];
    const rawCookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    const deactivated = await app.inject({
      method: "POST",
      url: "/v1/auth/me/deactivate",
      headers: {
        origin: "http://localhost:3001",
        cookie: `${rawCookie?.split(";")[0] ?? ""}; ${browserCookie}`,
        "x-csrf-token": responseData<{ csrfToken: string }>(csrf).csrfToken,
        "content-type": "application/json",
      },
      payload: {
        commandId: randomUUID(),
        confirmation: "DEACTIVATE",
        currentPassword: staff.password,
      },
    });
    expect(deactivated.statusCode).toBe(201);
    const denied = await signedStaffInject(app, lifecycleClient, {
      method: "GET",
      url: "/v1/staff/device-context",
    });
    expect(responseCode(denied)).toBe("STAFF_USER_DEACTIVATED");
    const refresh = await signedStaffInject(app, lifecycleClient, {
      method: "POST",
      url: "/v1/staff/devices/session/refresh",
      payload: { refreshToken: lifecycleClient.refreshToken },
    });
    expect(responseCode(refresh)).toBe("STAFF_USER_DEACTIVATED");
    expect(
      (
        await prisma.client.staffDeviceSession.findUniqueOrThrow({
          where: { id: lifecycleClient.deviceSessionId },
        })
      ).revokedAt,
    ).not.toBeNull();
    const headers = await merchantMutationHeaders();
    const rePair = await app.inject({
      method: "POST",
      url: `/v1/organizations/${ORGANIZATION_ID}/device-pairing-sessions`,
      headers,
      payload: {
        staffMemberId: staff.memberId,
        locations: [{ locationId: LOCATION_ID, earningAllowed: true, redemptionAllowed: true }],
        expiresInMinutes: 10,
      },
    });
    expect(rePair.statusCode).toBe(422);
    expect(responseCode(rePair)).toBe("DEVICE_PAIRING_INVALID");
  });

  it("creates a local Staff identity without an email invitation", async () => {
    const headers = await merchantMutationHeaders();
    const created = await app.inject({
      method: "POST",
      url: `/v1/organizations/${ORGANIZATION_ID}/members`,
      headers,
      payload: { name: `QR Staff ${randomUUID().slice(0, 8)}`, role: "STAFF" },
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(responseData<Record<string, unknown>>(created)).toMatchObject({
      role: "STAFF",
      status: "ACTIVE",
      accessType: "QR",
      user: { email: null },
    });
  });

  it("serializes concurrent Staff QR regeneration and immediately revokes prior access", async () => {
    const headers = await merchantMutationHeaders();
    const qrStaff = await createStaffIdentity(`qr-regeneration-${randomUUID()}`);
    await prisma.client.staffLocationAssignment.create({
      data: {
        organizationId: ORGANIZATION_ID,
        organizationMemberId: qrStaff.memberId,
        locationId: LOCATION_ID,
        assignedByUserId: OWNER_ID,
      },
    });
    const activeClient = await pairDevice({
      organizationId: ORGANIZATION_ID,
      organizationMemberId: qrStaff.memberId,
      locationId: LOCATION_ID,
      label: `prior-device-${randomUUID()}`,
    });
    const payload = {
      staffMemberId: qrStaff.memberId,
      locations: [{ locationId: LOCATION_ID, earningAllowed: true, redemptionAllowed: true }],
      expiresInMinutes: 10,
    };
    const first = await app.inject({
      method: "POST",
      url: `/v1/organizations/${ORGANIZATION_ID}/device-pairing-sessions`,
      headers,
      payload,
    });
    expect(first.statusCode).toBe(201);
    const firstPairing = responseData<{ publicId: string }>(first);
    expect(
      (
        await prisma.client.staffDeviceSession.findUniqueOrThrow({
          where: { id: activeClient.deviceSessionId },
        })
      ).revokedAt,
    ).not.toBeNull();
    expect(
      (
        await prisma.client.staffDevice.findUniqueOrThrow({
          where: { publicId: activeClient.devicePublicId },
        })
      ).status,
    ).toBe("REVOKED");

    const oldPhoneDenied = await signedStaffInject(app, activeClient, {
      method: "GET",
      url: "/v1/staff/device-context",
    });
    expect(oldPhoneDenied.statusCode).toBe(401);
    expect(responseCode(oldPhoneDenied)).toBe("STAFF_DEVICE_REVOKED");

    const [second, third] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/v1/organizations/${ORGANIZATION_ID}/device-pairing-sessions`,
        headers,
        payload,
      }),
      app.inject({
        method: "POST",
        url: `/v1/organizations/${ORGANIZATION_ID}/device-pairing-sessions`,
        headers,
        payload,
      }),
    ]);
    expect(second.statusCode).toBe(201);
    expect(third.statusCode).toBe(201);
    const concurrentPairingIds = [
      responseData<{ publicId: string }>(second).publicId,
      responseData<{ publicId: string }>(third).publicId,
    ];
    expect(new Set(concurrentPairingIds).size).toBe(2);
    const concurrentPairings = await prisma.client.devicePairingSession.findMany({
      where: { publicId: { in: concurrentPairingIds } },
      select: { publicId: true, status: true },
    });
    expect(concurrentPairings.filter((pairing) => pairing.status === "PENDING")).toHaveLength(1);
    expect(concurrentPairings.filter((pairing) => pairing.status === "CANCELED")).toHaveLength(1);
    expect(
      (
        await prisma.client.devicePairingSession.findUniqueOrThrow({
          where: { publicId: firstPairing.publicId },
        })
      ).status,
    ).toBe("CANCELED");
    expect(
      await prisma.client.devicePairingSession.count({
        where: { intendedStaffMemberId: qrStaff.memberId, status: "PENDING" },
      }),
    ).toBe(1);
  });

  it("denies active devices after membership or Location assignment revocation", async () => {
    const headers = await merchantMutationHeaders();
    const suspendedStaff = await createStaffIdentity("suspended-device-principal");
    await prisma.client.staffLocationAssignment.create({
      data: {
        organizationId: ORGANIZATION_ID,
        organizationMemberId: suspendedStaff.memberId,
        locationId: LOCATION_ID,
        assignedByUserId: OWNER_ID,
      },
    });
    const suspendedClient = await pairDevice({
      organizationId: ORGANIZATION_ID,
      organizationMemberId: suspendedStaff.memberId,
      locationId: LOCATION_ID,
      label: `membership-revocation-${randomUUID()}`,
    });
    const suspended = await app.inject({
      method: "PATCH",
      url: `/v1/organizations/${ORGANIZATION_ID}/members/${suspendedStaff.memberId}`,
      headers,
      payload: { status: "SUSPENDED" },
    });
    expect(suspended.statusCode).toBe(200);
    expect(
      responseCode(
        await signedStaffInject(app, suspendedClient, {
          method: "GET",
          url: "/v1/staff/device-context",
        }),
      ),
    ).toBe("STAFF_MEMBERSHIP_INACTIVE");

    const unassignedStaff = await createStaffIdentity("unassigned-device-principal");
    await prisma.client.staffLocationAssignment.create({
      data: {
        organizationId: ORGANIZATION_ID,
        organizationMemberId: unassignedStaff.memberId,
        locationId: LOCATION_ID,
        assignedByUserId: OWNER_ID,
      },
    });
    const unassignedClient = await pairDevice({
      organizationId: ORGANIZATION_ID,
      organizationMemberId: unassignedStaff.memberId,
      locationId: LOCATION_ID,
      label: `assignment-revocation-${randomUUID()}`,
    });
    const revoked = await app.inject({
      method: "DELETE",
      url: `/v1/organizations/${ORGANIZATION_ID}/members/${unassignedStaff.memberId}/location-assignments/${LOCATION_ID}`,
      headers,
      payload: {},
    });
    expect(revoked.statusCode).toBe(200);
    expect(
      responseCode(
        await signedStaffInject(app, unassignedClient, {
          method: "POST",
          url: "/v1/staff/memberships/resolve",
          payload: { qrPayload: membershipQr },
        }),
      ),
    ).toBe("STAFF_LOCATION_ASSIGNMENT_INVALID");
  });

  it("blocks signed Staff loyalty mutations when merchant billing is restricted", async () => {
    await prisma.client.organizationBillingProfile.update({
      where: { organizationId: ORGANIZATION_ID },
      data: { subscriptionStatus: "SUSPENDED", trialEnd: null, gracePeriodEnd: null },
    });
    try {
      const blocked = await signedStaffInject(app, client, {
        method: "POST",
        url: "/v1/staff/operations/stamps",
        idempotencyKey: randomUUID(),
        payload: {
          qrPayload: membershipQr,
          amount: 1,
          purchaseAmountMinor: 10_000,
          purchaseCurrency: "IQD",
        },
      });
      expect(blocked.statusCode).toBe(422);
      expect(responseCode(blocked)).toBe("OPERATION_BILLING_BLOCKED");
    } finally {
      await prisma.client.organizationBillingProfile.update({
        where: { organizationId: ORGANIZATION_ID },
        data: { subscriptionStatus: "ACTIVE" },
      });
    }
  });

  it("enforces immediate device revocation", async () => {
    await prisma.client.staffDevice.update({
      where: { publicId: client.devicePublicId },
      data: { status: "REVOKED", revokedAt: new Date(), revocationReason: "HTTP boundary test" },
    });
    const denied = await signedStaffInject(app, client, {
      method: "GET",
      url: "/v1/staff/device-context",
    });
    expect(denied.statusCode).toBe(401);
    expect(responseCode(denied)).toBe("STAFF_DEVICE_REVOKED");
  });
});
