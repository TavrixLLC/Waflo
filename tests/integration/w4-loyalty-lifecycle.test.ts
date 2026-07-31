import { randomUUID } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApplication } from "../../apps/api/src/app.js";
import type { WafloRequest } from "../../apps/api/src/common/request-context.js";
import { CustomerSecurityService } from "../../apps/api/src/customer/customer-security.service.js";
import { PrismaService } from "../../apps/api/src/database/prisma.service.js";
import { LoyaltyOperationService } from "../../apps/api/src/loyalty/loyalty-operation.service.js";

const ORGANIZATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const COOKIE_PROGRAM_ID = "c0000000-0000-4000-8000-000000000001";
const COOKIE_VERSION_ID = "c1000000-0000-4000-8000-000000000001";
const LOCATION_ID = "a1111111-1111-4111-8111-111111111111";
const DEVICE_ID = "80000000-0000-4000-8000-000000000001";

describe.sequential("W4 real loyalty lifecycle", () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let security: CustomerSecurityService;
  let operations: LoyaltyOperationService;
  const request = {
    id: "w4-lifecycle",
    requestId: "w4-lifecycle",
    headers: {},
    ip: "127.0.0.1",
  } as unknown as WafloRequest;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.TEST_STAFF_CLIENT_ENABLED = "true";
    app = await createApiApplication({ logger: false });
    prisma = app.get(PrismaService);
    security = app.get(CustomerSecurityService);
    operations = app.get(LoyaltyOperationService);
  });

  afterAll(async () => {
    await app?.close();
  });

  it("unlocks crossed rewards on an authorized correction and resets only after final redemption", async () => {
    const ownerMember = await prisma.client.organizationMember.findFirstOrThrow({
      where: { organizationId: ORGANIZATION_ID, userId: OWNER_ID },
    });
    const staffDevice = await prisma.client.staffDevice.findUniqueOrThrow({
      where: { id: DEVICE_ID },
    });
    const customerId = randomUUID();
    const membershipId = randomUUID();
    const credential = security.createCredential(1);
    await prisma.client.$transaction(async (transaction) => {
      await transaction.customer.create({
        data: {
          id: customerId,
          organizationId: ORGANIZATION_ID,
          displayName: "W4 lifecycle fixture",
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

    const corrected = await operations.manualAdjustment({
      organizationId: ORGANIZATION_ID,
      membershipId,
      actorUserId: OWNER_ID,
      actorMemberId: ownerMember.id,
      actorRole: "OWNER",
      locationId: LOCATION_ID,
      commandId: randomUUID(),
      stampDelta: 8,
      reason: "Correcting a verified historical opening balance.",
      request,
    });
    expect(corrected).toMatchObject({
      progress: 8,
      goal: 8,
      rewardReady: true,
    });
    expect(corrected.unlockedRewards).toHaveLength(2);

    const context = {
      organizationId: ORGANIZATION_ID,
      organizationMemberId: staffDevice.organizationMemberId,
      role: "STAFF" as const,
      locationId: LOCATION_ID,
      deviceId: DEVICE_ID,
      devicePublicId: staffDevice.publicId,
      deviceSessionId: "82000000-0000-4000-8000-000000000001",
      platform: "TEST_CLIENT" as const,
      requestId: "w4-lifecycle",
    };
    await expect(
      operations.issueStamps(
        context,
        randomUUID(),
        { qrPayload: credential.payload, amount: 1 },
        request,
      ),
    ).rejects.toMatchObject({ code: "FINAL_REWARD_PENDING_REDEMPTION" });

    const finalEntitlement = await prisma.client.rewardEntitlement.findFirstOrThrow({
      where: { membershipId, threshold: 8 },
    });
    const redeemed = await operations.redeemReward(
      context,
      randomUUID(),
      {
        qrPayload: credential.payload,
        rewardEntitlementPublicId: finalEntitlement.publicId,
      },
      request,
    );
    expect(redeemed).toMatchObject({
      progress: 0,
      rewardReady: false,
      completedCycles: 1,
    });
    const projection = await prisma.client.membershipProgressProjection.findUniqueOrThrow({
      where: { membershipId },
    });
    expect(projection).toMatchObject({
      currentCycleStampCount: 0,
      completedCycleCount: 1,
      currentCycleNumber: 2,
      rewardReady: false,
    });
    const eventTypes = (
      await prisma.client.loyaltyLedgerEntry.findMany({
        where: { membershipId },
        orderBy: { membershipSequence: "asc" },
        select: { eventType: true },
      })
    ).map((entry) => entry.eventType);
    expect(eventTypes).toEqual([
      "MANUAL_STAMP_ADJUSTMENT",
      "MILESTONE_REWARD_UNLOCKED",
      "FINAL_REWARD_UNLOCKED",
      "REWARD_REDEEMED",
      "CYCLE_RESET",
    ]);
    await expect(
      operations.redeemReward(
        context,
        randomUUID(),
        {
          qrPayload: credential.payload,
          rewardEntitlementPublicId: finalEntitlement.publicId,
        },
        request,
      ),
    ).rejects.toMatchObject({ code: "REWARD_ALREADY_REDEEMED" });
  });
});
