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
let membershipId = "";
let applePassId = "";
let appleSerial = "";
let sessionCookie = "";

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

async function prepareTransferRace(displayName: string) {
  const enrollment = await app.inject({
    method: "POST",
    url: `/v1/public/programs/${fixture.programSlug}/enroll`,
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

describe.sequential("W3 Customer and Wallet concurrency invariants", () => {
  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.APPLE_WALLET_MODE = "TEST_ADAPTER";
    process.env.GOOGLE_WALLET_MODE = "TEST_ADAPTER";
    process.env.GOOGLE_WALLET_ISSUER_ID = "w3-concurrency-issuer";
    app = await createApiApplication({ logger: false });
    prisma = app.get(PrismaService);
    environment = app.get(EnvironmentService);
    security = app.get(CustomerSecurityService);
    fixture = await createW3CustomerWalletFixture(prisma.client, "concurrency");
    const enrollment = await app.inject({
      method: "POST",
      url: `/v1/public/programs/${fixture.programSlug}/enroll`,
      headers: {
        host: fixture.merchantHost,
        "content-type": "application/json",
        "x-idempotency-key": `enroll:${randomUUID()}`,
      },
      payload: {
        ...w3EnrollmentBase,
        displayName: "Concurrency Member",
        formStartedAt: Date.now() - 2_000,
      },
    });
    expect(enrollment.statusCode).toBe(201);
    sessionCookie = cookie(enrollment, environment.values.CUSTOMER_COOKIE_NAME);
    const publicMembershipId = data<{ membership: { publicMembershipId: string } }>(enrollment)
      .membership.publicMembershipId;
    const membership = await prisma.client.membership.findUniqueOrThrow({
      where: { publicMembershipId },
      include: { walletPassInstances: true },
    });
    membershipId = membership.id;
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
        select: { updateTag: true },
      }),
    ).toEqual({ updateTag: 2 });
  });

  it("registers one encrypted Apple device under concurrent requests and reactivates it safely", async () => {
    const device = `device-${randomUUID().replaceAll("-", "")}`;
    const passType = "pass.app.waflo.test-adapter";
    const authorization = `ApplePass ${security.appleAuthenticationToken(
      applePassId,
      appleSerial,
    )}`;
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
      where: { walletPassInstanceId: applePassId, unregisteredAt: null },
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
    ).toBe(1);

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
        where: { walletPassInstanceId: applePassId, unregisteredAt: null },
      }),
    ).toBe(1);
  }, 120_000);

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
    const csrf = await bootstrapCsrf(sessionCookie);
    const rotate = () =>
      app.inject({
        method: "POST",
        url: "/v1/customer/session/rotate",
        headers: {
          host: fixture.merchantHost,
          origin: new URL(environment.values.CUSTOMER_WEB_URL).origin,
          cookie: `${sessionCookie}; ${csrf.csrfCookie}`,
          "x-csrf-token": csrf.token,
          "content-type": "application/json",
        },
        payload: {},
      });
    const results = await Promise.all([rotate(), rotate()]);
    expect(results.map((response) => response.statusCode).sort()).toEqual([201, 409]);
    const success = required(
      results.find((response) => response.statusCode === 201),
      "Successful rotation response",
    );
    sessionCookie = cookie(success, environment.values.CUSTOMER_COOKIE_NAME);
    const oldSession = required(
      results.find((response) => response.statusCode === 409),
      "Rejected stale rotation response",
    );
    expect(oldSession.body).toContain("CUSTOMER_SESSION_ALREADY_ROTATED");
    const crossHost = await app.inject({
      method: "GET",
      url: "/v1/customer/csrf",
      headers: { host: "today.lvh.me", cookie: sessionCookie },
    });
    expect(crossHost.statusCode).toBe(403);
    expect(crossHost.body).toContain("CUSTOMER_SESSION_HOST_MISMATCH");
  });

  it("completes a transfer replay compatibly with one active credential and event", async () => {
    const card = await app.inject({
      method: "GET",
      url: "/v1/customer/card",
      headers: { host: fixture.merchantHost, cookie: sessionCookie },
    });
    const qrPayload = data<{ membershipQr: { payload: string } }>(card).membershipQr.payload;
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
    const membership = await prisma.client.membership.findUniqueOrThrow({
      where: { id: membershipId },
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
    const count = 61;
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

    for (let page = 0; page < 10; page += 1) {
      const current = await prisma.client.programWalletSyncJob.findUniqueOrThrow({
        where: { id: job.id },
      });
      if (current.status === "COMPLETED") break;
      await workerB.processOneProgramSyncJob(job.id);
    }
    const completed = await prisma.client.programWalletSyncJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(completed).toMatchObject({ status: "COMPLETED", processedCount: count });
    expect(
      await prisma.client.walletCommand.count({
        where: { idempotencyKey: { contains: `program-sync:${job.id}` } },
      }),
    ).toBe(count);
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
    ).toEqual({ status: "PENDING", updateTag: 1 });
    expect(
      await prisma.client.walletCommand.count({
        where: {
          walletPassInstanceId: latePassId,
          idempotencyKey: { contains: `program-sync:${job.id}` },
        },
      }),
    ).toBe(0);
  }, 120_000);
});
