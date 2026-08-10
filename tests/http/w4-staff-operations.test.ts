import { randomUUID } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApplication } from "../../apps/api/src/app.js";
import { CustomerSecurityService } from "../../apps/api/src/customer/customer-security.service.js";
import { PrismaService } from "../../apps/api/src/database/prisma.service.js";
import { createPairingToken } from "../../packages/staff-device-security/src/index.js";
import {
  createEphemeralStaffDeviceKeypair,
  type PairedStaffTestClient,
  signedStaffInject,
  signPairingMessage,
} from "../helpers/w4-staff-test-client.js";

const ORGANIZATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const STAFF_USER_ID = "33333333-3333-4333-8333-333333333333";
const LOCATION_ID = "a1111111-1111-4111-8111-111111111111";
const SECOND_ORGANIZATION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SECOND_LOCATION_ID = "b1111111-1111-4111-8111-111111111111";
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

type PairedStaffContractClient = PairedStaffTestClient & {
  readonly pairingChallengeSignatureAlgorithm: string;
};

describe.sequential("W4 signed Staff HTTP operations", () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let customerSecurity: CustomerSecurityService;
  let client: PairedStaffContractClient;
  let otherDeviceClient: PairedStaffContractClient;
  let otherOrganizationClient: PairedStaffContractClient;
  let membershipQr = "";
  let membershipId = "";
  let membershipPublicId = "";
  let customerId = "";
  let completedCommandId = "";
  const startingProgress = 0;

  async function pairDevice(input: {
    organizationId: string;
    organizationMemberId: string;
    locationId: string;
    label: string;
  }): Promise<PairedStaffContractClient> {
    const pairingPublicId = randomUUID();
    const pairing = createPairingToken({
      publicId: pairingPublicId,
      environmentId: "test",
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
    const claimed = responseData<{
      pairingPublicId: string;
      challenge: string;
      message: string;
    }>(claim);
    const recovery = await app.inject({
      method: "POST",
      url: "/v1/staff/devices/pairing/challenge",
      headers: { "content-type": "application/json" },
      payload: { pairingPublicId: claimed.pairingPublicId },
    });
    expect(recovery.statusCode).toBe(200);
    const challenge = responseData<{
      pairingPublicId: string;
      challenge: string;
      message: string;
      signatureAlgorithm: string;
    }>(recovery);
    expect(challenge).toMatchObject({
      pairingPublicId: claimed.pairingPublicId,
      challenge: claimed.challenge,
      message: claimed.message,
    });
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
      session: { id: string; token: string };
      context: { organizationId: string; locationId: string };
    }>(complete);
    return {
      ...keypair,
      devicePublicId: paired.device.publicId,
      deviceSessionId: paired.session.id,
      accessToken: paired.session.token,
      organizationId: paired.context.organizationId,
      locationId: paired.context.locationId,
      pairingChallengeSignatureAlgorithm: challenge.signatureAlgorithm,
    };
  }

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.TEST_STAFF_CLIENT_ENABLED = "true";
    process.env.APPLE_WALLET_MODE = "TEST_ADAPTER";
    process.env.GOOGLE_WALLET_MODE = "TEST_ADAPTER";
    app = await createApiApplication({ logger: false });
    prisma = app.get(PrismaService);
    customerSecurity = app.get(CustomerSecurityService);
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
    const otherOrganizationMember = await prisma.client.organizationMember.findFirstOrThrow({
      where: { organizationId: SECOND_ORGANIZATION_ID, userId: OWNER_ID },
    });
    await prisma.client.staffLocationAssignment.upsert({
      where: {
        organizationMemberId_locationId: {
          organizationMemberId: otherOrganizationMember.id,
          locationId: SECOND_LOCATION_ID,
        },
      },
      update: { active: true, earningAllowed: true, redemptionAllowed: true, revokedAt: null },
      create: {
        organizationId: SECOND_ORGANIZATION_ID,
        organizationMemberId: otherOrganizationMember.id,
        locationId: SECOND_LOCATION_ID,
        earningAllowed: true,
        redemptionAllowed: true,
        assignedByUserId: OWNER_ID,
      },
    });
    otherOrganizationClient = await pairDevice({
      organizationId: SECOND_ORGANIZATION_ID,
      organizationMemberId: otherOrganizationMember.id,
      locationId: SECOND_LOCATION_ID,
      label: "m2-other-tenant-client",
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it("pairs through canonical Ed25519 challenge recovery and resolves localized data", async () => {
    expect(client.pairingChallengeSignatureAlgorithm).toBe("Ed25519");

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
    const pairing = createPairingToken({ publicId: pairingPublicId, environmentId: "test" });
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
    expect(responseCode(denied)).toBe("STAFF_DEVICE_NOT_ACTIVE");
  });
});
