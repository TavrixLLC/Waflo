import { randomUUID } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { Prisma } from "@waflo/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApplication } from "../../apps/api/src/app.js";
import type { WafloRequest } from "../../apps/api/src/common/request-context.js";
import { CustomerSecurityService } from "../../apps/api/src/customer/customer-security.service.js";
import { PrismaService } from "../../apps/api/src/database/prisma.service.js";
import { LoyaltyOperationService } from "../../apps/api/src/loyalty/loyalty-operation.service.js";

const ORGANIZATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const LOCATION_ID = "a1111111-1111-4111-8111-111111111111";
const DEVICE_ID = "80000000-0000-4000-8000-000000000001";
const DEVICE_SESSION_ID = "82000000-0000-4000-8000-000000000001";
const PROGRAM_ID = "c0000000-0000-4000-8000-000000000001";
const VERSION_ID = "c1000000-0000-4000-8000-000000000001";

describe.sequential("production manager approval intent binding", () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let loyalty: LoyaltyOperationService;
  let security: CustomerSecurityService;
  let context: Parameters<LoyaltyOperationService["issueStamps"]>[0];
  let membershipId: string;
  let qrPayload: string;
  let milestoneEntitlementId: string;
  let finalEntitlementId: string;

  const request = {
    id: "manager-approval-proof",
    requestId: "manager-approval-proof",
    headers: {},
    cookies: {},
    ip: "127.0.0.1",
  } as unknown as WafloRequest;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    app = await createApiApplication({ logger: false });
    prisma = app.get(PrismaService);
    loyalty = app.get(LoyaltyOperationService);
    security = app.get(CustomerSecurityService);
    const [owner, device] = await Promise.all([
      prisma.client.organizationMember.findFirstOrThrow({
        where: { organizationId: ORGANIZATION_ID, userId: OWNER_ID },
      }),
      prisma.client.staffDevice.findUniqueOrThrow({ where: { id: DEVICE_ID } }),
    ]);
    context = {
      organizationId: ORGANIZATION_ID,
      organizationMemberId: device.organizationMemberId,
      role: "STAFF",
      locationId: LOCATION_ID,
      deviceId: DEVICE_ID,
      devicePublicId: device.publicId,
      deviceSessionId: DEVICE_SESSION_ID,
      platform: "TEST_CLIENT",
      requestId: request.requestId,
    };
    const credential = security.createCredential(1);
    qrPayload = credential.payload;
    membershipId = randomUUID();
    const customerId = randomUUID();
    await prisma.client.$transaction(async (tx) => {
      await tx.customer.create({
        data: {
          id: customerId,
          organizationId: ORGANIZATION_ID,
          displayName: "Approval proof",
          preferredLocale: "EN",
        },
      });
      await tx.membership.create({
        data: {
          id: membershipId,
          organizationId: ORGANIZATION_ID,
          customerId,
          programId: PROGRAM_ID,
          enrollmentProgramVersionId: VERSION_ID,
          publicMembershipId: `mem_${randomUUID().replaceAll("-", "")}`,
        },
      });
      await tx.membershipProgressProjection.create({
        data: { membershipId, organizationId: ORGANIZATION_ID },
      });
      await tx.membershipCredential.create({
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
    await loyalty.manualAdjustment({
      organizationId: ORGANIZATION_ID,
      membershipId,
      actorUserId: OWNER_ID,
      actorMemberId: owner.id,
      actorRole: "OWNER",
      locationId: LOCATION_ID,
      commandId: randomUUID(),
      stampDelta: 8,
      reason: "Create both approval policy targets.",
      request,
    });
    const entitlements = await prisma.client.rewardEntitlement.findMany({
      where: { membershipId },
    });
    milestoneEntitlementId = entitlements.find((item) => item.threshold === 4)?.id ?? "";
    finalEntitlementId = entitlements.find((item) => item.threshold === 8)?.id ?? "";
    expect(milestoneEntitlementId).toBeTruthy();
    expect(finalEntitlementId).toBeTruthy();
  });

  afterAll(async () => app?.close());

  async function approval(
    overrides: Partial<Prisma.ManagerApprovalChallengeUncheckedCreateInput> = {},
  ) {
    return prisma.client.$transaction(async (transaction) => {
      const command = await transaction.loyaltyOperationCommand.create({
        data: {
          organizationId: ORGANIZATION_ID,
          membershipId,
          operationType: "REDEEM_REWARD",
          idempotencyKey: randomUUID(),
          requestFingerprint: "a".repeat(64),
          actorMemberId: context.organizationMemberId,
          actorDeviceId: DEVICE_ID,
          locationId: LOCATION_ID,
        },
      });
      const item = await transaction.managerApprovalChallenge.create({
        data: {
          publicId: randomUUID(),
          organizationId: ORGANIZATION_ID,
          membershipId,
          rewardEntitlementId: milestoneEntitlementId,
          pendingOperationId: command.id,
          staffDeviceId: DEVICE_ID,
          locationId: LOCATION_ID,
          requestFingerprint: "a".repeat(64),
          operationType: "REDEEM",
          status: "APPROVED",
          requestedByMemberId: context.organizationMemberId,
          approvedByUserId: OWNER_ID,
          approvedAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
          ...overrides,
        },
      });
      return { ...item, operationCommandId: command.id };
    });
  }

  async function consume(
    item: Awaited<ReturnType<typeof approval>>,
    input: {
      membershipId?: string;
      entitlementId?: string;
      fingerprint?: string;
      deviceId?: string;
      locationId?: string;
    } = {},
  ) {
    const candidateContext = {
      ...context,
      deviceId: input.deviceId ?? context.deviceId,
      locationId: input.locationId ?? context.locationId,
    };
    return prisma.client.$transaction((tx) =>
      (
        loyalty as unknown as {
          consumeManagerApproval(
            transaction: Prisma.TransactionClient,
            context: typeof context,
            approvalPublicId: string,
            operationCommandId: string,
            membershipId: string,
            entitlementId: string,
            requestFingerprint: string,
          ): Promise<void>;
        }
      ).consumeManagerApproval(
        tx,
        candidateContext,
        item.publicId,
        item.operationCommandId,
        input.membershipId ?? membershipId,
        input.entitlementId ?? milestoneEntitlementId,
        input.fingerprint ?? "a".repeat(64),
      ),
    );
  }

  it("does not consume a REDEEM approval during stamp issuance", async () => {
    const item = await approval();
    await expect(
      loyalty.issueStamps(
        context,
        randomUUID(),
        {
          qrPayload,
          amount: 1,
          managerOverride: {
            approvalPublicId: item.publicId,
            dailyCap: true,
            purchasePolicy: true,
            reason: "Attempt to reuse a redemption approval.",
          },
        },
        request,
      ),
    ).rejects.toBeDefined();
    expect(
      (await prisma.client.managerApprovalChallenge.findUniqueOrThrow({ where: { id: item.id } }))
        .status,
    ).toBe("APPROVED");
  });

  it("rejects a different operation", async () =>
    expect(consume(await approval({ operationType: "ISSUE_STAMPS" }))).rejects.toMatchObject({
      code: "MANAGER_APPROVAL_MISMATCH",
    }));
  it("rejects a different entitlement/policy", async () =>
    expect(consume(await approval(), { entitlementId: finalEntitlementId })).rejects.toMatchObject({
      code: "MANAGER_APPROVAL_MISMATCH",
    }));
  it("rejects a changed amount/request fingerprint", async () =>
    expect(consume(await approval(), { fingerprint: "b".repeat(64) })).rejects.toMatchObject({
      code: "MANAGER_APPROVAL_MISMATCH",
    }));
  it("rejects a changed membership", async () =>
    expect(consume(await approval(), { membershipId: randomUUID() })).rejects.toMatchObject({
      code: "MANAGER_APPROVAL_MISMATCH",
    }));
  it("rejects a changed device", async () =>
    expect(consume(await approval(), { deviceId: randomUUID() })).rejects.toMatchObject({
      code: "MANAGER_APPROVAL_MISMATCH",
    }));
  it("rejects a changed location", async () =>
    expect(consume(await approval(), { locationId: randomUUID() })).rejects.toMatchObject({
      code: "MANAGER_APPROVAL_MISMATCH",
    }));
  it("rejects an expired approval", async () =>
    expect(
      consume(await approval({ expiresAt: new Date(Date.now() - 1_000) })),
    ).rejects.toMatchObject({ code: "MANAGER_APPROVAL_EXPIRED" }));
  it("rejects a rejected approval", async () =>
    expect(
      consume(await approval({ status: "REJECTED", rejectedAt: new Date() })),
    ).rejects.toMatchObject({
      code: "MANAGER_APPROVAL_REJECTED",
    }));
  it("rejects an already-consumed approval", async () =>
    expect(
      consume(await approval({ status: "CONSUMED", consumedAt: new Date() })),
    ).rejects.toMatchObject({ code: "MANAGER_APPROVAL_CONSUMED" }));
  it("allows exactly one concurrent consumption", async () => {
    const item = await approval();
    const results = await Promise.allSettled([consume(item), consume(item)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });
});
