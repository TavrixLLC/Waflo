import { randomUUID } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApplication } from "../../apps/api/src/app.js";
import type { WafloRequest } from "../../apps/api/src/common/request-context.js";
import { CustomerSecurityService } from "../../apps/api/src/customer/customer-security.service.js";
import { PrismaService } from "../../apps/api/src/database/prisma.service.js";
import { LoyaltyOperationService } from "../../apps/api/src/loyalty/loyalty-operation.service.js";

const ORGANIZATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LOCATION_ID = "a1111111-1111-4111-8111-111111111111";
const DEVICE_ID = "80000000-0000-4000-8000-000000000001";
const DEVICE_PUBLIC_ID = "81000000-0000-4000-8000-000000000001";
const DEVICE_SESSION_ID = "82000000-0000-4000-8000-000000000001";
const COOKIE_PROGRAM_ID = "c0000000-0000-4000-8000-000000000001";
const COOKIE_VERSION_ID = "c1000000-0000-4000-8000-000000000001";

describe.sequential("W4 PostgreSQL loyalty concurrency", () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let operations: LoyaltyOperationService;
  let security: CustomerSecurityService;
  let context: Parameters<LoyaltyOperationService["issueStamps"]>[0];
  let zeroMembershipId: string;
  let zeroQrPayload: string;
  let milestoneMembershipId: string;
  let milestoneQrPayload: string;
  const request = {
    id: "w4-concurrency",
    headers: {},
    ip: "127.0.0.1",
  } as unknown as WafloRequest;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.TEST_STAFF_CLIENT_ENABLED = "true";
    app = await createApiApplication({ logger: false });
    prisma = app.get(PrismaService);
    operations = app.get(LoyaltyOperationService);
    security = app.get(CustomerSecurityService);
    const device = await prisma.client.staffDevice.findUniqueOrThrow({
      where: { id: DEVICE_ID },
    });
    if (device.status !== "ACTIVE") {
      await prisma.client.staffDevice.update({
        where: { id: DEVICE_ID },
        data: { status: "ACTIVE", revokedAt: null, revocationReason: null },
      });
    }
    context = {
      organizationId: ORGANIZATION_ID,
      organizationMemberId: device.organizationMemberId,
      role: "STAFF",
      locationId: LOCATION_ID,
      deviceId: DEVICE_ID,
      devicePublicId: DEVICE_PUBLIC_ID,
      deviceSessionId: DEVICE_SESSION_ID,
      platform: "TEST_CLIENT",
      requestId: "w4-concurrency",
    };
    const fixtures = await Promise.all(
      ["same-key", "milestone"].map(async (label) => {
        const customerId = randomUUID();
        const membershipId = randomUUID();
        const credential = security.createCredential(1);
        await prisma.client.$transaction(async (transaction) => {
          await transaction.customer.create({
            data: {
              id: customerId,
              organizationId: ORGANIZATION_ID,
              displayName: `W4 concurrency ${label}`,
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
              publicCredentialId: credential.publicCredentialId,
              secretVersion: credential.secretVersion,
              secretHash: credential.secretHash,
              status: "ACTIVE",
            },
          });
        });
        return { membershipId, qrPayload: credential.payload };
      }),
    );
    const [sameKeyFixture, milestoneFixture] = fixtures;
    if (!sameKeyFixture || !milestoneFixture)
      throw new Error("Concurrency fixtures were not created.");
    zeroMembershipId = sameKeyFixture.membershipId;
    zeroQrPayload = sameKeyFixture.qrPayload;
    milestoneMembershipId = milestoneFixture.membershipId;
    milestoneQrPayload = milestoneFixture.qrPayload;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("returns compatible success for 100 concurrent same-key stamp requests", async () => {
    const commandId = randomUUID();
    const before = await prisma.client.membershipProgressProjection.findUniqueOrThrow({
      where: { membershipId: zeroMembershipId },
    });
    const results = await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        operations.issueStamps(
          { ...context, requestId: `same-key-${index}` },
          commandId,
          { qrPayload: zeroQrPayload, amount: 1 },
          request,
        ),
      ),
    );
    expect(results).toHaveLength(100);
    expect(results.filter((result) => result.replayed === false)).toHaveLength(1);
    expect(results.filter((result) => result.replayed === true)).toHaveLength(99);
    expect(new Set(results.map((result) => result.operationPublicId)).size).toBe(1);
    const after = await prisma.client.membershipProgressProjection.findUniqueOrThrow({
      where: { membershipId: zeroMembershipId },
    });
    expect(after.currentCycleStampCount).toBe(before.currentCycleStampCount + 1);
    expect(
      await prisma.client.loyaltyLedgerEntry.count({
        where: {
          membershipId: zeroMembershipId,
          operationCommand: { idempotencyKey: commandId },
          eventType: "STAMP_ISSUED",
        },
      }),
    ).toBe(1);
  });

  it("keeps command recovery safe while a stamp command is being claimed and completed", async () => {
    const commandId = randomUUID();
    const mutation = operations.issueStamps(
      { ...context, requestId: "m2-command-race-mutation" },
      commandId,
      { qrPayload: zeroQrPayload, amount: 1 },
      request,
    );
    const observations = await Promise.all(
      Array.from({ length: 20 }, async () => {
        try {
          return (await operations.commandStatus(context, commandId)).status;
        } catch (error) {
          return error && typeof error === "object" && "code" in error
            ? String(error.code)
            : "UNKNOWN";
        }
      }),
    );
    const result = await mutation;
    const recovered = await operations.commandStatus(context, commandId);
    expect(result.commandId).toBe(commandId);
    expect(recovered).toMatchObject({ commandId, status: "COMPLETED" });
    expect(
      observations.every((state) =>
        ["OPERATION_NOT_FOUND", "PROCESSING", "COMPLETED"].includes(state),
      ),
    ).toBe(true);
  });

  it("serializes different keys and creates at most one entitlement per threshold", async () => {
    await operations.issueStamps(
      { ...context, requestId: "milestone-prefill" },
      randomUUID(),
      { qrPayload: milestoneQrPayload, amount: 3 },
      request,
    );
    const before = await prisma.client.membershipProgressProjection.findUniqueOrThrow({
      where: { membershipId: milestoneMembershipId },
    });
    const keys = [randomUUID(), randomUUID()];
    const results = await Promise.all(
      keys.map((key, index) =>
        operations.issueStamps(
          { ...context, requestId: `different-key-${index}` },
          key,
          { qrPayload: milestoneQrPayload, amount: 1 },
          request,
        ),
      ),
    );
    expect(results).toHaveLength(2);
    const after = await prisma.client.membershipProgressProjection.findUniqueOrThrow({
      where: { membershipId: milestoneMembershipId },
    });
    expect(after.currentCycleStampCount).toBe(before.currentCycleStampCount + 2);
    const grouped = await prisma.client.rewardEntitlement.groupBy({
      by: ["membershipId", "cycleNumber", "rewardDefinitionId"],
      where: { membershipId: milestoneMembershipId },
      _count: { _all: true },
    });
    expect(grouped.every((row) => row._count._all === 1)).toBe(true);
  });
});
