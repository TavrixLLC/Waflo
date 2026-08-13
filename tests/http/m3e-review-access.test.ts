import { createHmac, randomBytes, randomUUID } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApplication } from "../../apps/api/src/app.js";
import { CustomerSecurityService } from "../../apps/api/src/customer/customer-security.service.js";
import { PrismaService } from "../../apps/api/src/database/prisma.service.js";
import {
  REVIEW_FIXTURE_IDS,
  REVIEW_SCENARIOS,
} from "../../apps/api/src/review-access/review-session.js";
import { createPairingToken } from "../../packages/staff-device-security/src/index.js";
import {
  createEphemeralStaffDeviceKeypair,
  type PairedStaffTestClient,
  signedStaffInject,
  signPairingMessage,
} from "../helpers/w4-staff-test-client.js";

function responseData<T>(response: { json(): unknown }): T {
  return (response.json() as { data: T }).data;
}

function responseCode(response: { json(): unknown }): string | undefined {
  const body = response.json() as { error?: { code?: string }; code?: string };
  return body.error?.code ?? body.code;
}

function reviewCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  const value = [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
  return `${value.slice(0, 4)}-${value.slice(4)}`;
}

describe.sequential("M3E Review Access HTTP isolation", () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let customerSecurity: CustomerSecurityService;
  let code = "";
  let reviewClient: PairedStaffTestClient;
  let normalClient: PairedStaffTestClient;
  let externalMembershipQr = "";

  async function completePairing(
    claim: {
      pairingPublicId: string;
      challenge: string;
      message: string;
    },
    keypair: ReturnType<typeof createEphemeralStaffDeviceKeypair>,
    displayName: string,
  ): Promise<PairedStaffTestClient> {
    const complete = await app.inject({
      method: "POST",
      url: "/v1/staff/devices/pairing/complete",
      headers: { "content-type": "application/json" },
      payload: {
        pairingPublicId: claim.pairingPublicId,
        challenge: claim.challenge,
        signature: signPairingMessage(keypair.privateKey, claim.message),
        displayName,
      },
    });
    expect(complete.statusCode).toBe(200);
    const data = responseData<{
      device: { publicId: string };
      session: { id: string; token: string };
      context: { organizationId: string; locationId: string };
    }>(complete);
    return {
      ...keypair,
      devicePublicId: data.device.publicId,
      deviceSessionId: data.session.id,
      accessToken: data.session.token,
      organizationId: data.context.organizationId,
      locationId: data.context.locationId,
    };
  }

  async function pairNormalDevice(): Promise<PairedStaffTestClient> {
    const member = await prisma.client.organizationMember.findFirstOrThrow({
      where: {
        organizationId: { not: REVIEW_FIXTURE_IDS.organization },
        status: "ACTIVE",
        user: { status: "ACTIVE" },
        staffLocationAssignments: { some: { active: true } },
      },
      include: { staffLocationAssignments: { where: { active: true }, take: 1 } },
    });
    const assignment = member.staffLocationAssignments[0];
    if (!assignment) throw new Error("Normal Staff assignment fixture missing.");
    const pairingPublicId = randomUUID();
    const pairing = createPairingToken({ publicId: pairingPublicId, environmentId: "test" });
    await prisma.client.devicePairingSession.create({
      data: {
        publicId: pairingPublicId,
        organizationId: member.organizationId,
        intendedStaffMemberId: member.id,
        pairingTokenHash: pairing.tokenHash,
        requestedLocationAssignments: [
          {
            locationId: assignment.locationId,
            earningAllowed: assignment.earningAllowed,
            redemptionAllowed: assignment.redemptionAllowed,
          },
        ],
        createdByUserId: member.userId,
        expiresAt: new Date(Date.now() + 5 * 60_000),
      },
    });
    const keypair = createEphemeralStaffDeviceKeypair();
    const response = await app.inject({
      method: "POST",
      url: "/v1/staff/devices/pairing/claim",
      headers: { "content-type": "application/json" },
      payload: {
        pairingToken: pairing.token,
        installationId: `normal-review-boundary-${randomUUID()}`,
        publicKey: keypair.publicKeyPem,
        platform: "TEST_CLIENT",
        appVersion: "1.0.0",
      },
    });
    expect(response.statusCode).toBe(200);
    return completePairing(responseData(response), keypair, "Normal Review Boundary Device");
  }

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.TEST_STAFF_CLIENT_ENABLED = "true";
    process.env.REVIEW_ACCESS_ENABLED = "true";
    process.env.REVIEW_TENANT_SLUG = "waflo-app-review";
    process.env.REVIEW_ACCESS_ATTEMPT_LIMIT = "5";
    process.env.REVIEW_ACCESS_ATTEMPT_WINDOW_SECONDS = "900";
    process.env.REVIEW_ACCESS_EXPIRES_AT = new Date(Date.now() + 60 * 60_000).toISOString();
    code = reviewCode();
    process.env.REVIEW_ACCESS_CODE_HASH = createHmac(
      "sha256",
      process.env.DEVICE_SESSION_SECRET ?? "",
    )
      .update(`waflo-review-access-v1\n${code}`, "utf8")
      .digest("hex");
    process.argv.push("--confirm-review-tenant");
    await import("../../scripts/provision-m3e-review-access.js");

    app = await createApiApplication({ logger: false });
    prisma = app.get(PrismaService);
    customerSecurity = app.get(CustomerSecurityService);
    const reviewKeypair = createEphemeralStaffDeviceKeypair();
    const authorize = await app.inject({
      method: "POST",
      url: "/v1/staff/review-access/authorize",
      headers: { "content-type": "application/json" },
      payload: {
        reviewAccessCode: code,
        installationId: `review-http-${randomUUID()}`,
        publicKey: reviewKeypair.publicKeyPem,
        platform: "TEST_CLIENT",
        appVersion: "1.0.0",
      },
    });
    expect(authorize.statusCode).toBe(200);
    const challenge = responseData<{
      pairingPublicId: string;
      challenge: string;
      message: string;
      signatureAlgorithm: string;
    }>(authorize);
    expect(challenge.signatureAlgorithm).toBe("Ed25519");
    reviewClient = await completePairing(challenge, reviewKeypair, "Review HTTP Device");
    normalClient = await pairNormalDevice();

    const program = await prisma.client.loyaltyProgram.findFirstOrThrow({
      where: {
        organizationId: { not: REVIEW_FIXTURE_IDS.organization },
        currentPublishedVersionId: { not: null },
      },
    });
    const publishedVersionId = program.currentPublishedVersionId;
    if (!publishedVersionId) {
      throw new Error("Published isolation fixture version missing.");
    }
    const credential = customerSecurity.createCredential(1);
    const customerId = randomUUID();
    const membershipId = randomUUID();
    await prisma.client.$transaction(async (transaction) => {
      await transaction.customer.create({
        data: {
          id: customerId,
          organizationId: program.organizationId,
          displayName: "External isolation fixture",
          preferredLocale: "EN",
        },
      });
      await transaction.membership.create({
        data: {
          id: membershipId,
          organizationId: program.organizationId,
          customerId,
          programId: program.id,
          enrollmentProgramVersionId: publishedVersionId,
          publicMembershipId: `mem_${randomUUID().replaceAll("-", "")}`,
        },
      });
      await transaction.membershipProgressProjection.create({
        data: { membershipId, organizationId: program.organizationId },
      });
      await transaction.membershipCredential.create({
        data: {
          organizationId: program.organizationId,
          membershipId,
          credentialVersion: 1,
          publicCredentialId: credential.publicCredentialId,
          secretVersion: credential.secretVersion,
          secretHash: credential.secretHash,
          status: "ACTIVE",
        },
      });
    });
    externalMembershipQr = credential.payload;
  });

  afterAll(async () => {
    code = "";
    delete process.env.REVIEW_ACCESS_CODE_HASH;
    await app?.close();
  });

  it("authorizes a signed review session and returns only fixed fake scenarios", async () => {
    const context = await signedStaffInject(app, reviewClient, {
      method: "GET",
      url: "/v1/staff/device-context",
    });
    expect(context.statusCode).toBe(200);
    expect(responseData<Record<string, unknown>>(context).sessionMode).toBe("REVIEW");

    const response = await signedStaffInject(app, reviewClient, {
      method: "GET",
      url: "/v1/staff/review/scenarios",
    });
    expect(response.statusCode).toBe(200);
    const data = responseData<{
      sessionMode: string;
      scenarios: Array<{
        id: string;
        progress: number;
        goal: number;
        rewardReady: boolean;
        qrPayload: string;
      }>;
    }>(response);
    expect(data.sessionMode).toBe("REVIEW");
    expect(data.scenarios).toHaveLength(REVIEW_SCENARIOS.length);
    expect(data.scenarios.map((scenario) => scenario.id)).toEqual(
      REVIEW_SCENARIOS.map((scenario) => scenario.id),
    );
    expect(data.scenarios.map((scenario) => scenario.progress)).toEqual([0, 5, 8, 5, 0, 0, 0]);
    expect(data.scenarios.every((scenario) => scenario.goal === 8)).toBe(true);
    expect(data.scenarios.every((scenario) => scenario.qrPayload.length >= 40)).toBe(true);
  });

  it("blocks normal sessions, altered organizations, and cross-tenant customer QR", async () => {
    const normal = await signedStaffInject(app, normalClient, {
      method: "GET",
      url: "/v1/staff/review/scenarios",
    });
    expect(normal.statusCode).toBe(403);
    expect(responseCode(normal)).toBe("REVIEW_SESSION_INVALID");

    const altered = await signedStaffInject(
      app,
      { ...reviewClient, organizationId: normalClient.organizationId },
      { method: "GET", url: "/v1/staff/review/scenarios" },
    );
    expect(altered.statusCode).not.toBe(200);

    const externalQr = await signedStaffInject(app, reviewClient, {
      method: "POST",
      url: "/v1/staff/memberships/resolve",
      payload: { qrPayload: externalMembershipQr },
    });
    expect(externalQr.statusCode).toBe(404);
    expect(responseCode(externalQr)).toBe("MEMBERSHIP_CREDENTIAL_INVALID");
  });

  it("accepts only enumerated reset/select commands and creates no wallet or billing side effects", async () => {
    const invalid = await signedStaffInject(app, reviewClient, {
      method: "POST",
      url: "/v1/staff/review/scenarios/select",
      payload: { scenarioId: "ARBITRARY_RECORD", commandId: randomUUID() },
    });
    expect(invalid.statusCode).toBe(422);

    const selected = await signedStaffInject(app, reviewClient, {
      method: "POST",
      url: "/v1/staff/review/scenarios/select",
      payload: { scenarioId: "BILLING_BLOCKED", commandId: randomUUID() },
    });
    expect(selected.statusCode).toBe(200);
    expect(responseData<{ id: string; progress: number }>(selected)).toMatchObject({
      id: "BILLING_BLOCKED",
      progress: 0,
    });

    const reset = await signedStaffInject(app, reviewClient, {
      method: "POST",
      url: "/v1/staff/review/reset",
      payload: { commandId: randomUUID() },
    });
    expect(reset.statusCode).toBe(200);
    expect(responseData<{ scenarioCount: number }>(reset).scenarioCount).toBe(7);
    expect(
      await prisma.client.walletPassInstance.count({
        where: { organizationId: REVIEW_FIXTURE_IDS.organization },
      }),
    ).toBe(0);
    const billing = await prisma.client.organizationBillingProfile.findUniqueOrThrow({
      where: { organizationId: REVIEW_FIXTURE_IDS.organization },
    });
    expect(billing.stripeCustomerId).toBeNull();
    expect(billing.subscriptionStatus).toBe("ACTIVE");
  });

  it("rate-limits repeated failures per source and never audits the plaintext credential", async () => {
    const wrong = reviewCode();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/staff/review-access/authorize",
        headers: { "content-type": "application/json" },
        payload: {
          reviewAccessCode: wrong,
          installationId: `wrong-${randomUUID()}`,
          publicKey: createEphemeralStaffDeviceKeypair().publicKeyPem,
          platform: "TEST_CLIENT",
          appVersion: "1.0.0",
        },
      });
      expect(response.statusCode).toBe(401);
      expect(responseCode(response)).toBe("REVIEW_ACCESS_INVALID");
    }
    const limited = await app.inject({
      method: "POST",
      url: "/v1/staff/review-access/authorize",
      headers: { "content-type": "application/json" },
      payload: {
        reviewAccessCode: wrong,
        installationId: `limited-${randomUUID()}`,
        publicKey: createEphemeralStaffDeviceKeypair().publicKeyPem,
        platform: "TEST_CLIENT",
        appVersion: "1.0.0",
      },
    });
    expect(limited.statusCode).toBe(429);
    expect(responseCode(limited)).toBe("REVIEW_ACCESS_RATE_LIMITED");
    const events = await prisma.client.securityEvent.findMany({
      where: { eventType: "review.authorization_failed" },
      select: { metadata: true },
    });
    expect(events.length).toBeGreaterThanOrEqual(5);
    expect(JSON.stringify(events)).not.toContain(wrong);
    expect(JSON.stringify(events)).not.toContain(code);
  });
});
