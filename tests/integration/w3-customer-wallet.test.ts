import { randomUUID } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApplication } from "../../apps/api/src/app.js";
import { EnvironmentService } from "../../apps/api/src/config/environment.service.js";
import { PrismaService } from "../../apps/api/src/database/prisma.service.js";
import { WalletWorker } from "../../apps/wallet-worker/src/main.js";
import { googleLoyaltyClassId } from "../../packages/wallet-google/src/index.js";
import {
  createPublishedProgramVersion,
  createW3CustomerWalletFixture,
  w3EnrollmentBase,
  type W3CustomerWalletFixture,
} from "../helpers/w3-customer-wallet-fixture.js";

let app: NestFastifyApplication;
let prisma: PrismaService;
let environment: EnvironmentService;
let fixture: W3CustomerWalletFixture;
let firstMembershipId = "";
let firstCustomerId = "";

function responseData<T>(response: { json(): unknown }): T {
  return (response.json() as { data: T }).data;
}

async function enroll(idempotencyKey: string, displayName: string) {
  return app.inject({
    method: "POST",
    url: `/v1/public/programs/${fixture.programSlug}/enroll`,
    headers: {
      host: fixture.merchantHost,
      "content-type": "application/json",
      "x-idempotency-key": idempotencyKey,
    },
    payload: {
      ...w3EnrollmentBase,
      displayName,
      formStartedAt: Date.now() - 2_000,
    },
  });
}

describe.sequential("W3 Customer and Wallet integration", () => {
  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.APPLE_WALLET_MODE = "TEST_ADAPTER";
    process.env.GOOGLE_WALLET_MODE = "TEST_ADAPTER";
    process.env.GOOGLE_WALLET_ISSUER_ID = "w3-integration-issuer";
    app = await createApiApplication({ logger: false });
    prisma = app.get(PrismaService);
    environment = app.get(EnvironmentService);
    fixture = await createW3CustomerWalletFixture(prisma.client, "integration");
  }, 120_000);

  afterAll(async () => {
    await app.close();
  });

  it("returns compatible concurrent enrollment success and enforces its identity policy", async () => {
    const key = `enroll:${randomUUID()}`;
    const [first, replay] = await Promise.all([
      enroll(key, "Concurrent Member"),
      enroll(key, "Concurrent Member"),
    ]);
    expect([first.statusCode, replay.statusCode]).toEqual([201, 201]);
    const firstResult = responseData<{
      membership: { publicMembershipId: string };
      replayed: boolean;
    }>(first);
    const replayResult = responseData<typeof firstResult>(replay);
    expect(firstResult.membership.publicMembershipId).toBe(
      replayResult.membership.publicMembershipId,
    );
    expect([firstResult.replayed, replayResult.replayed].sort()).toEqual([false, true]);

    const membership = await prisma.client.membership.findUniqueOrThrow({
      where: { publicMembershipId: firstResult.membership.publicMembershipId },
      include: {
        progress: true,
        credentials: true,
        walletPassInstances: true,
        walletCommands: true,
      },
    });
    firstMembershipId = membership.id;
    firstCustomerId = membership.customerId;
    expect(membership.progress).not.toBeNull();
    expect(membership.credentials.filter((item) => item.status === "ACTIVE")).toHaveLength(1);
    expect(membership.walletPassInstances).toHaveLength(2);
    expect(membership.walletCommands.filter((item) => item.commandType === "ISSUE")).toHaveLength(
      2,
    );
    expect(await prisma.client.customer.count({ where: { id: membership.customerId } })).toBe(1);

    const conflict = await enroll(key, "Different Fingerprint");
    expect(conflict.statusCode).toBe(409);
    expect(conflict.body).toContain("ENROLLMENT_IDEMPOTENCY_KEY_CONFLICT");

    const [duplicatePersonA, duplicatePersonB] = await Promise.all([
      enroll(`enroll:${randomUUID()}`, "Same Person"),
      enroll(`enroll:${randomUUID()}`, "Same Person"),
    ]);
    expect([duplicatePersonA.statusCode, duplicatePersonB.statusCode]).toEqual([201, 201]);
    expect(
      await prisma.client.customer.count({
        where: { organizationId: fixture.organizationId, displayName: "Same Person" },
      }),
    ).toBe(2);
  }, 120_000);

  it("claims each provider issuance command once and creates immutable public progress art", async () => {
    const worker = new WalletWorker(prisma.client, {} as never, environment.values);
    const commands = await prisma.client.walletCommand.findMany({
      where: {
        membershipId: firstMembershipId,
        commandType: "ISSUE",
      },
      orderBy: { provider: "asc" },
    });
    expect(commands).toHaveLength(2);
    for (const command of commands) {
      const results = await Promise.all([
        worker.processCommandById(command.id, 1),
        worker.processCommandById(command.id, 2),
      ]);
      expect(results.sort()).toEqual([false, true]);
    }
    const passes = await prisma.client.walletPassInstance.findMany({
      where: { membershipId: firstMembershipId },
    });
    expect(passes).toHaveLength(2);
    expect(passes.every((pass) => pass.status === "ACTIVE")).toBe(true);
    expect(new Set(passes.map((pass) => pass.providerIdentity)).size).toBe(2);
    const googleAssets = await prisma.client.publicWalletAsset.findMany({
      where: {
        membershipId: firstMembershipId,
        assetType: { startsWith: "GOOGLE_PROGRESS_" },
      },
    });
    expect(googleAssets).toHaveLength(1);
    expect(googleAssets[0]?.objectKey).not.toContain(firstMembershipId);
  }, 120_000);

  it("deduplicates concurrent equivalent public renders and skips storage on a cache hit", async () => {
    const sameProgressMemberships = await prisma.client.membership.findMany({
      where: {
        organizationId: fixture.organizationId,
        customer: { displayName: "Same Person" },
      },
      select: { id: true },
    });
    expect(sameProgressMemberships).toHaveLength(2);
    await prisma.client.membershipProgressProjection.updateMany({
      where: { membershipId: { in: sameProgressMemberships.map((item) => item.id) } },
      data: { currentCycleStampCount: 1 },
    });
    const commands = await prisma.client.walletCommand.findMany({
      where: {
        membershipId: { in: sameProgressMemberships.map((item) => item.id) },
        provider: "GOOGLE",
        commandType: "ISSUE",
      },
    });
    expect(commands).toHaveLength(2);
    const before = await prisma.client.publicWalletAsset.count({
      where: {
        organizationId: fixture.organizationId,
        assetType: { startsWith: "GOOGLE_PROGRESS_" },
      },
    });
    const generated = await Promise.all(
      commands.map((command, index) =>
        new WalletWorker(prisma.client, {} as never, environment.values).processCommandById(
          command.id,
          index + 10,
        ),
      ),
    );
    expect(generated).toEqual([true, true]);
    expect(
      await prisma.client.walletCommand.count({
        where: { id: { in: commands.map((command) => command.id) }, status: "COMPLETED" },
      }),
    ).toBe(2);
    expect(
      await prisma.client.publicWalletAsset.count({
        where: {
          organizationId: fixture.organizationId,
          assetType: { startsWith: "GOOGLE_PROGRESS_" },
        },
      }),
    ).toBe(before + 1);

    const cachedEnrollment = await enroll(`enroll:${randomUUID()}`, "Cached Render Member");
    expect(cachedEnrollment.statusCode).toBe(201);
    const cachedMembership = await prisma.client.membership.findUniqueOrThrow({
      where: {
        publicMembershipId: responseData<{ membership: { publicMembershipId: string } }>(
          cachedEnrollment,
        ).membership.publicMembershipId,
      },
      include: { progress: true },
    });
    await prisma.client.membershipProgressProjection.update({
      where: { membershipId: cachedMembership.id },
      data: { currentCycleStampCount: 1 },
    });
    const cachedCommand = await prisma.client.walletCommand.findFirstOrThrow({
      where: {
        membershipId: cachedMembership.id,
        provider: "GOOGLE",
        commandType: "ISSUE",
      },
    });
    let storageCalls = 0;
    const cachedWorker = new WalletWorker(prisma.client, {} as never, environment.values);
    Object.defineProperty(cachedWorker, "objectStorage", {
      value: {
        send: async () => {
          storageCalls += 1;
          throw new Error("A cached render must not access object storage.");
        },
      },
    });
    await expect(cachedWorker.processCommandById(cachedCommand.id, 20)).resolves.toBe(true);
    expect(storageCalls).toBe(0);
  }, 120_000);

  it("rejects a processed stamp asset whose stored bytes do not match its digest", async () => {
    const asset = await prisma.client.merchantAsset.create({
      data: {
        organizationId: fixture.organizationId,
        category: "STAMP_FILLED",
        source: "MERCHANT_UPLOAD",
        originalObjectKey: `test/${fixture.runId}/digest-mismatch-original.svg`,
        originalFilename: "digest-mismatch.svg",
        mimeType: "image/svg+xml",
        fileSize: 64,
        width: 256,
        height: 256,
        sha256Digest: "d".repeat(64),
        processingStatus: "READY",
        safeMetadata: {},
        createdByUserId: fixture.ownerId,
      },
    });
    await prisma.client.merchantAssetVariant.create({
      data: {
        assetId: asset.id,
        variantCode: "STAMP_256",
        objectKey: `test/${fixture.runId}/digest-mismatch.svg`,
        mimeType: "image/svg+xml",
        width: 256,
        height: 256,
        fileSize: 64,
        digest: "f".repeat(64),
      },
    });
    const program = await prisma.client.loyaltyProgram.create({
      data: {
        organizationId: fixture.organizationId,
        internalName: "Digest Mismatch Program",
        publicSlug: `digest-${fixture.runId}`,
        status: "DRAFT",
        createdByUserId: fixture.ownerId,
      },
    });
    const versionId = await createPublishedProgramVersion(prisma.client, {
      organizationId: fixture.organizationId,
      programId: program.id,
      ownerId: fixture.ownerId,
      locationId: fixture.locationId,
      filledAssetId: asset.id,
      emptyAssetId: fixture.emptyAssetId,
      versionNumber: 1,
    });
    await prisma.client.loyaltyProgram.update({
      where: { id: program.id },
      data: {
        status: "PUBLISHED",
        currentPublishedVersionId: versionId,
        publishedAt: new Date(),
      },
    });
    const enrollment = await app.inject({
      method: "POST",
      url: `/v1/public/programs/${program.publicSlug}/enroll`,
      headers: {
        host: fixture.merchantHost,
        "content-type": "application/json",
        "x-idempotency-key": `enroll:${randomUUID()}`,
      },
      payload: {
        ...w3EnrollmentBase,
        displayName: "Digest Mismatch Member",
        formStartedAt: Date.now() - 2_000,
      },
    });
    expect(enrollment.statusCode).toBe(201);
    const membership = await prisma.client.membership.findUniqueOrThrow({
      where: {
        publicMembershipId: responseData<{ membership: { publicMembershipId: string } }>(enrollment)
          .membership.publicMembershipId,
      },
    });
    const command = await prisma.client.walletCommand.findFirstOrThrow({
      where: {
        membershipId: membership.id,
        provider: "GOOGLE",
        commandType: "ISSUE",
      },
    });
    const worker = new WalletWorker(prisma.client, {} as never, environment.values);
    Object.defineProperty(worker, "objectStorage", {
      value: {
        send: async () => ({
          Body: {
            transformToByteArray: async () =>
              new Uint8Array(
                Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>'),
              ),
          },
        }),
      },
    });
    await expect(worker.processCommandById(command.id, 21)).resolves.toBe(true);
    await expect(
      prisma.client.walletCommand.findUniqueOrThrow({
        where: { id: command.id },
        select: { status: true, safeErrorCode: true },
      }),
    ).resolves.toEqual({
      status: "DEAD_LETTER",
      safeErrorCode: "RENDER_ASSET_DIGEST_MISMATCH",
    });
    expect(
      await prisma.client.auditLog.count({
        where: {
          action: "wallet.render_asset_rejected",
          targetId: command.id,
        },
      }),
    ).toBe(1);
  }, 120_000);

  it("keeps old Memberships on their version and gives new Memberships a replacement Class", async () => {
    const replacementVersionId = await createPublishedProgramVersion(prisma.client, {
      organizationId: fixture.organizationId,
      programId: fixture.programId,
      ownerId: fixture.ownerId,
      locationId: fixture.locationId,
      filledAssetId: fixture.filledAssetId,
      emptyAssetId: fixture.emptyAssetId,
      versionNumber: 2,
    });
    await prisma.client.$transaction([
      prisma.client.loyaltyProgramVersion.update({
        where: { id: fixture.versionId },
        data: { status: "SUPERSEDED", supersededAt: new Date() },
      }),
      prisma.client.loyaltyProgram.update({
        where: { id: fixture.programId },
        data: {
          currentPublishedVersionId: replacementVersionId,
          latestVersionNumber: 2,
          revision: { increment: 1 },
        },
      }),
    ]);
    const next = await enroll(`enroll:${randomUUID()}`, "Replacement Version Member");
    expect(next.statusCode).toBe(201);
    const nextPublicId = responseData<{ membership: { publicMembershipId: string } }>(next)
      .membership.publicMembershipId;
    const [oldMembership, newMembership] = await Promise.all([
      prisma.client.membership.findUniqueOrThrow({ where: { id: firstMembershipId } }),
      prisma.client.membership.findUniqueOrThrow({
        where: { publicMembershipId: nextPublicId },
      }),
    ]);
    expect(oldMembership.enrollmentProgramVersionId).toBe(fixture.versionId);
    expect(newMembership.enrollmentProgramVersionId).toBe(replacementVersionId);
    expect(
      googleLoyaltyClassId("w3-integration-issuer", oldMembership.enrollmentProgramVersionId),
    ).not.toBe(
      googleLoyaltyClassId("w3-integration-issuer", newMembership.enrollmentProgramVersionId),
    );
    expect(
      await prisma.client.auditLog.count({
        where: {
          organizationId: fixture.organizationId,
          action: "customer.enrolled",
          targetId: firstCustomerId,
        },
      }),
    ).toBe(1);
  }, 120_000);
});
