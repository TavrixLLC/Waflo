import { createHash, randomUUID } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApiApplication } from "../../apps/api/src/app.js";
import { AuditService } from "../../apps/api/src/audit/audit.service.js";
import type { WafloRequest } from "../../apps/api/src/common/request-context.js";
import { CustomerSecurityService } from "../../apps/api/src/customer/customer-security.service.js";
import { PrismaService } from "../../apps/api/src/database/prisma.service.js";
import { LoyaltyOperationService } from "../../apps/api/src/loyalty/loyalty-operation.service.js";
import { OperationalWorker } from "../../apps/operational-worker/src/main.js";
import { parseEnvironment } from "../../packages/config/src/index.js";
import { canonicalJson } from "../../packages/loyalty-ledger/src/index.js";

const ORGANIZATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const LOCATION_ID = "a1111111-1111-4111-8111-111111111111";
const DEVICE_ID = "80000000-0000-4000-8000-000000000001";
const DEVICE_SESSION_ID = "82000000-0000-4000-8000-000000000001";
const COOKIE_PROGRAM_ID = "c0000000-0000-4000-8000-000000000001";
const COOKIE_VERSION_ID = "c1000000-0000-4000-8000-000000000001";

describe.sequential("W4 Repair Round 1 operational failures", () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let loyalty: LoyaltyOperationService;
  let security: CustomerSecurityService;
  let audit: AuditService;
  let context: Parameters<LoyaltyOperationService["issueStamps"]>[0];

  const request = {
    id: "w4-repair-failure",
    requestId: "w4-repair-failure",
    headers: {},
    ip: "127.0.0.1",
  } as unknown as WafloRequest;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.TEST_STAFF_CLIENT_ENABLED = "true";
    app = await createApiApplication({ logger: false });
    prisma = app.get(PrismaService);
    loyalty = app.get(LoyaltyOperationService);
    security = app.get(CustomerSecurityService);
    audit = app.get(AuditService);
    const device = await prisma.client.staffDevice.findUniqueOrThrow({ where: { id: DEVICE_ID } });
    await prisma.client.staffDevice.update({
      where: { id: DEVICE_ID },
      data: { status: "ACTIVE", revokedAt: null, revocationReason: null },
    });
    context = {
      organizationId: ORGANIZATION_ID,
      organizationMemberId: device.organizationMemberId,
      role: "STAFF",
      locationId: LOCATION_ID,
      deviceId: DEVICE_ID,
      devicePublicId: device.publicId,
      deviceSessionId: DEVICE_SESSION_ID,
      platform: "TEST_CLIENT",
      requestId: "w4-repair-failure",
    };
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await app?.close();
  });

  async function createMembership() {
    const customerId = randomUUID();
    const membershipId = randomUUID();
    const credential = security.createCredential(1);
    await prisma.client.$transaction(async (transaction) => {
      await transaction.customer.create({
        data: {
          id: customerId,
          organizationId: ORGANIZATION_ID,
          displayName: "W4 failure fixture",
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
          publicMembershipId: `mem_${randomUUID().replaceAll("-", "")}`,
        },
      });
      await transaction.membershipProgressProjection.create({
        data: { membershipId, organizationId: ORGANIZATION_ID },
      });
      await transaction.membershipCredential.create({
        data: {
          organizationId: ORGANIZATION_ID,
          membershipId,
          credentialVersion: 1,
          publicCredentialId: credential.publicCredentialId,
          secretVersion: credential.secretVersion,
          secretHash: credential.secretHash,
          status: "ACTIVE",
        },
      });
    });
    return { membershipId, qrPayload: credential.payload };
  }

  function stampFingerprint(qrPayload: string, amount: number) {
    return createHash("sha256")
      .update(
        canonicalJson({
          type: "ISSUE_STAMP",
          qr: createHash("sha256").update(qrPayload, "utf8").digest("hex"),
          amount,
          purchaseAmountMinor: null,
          purchaseCurrency: null,
          merchantTransactionReferenceDigest: null,
          managerOverride: null,
        }),
        "utf8",
      )
      .digest("hex");
  }

  it("persists a policy failure and replays the same code while conflicting a changed payload", async () => {
    const fixture = await createMembership();
    const commandId = randomUUID();
    const first = loyalty.issueStamps(
      context,
      commandId,
      { qrPayload: fixture.qrPayload, amount: 6 },
      request,
    );
    await expect(first).rejects.toMatchObject({ code: "STAMP_OPERATION_LIMIT_EXCEEDED" });
    const stored = await prisma.client.loyaltyOperationCommand.findUniqueOrThrow({
      where: {
        organizationId_idempotencyKey: {
          organizationId: ORGANIZATION_ID,
          idempotencyKey: commandId,
        },
      },
    });
    expect(stored).toMatchObject({
      status: "FAILED",
      safeFailureCode: "STAMP_OPERATION_LIMIT_EXCEEDED",
    });
    await expect(
      loyalty.issueStamps(context, commandId, { qrPayload: fixture.qrPayload, amount: 6 }, request),
    ).rejects.toMatchObject({ code: "STAMP_OPERATION_LIMIT_EXCEEDED" });
    await expect(
      loyalty.issueStamps(context, commandId, { qrPayload: fixture.qrPayload, amount: 5 }, request),
    ).rejects.toMatchObject({ code: "OPERATION_IDEMPOTENCY_CONFLICT" });
  });

  it("recovers an abandoned processing claim after its lease expires", async () => {
    const fixture = await createMembership();
    const commandId = randomUUID();
    await prisma.client.loyaltyOperationCommand.create({
      data: {
        organizationId: ORGANIZATION_ID,
        membershipId: fixture.membershipId,
        operationType: "ISSUE_STAMP",
        idempotencyKey: commandId,
        requestFingerprint: stampFingerprint(fixture.qrPayload, 1),
        actorMemberId: context.organizationMemberId,
        actorDeviceId: context.deviceId,
        locationId: LOCATION_ID,
        leaseOwner: "crashed-api-worker",
        leaseExpiresAt: new Date("2000-01-01T00:00:00.000Z"),
        attemptCount: 1,
      },
    });
    await expect(
      loyalty.issueStamps(context, commandId, { qrPayload: fixture.qrPayload, amount: 1 }, request),
    ).resolves.toMatchObject({ progress: 1, replayed: false });
    expect(
      await prisma.client.loyaltyOperationCommand.findUniqueOrThrow({
        where: {
          organizationId_idempotencyKey: {
            organizationId: ORGANIZATION_ID,
            idempotencyKey: commandId,
          },
        },
      }),
    ).toMatchObject({ status: "COMPLETED", attemptCount: 2 });
  });

  it("rolls back ledger state when transactional audit fails, then records a durable failure", async () => {
    const fixture = await createMembership();
    const commandId = randomUUID();
    const spy = vi
      .spyOn(audit, "recordInTransaction")
      .mockRejectedValueOnce(new Error("AUDIT_DOWN"));
    await expect(
      loyalty.issueStamps(context, commandId, { qrPayload: fixture.qrPayload, amount: 1 }, request),
    ).rejects.toThrow("AUDIT_DOWN");
    spy.mockRestore();
    expect(
      await prisma.client.loyaltyLedgerEntry.count({
        where: { membershipId: fixture.membershipId },
      }),
    ).toBe(0);
    expect(
      await prisma.client.membershipProgressProjection.findUniqueOrThrow({
        where: { membershipId: fixture.membershipId },
      }),
    ).toMatchObject({ currentCycleStampCount: 0, projectionVersion: 0 });
    expect(
      await prisma.client.loyaltyOperationCommand.findUniqueOrThrow({
        where: {
          organizationId_idempotencyKey: {
            organizationId: ORGANIZATION_ID,
            idempotencyKey: commandId,
          },
        },
      }),
    ).toMatchObject({ status: "FAILED", safeFailureCode: "OPERATION_FAILED" });
  });

  it("persists export failure and audit when object storage is unavailable", async () => {
    const command = await prisma.client.exportCommand.create({
      data: {
        organizationId: ORGANIZATION_ID,
        requestedByUserId: OWNER_ID,
        exportType: "MEMBERSHIP_SUMMARY",
        filters: {},
        filterFingerprint: createHash("sha256").update(randomUUID()).digest("hex"),
        createdAt: new Date("1900-01-01T00:00:00.000Z"),
      },
    });
    const environment = {
      ...parseEnvironment(process.env),
      OBJECT_STORAGE_ENDPOINT: "http://127.0.0.1:1",
    };
    const worker = new OperationalWorker(prisma.client, environment);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const state = await prisma.client.exportCommand.findUniqueOrThrow({
        where: { id: command.id },
        select: { status: true },
      });
      if (state.status !== "PENDING") break;
      await expect(worker.processOneExport()).resolves.toBe(true);
    }
    expect(
      await prisma.client.exportCommand.findUniqueOrThrow({ where: { id: command.id } }),
    ).toMatchObject({ status: "FAILED", safeFailureCode: "EXPORT_BUILD_FAILED" });
    expect(
      await prisma.client.auditLog.count({
        where: { action: "export.failed", targetId: command.id },
      }),
    ).toBe(1);
  });
});
