import { randomUUID } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { queueWalletPassStateChange } from "../../packages/database/src/index.js";
import {
  WalletProviderError,
  type WalletAddAction,
  type WalletInvalidateResult,
  type WalletIssueResult,
  type WalletMembershipInput,
  type WalletProgramInput,
  type WalletProgramTemplateResult,
  type WalletProvider,
  type WalletProviderHealth,
  type WalletReconcileResult,
  type WalletUpdateReason,
  type WalletUpdateResult,
} from "../../packages/wallet-core/src/index.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApplication } from "../../apps/api/src/app.js";
import { EnvironmentService } from "../../apps/api/src/config/environment.service.js";
import { CustomerSecurityService } from "../../apps/api/src/customer/customer-security.service.js";
import { PrismaService } from "../../apps/api/src/database/prisma.service.js";
import type { WafloRequest } from "../../apps/api/src/common/request-context.js";
import { ProgramsService } from "../../apps/api/src/programs/programs.service.js";
import { WalletService } from "../../apps/api/src/wallet/wallet.service.js";
import { NotificationService } from "../../apps/api/src/notifications/notification.service.js";
import { WalletWorker } from "../../apps/wallet-worker/src/main.js";
import {
  createPublishedProgramVersion,
  createW3CustomerWalletFixture,
  w3EnrollmentBase,
  type W3CustomerWalletFixture,
} from "../helpers/w3-customer-wallet-fixture.js";

class ControlledAppleProvider implements WalletProvider {
  readonly provider = "APPLE" as const;
  readonly mode = "TEST_ADAPTER" as const;
  calls = 0;
  temporaryFailuresRemaining = 0;
  permanentFailure = false;

  async healthCheck(): Promise<WalletProviderHealth> {
    return {
      provider: "APPLE",
      mode: "TEST_ADAPTER",
      status: "HEALTHY",
      checkedAt: new Date().toISOString(),
      safeMessage: "Controlled test provider.",
      demo: true,
    };
  }

  async ensureProgramTemplate(input: WalletProgramInput): Promise<WalletProgramTemplateResult> {
    return {
      providerTemplateId: input.programVersionId,
      state: "READY",
      fingerprint: input.configurationFingerprint,
    };
  }

  async issueMembershipPass(input: WalletMembershipInput): Promise<WalletIssueResult> {
    await this.maybeFail();
    return { providerObjectId: input.providerIdentity, state: "ACTIVE" };
  }

  async createAddToWalletAction(): Promise<WalletAddAction> {
    return { mode: "TEST_ADAPTER", url: "https://example.test", testAdapter: true };
  }

  async updateMembershipPass(
    _input: WalletMembershipInput,
    _reason: WalletUpdateReason,
  ): Promise<WalletUpdateResult> {
    await this.maybeFail();
    return { state: "ACTIVE" };
  }

  async invalidateMembershipPass(): Promise<WalletInvalidateResult> {
    await this.maybeFail();
    return { state: "INVALIDATED" };
  }

  async reconcileMembershipPass(): Promise<WalletReconcileResult> {
    await this.maybeFail();
    return { state: "ACTIVE", changed: false };
  }

  private async maybeFail() {
    this.calls += 1;
    if (this.permanentFailure) {
      throw new WalletProviderError("PERMANENT_FAILURE", "Controlled permanent failure.", {
        retryable: false,
      });
    }
    if (this.temporaryFailuresRemaining > 0) {
      this.temporaryFailuresRemaining -= 1;
      const error = new Error("Controlled temporary failure.") as Error & {
        status: number;
      };
      error.status = 503;
      throw error;
    }
  }
}

let app: NestFastifyApplication;
let prisma: PrismaService;
let environment: EnvironmentService;
let security: CustomerSecurityService;
let fixture: W3CustomerWalletFixture;
let applePassId = "";
let appleSerial = "";
const notificationLinks: Array<{ to: string; actionUrl: string }> = [];
const rateLimitRunId = randomUUID().slice(0, 8);
let remoteAddressCounter = 1;

function testRemoteAddress(): string {
  const value = remoteAddressCounter++;
  return `10.124.${Math.floor(value / 250)}.${(value % 250) + 1}`;
}

function data<T>(response: { json(): unknown }): T {
  return (response.json() as { data: T }).data;
}

function cookie(
  response: { headers: Record<string, string | string[] | undefined> },
  name: string,
) {
  const raw = response.headers["set-cookie"];
  const values = Array.isArray(raw) ? raw : [raw ?? ""];
  return values.find((value) => value.startsWith(`${name}=`))?.split(";")[0] ?? "";
}

function required<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`${label} is unavailable.`);
  return value;
}

async function bootstrapCsrf(currentCookie: string) {
  const response = await app.inject({
    method: "GET",
    url: "/v1/customer/csrf",
    headers: { host: fixture.merchantHost, cookie: currentCookie },
  });
  return {
    token: data<{ token: string }>(response).token,
    csrfCookie: cookie(response, environment.customerCsrfCookieName),
  };
}

async function enrollIsolatedCustomer(displayName: string) {
  const enrollment = await app.inject({
    method: "POST",
    url: `/v1/public/programs/${fixture.programSlug}/enroll`,
    remoteAddress: testRemoteAddress(),
    headers: {
      host: fixture.merchantHost,
      "content-type": "application/json",
      "x-idempotency-key": `enroll:${randomUUID()}`,
    },
    payload: {
      ...w3EnrollmentBase,
      displayName,
      formStartedAt: Date.now() - 2_000,
    },
  });
  expect(enrollment.statusCode, enrollment.body).toBe(201);
  const customerCookie = cookie(enrollment, environment.values.CUSTOMER_COOKIE_NAME);
  expect(customerCookie).not.toBe("");
  const publicMembershipId = data<{ membership: { publicMembershipId: string } }>(enrollment)
    .membership.publicMembershipId;
  const membership = await prisma.client.membership.findUniqueOrThrow({
    where: { publicMembershipId },
    include: {
      accessSessions: true,
      credentials: true,
      walletCommands: true,
      walletPassInstances: true,
    },
  });
  return { customerCookie, membership };
}

async function drainProgramSyncJobs(programId: string) {
  const worker = new WalletWorker(prisma.client, {} as never, environment.values);
  const jobs = await prisma.client.programWalletSyncJob.findMany({
    where: {
      programId,
      status: { notIn: ["COMPLETED", "DEAD_LETTER"] },
    },
    select: { id: true },
  });
  for (const job of jobs) {
    for (let page = 0; page < 20; page += 1) {
      const current = await prisma.client.programWalletSyncJob.findUniqueOrThrow({
        where: { id: job.id },
        select: { status: true },
      });
      if (current.status === "COMPLETED" || current.status === "DEAD_LETTER") break;
      await worker.processOneProgramSyncJob(job.id);
    }
  }
}

async function prepareTransferRace(displayName: string) {
  const enrollment = await app.inject({
    method: "POST",
    url: `/v1/public/programs/${fixture.programSlug}/enroll`,
    remoteAddress: testRemoteAddress(),
    headers: {
      host: fixture.merchantHost,
      "content-type": "application/json",
      "x-idempotency-key": `enroll:${randomUUID()}`,
    },
    payload: {
      ...w3EnrollmentBase,
      displayName,
      formStartedAt: Date.now() - 2_000,
    },
  });
  expect(enrollment.statusCode).toBe(201);
  const customerCookie = cookie(enrollment, environment.values.CUSTOMER_COOKIE_NAME);
  const publicMembershipId = data<{ membership: { publicMembershipId: string } }>(enrollment)
    .membership.publicMembershipId;
  const membership = await prisma.client.membership.findUniqueOrThrow({
    where: { publicMembershipId },
    include: {
      credentials: true,
      walletCommands: true,
      walletPassInstances: true,
    },
  });
  const card = await app.inject({
    method: "GET",
    url: "/v1/customer/card",
    headers: { host: fixture.merchantHost, cookie: customerCookie },
  });
  expect(card.statusCode, card.body).toBe(200);
  const requested = await app.inject({
    method: "POST",
    url: "/v1/public/transfers/request",
    headers: {
      host: fixture.merchantHost,
      "content-type": "application/json",
      "x-idempotency-key": `transfer:${randomUUID()}`,
    },
    payload: {
      qrPayload: data<{ membershipQr: { payload: string } }>(card).membershipQr.payload,
      preferredLocale: "en",
    },
  });
  expect(requested.statusCode).toBe(201);
  const transfer = data<{ transferPublicId: string; challenge: string }>(requested);
  const browserCookie = cookie(requested, "waflo_transfer_browser");
  return {
    membership,
    oldCredential: required(
      membership.credentials.find((credential) => credential.status === "ACTIVE"),
      "Active transfer credential",
    ),
    confirm: () =>
      app.inject({
        method: "POST",
        url: "/v1/public/transfers/confirm-without-email",
        headers: {
          host: fixture.merchantHost,
          cookie: browserCookie,
          "content-type": "application/json",
        },
        payload: {
          transferPublicId: transfer.transferPublicId,
          challenge: transfer.challenge,
          explicitRiskAccepted: true,
        },
      }),
  };
}

async function prepareEmailTransferRace(displayName: string) {
  const email = `race-${randomUUID()}@customer.test`;
  const enrollment = await app.inject({
    method: "POST",
    url: `/v1/public/programs/${fixture.programSlug}/enroll`,
    remoteAddress: testRemoteAddress(),
    headers: {
      host: fixture.merchantHost,
      "content-type": "application/json",
      "x-idempotency-key": `enroll:${randomUUID()}`,
    },
    payload: {
      ...w3EnrollmentBase,
      displayName,
      email,
      formStartedAt: Date.now() - 2_000,
    },
  });
  expect(enrollment.statusCode).toBe(201);
  const customerCookie = cookie(enrollment, environment.values.CUSTOMER_COOKIE_NAME);
  const publicMembershipId = data<{ membership: { publicMembershipId: string } }>(enrollment)
    .membership.publicMembershipId;
  const membership = await prisma.client.membership.findUniqueOrThrow({
    where: { publicMembershipId },
    include: { credentials: true, walletPassInstances: true },
  });
  const card = await app.inject({
    method: "GET",
    url: "/v1/customer/card",
    headers: { host: fixture.merchantHost, cookie: customerCookie },
  });
  expect(card.statusCode, card.body).toBe(200);
  const requested = await app.inject({
    method: "POST",
    url: "/v1/public/transfers/request",
    headers: {
      host: fixture.merchantHost,
      "content-type": "application/json",
      "x-idempotency-key": `transfer:${randomUUID()}`,
    },
    payload: {
      qrPayload: data<{ membershipQr: { payload: string } }>(card).membershipQr.payload,
      preferredLocale: "en",
    },
  });
  expect(requested.statusCode).toBe(201);
  const transfer = data<{ transferPublicId: string; method: string }>(requested);
  expect(transfer.method).toBe("EMAIL_CONFIRMED");
  const actionUrl = required(
    notificationLinks.findLast((message) => message.to === email)?.actionUrl,
    "Transfer confirmation URL",
  );
  const fragment = new URLSearchParams(new URL(actionUrl).hash.slice(1));
  return {
    membership,
    confirm: () =>
      app.inject({
        method: "POST",
        url: "/v1/public/transfers/confirm-email",
        headers: {
          host: fixture.merchantHost,
          "content-type": "application/json",
        },
        payload: {
          transferPublicId: fragment.get("transfer"),
          token: fragment.get("token"),
        },
      }),
  };
}

describe.sequential("W3 Customer and Wallet concurrency invariants", () => {
  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.APPLE_WALLET_MODE = "TEST_ADAPTER";
    process.env.GOOGLE_WALLET_MODE = "TEST_ADAPTER";
    process.env.GOOGLE_WALLET_ISSUER_ID = "w3-concurrency-issuer";
    process.env.RATE_LIMIT_NAMESPACE = `w3-concurrency-${rateLimitRunId}`;
    app = await createApiApplication({ logger: false });
    prisma = app.get(PrismaService);
    environment = app.get(EnvironmentService);
    security = app.get(CustomerSecurityService);
    const notifications = app.get(NotificationService) as unknown as {
      provider: { send(message: { to: string; html: string }): Promise<void> };
    };
    notifications.provider = {
      async send(message) {
        const href = /href="([^"]+)"/.exec(message.html)?.[1];
        if (href) {
          notificationLinks.push({
            to: message.to,
            actionUrl: href.replaceAll("&amp;", "&"),
          });
        }
      },
    };
    fixture = await createW3CustomerWalletFixture(prisma.client, "concurrency");
    const { membership } = await enrollIsolatedCustomer("Concurrency Member");
    const apple = membership.walletPassInstances.find((pass) => pass.provider === "APPLE");
    if (!apple) throw new Error("Apple pass fixture was not created.");
    applePassId = apple.id;
    appleSerial = apple.providerIdentity;
    await prisma.client.walletPassInstance.update({
      where: { id: apple.id },
      data: { status: "ACTIVE" },
    });
  }, 120_000);

  afterAll(async () => {
    await app.close();
  });

  it("increments Apple update tags exactly once for a concurrent duplicate event", async () => {
    const eventKey = `duplicate:${randomUUID()}`;
    const before = await prisma.client.walletPassInstance.findUniqueOrThrow({
      where: { id: applePassId },
      select: { appleUpdateSequence: true },
    });
    expect(before.appleUpdateSequence).not.toBeNull();
    const results = await Promise.all([
      prisma.client.$transaction((transaction) =>
        queueWalletPassStateChange(transaction, {
          walletPassInstanceId: applePassId,
          commandType: "UPDATE",
          reason: "PROGRAM_PAUSED",
          eventKey,
        }),
      ),
      prisma.client.$transaction((transaction) =>
        queueWalletPassStateChange(transaction, {
          walletPassInstanceId: applePassId,
          commandType: "UPDATE",
          reason: "PROGRAM_PAUSED",
          eventKey,
        }),
      ),
    ]);
    expect(results.filter((result) => result.replayed)).toHaveLength(1);
    const passAfterFirstEvent = await prisma.client.walletPassInstance.findUniqueOrThrow({
      where: { id: applePassId },
    });
    expect(passAfterFirstEvent.updateTag).toBe(2);
    expect(passAfterFirstEvent.appleUpdateSequence).toBeGreaterThan(
      required(before.appleUpdateSequence, "Initial Apple update sequence"),
    );
    await prisma.client.$transaction((transaction) =>
      queueWalletPassStateChange(transaction, {
        walletPassInstanceId: applePassId,
        commandType: "UPDATE",
        reason: "PROGRAM_PAUSED",
        eventKey,
      }),
    );
    expect(
      await prisma.client.walletCommand.count({
        where: { walletPassInstanceId: applePassId, idempotencyKey: { contains: eventKey } },
      }),
    ).toBe(1);
    expect(
      await prisma.client.walletPassInstance.findUniqueOrThrow({
        where: { id: applePassId },
        select: { updateTag: true, appleUpdateSequence: true },
      }),
    ).toEqual({
      updateTag: 2,
      appleUpdateSequence: passAfterFirstEvent.appleUpdateSequence,
    });
  });

  it("orders interleaved Apple updates globally without precision loss or cross-pass misses", async () => {
    const enrollment = await app.inject({
      method: "POST",
      url: `/v1/public/programs/${fixture.programSlug}/enroll`,
      remoteAddress: testRemoteAddress(),
      headers: {
        host: fixture.merchantHost,
        "content-type": "application/json",
        "x-idempotency-key": `enroll:${randomUUID()}`,
      },
      payload: {
        ...w3EnrollmentBase,
        displayName: "Interleaved Apple Member",
        formStartedAt: Date.now() - 2_000,
      },
    });
    expect(enrollment.statusCode).toBe(201);
    const publicMembershipId = data<{ membership: { publicMembershipId: string } }>(enrollment)
      .membership.publicMembershipId;
    const secondMembership = await prisma.client.membership.findUniqueOrThrow({
      where: { publicMembershipId },
      include: { walletPassInstances: true },
    });
    const secondPass = required(
      secondMembership.walletPassInstances.find((pass) => pass.provider === "APPLE"),
      "Second Apple pass",
    );
    await prisma.client.walletPassInstance.update({
      where: { id: secondPass.id },
      data: { status: "PENDING" },
    });

    const device = `global-${randomUUID().replaceAll("-", "")}`;
    const passType = "pass.app.waflo.test-adapter";
    for (const pass of [
      { id: applePassId, serial: appleSerial },
      { id: secondPass.id, serial: secondPass.providerIdentity },
    ]) {
      const response = await app.inject({
        method: "POST",
        url: `/v1/apple-wallet/v1/devices/${device}/registrations/${passType}/${pass.serial}`,
        headers: {
          host: fixture.merchantHost,
          authorization: `ApplePass ${security.appleAuthenticationToken(pass.id, pass.serial)}`,
          "content-type": "application/json",
        },
        payload: { pushToken: `push-${pass.id.replaceAll("-", "")}` },
      });
      expect(response.statusCode).toBe(201);
    }

    const initial = await app.inject({
      method: "GET",
      url: `/v1/apple-wallet/v1/devices/${device}/registrations/${passType}`,
      headers: { host: fixture.merchantHost },
    });
    expect(initial.statusCode).toBe(200);
    const initialBody = initial.json<{
      serialNumbers: string[];
      lastUpdated: string;
    }>();
    expect(new Set(initialBody.serialNumbers)).toEqual(
      new Set([appleSerial, secondPass.providerIdentity]),
    );
    expect(initialBody.lastUpdated).toMatch(/^\d+$/);

    const updateA = await prisma.client.$transaction((transaction) =>
      queueWalletPassStateChange(transaction, {
        walletPassInstanceId: applePassId,
        commandType: "UPDATE",
        reason: "PROGRAM_PAUSED",
        eventKey: `global-a:${randomUUID()}`,
      }),
    );
    const pollA = await app.inject({
      method: "GET",
      url: `/v1/apple-wallet/v1/devices/${device}/registrations/${passType}?passesUpdatedSince=${initialBody.lastUpdated}`,
      headers: { host: fixture.merchantHost },
    });
    expect(pollA.statusCode).toBe(200);
    const pollABody = pollA.json<{ serialNumbers: string[]; lastUpdated: string }>();
    expect(pollABody.serialNumbers).toEqual([appleSerial]);
    expect(pollABody.lastUpdated).toBe(updateA.appleUpdateSequence?.toString());

    const updateB = await prisma.client.$transaction((transaction) =>
      queueWalletPassStateChange(transaction, {
        walletPassInstanceId: secondPass.id,
        commandType: "UPDATE",
        reason: "PROGRAM_RESUMED",
        eventKey: `global-b:${randomUUID()}`,
      }),
    );
    const pollB = await app.inject({
      method: "GET",
      url: `/v1/apple-wallet/v1/devices/${device}/registrations/${passType}?passesUpdatedSince=${pollABody.lastUpdated}`,
      headers: { host: fixture.merchantHost },
    });
    expect(pollB.statusCode).toBe(200);
    const pollBBody = pollB.json<{ serialNumbers: string[]; lastUpdated: string }>();
    expect(pollBBody.serialNumbers).toEqual([secondPass.providerIdentity]);
    expect(pollBBody.serialNumbers).not.toContain(appleSerial);
    expect(pollBBody.lastUpdated).toBe(updateB.appleUpdateSequence?.toString());

    const concurrent = await Promise.all(
      [
        { id: applePassId, key: `global-concurrent-a:${randomUUID()}` },
        { id: secondPass.id, key: `global-concurrent-b:${randomUUID()}` },
      ].map((pass) =>
        prisma.client.$transaction((transaction) =>
          queueWalletPassStateChange(transaction, {
            walletPassInstanceId: pass.id,
            commandType: "UPDATE",
            reason: "RECONCILIATION",
            eventKey: pass.key,
          }),
        ),
      ),
    );
    const concurrentSequences = concurrent.map((result) =>
      required(result.appleUpdateSequence, "Concurrent Apple update sequence"),
    );
    expect(new Set(concurrentSequences.map(String)).size).toBe(2);
    expect(
      concurrentSequences.every(
        (sequence) => sequence > required(updateB.appleUpdateSequence, "B sequence"),
      ),
    ).toBe(true);

    for (const malformed of ["-1", "12x", "9223372036854775808"]) {
      const response = await app.inject({
        method: "GET",
        url: `/v1/apple-wallet/v1/devices/${device}/registrations/${passType}?passesUpdatedSince=${malformed}`,
        headers: { host: fixture.merchantHost },
      });
      expect(response.statusCode).toBe(400);
      expect(response.body).toContain("APPLE_UPDATE_TAG_INVALID");
    }
  }, 120_000);

  it("registers one encrypted Apple device under concurrent requests and reactivates it safely", async () => {
    const device = `device-${randomUUID().replaceAll("-", "")}`;
    const passType = "pass.app.waflo.test-adapter";
    const authorization = `ApplePass ${security.appleAuthenticationToken(
      applePassId,
      appleSerial,
    )}`;
    const auditCountBefore = await prisma.client.auditLog.count({
      where: {
        organizationId: fixture.organizationId,
        action: "apple.pass_registered",
        targetId: applePassId,
      },
    });
    const deviceHash = security.protectedIdentifierHash("apple-device", device);
    const url = `/v1/apple-wallet/v1/devices/${device}/registrations/${passType}/${appleSerial}`;
    const [first, replay] = await Promise.all(
      ["push-token-aaaaaaaa", "push-token-bbbbbbbb"].map((pushToken) =>
        app.inject({
          method: "POST",
          url,
          headers: {
            host: fixture.merchantHost,
            authorization,
            "content-type": "application/json",
          },
          payload: { pushToken },
        }),
      ),
    );
    expect([first.statusCode, replay.statusCode].sort()).toEqual([200, 201]);
    const registrations = await prisma.client.applePassRegistration.findMany({
      where: {
        walletPassInstanceId: applePassId,
        deviceLibraryIdentifierHash: deviceHash,
        unregisteredAt: null,
      },
    });
    expect(registrations).toHaveLength(1);
    const registration = required(registrations[0], "Apple registration");
    expect(registration.pushTokenEncrypted).not.toContain("push-token");
    expect(
      ["push-token-aaaaaaaa", "push-token-bbbbbbbb"].includes(
        security.unprotectProviderValue(
          registration.pushTokenEncrypted,
          fixture.organizationId,
          registration.id,
          "apple-push-token",
        ),
      ),
    ).toBe(true);
    expect(
      await prisma.client.auditLog.count({
        where: {
          organizationId: fixture.organizationId,
          action: "apple.pass_registered",
          targetId: applePassId,
        },
      }),
    ).toBe(auditCountBefore + 1);

    await prisma.client.$transaction((transaction) =>
      queueWalletPassStateChange(transaction, {
        walletPassInstanceId: applePassId,
        commandType: "UPDATE",
        reason: "PROGRAM_RESUMED",
        eventKey: `serial-query:${randomUUID()}`,
      }),
    );
    const serials = await app.inject({
      method: "GET",
      url: `/v1/apple-wallet/v1/devices/${device}/registrations/${passType}?passesUpdatedSince=2`,
      headers: { host: fixture.merchantHost },
    });
    expect(serials.statusCode).toBe(200);
    expect(serials.body).toContain(appleSerial);

    const unregistered = await Promise.all([
      app.inject({ method: "DELETE", url, headers: { host: fixture.merchantHost, authorization } }),
      app.inject({ method: "DELETE", url, headers: { host: fixture.merchantHost, authorization } }),
    ]);
    expect(unregistered.map((response) => response.statusCode)).toEqual([200, 200]);
    const reregistered = await app.inject({
      method: "POST",
      url,
      headers: {
        host: fixture.merchantHost,
        authorization,
        "content-type": "application/json",
      },
      payload: { pushToken: "push-token-cccccccc" },
    });
    expect(reregistered.statusCode).toBe(200);
    expect(
      await prisma.client.applePassRegistration.count({
        where: {
          walletPassInstanceId: applePassId,
          deviceLibraryIdentifierHash: deviceHash,
          unregisteredAt: null,
        },
      }),
    ).toBe(1);
  }, 120_000);

  it("serializes lifecycle transitions with enrollment, transfer, and pass issuance", async () => {
    const programs = app.get(ProgramsService);
    const transitionRequest = {
      requestId: `lifecycle-race-${randomUUID()}`,
      headers: {},
    } as WafloRequest;
    const enroll = (displayName: string) =>
      app.inject({
        method: "POST",
        url: `/v1/public/programs/${fixture.programSlug}/enroll`,
        remoteAddress: testRemoteAddress(),
        headers: {
          host: fixture.merchantHost,
          "content-type": "application/json",
          "x-idempotency-key": `enroll:${randomUUID()}`,
        },
        payload: {
          ...w3EnrollmentBase,
          displayName,
          formStartedAt: Date.now() - 2_000,
        },
      });

    const [, pauseEnrollment] = await Promise.all([
      programs.transition(
        fixture.ownerId,
        fixture.organizationId,
        fixture.programId,
        "pause",
        transitionRequest,
      ),
      enroll("Pause Enrollment Race"),
    ]);
    expect([201, 409]).toContain(pauseEnrollment.statusCode);
    expect(
      await prisma.client.loyaltyProgram.findUniqueOrThrow({
        where: { id: fixture.programId },
        select: { status: true },
      }),
    ).toEqual({ status: "PAUSED" });
    await drainProgramSyncJobs(fixture.programId);
    if (pauseEnrollment.statusCode === 201) {
      const publicMembershipId = data<{ membership: { publicMembershipId: string } }>(
        pauseEnrollment,
      ).membership.publicMembershipId;
      const racedMembership = await prisma.client.membership.findUniqueOrThrow({
        where: { publicMembershipId },
        include: { walletPassInstances: true },
      });
      expect(racedMembership.walletPassInstances.every((pass) => pass.status !== "ACTIVE")).toBe(
        true,
      );
    }

    await programs.transition(
      fixture.ownerId,
      fixture.organizationId,
      fixture.programId,
      "resume",
      transitionRequest,
    );
    await drainProgramSyncJobs(fixture.programId);
    const [, archiveEnrollment] = await Promise.all([
      programs.transition(
        fixture.ownerId,
        fixture.organizationId,
        fixture.programId,
        "archive",
        transitionRequest,
      ),
      enroll("Archive Enrollment Race"),
    ]);
    expect([201, 409]).toContain(archiveEnrollment.statusCode);
    expect(
      await prisma.client.loyaltyProgram.findUniqueOrThrow({
        where: { id: fixture.programId },
        select: { status: true },
      }),
    ).toEqual({ status: "ARCHIVED" });
    await drainProgramSyncJobs(fixture.programId);

    const [, restoreEnrollment] = await Promise.all([
      programs.transition(
        fixture.ownerId,
        fixture.organizationId,
        fixture.programId,
        "restore",
        transitionRequest,
      ),
      enroll("Restore Enrollment Race"),
    ]);
    expect([201, 409]).toContain(restoreEnrollment.statusCode);
    expect(
      await prisma.client.loyaltyProgram.findUniqueOrThrow({
        where: { id: fixture.programId },
        select: { status: true },
      }),
    ).toEqual({ status: "PUBLISHED" });
    await drainProgramSyncJobs(fixture.programId);

    const pauseTransfer = await prepareTransferRace("Pause Transfer Race");
    const [, pauseTransferResponse] = await Promise.all([
      programs.transition(
        fixture.ownerId,
        fixture.organizationId,
        fixture.programId,
        "pause",
        transitionRequest,
      ),
      pauseTransfer.confirm(),
    ]);
    expect([201, 409]).toContain(pauseTransferResponse.statusCode);
    await drainProgramSyncJobs(fixture.programId);
    const afterPauseTransfer = await prisma.client.membership.findUniqueOrThrow({
      where: { id: pauseTransfer.membership.id },
      include: { credentials: true, walletPassInstances: true },
    });
    expect(
      afterPauseTransfer.credentials.filter((credential) => credential.status === "ACTIVE"),
    ).toHaveLength(1);
    expect(afterPauseTransfer.walletPassInstances.every((pass) => pass.status !== "ACTIVE")).toBe(
      true,
    );

    await programs.transition(
      fixture.ownerId,
      fixture.organizationId,
      fixture.programId,
      "resume",
      transitionRequest,
    );
    await drainProgramSyncJobs(fixture.programId);
    const emailPauseTransfer = await prepareEmailTransferRace("Email Pause Transfer Race");
    const [, emailPauseTransferResponse] = await Promise.all([
      programs.transition(
        fixture.ownerId,
        fixture.organizationId,
        fixture.programId,
        "pause",
        transitionRequest,
      ),
      emailPauseTransfer.confirm(),
    ]);
    expect([201, 409]).toContain(emailPauseTransferResponse.statusCode);
    await drainProgramSyncJobs(fixture.programId);
    const afterEmailPauseTransfer = await prisma.client.membership.findUniqueOrThrow({
      where: { id: emailPauseTransfer.membership.id },
      include: { credentials: true, walletPassInstances: true },
    });
    expect(
      afterEmailPauseTransfer.credentials.filter((credential) => credential.status === "ACTIVE"),
    ).toHaveLength(1);
    expect(
      afterEmailPauseTransfer.walletPassInstances.every((pass) => pass.status !== "ACTIVE"),
    ).toBe(true);
    await programs.transition(
      fixture.ownerId,
      fixture.organizationId,
      fixture.programId,
      "resume",
      transitionRequest,
    );
    await drainProgramSyncJobs(fixture.programId);
    const archiveTransfer = await prepareTransferRace("Archive Transfer Race");
    const [, archiveTransferResponse] = await Promise.all([
      programs.transition(
        fixture.ownerId,
        fixture.organizationId,
        fixture.programId,
        "archive",
        transitionRequest,
      ),
      archiveTransfer.confirm(),
    ]);
    expect([201, 409]).toContain(archiveTransferResponse.statusCode);
    await drainProgramSyncJobs(fixture.programId);
    const afterArchiveTransfer = await prisma.client.membership.findUniqueOrThrow({
      where: { id: archiveTransfer.membership.id },
      include: { credentials: true, walletPassInstances: true },
    });
    expect(
      afterArchiveTransfer.credentials.filter((credential) => credential.status === "ACTIVE"),
    ).toHaveLength(1);
    expect(afterArchiveTransfer.walletPassInstances.every((pass) => pass.status !== "ACTIVE")).toBe(
      true,
    );

    await programs.transition(
      fixture.ownerId,
      fixture.organizationId,
      fixture.programId,
      "restore",
      transitionRequest,
    );
    await drainProgramSyncJobs(fixture.programId);
    const issuanceEnrollment = await enroll("Lifecycle Issue Race");
    expect(issuanceEnrollment.statusCode).toBe(201);
    const issuancePublicId = data<{ membership: { publicMembershipId: string } }>(
      issuanceEnrollment,
    ).membership.publicMembershipId;
    const issuanceMembership = await prisma.client.membership.findUniqueOrThrow({
      where: { publicMembershipId: issuancePublicId },
      include: { walletCommands: true, walletPassInstances: true },
    });
    const issue = required(
      issuanceMembership.walletCommands.find(
        (command) => command.provider === "APPLE" && command.commandType === "ISSUE",
      ),
      "Lifecycle issue command",
    );
    const issueWorker = new WalletWorker(prisma.client, {} as never, environment.values);
    await Promise.all([
      programs.transition(
        fixture.ownerId,
        fixture.organizationId,
        fixture.programId,
        "pause",
        transitionRequest,
      ),
      issueWorker.processCommandById(issue.id, 90),
    ]);
    await drainProgramSyncJobs(fixture.programId);
    const finalIssuePass = await prisma.client.walletPassInstance.findUniqueOrThrow({
      where: {
        id: required(
          issuanceMembership.walletPassInstances.find((pass) => pass.provider === "APPLE"),
          "Lifecycle Apple pass",
        ).id,
      },
    });
    expect(finalIssuePass.status).not.toBe("ACTIVE");
    await programs.transition(
      fixture.ownerId,
      fixture.organizationId,
      fixture.programId,
      "resume",
      transitionRequest,
    );
    await drainProgramSyncJobs(fixture.programId);
  }, 180_000);

  it("recovers expired leases, retries temporary failures, and dead-letters permanent failures", async () => {
    const provider = new ControlledAppleProvider();
    const worker = new WalletWorker(
      prisma.client,
      {} as never,
      environment.values,
      new Map([["APPLE", provider]]),
    );
    const leased = await prisma.client.$transaction((transaction) =>
      queueWalletPassStateChange(transaction, {
        walletPassInstanceId: applePassId,
        commandType: "UPDATE",
        reason: "RECONCILIATION",
        eventKey: `expired-lease:${randomUUID()}`,
      }),
    );
    await prisma.client.walletCommand.update({
      where: { id: leased.command.id },
      data: {
        status: "PROCESSING",
        leaseOwner: "expired-worker",
        leaseExpiresAt: new Date(Date.now() - 1_000),
      },
    });
    const beforeLeaseCalls = provider.calls;
    const leaseResults = await Promise.all([
      worker.processCommandById(leased.command.id, 1),
      worker.processCommandById(leased.command.id, 2),
    ]);
    expect(leaseResults.sort()).toEqual([false, true]);
    expect(provider.calls - beforeLeaseCalls).toBe(1);

    provider.temporaryFailuresRemaining = 1;
    const retry = await prisma.client.$transaction((transaction) =>
      queueWalletPassStateChange(transaction, {
        walletPassInstanceId: applePassId,
        commandType: "UPDATE",
        reason: "RECONCILIATION",
        eventKey: `temporary:${randomUUID()}`,
      }),
    );
    await worker.processCommandById(retry.command.id, 3);
    expect(
      await prisma.client.walletCommand.findUniqueOrThrow({ where: { id: retry.command.id } }),
    ).toMatchObject({ status: "FAILED", safeErrorCode: "TEMPORARY_FAILURE" });
    await prisma.client.walletCommand.update({
      where: { id: retry.command.id },
      data: { nextAttemptAt: new Date(Date.now() - 1_000) },
    });
    await worker.processCommandById(retry.command.id, 3);
    expect(
      await prisma.client.walletCommand.findUniqueOrThrow({ where: { id: retry.command.id } }),
    ).toMatchObject({ status: "COMPLETED" });

    provider.permanentFailure = true;
    const dead = await prisma.client.$transaction((transaction) =>
      queueWalletPassStateChange(transaction, {
        walletPassInstanceId: applePassId,
        commandType: "INVALIDATE",
        reason: "MEMBERSHIP_REVOKED",
        eventKey: `permanent:${randomUUID()}`,
      }),
    );
    await worker.processCommandById(dead.command.id, 4);
    expect(
      await prisma.client.walletCommand.findUniqueOrThrow({ where: { id: dead.command.id } }),
    ).toMatchObject({ status: "DEAD_LETTER", safeErrorCode: "PERMANENT_FAILURE" });
  }, 120_000);

  it("serializes customer session rotation and leaves the old session explicitly revoked", async () => {
    const { customerCookie: oldCookie, membership } =
      await enrollIsolatedCustomer("Session Rotation Race");
    const oldToken = oldCookie.slice(`${environment.values.CUSTOMER_COOKIE_NAME}=`.length);
    const oldSession = await prisma.client.membershipAccessSession.findUniqueOrThrow({
      where: { tokenHash: security.hashSessionToken(oldToken) },
    });
    const csrf = await bootstrapCsrf(oldCookie);
    const rotate = () =>
      app.inject({
        method: "POST",
        url: "/v1/customer/session/rotate",
        headers: {
          host: fixture.merchantHost,
          origin: new URL(environment.values.CUSTOMER_WEB_URL).origin,
          cookie: `${oldCookie}; ${csrf.csrfCookie}`,
          "x-csrf-token": csrf.token,
          "content-type": "application/json",
        },
        payload: {},
      });
    const results = await Promise.all([rotate(), rotate()]);
    expect(results.map((response) => response.statusCode).sort()).toEqual([201, 401]);
    const success = required(
      results.find((response) => response.statusCode === 201),
      "Successful rotation response",
    );
    const newCookie = cookie(success, environment.values.CUSTOMER_COOKIE_NAME);
    expect(newCookie).not.toBe("");
    const rejected = required(
      results.find((response) => response.statusCode === 401),
      "Rejected stale rotation response",
    );
    expect(rejected.body).toContain("CUSTOMER_SESSION_EXPIRED");
    const persistedMembership = await prisma.client.membership.findUniqueOrThrow({
      where: { id: membership.id },
      include: { accessSessions: true, credentials: true },
    });
    expect(
      persistedMembership.accessSessions.find((session) => session.id === oldSession.id)?.revokedAt,
    ).not.toBeNull();
    const activeSessions = persistedMembership.accessSessions.filter(
      (session) => !session.revokedAt && session.expiresAt > new Date(),
    );
    expect(activeSessions).toHaveLength(1);
    const newToken = newCookie.slice(`${environment.values.CUSTOMER_COOKIE_NAME}=`.length);
    expect(activeSessions[0]?.tokenHash).toBe(security.hashSessionToken(newToken));
    expect(
      persistedMembership.credentials.filter((credential) => credential.status === "ACTIVE"),
    ).toHaveLength(1);
    const crossHost = await app.inject({
      method: "GET",
      url: "/v1/customer/csrf",
      headers: { host: "today.lvh.me", cookie: newCookie },
    });
    expect(crossHost.statusCode).toBe(403);
    expect(crossHost.body).toContain("CUSTOMER_SESSION_HOST_MISMATCH");
  });

  it("completes a transfer replay compatibly with one active credential and event", async () => {
    const { customerCookie, membership: originalMembership } =
      await enrollIsolatedCustomer("Transfer Replay Race");
    const originalApplePass = required(
      originalMembership.walletPassInstances.find((pass) => pass.provider === "APPLE"),
      "Transfer replay Apple pass",
    );
    await prisma.client.walletPassInstance.update({
      where: { id: originalApplePass.id },
      data: { status: "ACTIVE" },
    });
    const card = await app.inject({
      method: "GET",
      url: "/v1/customer/card",
      headers: { host: fixture.merchantHost, cookie: customerCookie },
    });
    expect(card.statusCode, card.body).toBe(200);
    const membershipQr = required(
      data<{ membershipQr: { payload: string } | null }>(card).membershipQr,
      "Transfer replay membership QR",
    );
    const qrPayload = membershipQr.payload;
    const requested = await app.inject({
      method: "POST",
      url: "/v1/public/transfers/request",
      headers: {
        host: fixture.merchantHost,
        "content-type": "application/json",
        "x-idempotency-key": `transfer:${randomUUID()}`,
      },
      payload: { qrPayload, preferredLocale: "en" },
    });
    expect(requested.statusCode).toBe(201);
    const transfer = data<{
      transferPublicId: string;
      challenge: string;
    }>(requested);
    const transferDevice = `transfer-${randomUUID().replaceAll("-", "")}`;
    const passType = "pass.app.waflo.test-adapter";
    const registration = await app.inject({
      method: "POST",
      url: `/v1/apple-wallet/v1/devices/${transferDevice}/registrations/${passType}/${originalApplePass.providerIdentity}`,
      headers: {
        host: fixture.merchantHost,
        authorization: `ApplePass ${security.appleAuthenticationToken(originalApplePass.id, originalApplePass.providerIdentity)}`,
        "content-type": "application/json",
      },
      payload: { pushToken: `transfer-push-${randomUUID().replaceAll("-", "")}` },
    });
    expect(registration.statusCode).toBe(201);
    const beforeTransferPoll = await app.inject({
      method: "GET",
      url: `/v1/apple-wallet/v1/devices/${transferDevice}/registrations/${passType}`,
      headers: { host: fixture.merchantHost },
    });
    const beforeTransferTag = beforeTransferPoll.json<{ lastUpdated: string }>().lastUpdated;
    const browserCookie = cookie(requested, "waflo_transfer_browser");
    const confirm = () =>
      app.inject({
        method: "POST",
        url: "/v1/public/transfers/confirm-without-email",
        headers: {
          host: fixture.merchantHost,
          cookie: browserCookie,
          "content-type": "application/json",
        },
        payload: {
          transferPublicId: transfer.transferPublicId,
          challenge: transfer.challenge,
          explicitRiskAccepted: true,
        },
      });
    const results = await Promise.all([confirm(), confirm()]);
    expect(
      results.map((response) => response.statusCode),
      results.map((response) => response.body).join("\n"),
    ).toEqual([201, 201]);
    const transferInvalidation = await app.inject({
      method: "GET",
      url: `/v1/apple-wallet/v1/devices/${transferDevice}/registrations/${passType}?passesUpdatedSince=${beforeTransferTag}`,
      headers: { host: fixture.merchantHost },
    });
    expect(transferInvalidation.statusCode).toBe(200);
    expect(transferInvalidation.json<{ serialNumbers: string[] }>().serialNumbers).toContain(
      originalApplePass.providerIdentity,
    );
    const membership = await prisma.client.membership.findUniqueOrThrow({
      where: { id: originalMembership.id },
      include: {
        credentials: true,
        transferEvents: true,
        walletPassInstances: true,
      },
    });
    expect(
      membership.credentials.filter((credential) => credential.status === "ACTIVE"),
    ).toHaveLength(1);
    expect(
      membership.credentials.filter((credential) => credential.status === "TRANSFERRED"),
    ).toHaveLength(1);
    expect(membership.transferEvents).toHaveLength(1);
    expect(new Set(membership.walletPassInstances.map((pass) => pass.providerIdentity)).size).toBe(
      membership.walletPassInstances.length,
    );
  }, 120_000);

  it("keeps transfer invariants under suspension, credential revocation, and issuance races", async () => {
    const suspension = await prepareTransferRace("Transfer Suspension Race");
    const [suspensionTransfer] = await Promise.all([
      suspension.confirm(),
      prisma.client.membership.update({
        where: { id: suspension.membership.id },
        data: { status: "SUSPENDED" },
      }),
    ]);
    expect([201, 409]).toContain(suspensionTransfer.statusCode);
    const suspended = await prisma.client.membership.findUniqueOrThrow({
      where: { id: suspension.membership.id },
      include: { credentials: true, transferEvents: true },
    });
    expect(suspended.status).toBe("SUSPENDED");
    expect(
      suspended.credentials.filter((credential) => credential.status === "ACTIVE").length,
    ).toBeLessThanOrEqual(1);
    expect(suspended.transferEvents.length).toBeLessThanOrEqual(1);

    const revocation = await prepareTransferRace("Transfer Revocation Race");
    const [revocationTransfer] = await Promise.all([
      revocation.confirm(),
      prisma.client.membershipCredential.updateMany({
        where: { id: revocation.oldCredential.id, status: "ACTIVE" },
        data: { status: "REVOKED", revokedAt: new Date() },
      }),
    ]);
    expect([201, 409]).toContain(revocationTransfer.statusCode);
    const revoked = await prisma.client.membership.findUniqueOrThrow({
      where: { id: revocation.membership.id },
      include: { credentials: true, transferEvents: true },
    });
    expect(
      revoked.credentials.filter((credential) => credential.status === "ACTIVE").length,
    ).toBeLessThanOrEqual(1);
    expect(
      revoked.credentials.find((credential) => credential.id === revocation.oldCredential.id)
        ?.status,
    ).not.toBe("ACTIVE");
    expect(revoked.transferEvents.length).toBeLessThanOrEqual(1);

    const issuance = await prepareTransferRace("Transfer Issuance Race");
    const oldGooglePass = required(
      issuance.membership.walletPassInstances.find((pass) => pass.provider === "GOOGLE"),
      "Google pass",
    );
    const issueCommand = required(
      issuance.membership.walletCommands.find(
        (command) => command.provider === "GOOGLE" && command.commandType === "ISSUE",
      ),
      "Google issue command",
    );
    const worker = new WalletWorker(prisma.client, {} as never, environment.values);
    const [issuanceTransfer] = await Promise.all([
      issuance.confirm(),
      worker.processCommandById(issueCommand.id, 30),
    ]);
    expect(issuanceTransfer.statusCode).toBe(201);
    const afterIssuanceRace = await prisma.client.membership.findUniqueOrThrow({
      where: { id: issuance.membership.id },
      include: {
        credentials: true,
        transferEvents: true,
        walletPassInstances: true,
      },
    });
    expect(
      afterIssuanceRace.credentials.filter((credential) => credential.status === "ACTIVE"),
    ).toHaveLength(1);
    expect(afterIssuanceRace.transferEvents).toHaveLength(1);
    expect(
      afterIssuanceRace.walletPassInstances.find((pass) => pass.id === oldGooglePass.id)?.status,
    ).not.toBe("ACTIVE");
    expect(
      new Set(afterIssuanceRace.walletPassInstances.map((pass) => pass.providerIdentity)).size,
    ).toBe(afterIssuanceRace.walletPassInstances.length);
  }, 120_000);

  it("resumes a stable-cursor lifecycle job across pages and replays a page without tag skips", async () => {
    const count = 501;
    const massProgram = await prisma.client.loyaltyProgram.create({
      data: {
        organizationId: fixture.organizationId,
        internalName: "Mass Sync Program",
        publicSlug: `mass-${fixture.runId}`,
        status: "DRAFT",
        createdByUserId: fixture.ownerId,
      },
    });
    const massVersionId = await createPublishedProgramVersion(prisma.client, {
      organizationId: fixture.organizationId,
      programId: massProgram.id,
      ownerId: fixture.ownerId,
      locationId: fixture.locationId,
      filledAssetId: fixture.filledAssetId,
      emptyAssetId: fixture.emptyAssetId,
      versionNumber: 1,
    });
    await prisma.client.loyaltyProgram.update({
      where: { id: massProgram.id },
      data: {
        status: "PAUSED",
        currentPublishedVersionId: massVersionId,
        publishedAt: new Date(),
      },
    });
    const customerRows = Array.from({ length: count }, () => ({
      id: randomUUID(),
      organizationId: fixture.organizationId,
      displayName: "Mass sync member",
    }));
    const membershipRows = customerRows.map((customer, index) => ({
      id: randomUUID(),
      organizationId: fixture.organizationId,
      customerId: customer.id,
      programId: massProgram.id,
      enrollmentProgramVersionId: massVersionId,
      publicMembershipId: `member_mass_${fixture.runId}_${index}`,
    }));
    const credentialRows = membershipRows.map((membership, index) => ({
      id: randomUUID(),
      organizationId: fixture.organizationId,
      membershipId: membership.id,
      credentialVersion: 1,
      publicCredentialId: `cred_mass_${fixture.runId}_${index}`,
      secretVersion: 1,
      secretHash: String(index % 10).repeat(64),
      status: "ACTIVE" as const,
    }));
    const passRows = membershipRows.map((membership, index) => {
      const credential = required(credentialRows[index], "Mass sync credential");
      return {
        id: randomUUID(),
        organizationId: fixture.organizationId,
        membershipId: membership.id,
        membershipCredentialId: credential.id,
        provider: "APPLE" as const,
        providerIdentity: `waflo.mass.${fixture.runId}.${index}`,
        status: "ACTIVE" as const,
      };
    });
    await prisma.client.$transaction([
      prisma.client.customer.createMany({ data: customerRows }),
      prisma.client.membership.createMany({ data: membershipRows }),
      prisma.client.membershipCredential.createMany({ data: credentialRows }),
      prisma.client.walletPassInstance.createMany({ data: passRows }),
    ]);
    const job = await prisma.client.programWalletSyncJob.create({
      data: {
        organizationId: fixture.organizationId,
        programId: massProgram.id,
        action: "pause",
        reason: "PROGRAM_PAUSED",
        commandType: "UPDATE",
        idempotencyKey: `mass-sync:${randomUUID()}`,
        batchSize: 17,
      },
    });
    const lateCustomerId = randomUUID();
    const lateMembershipId = randomUUID();
    const lateCredentialId = randomUUID();
    const latePassId = randomUUID();
    await prisma.client.$transaction([
      prisma.client.customer.create({
        data: {
          id: lateCustomerId,
          organizationId: fixture.organizationId,
          displayName: "Post-snapshot member",
        },
      }),
      prisma.client.membership.create({
        data: {
          id: lateMembershipId,
          organizationId: fixture.organizationId,
          customerId: lateCustomerId,
          programId: massProgram.id,
          enrollmentProgramVersionId: massVersionId,
          publicMembershipId: `member_mass_late_${fixture.runId}`,
        },
      }),
      prisma.client.membershipCredential.create({
        data: {
          id: lateCredentialId,
          organizationId: fixture.organizationId,
          membershipId: lateMembershipId,
          credentialVersion: 1,
          publicCredentialId: `cred_mass_late_${fixture.runId}`,
          secretVersion: 1,
          secretHash: "e".repeat(64),
          status: "ACTIVE",
        },
      }),
      prisma.client.walletPassInstance.create({
        data: {
          id: latePassId,
          organizationId: fixture.organizationId,
          membershipId: lateMembershipId,
          membershipCredentialId: lateCredentialId,
          provider: "APPLE",
          providerIdentity: `waflo.mass.${fixture.runId}.late`,
          status: "PENDING",
          createdAt: new Date(job.snapshotAt.getTime() + 1_000),
        },
      }),
    ]);
    const massDevice = `mass-device-${randomUUID().replaceAll("-", "")}`;
    const massDeviceHash = security.protectedIdentifierHash("apple-device", massDevice);
    await prisma.client.applePassRegistration.createMany({
      data: [...passRows.map((pass) => pass.id), latePassId].map((walletPassInstanceId) => ({
        walletPassInstanceId,
        deviceLibraryIdentifierHash: massDeviceHash,
        pushTokenEncrypted: "encrypted-test-fixture",
        encryptionKeyVersion: 1,
      })),
    });
    const workerA = new WalletWorker(prisma.client, {} as never, environment.values);
    await workerA.processOneProgramSyncJob(job.id);
    const firstCheckpoint = await prisma.client.programWalletSyncJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(firstCheckpoint.processedCount, JSON.stringify(firstCheckpoint)).toBe(17);
    const tagsAfterFirstPage = await prisma.client.walletPassInstance.findMany({
      where: { id: { in: passRows.map((pass) => pass.id) }, updateTag: 2 },
      select: { id: true, updateTag: true },
    });
    expect(tagsAfterFirstPage).toHaveLength(17);

    await prisma.client.programWalletSyncJob.update({
      where: { id: job.id },
      data: { cursorCreatedAt: null, cursorPassInstanceId: null },
    });
    const workerB = new WalletWorker(prisma.client, {} as never, environment.values);
    await workerB.processOneProgramSyncJob(job.id);
    expect(
      await prisma.client.programWalletSyncJob.findUniqueOrThrow({
        where: { id: job.id },
        select: { processedCount: true },
      }),
    ).toEqual({ processedCount: 17 });
    expect(
      await prisma.client.walletPassInstance.count({
        where: { id: { in: tagsAfterFirstPage.map((pass) => pass.id) }, updateTag: 2 },
      }),
    ).toBe(17);

    for (let page = 0; page < 40; page += 1) {
      const current = await prisma.client.programWalletSyncJob.findUniqueOrThrow({
        where: { id: job.id },
      });
      if (current.status === "COMPLETED") break;
      await workerB.processOneProgramSyncJob(job.id);
    }
    const completed = await prisma.client.programWalletSyncJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(completed).toMatchObject({ status: "COMPLETED", processedCount: count + 1 });
    expect(
      await prisma.client.walletCommand.count({
        where: { idempotencyKey: { contains: `program-sync:${job.id}` } },
      }),
    ).toBe(count + 1);
    expect(
      await prisma.client.walletPassInstance.count({
        where: { id: { in: passRows.map((pass) => pass.id) }, updateTag: 2 },
      }),
    ).toBe(count);
    expect(
      await prisma.client.auditLog.count({
        where: { action: "program.wallet_sync_job_completed", targetId: job.id },
      }),
    ).toBe(1);
    expect(
      await prisma.client.walletPassInstance.findUniqueOrThrow({
        where: { id: latePassId },
        select: { status: true, updateTag: true },
      }),
    ).toEqual({ status: "UPDATE_PENDING", updateTag: 2 });
    expect(
      await prisma.client.walletCommand.count({
        where: {
          walletPassInstanceId: latePassId,
          idempotencyKey: { contains: `program-sync:${job.id}` },
        },
      }),
    ).toBe(1);
    const allUpdatedSerials = await app.inject({
      method: "GET",
      url: `/v1/apple-wallet/v1/devices/${massDevice}/registrations/pass.app.waflo.test-adapter?passesUpdatedSince=0`,
      headers: { host: fixture.merchantHost },
    });
    expect(allUpdatedSerials.statusCode).toBe(200);
    const serialBody = allUpdatedSerials.json<{
      serialNumbers: string[];
      lastUpdated: string;
    }>();
    expect(serialBody.serialNumbers).toHaveLength(count + 1);
    expect(new Set(serialBody.serialNumbers).size).toBe(count + 1);
    expect(serialBody.lastUpdated).toMatch(/^\d+$/);

    const wallets = app.get(WalletService);
    const reconciliationRequest = {
      requestId: `reconcile-${randomUUID()}`,
      headers: {},
    } as WafloRequest;
    const [firstReconcile, concurrentReconcile] = await Promise.all([
      wallets.reconcile(
        fixture.ownerId,
        fixture.organizationId,
        massProgram.id,
        reconciliationRequest,
      ),
      wallets.reconcile(
        fixture.ownerId,
        fixture.organizationId,
        massProgram.id,
        reconciliationRequest,
      ),
    ]);
    expect(concurrentReconcile.jobId).toBe(firstReconcile.jobId);
    expect(firstReconcile).toMatchObject({
      status: "PENDING",
      processedCount: 0,
      safeErrorCode: null,
    });
    const reconcileWorkerA = new WalletWorker(prisma.client, {} as never, environment.values);
    await reconcileWorkerA.processOneProgramSyncJob(firstReconcile.jobId);
    expect(
      await prisma.client.programWalletSyncJob.findUniqueOrThrow({
        where: { id: firstReconcile.jobId },
        select: { processedCount: true, status: true },
      }),
    ).toEqual({ processedCount: 500, status: "PENDING" });

    await prisma.client.programWalletSyncJob.update({
      where: { id: firstReconcile.jobId },
      data: { cursorCreatedAt: null, cursorPassInstanceId: null },
    });
    const reconcileWorkerB = new WalletWorker(prisma.client, {} as never, environment.values);
    await reconcileWorkerB.processOneProgramSyncJob(firstReconcile.jobId);
    expect(
      await prisma.client.programWalletSyncJob.findUniqueOrThrow({
        where: { id: firstReconcile.jobId },
        select: { processedCount: true },
      }),
    ).toEqual({ processedCount: 500 });
    await reconcileWorkerB.processOneProgramSyncJob(firstReconcile.jobId);
    await reconcileWorkerB.processOneProgramSyncJob(firstReconcile.jobId);
    expect(
      await wallets.reconciliationStatus(
        fixture.ownerId,
        fixture.organizationId,
        massProgram.id,
        firstReconcile.jobId,
      ),
    ).toMatchObject({ status: "COMPLETED", processedCount: count + 1 });
    expect(
      await prisma.client.walletCommand.count({
        where: {
          commandType: "RECONCILE",
          idempotencyKey: { contains: `program-sync:${firstReconcile.jobId}` },
        },
      }),
    ).toBe(count + 1);
    expect(
      await prisma.client.auditLog.count({
        where: {
          action: "wallet.program_reconciliation_job_created",
          targetId: firstReconcile.jobId,
        },
      }),
    ).toBe(1);
    // Keep the shared local test database free of a 1,000-command backlog so
    // later worker/E2E suites are not starved by this scale fixture.
    await prisma.client.walletCommand.deleteMany({
      where: { membership: { programId: massProgram.id } },
    });
  }, 180_000);
});
