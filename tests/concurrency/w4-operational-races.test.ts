import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import {
  createOpaqueDeviceSessionToken,
  createPairingToken,
  hashOpaqueDeviceToken,
} from "../../packages/staff-device-security/src/index.js";
import { parseEnvironment } from "../../packages/config/src/index.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApplication } from "../../apps/api/src/app.js";
import type { WafloRequest } from "../../apps/api/src/common/request-context.js";
import { CustomerSecurityService } from "../../apps/api/src/customer/customer-security.service.js";
import { TransferService } from "../../apps/api/src/customer/transfer.service.js";
import { PrismaService } from "../../apps/api/src/database/prisma.service.js";
import { LoyaltyOperationService } from "../../apps/api/src/loyalty/loyalty-operation.service.js";
import { MerchantOperationsService } from "../../apps/api/src/operations/merchant-operations.service.js";
import { ProgramsService } from "../../apps/api/src/programs/programs.service.js";
import { StaffDeviceService } from "../../apps/api/src/staff-devices/staff-device.service.js";
import { OperationalWorker } from "../../apps/operational-worker/src/main.js";
import { canonicalJson } from "../../packages/loyalty-ledger/src/index.js";

const ORGANIZATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const LOCATION_ID = "a1111111-1111-4111-8111-111111111111";
const DEVICE_ID = "80000000-0000-4000-8000-000000000001";
const DEVICE_SESSION_ID = "82000000-0000-4000-8000-000000000001";
const COOKIE_PROGRAM_ID = "c0000000-0000-4000-8000-000000000001";
const COOKIE_VERSION_ID = "c1000000-0000-4000-8000-000000000001";

describe.sequential("W4 Repair Round 1 operational races", () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let loyalty: LoyaltyOperationService;
  let operations: MerchantOperationsService;
  let programs: ProgramsService;
  let staffDevices: StaffDeviceService;
  let security: CustomerSecurityService;
  let transfers: TransferService;
  let ownerMemberId: string;
  let staffMemberId: string;
  let context: Parameters<LoyaltyOperationService["issueStamps"]>[0];

  const request = {
    id: "w4-repair-races",
    requestId: "w4-repair-races",
    headers: {},
    cookies: {},
    ip: "127.0.0.1",
  } as unknown as WafloRequest;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.TEST_STAFF_CLIENT_ENABLED = "true";
    app = await createApiApplication({ logger: false });
    prisma = app.get(PrismaService);
    loyalty = app.get(LoyaltyOperationService);
    operations = app.get(MerchantOperationsService);
    programs = app.get(ProgramsService);
    staffDevices = app.get(StaffDeviceService);
    security = app.get(CustomerSecurityService);
    transfers = app.get(TransferService);
    const [owner, device] = await Promise.all([
      prisma.client.organizationMember.findFirstOrThrow({
        where: { organizationId: ORGANIZATION_ID, userId: OWNER_ID },
      }),
      prisma.client.staffDevice.findUniqueOrThrow({ where: { id: DEVICE_ID } }),
    ]);
    ownerMemberId = owner.id;
    staffMemberId = device.organizationMemberId;
    await prisma.client.staffDevice.update({
      where: { id: DEVICE_ID },
      data: { status: "ACTIVE", revokedAt: null, revocationReason: null },
    });
    context = {
      organizationId: ORGANIZATION_ID,
      organizationMemberId: staffMemberId,
      role: "STAFF",
      locationId: LOCATION_ID,
      deviceId: DEVICE_ID,
      devicePublicId: device.publicId,
      deviceSessionId: DEVICE_SESSION_ID,
      platform: "TEST_CLIENT",
      requestId: "w4-repair-races",
    };
  });

  afterAll(async () => {
    await app?.close();
  });

  async function createMembership() {
    const customerId = randomUUID();
    const membershipId = randomUUID();
    const credential = security.createCredential(1);
    const membershipCredential = await prisma.client.$transaction(async (transaction) => {
      await transaction.customer.create({
        data: {
          id: customerId,
          organizationId: ORGANIZATION_ID,
          displayName: "W4 repair concurrency fixture",
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
      return transaction.membershipCredential.create({
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
    return { customerId, membershipId, membershipCredential, qrPayload: credential.payload };
  }

  async function unlockMilestone() {
    const fixture = await createMembership();
    await loyalty.manualAdjustment({
      organizationId: ORGANIZATION_ID,
      membershipId: fixture.membershipId,
      actorUserId: OWNER_ID,
      actorMemberId: ownerMemberId,
      actorRole: "OWNER",
      locationId: LOCATION_ID,
      commandId: randomUUID(),
      stampDelta: 4,
      reason: "Prepare an isolated reward-expiry race fixture.",
      request,
    });
    const entitlement = await prisma.client.rewardEntitlement.findFirstOrThrow({
      where: { membershipId: fixture.membershipId, threshold: 4 },
    });
    await prisma.client.rewardEntitlement.update({
      where: { id: entitlement.id },
      data: { expiresAt: new Date("2000-01-01T00:00:00.000Z") },
    });
    return { ...fixture, entitlement };
  }

  async function assertLedgerSequence(membershipId: string) {
    const entries = await prisma.client.loyaltyLedgerEntry.findMany({
      where: { membershipId },
      orderBy: { membershipSequence: "asc" },
      select: { membershipSequence: true },
    });
    expect(entries.map((entry) => entry.membershipSequence)).toEqual(
      Array.from({ length: entries.length }, (_, index) => index + 1),
    );
  }

  async function unlockFinalReward() {
    const fixture = await createMembership();
    await loyalty.manualAdjustment({
      organizationId: ORGANIZATION_ID,
      membershipId: fixture.membershipId,
      actorUserId: OWNER_ID,
      actorMemberId: ownerMemberId,
      actorRole: "OWNER",
      locationId: LOCATION_ID,
      commandId: randomUUID(),
      stampDelta: 8,
      reason: "Prepare an isolated final reward race fixture.",
      request,
    });
    const entitlement = await prisma.client.rewardEntitlement.findFirstOrThrow({
      where: { membershipId: fixture.membershipId, threshold: 8 },
    });
    return { ...fixture, entitlement };
  }

  async function approvedMilestoneRedemption(fixture: Awaited<ReturnType<typeof unlockMilestone>>) {
    const approvalPublicId = randomUUID();
    const requestFingerprint = createHash("sha256")
      .update(
        canonicalJson({
          type: "REDEEM_REWARD",
          qr: createHash("sha256").update(fixture.qrPayload, "utf8").digest("hex"),
          entitlement: fixture.entitlement.publicId,
          approval: approvalPublicId,
          note: null,
        }),
        "utf8",
      )
      .digest("hex");
    await prisma.client.managerApprovalChallenge.create({
      data: {
        publicId: approvalPublicId,
        organizationId: ORGANIZATION_ID,
        membershipId: fixture.membershipId,
        rewardEntitlementId: fixture.entitlement.id,
        staffDeviceId: DEVICE_ID,
        locationId: LOCATION_ID,
        requestFingerprint,
        status: "APPROVED",
        requestedByMemberId: staffMemberId,
        approvedByUserId: OWNER_ID,
        approvedAt: new Date(),
        expiresAt: new Date(Date.now() + 5 * 60_000),
      },
    });
    return {
      qrPayload: fixture.qrPayload,
      rewardEntitlementPublicId: fixture.entitlement.publicId,
      managerApprovalPublicId: approvalPublicId,
    };
  }

  async function prepareTransfer(fixture: Awaited<ReturnType<typeof createMembership>>) {
    const transfer = await transfers.request(
      "localhost",
      `transfer:${randomUUID()}`,
      { qrPayload: fixture.qrPayload, preferredLocale: "en" },
      request,
      "today",
    );
    expect(transfer.challenge).toBeTruthy();
    expect(transfer.browserNonce).toBeTruthy();
    return {
      transfer,
      confirm: () =>
        transfers.confirmWithoutEmail(
          "localhost",
          transfer.transferPublicId,
          transfer.challenge ?? "",
          transfer.browserNonce ?? undefined,
          request,
          "today",
        ),
    };
  }

  async function prepareErasure(
    fixture: Awaited<ReturnType<typeof createMembership>>,
    reason: string,
  ) {
    const created = await operations.createPrivacyRequest(
      OWNER_ID,
      ORGANIZATION_ID,
      fixture.customerId,
      "ERASURE",
      {
        commandId: randomUUID(),
        confirmation: "CONFIRM",
        reasonOrLegalBasis: reason,
      },
      request,
    );
    const privacy = await prisma.client.customerPrivacyRequest.findUniqueOrThrow({
      where: { publicId: created.publicId },
    });
    const worker = new OperationalWorker(prisma.client, parseEnvironment(process.env));
    const eraseCustomer = (
      worker as unknown as {
        eraseCustomer: (candidate: typeof privacy) => Promise<void>;
      }
    ).eraseCustomer.bind(worker);
    return { privacy, erase: () => eraseCustomer(privacy) };
  }

  it("allows exactly one of two expiry workers to append the expiry event and wallet command", async () => {
    const fixture = await unlockMilestone();
    const pass = await prisma.client.walletPassInstance.create({
      data: {
        organizationId: ORGANIZATION_ID,
        membershipId: fixture.membershipId,
        membershipCredentialId: fixture.membershipCredential.id,
        provider: "APPLE",
        providerIdentity: `w4-expiry-${randomUUID()}`,
        status: "ACTIVE",
      },
    });
    const environment = parseEnvironment(process.env);
    const workers = [
      new OperationalWorker(prisma.client, environment),
      new OperationalWorker(prisma.client, environment),
    ];
    await Promise.all(workers.map((worker) => worker.expireRewards()));
    const command = await prisma.client.rewardExpiryCommand.findUniqueOrThrow({
      where: { entitlementId: fixture.entitlement.id },
    });
    expect(command.status).toBe("COMPLETED");
    expect(
      await prisma.client.loyaltyLedgerEntry.count({
        where: {
          membershipId: fixture.membershipId,
          rewardEntitlementId: fixture.entitlement.id,
          eventType: "REWARD_EXPIRED",
        },
      }),
    ).toBe(1);
    expect(
      await prisma.client.walletCommand.count({
        where: { walletPassInstanceId: pass.id, commandType: "UPDATE" },
      }),
    ).toBe(1);
    const beforeReplay = await prisma.client.loyaltyLedgerEntry.count({
      where: { membershipId: fixture.membershipId },
    });
    await workers[0]?.expireRewards();
    expect(
      await prisma.client.loyaltyLedgerEntry.count({
        where: { membershipId: fixture.membershipId },
      }),
    ).toBe(beforeReplay);
  });

  it("serializes expiry with membership suspension and preserves unique ledger sequence", async () => {
    const fixture = await unlockMilestone();
    const worker = new OperationalWorker(prisma.client, parseEnvironment(process.env));
    const results = await Promise.allSettled([
      worker.expireRewards(),
      loyalty.changeMembershipStatus({
        organizationId: ORGANIZATION_ID,
        membershipId: fixture.membershipId,
        actorUserId: OWNER_ID,
        actorMemberId: ownerMemberId,
        actorRole: "OWNER",
        locationId: LOCATION_ID,
        commandId: randomUUID(),
        action: "SUSPEND",
        reason: "Exercise the expiry versus suspension lock order.",
        request,
      }),
    ]);
    expect(results[0]?.status).toBe("fulfilled");
    if (results[1]?.status === "rejected") {
      await loyalty.changeMembershipStatus({
        organizationId: ORGANIZATION_ID,
        membershipId: fixture.membershipId,
        actorUserId: OWNER_ID,
        actorMemberId: ownerMemberId,
        actorRole: "OWNER",
        locationId: LOCATION_ID,
        commandId: randomUUID(),
        action: "SUSPEND",
        reason: "Retry the suspension after a safe concurrent modification response.",
        request,
      });
    }
    const [membership, entitlement, entries] = await Promise.all([
      prisma.client.membership.findUniqueOrThrow({ where: { id: fixture.membershipId } }),
      prisma.client.rewardEntitlement.findUniqueOrThrow({
        where: { id: fixture.entitlement.id },
      }),
      prisma.client.loyaltyLedgerEntry.findMany({
        where: { membershipId: fixture.membershipId },
        orderBy: { membershipSequence: "asc" },
      }),
    ]);
    expect(membership.status).toBe("SUSPENDED");
    expect(entitlement.status).toBe("EXPIRED");
    expect(entries.map((entry) => entry.membershipSequence)).toEqual(
      Array.from({ length: entries.length }, (_, index) => index + 1),
    );
  });

  it("serializes reward expiry with redemption and never redeems after expiry", async () => {
    const fixture = await unlockMilestone();
    const redemption = await approvedMilestoneRedemption(fixture);
    const worker = new OperationalWorker(prisma.client, parseEnvironment(process.env));
    const results = await Promise.allSettled([
      worker.expireRewards(),
      loyalty.redeemReward(context, randomUUID(), redemption, request),
    ]);
    expect(results.some((result) => result.status === "fulfilled")).toBe(true);
    const entries = await prisma.client.loyaltyLedgerEntry.findMany({
      where: {
        membershipId: fixture.membershipId,
        eventType: { in: ["REWARD_REDEEMED", "REWARD_EXPIRED"] },
      },
      orderBy: { membershipSequence: "asc" },
      select: { eventType: true, membershipSequence: true },
    });
    const expiredIndex = entries.findIndex((entry) => entry.eventType === "REWARD_EXPIRED");
    const redeemedIndex = entries.findIndex((entry) => entry.eventType === "REWARD_REDEEMED");
    expect(expiredIndex).toBeGreaterThanOrEqual(0);
    expect(redeemedIndex === -1 || redeemedIndex < expiredIndex).toBe(true);
    expect(entries.filter((entry) => entry.eventType === "REWARD_EXPIRED")).toHaveLength(1);
    await worker.expireRewards();
    expect(
      await prisma.client.loyaltyLedgerEntry.count({
        where: { rewardEntitlementId: fixture.entitlement.id, eventType: "REWARD_EXPIRED" },
      }),
    ).toBe(1);
    await assertLedgerSequence(fixture.membershipId);
  });

  it("serializes reward expiry with credential transfer", async () => {
    const fixture = await unlockMilestone();
    const prepared = await prepareTransfer(fixture);
    const worker = new OperationalWorker(prisma.client, parseEnvironment(process.env));
    const results = await Promise.allSettled([worker.expireRewards(), prepared.confirm()]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    const [command, entitlement, oldCredential, transferCommand] = await Promise.all([
      prisma.client.rewardExpiryCommand.findUniqueOrThrow({
        where: { entitlementId: fixture.entitlement.id },
      }),
      prisma.client.rewardEntitlement.findUniqueOrThrow({ where: { id: fixture.entitlement.id } }),
      prisma.client.membershipCredential.findUniqueOrThrow({
        where: { id: fixture.membershipCredential.id },
      }),
      prisma.client.membershipTransferCommand.findUniqueOrThrow({
        where: { publicTransferId: prepared.transfer.transferPublicId },
      }),
    ]);
    expect(command.status).toBe("COMPLETED");
    expect(entitlement.status).toBe("EXPIRED");
    expect(oldCredential.status).toBe("TRANSFERRED");
    expect(transferCommand.status).toBe("COMPLETED");
    expect(
      await prisma.client.loyaltyLedgerEntry.count({
        where: { rewardEntitlementId: fixture.entitlement.id, eventType: "REWARD_EXPIRED" },
      }),
    ).toBe(1);
    await assertLedgerSequence(fixture.membershipId);
  });

  it("serializes stamp versus redemption at the final reward boundary", async () => {
    const fixture = await unlockFinalReward();
    const results = await Promise.allSettled([
      loyalty.issueStamps(
        context,
        randomUUID(),
        { qrPayload: fixture.qrPayload, amount: 1 },
        request,
      ),
      loyalty.redeemReward(
        context,
        randomUUID(),
        {
          qrPayload: fixture.qrPayload,
          rewardEntitlementPublicId: fixture.entitlement.publicId,
        },
        request,
      ),
    ]);
    expect(results[1]?.status).toBe("fulfilled");
    const [entitlement, progress, redemptionCount, stampCount] = await Promise.all([
      prisma.client.rewardEntitlement.findUniqueOrThrow({ where: { id: fixture.entitlement.id } }),
      prisma.client.membershipProgressProjection.findUniqueOrThrow({
        where: { membershipId: fixture.membershipId },
      }),
      prisma.client.rewardRedemption.count({
        where: { rewardEntitlementId: fixture.entitlement.id },
      }),
      prisma.client.loyaltyLedgerEntry.count({
        where: { membershipId: fixture.membershipId, eventType: "STAMP_ISSUED" },
      }),
    ]);
    expect(entitlement.status).toBe("REDEEMED");
    expect(redemptionCount).toBe(1);
    expect(stampCount).toBeLessThanOrEqual(1);
    expect(progress).toMatchObject({
      currentCycleStampCount: stampCount,
      completedCycleCount: 1,
    });
    expect(await loyalty.verifyProjection(ORGANIZATION_ID, fixture.membershipId)).toMatchObject({
      valid: true,
      drift: false,
    });
    await assertLedgerSequence(fixture.membershipId);
  });

  it("allows only one concurrent redemption of a single-use final reward", async () => {
    const fixture = await unlockFinalReward();
    const redeem = (commandId: string) =>
      loyalty.redeemReward(
        context,
        commandId,
        {
          qrPayload: fixture.qrPayload,
          rewardEntitlementPublicId: fixture.entitlement.publicId,
        },
        request,
      );
    const results = await Promise.allSettled([redeem(randomUUID()), redeem(randomUUID())]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(
      await prisma.client.rewardRedemption.count({
        where: { rewardEntitlementId: fixture.entitlement.id, status: "COMPLETED" },
      }),
    ).toBe(1);
    expect(
      await prisma.client.loyaltyLedgerEntry.count({
        where: { rewardEntitlementId: fixture.entitlement.id, eventType: "REWARD_REDEEMED" },
      }),
    ).toBe(1);
    await assertLedgerSequence(fixture.membershipId);
  });

  it("serializes credential transfer with stamp issuance", async () => {
    const fixture = await createMembership();
    const transfer = await transfers.request(
      "localhost",
      `transfer:${randomUUID()}`,
      { qrPayload: fixture.qrPayload, preferredLocale: "en" },
      request,
      "today",
    );
    expect(transfer.challenge).toBeTruthy();
    expect(transfer.browserNonce).toBeTruthy();
    const results = await Promise.allSettled([
      transfers.confirmWithoutEmail(
        "localhost",
        transfer.transferPublicId,
        transfer.challenge ?? "",
        transfer.browserNonce ?? undefined,
        request,
        "today",
      ),
      loyalty.issueStamps(
        context,
        randomUUID(),
        { qrPayload: fixture.qrPayload, amount: 1 },
        request,
      ),
    ]);
    expect(results.some((result) => result.status === "fulfilled")).toBe(true);
    const [oldCredential, transferCommand, stampEntries] = await Promise.all([
      prisma.client.membershipCredential.findUniqueOrThrow({
        where: { id: fixture.membershipCredential.id },
      }),
      prisma.client.membershipTransferCommand.findUniqueOrThrow({
        where: { publicTransferId: transfer.transferPublicId },
      }),
      prisma.client.loyaltyLedgerEntry.count({
        where: { membershipId: fixture.membershipId, eventType: "STAMP_ISSUED" },
      }),
    ]);
    expect(transferCommand.status).toBe("COMPLETED");
    expect(oldCredential.status).toBe("TRANSFERRED");
    expect(stampEntries).toBeLessThanOrEqual(1);
    await assertLedgerSequence(fixture.membershipId);
  });

  it("serializes credential transfer with reward redemption", async () => {
    const fixture = await unlockFinalReward();
    const prepared = await prepareTransfer(fixture);
    const results = await Promise.allSettled([
      prepared.confirm(),
      loyalty.redeemReward(
        context,
        randomUUID(),
        {
          qrPayload: fixture.qrPayload,
          rewardEntitlementPublicId: fixture.entitlement.publicId,
        },
        request,
      ),
    ]);
    expect(results[0]?.status).toBe("fulfilled");
    const [oldCredential, activeCredentials, transferCommand, redemptions] = await Promise.all([
      prisma.client.membershipCredential.findUniqueOrThrow({
        where: { id: fixture.membershipCredential.id },
      }),
      prisma.client.membershipCredential.count({
        where: { membershipId: fixture.membershipId, status: "ACTIVE" },
      }),
      prisma.client.membershipTransferCommand.findUniqueOrThrow({
        where: { publicTransferId: prepared.transfer.transferPublicId },
      }),
      prisma.client.rewardRedemption.count({
        where: { rewardEntitlementId: fixture.entitlement.id, status: "COMPLETED" },
      }),
    ]);
    expect(oldCredential.status).toBe("TRANSFERRED");
    expect(activeCredentials).toBe(1);
    expect(transferCommand.status).toBe("COMPLETED");
    expect(redemptions).toBeLessThanOrEqual(1);
    await assertLedgerSequence(fixture.membershipId);
  });

  it("never expires a final reward even when malformed legacy data supplies an expiry", async () => {
    const fixture = await createMembership();
    await loyalty.manualAdjustment({
      organizationId: ORGANIZATION_ID,
      membershipId: fixture.membershipId,
      actorUserId: OWNER_ID,
      actorMemberId: ownerMemberId,
      actorRole: "OWNER",
      locationId: LOCATION_ID,
      commandId: randomUUID(),
      stampDelta: 8,
      reason: "Prepare a final reward non-expiry invariant fixture.",
      request,
    });
    const finalReward = await prisma.client.rewardEntitlement.findFirstOrThrow({
      where: { membershipId: fixture.membershipId, threshold: 8 },
    });
    await prisma.client.rewardEntitlement.update({
      where: { id: finalReward.id },
      data: { expiresAt: new Date("2000-01-01T00:00:00.000Z") },
    });
    await new OperationalWorker(prisma.client, parseEnvironment(process.env)).expireRewards();
    expect(
      await prisma.client.rewardEntitlement.findUniqueOrThrow({ where: { id: finalReward.id } }),
    ).toMatchObject({ status: "AVAILABLE" });
    expect(
      await prisma.client.loyaltyLedgerEntry.count({
        where: { rewardEntitlementId: finalReward.id, eventType: "REWARD_EXPIRED" },
      }),
    ).toBe(0);
    expect(
      await prisma.client.rewardExpiryCommand.findUniqueOrThrow({
        where: { entitlementId: finalReward.id },
      }),
    ).toMatchObject({ status: "COMPLETED", safeFailureCode: "FINAL_REWARD_NON_EXPIRING" });
  });

  it("gives one pairing claimant a usable challenge and writes one claim audit", async () => {
    await prisma.client.devicePairingSession.updateMany({
      where: {
        intendedStaffMemberId: staffMemberId,
        status: { in: ["PENDING", "CLAIMED"] },
      },
      data: { status: "CANCELED" },
    });
    const publicId = randomUUID();
    const pairing = createPairingToken({ publicId, environmentId: "test" });
    const session = await prisma.client.devicePairingSession.create({
      data: {
        publicId,
        organizationId: ORGANIZATION_ID,
        intendedStaffMemberId: staffMemberId,
        pairingTokenHash: pairing.tokenHash,
        requestedLocationAssignments: [],
        createdByUserId: OWNER_ID,
        expiresAt: new Date(Date.now() + 10 * 60_000),
      },
    });
    const claims = ["one", "two"].map((label) => {
      const { publicKey } = generateKeyPairSync("ed25519");
      return staffDevices.claim({
        pairingToken: pairing.token,
        installationId: `w4-pairing-${label}-${randomUUID()}`,
        publicKey: publicKey.export({ format: "pem", type: "spki" }).toString(),
        platform: "TEST_CLIENT",
        appVersion: "w4-race/1.0",
      });
    });
    const results = await Promise.allSettled(claims);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(
      await prisma.client.auditLog.count({
        where: { action: "device.pairing_claimed", targetId: session.id },
      }),
    ).toBe(1);
    expect(
      await prisma.client.devicePairingSession.findUniqueOrThrow({ where: { id: session.id } }),
    ).toMatchObject({ status: "CLAIMED" });
  });

  it("rotates a refresh token once and creates exactly one successor and audit", async () => {
    const rawRefreshToken = `refresh-${randomUUID()}-${randomUUID()}`;
    const access = createOpaqueDeviceSessionToken(
      parseEnvironment(process.env).DEVICE_SESSION_SECRET,
    );
    const old = await prisma.client.staffDeviceSession.create({
      data: {
        organizationId: ORGANIZATION_ID,
        staffDeviceId: DEVICE_ID,
        organizationMemberId: staffMemberId,
        locationId: LOCATION_ID,
        tokenHash: access.tokenHash,
        refreshTokenHash: hashOpaqueDeviceToken(
          `refresh:${rawRefreshToken}`,
          parseEnvironment(process.env).DEVICE_SESSION_SECRET,
        ),
        expiresAt: new Date(Date.now() + 86_400_000),
        appVersion: "w4-race/1.0",
      },
    });
    const results = await Promise.allSettled([
      staffDevices.refreshSession(old.id, rawRefreshToken),
      staffDevices.refreshSession(old.id, rawRefreshToken),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(
      await prisma.client.staffDeviceSession.count({ where: { rotationSource: old.id } }),
    ).toBe(1);
    expect(
      await prisma.client.auditLog.count({
        where: {
          action: "device.session_rotated",
          metadata: { path: ["rotationSource"], equals: old.id },
        },
      }),
    ).toBe(1);
    expect(
      await prisma.client.staffDeviceSession.findUniqueOrThrow({ where: { id: old.id } }),
    ).toMatchObject({ refreshTokenHash: null });
  });

  it("allows exactly one manager approval decision and one decision audit", async () => {
    const entitlement = await prisma.client.rewardEntitlement.findFirstOrThrow({
      where: { organizationId: ORGANIZATION_ID },
    });
    const approval = await prisma.client.managerApprovalChallenge.create({
      data: {
        organizationId: ORGANIZATION_ID,
        membershipId: entitlement.membershipId,
        rewardEntitlementId: entitlement.id,
        staffDeviceId: DEVICE_ID,
        locationId: LOCATION_ID,
        requestFingerprint: createHash("sha256").update(randomUUID()).digest("hex"),
        requestedByMemberId: staffMemberId,
        expiresAt: new Date(Date.now() + 5 * 60_000),
      },
    });
    const results = await Promise.allSettled([
      operations.decideApproval(
        OWNER_ID,
        ORGANIZATION_ID,
        approval.publicId,
        "APPROVED",
        "approve race",
        request,
      ),
      operations.decideApproval(
        OWNER_ID,
        ORGANIZATION_ID,
        approval.publicId,
        "REJECTED",
        "reject race",
        request,
      ),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const stored = await prisma.client.managerApprovalChallenge.findUniqueOrThrow({
      where: { id: approval.id },
    });
    expect(["APPROVED", "REJECTED"]).toContain(stored.status);
    expect(
      await prisma.client.auditLog.count({
        where: {
          targetId: approval.id,
          action: {
            in: ["operation.manager_approval_granted", "operation.manager_approval_rejected"],
          },
        },
      }),
    ).toBe(1);
  });

  it("serializes stamp issuance with Program pause", async () => {
    const fixture = await createMembership();
    const current = await prisma.client.loyaltyProgram.findUniqueOrThrow({
      where: { id: COOKIE_PROGRAM_ID },
      select: { status: true },
    });
    if (current.status === "PAUSED") {
      await programs.transition(OWNER_ID, ORGANIZATION_ID, COOKIE_PROGRAM_ID, "resume", request);
    }
    try {
      const results = await Promise.allSettled([
        programs.transition(OWNER_ID, ORGANIZATION_ID, COOKIE_PROGRAM_ID, "pause", request),
        loyalty.issueStamps(
          context,
          randomUUID(),
          { qrPayload: fixture.qrPayload, amount: 1 },
          request,
        ),
      ]);
      expect(results[0]?.status).toBe("fulfilled");
      expect(
        await prisma.client.loyaltyProgram.findUniqueOrThrow({ where: { id: COOKIE_PROGRAM_ID } }),
      ).toMatchObject({ status: "PAUSED" });
      expect(
        await prisma.client.loyaltyLedgerEntry.count({
          where: { membershipId: fixture.membershipId, eventType: "STAMP_ISSUED" },
        }),
      ).toBeLessThanOrEqual(1);
      await assertLedgerSequence(fixture.membershipId);
    } finally {
      const program = await prisma.client.loyaltyProgram.findUniqueOrThrow({
        where: { id: COOKIE_PROGRAM_ID },
        select: { status: true },
      });
      if (program.status === "PAUSED") {
        await programs.transition(OWNER_ID, ORGANIZATION_ID, COOKIE_PROGRAM_ID, "resume", request);
      }
    }
  });

  it("serializes reversal with Program archive and preserves projection truth", async () => {
    const fixture = await createMembership();
    const issued = await loyalty.issueStamps(
      context,
      randomUUID(),
      { qrPayload: fixture.qrPayload, amount: 1 },
      request,
    );
    try {
      const results = await Promise.allSettled([
        programs.transition(OWNER_ID, ORGANIZATION_ID, COOKIE_PROGRAM_ID, "archive", request),
        loyalty.reverseOperation(
          context,
          randomUUID(),
          {
            operationPublicId: issued.operationPublicId,
            reason: "Exercise reversal versus archive serialization.",
          },
          request,
        ),
      ]);
      expect(results[0]?.status).toBe("fulfilled");
      expect(
        await prisma.client.loyaltyProgram.findUniqueOrThrow({ where: { id: COOKIE_PROGRAM_ID } }),
      ).toMatchObject({ status: "ARCHIVED" });
      expect(
        await prisma.client.loyaltyLedgerEntry.count({
          where: { membershipId: fixture.membershipId, eventType: "STAMP_REVERSED" },
        }),
      ).toBeLessThanOrEqual(1);
      expect(await loyalty.verifyProjection(ORGANIZATION_ID, fixture.membershipId)).toMatchObject({
        valid: true,
        drift: false,
      });
      await assertLedgerSequence(fixture.membershipId);
    } finally {
      const program = await prisma.client.loyaltyProgram.findUniqueOrThrow({
        where: { id: COOKIE_PROGRAM_ID },
        select: { status: true },
      });
      if (program.status === "ARCHIVED") {
        await programs.transition(OWNER_ID, ORGANIZATION_ID, COOKIE_PROGRAM_ID, "restore", request);
      }
    }
  });

  it("serializes reversal with a new stamp without dependent-ledger corruption", async () => {
    const fixture = await createMembership();
    const original = await loyalty.issueStamps(
      context,
      randomUUID(),
      { qrPayload: fixture.qrPayload, amount: 1 },
      request,
    );
    const results = await Promise.allSettled([
      loyalty.reverseOperation(
        context,
        randomUUID(),
        {
          operationPublicId: original.operationPublicId,
          reason: "Exercise reversal versus subsequent stamp serialization.",
        },
        request,
      ),
      loyalty.issueStamps(
        context,
        randomUUID(),
        { qrPayload: fixture.qrPayload, amount: 1 },
        request,
      ),
    ]);
    expect(results[1]?.status).toBe("fulfilled");
    const progress = await prisma.client.membershipProgressProjection.findUniqueOrThrow({
      where: { membershipId: fixture.membershipId },
    });
    expect([1, 2]).toContain(progress.currentCycleStampCount);
    expect(await loyalty.verifyProjection(ORGANIZATION_ID, fixture.membershipId)).toMatchObject({
      valid: true,
      drift: false,
    });
    await assertLedgerSequence(fixture.membershipId);
  });

  it("serializes reversal with redemption so exactly one terminal outcome wins", async () => {
    const fixture = await createMembership();
    const original = await loyalty.issueStamps(
      context,
      randomUUID(),
      { qrPayload: fixture.qrPayload, amount: 4 },
      request,
    );
    const entitlement = await prisma.client.rewardEntitlement.findFirstOrThrow({
      where: { membershipId: fixture.membershipId, threshold: 4 },
    });
    const redemption = await approvedMilestoneRedemption({ ...fixture, entitlement });
    const results = await Promise.allSettled([
      loyalty.reverseOperation(
        context,
        randomUUID(),
        {
          operationPublicId: original.operationPublicId,
          reason: "Exercise reversal versus redemption serialization.",
        },
        request,
      ),
      loyalty.redeemReward(context, randomUUID(), redemption, request),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const [reversed, redeemed] = await Promise.all([
      prisma.client.loyaltyLedgerEntry.count({
        where: { membershipId: fixture.membershipId, eventType: "STAMP_REVERSED" },
      }),
      prisma.client.loyaltyLedgerEntry.count({
        where: { membershipId: fixture.membershipId, eventType: "REWARD_REDEEMED" },
      }),
    ]);
    expect(reversed + redeemed).toBe(1);
    expect(await loyalty.verifyProjection(ORGANIZATION_ID, fixture.membershipId)).toMatchObject({
      valid: true,
      drift: false,
    });
    await assertLedgerSequence(fixture.membershipId);
  });

  it("serializes stamp issuance with membership suspension", async () => {
    const fixture = await createMembership();
    const results = await Promise.allSettled([
      loyalty.changeMembershipStatus({
        organizationId: ORGANIZATION_ID,
        membershipId: fixture.membershipId,
        actorUserId: OWNER_ID,
        actorMemberId: ownerMemberId,
        actorRole: "OWNER",
        locationId: LOCATION_ID,
        commandId: randomUUID(),
        action: "SUSPEND",
        reason: "Exercise membership suspension versus stamp serialization.",
        request,
      }),
      loyalty.issueStamps(
        context,
        randomUUID(),
        { qrPayload: fixture.qrPayload, amount: 1 },
        request,
      ),
    ]);
    expect(results[0]?.status).toBe("fulfilled");
    const entries = await prisma.client.loyaltyLedgerEntry.findMany({
      where: { membershipId: fixture.membershipId },
      orderBy: { membershipSequence: "asc" },
      select: { eventType: true, membershipSequence: true },
    });
    const suspendedIndex = entries.findIndex((entry) => entry.eventType === "MEMBERSHIP_SUSPENDED");
    expect(suspendedIndex).toBeGreaterThanOrEqual(0);
    expect(entries.slice(suspendedIndex + 1)).toEqual([]);
    expect(
      await prisma.client.membership.findUniqueOrThrow({ where: { id: fixture.membershipId } }),
    ).toMatchObject({ status: "SUSPENDED" });
    await assertLedgerSequence(fixture.membershipId);
  });

  it("serializes device revocation with an operation and rejects post-revocation work", async () => {
    const fixture = await createMembership();
    try {
      const results = await Promise.allSettled([
        staffDevices.revoke(
          OWNER_ID,
          ORGANIZATION_ID,
          context.devicePublicId,
          "Exercise device revocation versus operation serialization.",
          false,
          request,
        ),
        loyalty.issueStamps(
          context,
          randomUUID(),
          { qrPayload: fixture.qrPayload, amount: 1 },
          request,
        ),
      ]);
      expect(results[0]?.status).toBe("fulfilled");
      expect(
        await prisma.client.staffDevice.findUniqueOrThrow({ where: { id: DEVICE_ID } }),
      ).toMatchObject({ status: "REVOKED" });
      expect(
        await prisma.client.loyaltyLedgerEntry.count({
          where: { membershipId: fixture.membershipId, eventType: "STAMP_ISSUED" },
        }),
      ).toBeLessThanOrEqual(1);
      await expect(
        loyalty.issueStamps(
          context,
          randomUUID(),
          { qrPayload: fixture.qrPayload, amount: 1 },
          request,
        ),
      ).rejects.toMatchObject({ code: "LOCATION_NOT_AUTHORIZED" });
    } finally {
      await prisma.client.$transaction([
        prisma.client.staffDevice.update({
          where: { id: DEVICE_ID },
          data: { status: "ACTIVE", revokedAt: null, revocationReason: null },
        }),
        prisma.client.staffDeviceSession.updateMany({
          where: { id: DEVICE_SESSION_ID },
          data: { revokedAt: null },
        }),
      ]);
    }
  });

  it("serializes privacy erasure with operations and leaves revocation as the final membership event", async () => {
    const fixture = await createMembership();
    const created = await operations.createPrivacyRequest(
      OWNER_ID,
      ORGANIZATION_ID,
      fixture.customerId,
      "ERASURE",
      {
        commandId: randomUUID(),
        confirmation: "CONFIRM",
        reasonOrLegalBasis: "Exercise privacy erasure versus operation serialization.",
      },
      request,
    );
    const privacy = await prisma.client.customerPrivacyRequest.findUniqueOrThrow({
      where: { publicId: created.publicId },
    });
    const worker = new OperationalWorker(prisma.client, parseEnvironment(process.env));
    const eraseCustomer = (
      worker as unknown as {
        eraseCustomer: (candidate: typeof privacy) => Promise<void>;
      }
    ).eraseCustomer.bind(worker);
    const results = await Promise.allSettled([
      eraseCustomer(privacy),
      loyalty.issueStamps(
        context,
        randomUUID(),
        { qrPayload: fixture.qrPayload, amount: 1 },
        request,
      ),
    ]);
    expect(results[0]?.status).toBe("fulfilled");
    const [customer, membership, credential, storedPrivacy, entries] = await Promise.all([
      prisma.client.customer.findUniqueOrThrow({ where: { id: fixture.customerId } }),
      prisma.client.membership.findUniqueOrThrow({ where: { id: fixture.membershipId } }),
      prisma.client.membershipCredential.findUniqueOrThrow({
        where: { id: fixture.membershipCredential.id },
      }),
      prisma.client.customerPrivacyRequest.findUniqueOrThrow({ where: { id: privacy.id } }),
      prisma.client.loyaltyLedgerEntry.findMany({
        where: { membershipId: fixture.membershipId },
        orderBy: { membershipSequence: "asc" },
        select: { eventType: true, membershipSequence: true },
      }),
    ]);
    expect(customer.status).toBe("ARCHIVED");
    expect(membership.status).toBe("REVOKED");
    expect(credential.status).toBe("REVOKED");
    expect(storedPrivacy.status).toBe("COMPLETED");
    const revocationIndex = entries.findIndex((entry) => entry.eventType === "MEMBERSHIP_REVOKED");
    expect(revocationIndex).toBeGreaterThanOrEqual(0);
    expect(entries.slice(revocationIndex + 1)).toEqual([]);
    await assertLedgerSequence(fixture.membershipId);
  });

  it("serializes privacy erasure with reward redemption", async () => {
    const fixture = await unlockFinalReward();
    const erasure = await prepareErasure(
      fixture,
      "Exercise privacy erasure versus reward redemption serialization.",
    );
    const results = await Promise.allSettled([
      erasure.erase(),
      loyalty.redeemReward(
        context,
        randomUUID(),
        {
          qrPayload: fixture.qrPayload,
          rewardEntitlementPublicId: fixture.entitlement.publicId,
        },
        request,
      ),
    ]);
    expect(results[0]?.status).toBe("fulfilled");
    const [membership, privacy, entries, redemptions] = await Promise.all([
      prisma.client.membership.findUniqueOrThrow({ where: { id: fixture.membershipId } }),
      prisma.client.customerPrivacyRequest.findUniqueOrThrow({ where: { id: erasure.privacy.id } }),
      prisma.client.loyaltyLedgerEntry.findMany({
        where: { membershipId: fixture.membershipId },
        orderBy: { membershipSequence: "asc" },
        select: { eventType: true, membershipSequence: true },
      }),
      prisma.client.rewardRedemption.count({
        where: { rewardEntitlementId: fixture.entitlement.id, status: "COMPLETED" },
      }),
    ]);
    expect(membership.status).toBe("REVOKED");
    expect(privacy.status).toBe("COMPLETED");
    expect(redemptions).toBeLessThanOrEqual(1);
    const revocationIndex = entries.findIndex((entry) => entry.eventType === "MEMBERSHIP_REVOKED");
    expect(revocationIndex).toBeGreaterThanOrEqual(0);
    expect(entries.slice(revocationIndex + 1)).toEqual([]);
    await assertLedgerSequence(fixture.membershipId);
  });

  it("serializes privacy erasure with credential transfer", async () => {
    const fixture = await createMembership();
    const prepared = await prepareTransfer(fixture);
    const erasure = await prepareErasure(
      fixture,
      "Exercise privacy erasure versus credential transfer serialization.",
    );
    const results = await Promise.allSettled([erasure.erase(), prepared.confirm()]);
    expect(results[0]?.status).toBe("fulfilled");
    const [membership, privacy, activeCredentials, entries] = await Promise.all([
      prisma.client.membership.findUniqueOrThrow({ where: { id: fixture.membershipId } }),
      prisma.client.customerPrivacyRequest.findUniqueOrThrow({ where: { id: erasure.privacy.id } }),
      prisma.client.membershipCredential.count({
        where: { membershipId: fixture.membershipId, status: "ACTIVE" },
      }),
      prisma.client.loyaltyLedgerEntry.findMany({
        where: { membershipId: fixture.membershipId },
        orderBy: { membershipSequence: "asc" },
        select: { eventType: true, membershipSequence: true },
      }),
    ]);
    expect(membership.status).toBe("REVOKED");
    expect(privacy.status).toBe("COMPLETED");
    expect(activeCredentials).toBe(0);
    const revocationIndex = entries.findIndex((entry) => entry.eventType === "MEMBERSHIP_REVOKED");
    expect(revocationIndex).toBeGreaterThanOrEqual(0);
    expect(entries.slice(revocationIndex + 1)).toEqual([]);
    await assertLedgerSequence(fixture.membershipId);
  });

  it("serializes projection rebuild with a new stamp and leaves projection equal to ledger", async () => {
    const fixture = await createMembership();
    const rebuildCommandId = randomUUID();
    const results = await Promise.allSettled([
      loyalty.rebuildProjection({
        organizationId: ORGANIZATION_ID,
        membershipId: fixture.membershipId,
        commandId: rebuildCommandId,
        expectedProjectionVersion: 0,
        actorUserId: OWNER_ID,
        actorRole: "OWNER",
        request,
      }),
      loyalty.issueStamps(
        context,
        randomUUID(),
        { qrPayload: fixture.qrPayload, amount: 1 },
        request,
      ),
    ]);
    expect(results.filter((result) => result.status === "fulfilled").length).toBeGreaterThanOrEqual(
      1,
    );
    const verified = await loyalty.verifyProjection(ORGANIZATION_ID, fixture.membershipId);
    expect(verified).toMatchObject({ valid: true, drift: false });
    const command = await prisma.client.projectionRebuildCommand.findUniqueOrThrow({
      where: {
        organizationId_idempotencyKey: {
          organizationId: ORGANIZATION_ID,
          idempotencyKey: rebuildCommandId,
        },
      },
    });
    expect(["COMPLETED", "FAILED"]).toContain(command.status);
  });
});
