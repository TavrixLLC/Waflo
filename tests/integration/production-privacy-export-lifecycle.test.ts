import { createCipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApplication } from "../../apps/api/src/app.js";
import { PrismaService } from "../../apps/api/src/database/prisma.service.js";
import { MerchantOperationsService } from "../../apps/api/src/operations/merchant-operations.service.js";
import { OperationalWorker } from "../../apps/operational-worker/src/main.js";
import { parseEnvironment } from "../../packages/config/src/index.js";

const ORGANIZATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER_ID = "11111111-1111-4111-8111-111111111111";

function encrypt(plaintext: Buffer, objectKey: string, secret: string): Buffer {
  const key = createHash("sha256").update(secret, "utf8").digest();
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(`waflo-private-object:${objectKey}`, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.from(
    [
      "wpo1",
      nonce.toString("base64url"),
      ciphertext.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
    ].join("."),
  );
}

describe.sequential("production privacy and export object lifecycle", () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let operations: MerchantOperationsService;
  let otherOrganizationId: string;
  let customerId: string;
  let failedPrivacyId: string;
  const objects = new Map<string, Buffer>();
  let failDeletes = false;

  const storage = {
    async send(command: { input?: { Key?: string } }) {
      const key = command.input?.Key ?? "";
      if (command.constructor.name === "GetObjectCommand") {
        const value = objects.get(key);
        return value
          ? { Body: { transformToByteArray: async () => Uint8Array.from(value) } }
          : { Body: undefined };
      }
      if (command.constructor.name === "DeleteObjectCommand") {
        if (failDeletes) throw new Error("simulated object deletion failure");
        objects.delete(key);
        return {};
      }
      throw new Error(`Unexpected storage command ${command.constructor.name}`);
    },
  };

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    app = await createApiApplication({ logger: false });
    prisma = app.get(PrismaService);
    operations = app.get(MerchantOperationsService);
    (operations as unknown as { objectStorage: typeof storage }).objectStorage = storage;
    customerId = randomUUID();
    await prisma.client.customer.create({
      data: {
        id: customerId,
        organizationId: ORGANIZATION_ID,
        displayName: "Privacy lifecycle",
        preferredLocale: "EN",
      },
    });
    const suffix = randomUUID().slice(0, 8);
    otherOrganizationId = (
      await prisma.client.organization.create({
        data: {
          name: `Other privacy ${suffix}`,
          normalizedName: `other privacy ${suffix}`,
          merchantSlug: `other-privacy-${suffix}`,
          timezone: "UTC",
          members: { create: { userId: OWNER_ID, role: "OWNER" } },
          billingProfile: { create: {} },
        },
      })
    ).id;
  });

  afterAll(async () => app?.close());

  async function privacy(expiresAt = new Date(Date.now() + 60_000)) {
    const publicId = randomUUID();
    const objectKey = `private/privacy/${ORGANIZATION_ID}/${publicId}.json`;
    const body = Buffer.from(JSON.stringify({ subject: customerId }));
    objects.set(
      objectKey,
      encrypt(body, objectKey, parseEnvironment(process.env).OBJECT_STORAGE_SIGNING_SECRET),
    );
    const row = await prisma.client.customerPrivacyRequest.create({
      data: {
        publicId,
        organizationId: ORGANIZATION_ID,
        customerId,
        requestType: "EXPORT",
        status: "COMPLETED",
        requestedByUserId: OWNER_ID,
        idempotencyKey: randomUUID(),
        requestFingerprint: "a".repeat(64),
        objectKey,
        completedAt: new Date(),
        expiresAt,
      },
    });
    return { ...row, body };
  }

  function worker() {
    const value = new OperationalWorker(prisma.client, parseEnvironment(process.env));
    (value as unknown as { objectStorage: typeof storage }).objectStorage = storage;
    return value;
  }

  it("downloads an authorized tenant-scoped privacy export", async () => {
    const item = await privacy();
    const result = await operations.downloadPrivacyExport(OWNER_ID, ORGANIZATION_ID, item.publicId);
    expect(result.body).toEqual(item.body);
  });

  it("denies cross-tenant privacy export download", async () => {
    const item = await privacy();
    await expect(
      operations.downloadPrivacyExport(OWNER_ID, otherOrganizationId, item.publicId),
    ).rejects.toMatchObject({ code: "PRIVACY_EXPORT_NOT_READY" });
  });

  it("rejects expired privacy export download", async () => {
    const item = await privacy(new Date(Date.now() - 1_000));
    await expect(
      operations.downloadPrivacyExport(OWNER_ID, ORGANIZATION_ID, item.publicId),
    ).rejects.toMatchObject({ code: "PRIVACY_EXPORT_NOT_READY" });
  });

  it("deletes an expired privacy object before clearing its reference", async () => {
    const item = await privacy(new Date(Date.now() - 1_000));
    await worker().cleanupExpiredState();
    const stored = await prisma.client.customerPrivacyRequest.findUniqueOrThrow({
      where: { id: item.id },
    });
    expect(stored).toMatchObject({ status: "EXPIRED", objectKey: null });
    expect(objects.has(item.objectKey ?? "")).toBe(false);
  });

  it("preserves the privacy object reference when deletion fails", async () => {
    const item = await privacy(new Date(Date.now() - 1_000));
    failedPrivacyId = item.id;
    failDeletes = true;
    await worker().cleanupExpiredState();
    expect(
      (await prisma.client.customerPrivacyRequest.findUniqueOrThrow({ where: { id: item.id } }))
        .objectKey,
    ).toBe(item.objectKey);
    failDeletes = false;
  });

  it("retries and completes privacy cleanup later", async () => {
    await worker().cleanupExpiredState();
    expect(
      await prisma.client.customerPrivacyRequest.findUniqueOrThrow({
        where: { id: failedPrivacyId },
      }),
    ).toMatchObject({ status: "EXPIRED", objectKey: null });
  });

  it("gives ordinary exports the same deletion-failure and retry safety", async () => {
    const objectKey = `private/exports/${ORGANIZATION_ID}/${randomUUID()}.csv`;
    objects.set(objectKey, Buffer.from("encrypted-export"));
    const item = await prisma.client.exportCommand.create({
      data: {
        organizationId: ORGANIZATION_ID,
        requestedByUserId: OWNER_ID,
        exportType: "MEMBERSHIP_SUMMARY",
        filterFingerprint: "b".repeat(64),
        status: "COMPLETED",
        objectKey,
        expiresAt: new Date(Date.now() - 1_000),
      },
    });
    failDeletes = true;
    await worker().cleanupExpiredState();
    expect(
      (await prisma.client.exportCommand.findUniqueOrThrow({ where: { id: item.id } })).objectKey,
    ).toBe(objectKey);
    failDeletes = false;
    await worker().cleanupExpiredState();
    expect(
      await prisma.client.exportCommand.findUniqueOrThrow({ where: { id: item.id } }),
    ).toMatchObject({ status: "EXPIRED", objectKey: null });
  });
});
