import { randomUUID } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApplication } from "../../apps/api/src/app.js";
import type { WafloRequest } from "../../apps/api/src/common/request-context.js";
import { CustomerSecurityService } from "../../apps/api/src/customer/customer-security.service.js";
import { PrismaService } from "../../apps/api/src/database/prisma.service.js";
import { LoyaltyOperationService } from "../../apps/api/src/loyalty/loyalty-operation.service.js";
import { MerchantOperationsService } from "../../apps/api/src/operations/merchant-operations.service.js";
import { OperationalWorker } from "../../apps/operational-worker/src/main.js";
import { parseEnvironment } from "../../packages/config/src/index.js";

const ORGANIZATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const LOCATION_ID = "a1111111-1111-4111-8111-111111111111";
const DEVICE_ID = "80000000-0000-4000-8000-000000000001";
const DEVICE_SESSION_ID = "82000000-0000-4000-8000-000000000001";
const COOKIE_PROGRAM_ID = "c0000000-0000-4000-8000-000000000001";
const COOKIE_VERSION_ID = "c1000000-0000-4000-8000-000000000001";

describe.sequential("W4 repaired operational domain lifecycle", () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let loyalty: LoyaltyOperationService;
  let operations: MerchantOperationsService;
  let security: CustomerSecurityService;
  let context: Parameters<LoyaltyOperationService["issueStamps"]>[0];
  let ownerMemberId: string;

  const request = {
    id: "w4-operational-domain",
    requestId: "w4-operational-domain",
    headers: {},
    ip: "127.0.0.1",
  } as unknown as WafloRequest;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.TEST_STAFF_CLIENT_ENABLED = "true";
    app = await createApiApplication({ logger: false });
    prisma = app.get(PrismaService);
    loyalty = app.get(LoyaltyOperationService);
    operations = app.get(MerchantOperationsService);
    security = app.get(CustomerSecurityService);
    const [owner, device] = await Promise.all([
      prisma.client.organizationMember.findFirstOrThrow({
        where: { organizationId: ORGANIZATION_ID, userId: OWNER_ID },
      }),
      prisma.client.staffDevice.findUniqueOrThrow({ where: { id: DEVICE_ID } }),
    ]);
    ownerMemberId = owner.id;
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
      requestId: "w4-operational-domain",
    };
  });

  afterAll(async () => {
    await app?.close();
  });

  it("executes stamp, reward, redemption, reversal, status, and privacy erasure end to end", async () => {
    const customerId = randomUUID();
    const membershipId = randomUUID();
    const credential = security.createCredential(1);
    await prisma.client.$transaction(async (transaction) => {
      await transaction.customer.create({
        data: {
          id: customerId,
          organizationId: ORGANIZATION_ID,
          displayName: "W4 repaired lifecycle fixture",
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

    const firstStamp = await loyalty.issueStamps(
      context,
      randomUUID(),
      { qrPayload: credential.payload, amount: 1 },
      request,
    );
    expect(firstStamp).toMatchObject({ progress: 1, replayed: false });
    await expect(
      loyalty.reverseOperation(
        context,
        randomUUID(),
        { operationPublicId: firstStamp.operationPublicId },
        request,
      ),
    ).resolves.toMatchObject({ progress: 0 });

    const milestoneStamp = await loyalty.issueStamps(
      context,
      randomUUID(),
      { qrPayload: credential.payload, amount: 4 },
      request,
    );
    const milestone = await prisma.client.rewardEntitlement.findFirstOrThrow({
      where: { membershipId, threshold: 4 },
    });
    const redemptionCommandId = randomUUID();
    await expect(
      loyalty.redeemReward(
        context,
        redemptionCommandId,
        {
          qrPayload: credential.payload,
          rewardEntitlementPublicId: milestone.publicId,
        },
        request,
      ),
    ).rejects.toMatchObject({ code: "MANAGER_APPROVAL_REQUIRED" });
    const pendingCommand = await prisma.client.loyaltyOperationCommand.findUniqueOrThrow({
      where: {
        organizationId_idempotencyKey: {
          organizationId: ORGANIZATION_ID,
          idempotencyKey: redemptionCommandId,
        },
      },
    });
    const approval = await prisma.client.managerApprovalChallenge.findFirstOrThrow({
      where: { pendingOperationId: pendingCommand.id },
    });
    await operations.decideApproval(
      OWNER_ID,
      ORGANIZATION_ID,
      approval.publicId,
      "APPROVED",
      undefined,
      request,
    );
    const milestoneRedemption = await loyalty.redeemReward(
      context,
      redemptionCommandId,
      {
        qrPayload: credential.payload,
        rewardEntitlementPublicId: milestone.publicId,
        managerApprovalPublicId: approval.publicId,
      },
      request,
    );
    expect(milestoneRedemption).toMatchObject({ progress: 4, rewardReady: false });
    await expect(
      loyalty.reverseOperation(
        context,
        randomUUID(),
        {
          operationPublicId: milestoneRedemption.operationPublicId,
          reason: "Reverse the verified test redemption.",
        },
        request,
      ),
    ).resolves.toMatchObject({ progress: 4 });

    const finalStamp = await loyalty.issueStamps(
      context,
      randomUUID(),
      { qrPayload: credential.payload, amount: 4 },
      request,
    );
    expect(finalStamp).toMatchObject({ progress: 8, rewardReady: true });
    const finalReward = await prisma.client.rewardEntitlement.findFirstOrThrow({
      where: { membershipId, threshold: 8 },
    });
    const finalRedemption = await loyalty.redeemReward(
      context,
      randomUUID(),
      { qrPayload: credential.payload, rewardEntitlementPublicId: finalReward.publicId },
      request,
    );
    expect(finalRedemption).toMatchObject({ progress: 0, completedCycles: 1 });

    await loyalty.changeMembershipStatus({
      organizationId: ORGANIZATION_ID,
      membershipId,
      actorUserId: OWNER_ID,
      actorMemberId: ownerMemberId,
      actorRole: "OWNER",
      locationId: LOCATION_ID,
      commandId: randomUUID(),
      action: "SUSPEND",
      reason: "Exercise repaired status idempotency.",
      request,
    });
    await loyalty.changeMembershipStatus({
      organizationId: ORGANIZATION_ID,
      membershipId,
      actorUserId: OWNER_ID,
      actorMemberId: ownerMemberId,
      actorRole: "OWNER",
      locationId: LOCATION_ID,
      commandId: randomUUID(),
      action: "RESTORE",
      reason: "Exercise repaired status idempotency.",
      request,
    });

    const privacy = await operations.createPrivacyRequest(
      OWNER_ID,
      ORGANIZATION_ID,
      customerId,
      "ERASURE",
      {
        commandId: randomUUID(),
        confirmation: "CONFIRM",
        reasonOrLegalBasis: "Verified W4 integration erasure request.",
      },
      request,
    );
    const worker = new OperationalWorker(prisma.client, parseEnvironment(process.env));
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const stored = await prisma.client.customerPrivacyRequest.findUniqueOrThrow({
        where: { publicId: privacy.publicId },
      });
      if (["COMPLETED", "DEAD_LETTER"].includes(stored.status)) break;
      await worker.processOnePrivacyRequest();
    }
    expect(
      await prisma.client.customerPrivacyRequest.findUniqueOrThrow({
        where: { publicId: privacy.publicId },
      }),
    ).toMatchObject({ status: "COMPLETED" });
    expect(
      await prisma.client.membership.findUniqueOrThrow({ where: { id: membershipId } }),
    ).toMatchObject({ status: "REVOKED" });
    const entries = await prisma.client.loyaltyLedgerEntry.findMany({
      where: { membershipId },
      orderBy: { membershipSequence: "asc" },
    });
    expect(entries.map((entry) => entry.membershipSequence)).toEqual(
      Array.from({ length: entries.length }, (_, index) => index + 1),
    );
    expect(entries.some((entry) => entry.eventType === "MEMBERSHIP_REVOKED")).toBe(true);
    expect(milestoneStamp.unlockedRewards).toHaveLength(1);
  });
});
