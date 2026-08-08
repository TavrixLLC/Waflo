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
    return prisma.client.managerApprovalChallenge.create({
      data: {
        publicId: randomUUID(),
        organizationId: ORGANIZATION_ID,
        membershipId,
        rewardEntitlementId: milestoneEntitlementId,
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
  }

  async function consume(
    publicId: string,
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
          managerOverrideValid(
            transaction: Prisma.TransactionClient,
            context: typeof context,
            approvalPublicId: string,
            membershipId: string,
            entitlementId: string,
            requestFingerprint: string,
          ): Promise<boolean>;
        }
      ).managerOverrideValid(
        tx,
        candidateContext,
        publicId,
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
    expect(consume((await approval({ operationType: "ISSUE_STAMPS" })).publicId)).resolves.toBe(
      false,
    ));
  it("rejects a different entitlement/policy", async () =>
    expect(
      consume((await approval()).publicId, { entitlementId: finalEntitlementId }),
    ).resolves.toBe(false));
  it("rejects a changed amount/request fingerprint", async () =>
    expect(consume((await approval()).publicId, { fingerprint: "b".repeat(64) })).resolves.toBe(
      false,
    ));
  it("rejects a changed membership", async () =>
    expect(consume((await approval()).publicId, { membershipId: randomUUID() })).resolves.toBe(
      false,
    ));
  it("rejects a changed device", async () =>
    expect(consume((await approval()).publicId, { deviceId: randomUUID() })).resolves.toBe(false));
  it("rejects a changed location", async () =>
    expect(consume((await approval()).publicId, { locationId: randomUUID() })).resolves.toBe(
      false,
    ));
  it("rejects an expired approval", async () =>
    expect(
      consume((await approval({ expiresAt: new Date(Date.now() - 1_000) })).publicId),
    ).resolves.toBe(false));
  it("rejects an already-consumed approval", async () =>
    expect(
      consume((await approval({ status: "CONSUMED", consumedAt: new Date() })).publicId),
    ).resolves.toBe(false));
  it("allows exactly one concurrent consumption", async () => {
    const item = await approval();
    const results = await Promise.all([consume(item.publicId), consume(item.publicId)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});
