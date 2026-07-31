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
  signPairingMessage,
  signedStaffInject,
} from "../helpers/w4-staff-test-client.js";

const ORGANIZATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const STAFF_USER_ID = "33333333-3333-4333-8333-333333333333";
const LOCATION_ID = "a1111111-1111-4111-8111-111111111111";
const COOKIE_PROGRAM_ID = "c0000000-0000-4000-8000-000000000001";
const COOKIE_VERSION_ID = "c1000000-0000-4000-8000-000000000001";

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
  let customerSecurity: CustomerSecurityService;
  let client: PairedStaffTestClient;
  let membershipQr = "";
  let membershipId = "";
  let membershipPublicId = "";
  const startingProgress = 0;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.TEST_STAFF_CLIENT_ENABLED = "true";
    process.env.APPLE_WALLET_MODE = "TEST_ADAPTER";
    process.env.GOOGLE_WALLET_MODE = "TEST_ADAPTER";
    app = await createApiApplication({ logger: false });
    prisma = app.get(PrismaService);
    customerSecurity = app.get(CustomerSecurityService);
    const customerId = randomUUID();
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
          programId: COOKIE_PROGRAM_ID,
          enrollmentProgramVersionId: COOKIE_VERSION_ID,
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
    const pairingPublicId = randomUUID();
    const pairing = createPairingToken({
      publicId: pairingPublicId,
      environmentId: "test",
    });
    await prisma.client.devicePairingSession.updateMany({
      where: {
        intendedStaffMemberId: staff.id,
        status: { in: ["PENDING", "CLAIMED"] },
      },
      data: { status: "CANCELED" },
    });
    await prisma.client.devicePairingSession.create({
      data: {
        publicId: pairingPublicId,
        organizationId: ORGANIZATION_ID,
        intendedStaffMemberId: staff.id,
        pairingTokenHash: pairing.tokenHash,
        requestedLocationAssignments: [
          {
            locationId: LOCATION_ID,
            earningAllowed: true,
            redemptionAllowed: true,
          },
        ],
        deviceLabelSuggestion: "Ephemeral W4 HTTP client",
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
        installationId: `w4-http-${randomUUID()}`,
        publicKey: keypair.publicKeyPem,
        platform: "TEST_CLIENT",
        appVersion: "w4-http/1.0",
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
        displayName: "Ephemeral W4 HTTP client",
      },
    });
    expect(complete.statusCode).toBe(200);
    const paired = responseData<{
      device: { publicId: string };
      session: { id: string; token: string };
      context: { organizationId: string; locationId: string };
    }>(complete);
    client = {
      ...keypair,
      devicePublicId: paired.device.publicId,
      deviceSessionId: paired.session.id,
      accessToken: paired.session.token,
      organizationId: paired.context.organizationId,
      locationId: paired.context.locationId,
    };
  });

  afterAll(async () => {
    await app?.close();
  });

  it("pairs an ephemeral key, authenticates the device, and resolves a QR without email", async () => {
    const context = await signedStaffInject(app, client, {
      method: "GET",
      url: "/v1/staff/device-context",
    });
    expect(context.statusCode).toBe(200);
    expect(responseData<{ locationId: string }>(context).locationId).toBe(LOCATION_ID);

    const resolved = await signedStaffInject(app, client, {
      method: "POST",
      url: "/v1/staff/memberships/resolve",
      payload: { qrPayload: membershipQr },
    });
    expect(resolved.statusCode).toBe(200);
    const body = responseData<Record<string, unknown>>(resolved);
    expect(body).toMatchObject({
      membershipPublicId,
      progress: startingProgress,
      goal: 8,
      rewardReady: false,
    });
    expect(JSON.stringify(body).toLocaleLowerCase("en-US")).not.toContain("email");
    expect(JSON.stringify(body)).not.toContain(membershipQr);
  });

  it("issues atomically, supports compatible idempotent replay, and rejects conflicts", async () => {
    const commandId = randomUUID();
    const payload = { qrPayload: membershipQr, amount: 1 };
    const issued = await signedStaffInject(app, client, {
      method: "POST",
      url: "/v1/staff/operations/stamps",
      idempotencyKey: commandId,
      payload,
    });
    expect(issued.statusCode).toBe(200);
    expect(responseData<{ progress: number }>(issued).progress).toBe(startingProgress + 1);

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
      payload: { qrPayload: membershipQr, amount: 2 },
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
