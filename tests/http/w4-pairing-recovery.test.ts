import { generateKeyPairSync, type KeyObject, randomUUID, sign } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApplication } from "../../apps/api/src/app.js";
import { PrismaService } from "../../apps/api/src/database/prisma.service.js";
import { createPairingToken } from "../../packages/staff-device-security/src/index.js";

const ORGANIZATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const STAFF_USER_ID = "33333333-3333-4333-8333-333333333333";
const LOCATION_ID = "a1111111-1111-4111-8111-111111111111";

function data<T>(response: { json(): unknown }): T {
  return (response.json() as { data: T }).data;
}

function code(response: { json(): unknown }): string | undefined {
  return (response.json() as { error?: { code?: string } }).error?.code;
}

describe.sequential("W4-to-M1 pairing challenge recovery HTTP contract", () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let staffMemberId: string;
  let pairingPublicId: string;
  let pairingToken: ReturnType<typeof createPairingToken>;
  let installationId: string;
  let privateKey: KeyObject;
  let publicKeyPem: string;
  let claimData: {
    pairingPublicId: string;
    challenge: string;
    challengeExpiresAt: string;
    signatureAlgorithm: "Ed25519";
    message: string;
  };

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.TEST_STAFF_CLIENT_ENABLED = "true";
    app = await createApiApplication({ logger: false });
    prisma = app.get(PrismaService);
    const member = await prisma.client.organizationMember.findFirstOrThrow({
      where: { organizationId: ORGANIZATION_ID, userId: STAFF_USER_ID },
    });
    staffMemberId = member.id;
    await prisma.client.devicePairingSession.updateMany({
      where: { intendedStaffMemberId: staffMemberId, status: { in: ["PENDING", "CLAIMED"] } },
      data: { status: "CANCELED" },
    });
    pairingPublicId = randomUUID();
    pairingToken = createPairingToken({ publicId: pairingPublicId, environmentId: "test" });
    await prisma.client.devicePairingSession.create({
      data: {
        publicId: pairingPublicId,
        organizationId: ORGANIZATION_ID,
        intendedStaffMemberId: staffMemberId,
        pairingTokenHash: pairingToken.tokenHash,
        requestedLocationAssignments: [
          { locationId: LOCATION_ID, earningAllowed: true, redemptionAllowed: true },
        ],
        createdByUserId: OWNER_ID,
        expiresAt: new Date(Date.now() + 10 * 60_000),
      },
    });
    const keys = generateKeyPairSync("ed25519");
    privateKey = keys.privateKey;
    publicKeyPem = keys.publicKey.export({ format: "pem", type: "spki" }).toString();
    installationId = `m1-recovery-${randomUUID()}`;
    const claim = await app.inject({
      method: "POST",
      url: "/v1/staff/devices/pairing/claim",
      payload: {
        pairingToken: pairingToken.token,
        installationId,
        publicKey: publicKeyPem,
        platform: "ANDROID",
        appVersion: "1.0.0",
      },
    });
    expect(claim.statusCode).toBe(200);
    claimData = data(claim);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.client.staffDevice.deleteMany({ where: { installationId } });
      await prisma.client.devicePairingSession.deleteMany({
        where: { publicId: pairingPublicId },
      });
    }
    await app?.close();
  });

  it("recovers the active claimed challenge without returning the pairing secret", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/staff/devices/pairing/challenge",
      payload: { pairingPublicId },
    });
    expect(response.statusCode).toBe(200);
    expect(data(response)).toEqual(claimData);
    const serialized = JSON.stringify(response.json());
    expect(serialized).not.toContain(pairingToken.secret);
    expect(serialized).not.toContain(pairingToken.token);
  });

  it("is stable under repeated recovery and ambiguous claim retry", async () => {
    const repeated = await Promise.all([
      app.inject({
        method: "POST",
        url: "/v1/staff/devices/pairing/challenge",
        payload: { pairingPublicId },
      }),
      app.inject({
        method: "POST",
        url: "/v1/staff/devices/pairing/challenge",
        payload: { pairingPublicId },
      }),
    ]);
    expect(repeated.map((response) => response.statusCode)).toEqual([200, 200]);
    const [firstRecovery, secondRecovery] = repeated;
    if (!firstRecovery || !secondRecovery) throw new Error("Recovery responses are missing.");
    expect(data(firstRecovery)).toEqual(data(secondRecovery));

    const retriedClaim = await app.inject({
      method: "POST",
      url: "/v1/staff/devices/pairing/claim",
      payload: {
        pairingToken: pairingToken.token,
        installationId,
        publicKey: publicKeyPem,
        platform: "ANDROID",
        appVersion: "1.0.0",
      },
    });
    expect(retriedClaim.statusCode).toBe(409);
    const recovered = await app.inject({
      method: "POST",
      url: "/v1/staff/devices/pairing/challenge",
      payload: { pairingPublicId },
    });
    expect(recovered.statusCode).toBe(200);
    expect(data(recovered)).toEqual(claimData);
  });

  it("serializes concurrent recovery and completion and keeps completion single-use", async () => {
    const completionPayload = {
      pairingPublicId,
      challenge: claimData.challenge,
      signature: sign(null, Buffer.from(claimData.message), privateKey).toString("base64url"),
      displayName: "M1 recovery fixture",
    };
    const [recovery, completion] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/v1/staff/devices/pairing/challenge",
        payload: { pairingPublicId },
      }),
      app.inject({
        method: "POST",
        url: "/v1/staff/devices/pairing/complete",
        payload: completionPayload,
      }),
    ]);
    expect(completion.statusCode).toBe(200);
    expect([200, 410]).toContain(recovery.statusCode);
    const replay = await app.inject({
      method: "POST",
      url: "/v1/staff/devices/pairing/complete",
      payload: completionPayload,
    });
    expect(replay.statusCode).toBe(410);
  });

  it("returns the same safe unavailable response after completion and for unknown public IDs", async () => {
    const responses = await Promise.all([
      app.inject({
        method: "POST",
        url: "/v1/staff/devices/pairing/challenge",
        payload: { pairingPublicId },
      }),
      app.inject({
        method: "POST",
        url: "/v1/staff/devices/pairing/challenge",
        payload: { pairingPublicId: randomUUID() },
      }),
    ]);
    for (const response of responses) {
      expect(response.statusCode).toBe(410);
      expect(code(response)).toBe("DEVICE_PAIRING_EXPIRED");
      const serialized = JSON.stringify(response.json());
      expect(serialized).not.toContain(ORGANIZATION_ID);
      expect(serialized).not.toContain(staffMemberId);
    }
  });

  it("expires a claimed challenge and never recovers it", async () => {
    const publicId = randomUUID();
    const token = createPairingToken({ publicId, environmentId: "test" });
    await prisma.client.devicePairingSession.create({
      data: {
        publicId,
        organizationId: ORGANIZATION_ID,
        intendedStaffMemberId: staffMemberId,
        pairingTokenHash: token.tokenHash,
        requestedLocationAssignments: [
          { locationId: LOCATION_ID, earningAllowed: true, redemptionAllowed: true },
        ],
        createdByUserId: OWNER_ID,
        expiresAt: new Date(Date.now() + 10 * 60_000),
      },
    });
    const keys = generateKeyPairSync("ed25519");
    const expiredInstallationId = `m1-expired-${randomUUID()}`;
    const claim = await app.inject({
      method: "POST",
      url: "/v1/staff/devices/pairing/claim",
      payload: {
        pairingToken: token.token,
        installationId: expiredInstallationId,
        publicKey: keys.publicKey.export({ format: "pem", type: "spki" }).toString(),
        platform: "IOS",
        appVersion: "1.0.0",
      },
    });
    expect(claim.statusCode).toBe(200);
    await prisma.client.devicePairingSession.update({
      where: { publicId },
      data: { challengeExpiresAt: new Date(Date.now() - 1_000) },
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/staff/devices/pairing/challenge",
      payload: { pairingPublicId: publicId },
    });
    expect(response.statusCode).toBe(410);
    expect(code(response)).toBe("DEVICE_PAIRING_EXPIRED");
    expect(
      await prisma.client.devicePairingSession.findUniqueOrThrow({ where: { publicId } }),
    ).toMatchObject({ status: "EXPIRED" });
    await prisma.client.devicePairingSession.delete({ where: { publicId } });
  });
});
