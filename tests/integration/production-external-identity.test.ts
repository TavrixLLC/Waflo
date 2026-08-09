import { randomUUID } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { hashPassword } from "../../packages/auth/src/index.js";
import {
  createLocalJWKSet,
  exportJWK,
  exportPKCS8,
  generateKeyPair,
  SignJWT,
  type KeyLike,
} from "jose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApiApplication } from "../../apps/api/src/app.js";
import { AuthService } from "../../apps/api/src/auth/auth.service.js";
import { ExternalAuthService } from "../../apps/api/src/auth/external-auth.service.js";
import type { WafloRequest } from "../../apps/api/src/common/request-context.js";
import { EnvironmentService } from "../../apps/api/src/config/environment.service.js";
import { PrismaService } from "../../apps/api/src/database/prisma.service.js";
import { OrganizationsService } from "../../apps/api/src/organizations/organizations.service.js";
import { CustomerCardService } from "../../apps/api/src/customer/customer-card.service.js";
import { WalletWorker } from "../../apps/wallet-worker/src/main.js";
import {
  createW3CustomerWalletFixture,
  w3EnrollmentBase,
} from "../helpers/w3-customer-wallet-fixture.js";

const GOOGLE_CLIENT_ID = "google-production-completion-client";
const APPLE_CLIENT_ID = "app.waflo.production-completion";
const GOOGLE_ISSUER = "https://accounts.google.com";
const APPLE_ISSUER = "https://appleid.apple.com";

function requiredQueryParameter(url: URL, name: string): string {
  const value = url.searchParams.get(name);
  if (!value) throw new Error(`Missing ${name} query parameter.`);
  return value;
}

describe.sequential("production external identity and lifecycle", () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let external: ExternalAuthService;
  let auth: AuthService;
  let organizations: OrganizationsService;
  let cards: CustomerCardService;
  let environment: EnvironmentService;
  let providerPrivateKey: KeyLike;

  const request = {
    requestId: "production-external-identity",
    id: "production-external-identity",
    ip: "127.0.0.1",
    headers: { "user-agent": "Waflo production identity test" },
  } as unknown as WafloRequest;

  beforeAll(async () => {
    const appleClientKeys = await generateKeyPair("ES256", { extractable: true });
    process.env.NODE_ENV = "test";
    process.env.API_PUBLIC_URL = "http://localhost:4000";
    process.env.MERCHANT_DASHBOARD_URL = "http://localhost:3001";
    process.env.GOOGLE_SIGNIN_CLIENT_ID = GOOGLE_CLIENT_ID;
    process.env.GOOGLE_SIGNIN_CLIENT_SECRET = "google-test-secret";
    process.env.GOOGLE_SIGNIN_REDIRECT_URI =
      "http://localhost:4000/v1/auth/external/google/callback";
    process.env.APPLE_SIGNIN_CLIENT_ID = APPLE_CLIENT_ID;
    process.env.APPLE_SIGNIN_TEAM_ID = "WAFLOTEAM1";
    process.env.APPLE_SIGNIN_KEY_ID = "APPLEKEY1";
    process.env.APPLE_SIGNIN_PRIVATE_KEY = await exportPKCS8(appleClientKeys.privateKey);
    process.env.APPLE_SIGNIN_REDIRECT_URI = "http://localhost:4000/v1/auth/external/apple/callback";
    process.env.OAUTH_FLOW_SECRET = "oauth-flow-test-secret-which-is-long-enough";

    app = await createApiApplication({ logger: false });
    prisma = app.get(PrismaService);
    external = app.get(ExternalAuthService);
    auth = app.get(AuthService);
    organizations = app.get(OrganizationsService);
    cards = app.get(CustomerCardService);
    environment = app.get(EnvironmentService);

    const providerKeys = await generateKeyPair("RS256", { extractable: true });
    providerPrivateKey = providerKeys.privateKey;
    const publicJwk = await exportJWK(providerKeys.publicKey);
    const localJwks = createLocalJWKSet({
      keys: [{ ...publicJwk, kid: "provider-test-key", alg: "RS256", use: "sig" }],
    });
    external.googleJwks = localJwks;
    external.appleJwks = localJwks;
  }, 120_000);

  afterAll(async () => app?.close());

  async function start(provider: "google" | "apple", registration: boolean) {
    const result = await external.start(provider, {
      locale: "en",
      allowRegistration: registration,
      legalAccepted: registration,
    });
    const url = new URL(result.authorizationUrl);
    return {
      state: requiredQueryParameter(url, "state"),
      nonce: requiredQueryParameter(url, "nonce"),
      url,
    };
  }

  async function idToken(input: {
    issuer: string;
    audience: string | string[];
    subject: string;
    nonce: string;
    email?: string;
    emailVerified?: boolean;
    azp?: string;
  }) {
    return new SignJWT({
      nonce: input.nonce,
      ...(input.email ? { email: input.email } : {}),
      ...(input.emailVerified !== undefined ? { email_verified: input.emailVerified } : {}),
      ...(input.azp ? { azp: input.azp } : {}),
    })
      .setProtectedHeader({ alg: "RS256", kid: "provider-test-key" })
      .setIssuer(input.issuer)
      .setAudience(input.audience)
      .setSubject(input.subject)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(providerPrivateKey);
  }

  function returnToken(token: string) {
    external.providerFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ id_token: token }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;
  }

  it("maps a verified Google subject to a Waflo user and consumes state once", async () => {
    const flow = await start("google", true);
    expect(flow.url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:4000/v1/auth/external/google/callback",
    );
    expect(flow.url.searchParams.get("code_challenge_method")).toBe("S256");
    const subject = `google-${randomUUID()}`;
    const email = `${randomUUID()}@google.example`;
    returnToken(
      await idToken({
        issuer: GOOGLE_ISSUER,
        audience: GOOGLE_CLIENT_ID,
        subject,
        nonce: flow.nonce,
        email,
        emailVerified: true,
      }),
    );
    const completed = await external.complete(
      { provider: "google", state: flow.state, code: "one-time-google-code" },
      request,
    );
    const identity = await prisma.client.externalIdentity.findUniqueOrThrow({
      where: {
        provider_issuer_providerSubject: {
          provider: "GOOGLE",
          issuer: GOOGLE_ISSUER,
          providerSubject: subject,
        },
      },
    });
    expect(identity.userId).toBeTruthy();
    expect(identity.providerEmail).toBe(email);
    expect(completed.session.rawToken).not.toContain("one-time-google-code");
    await expect(
      external.complete({ provider: "google", state: flow.state, code: "replayed-code" }, request),
    ).rejects.toMatchObject({ code: "EXTERNAL_AUTH_INVALID" });
  });

  it("rejects Google issuer/audience and nonce boundaries", async () => {
    const wrongAudience = await start("google", true);
    returnToken(
      await idToken({
        issuer: GOOGLE_ISSUER,
        audience: "different-client",
        subject: randomUUID(),
        nonce: wrongAudience.nonce,
        email: `${randomUUID()}@google.example`,
        emailVerified: true,
      }),
    );
    await expect(
      external.complete(
        { provider: "google", state: wrongAudience.state, code: "wrong-audience" },
        request,
      ),
    ).rejects.toMatchObject({ code: "EXTERNAL_AUTH_FAILED" });

    const wrongNonce = await start("google", true);
    returnToken(
      await idToken({
        issuer: GOOGLE_ISSUER,
        audience: GOOGLE_CLIENT_ID,
        subject: randomUUID(),
        nonce: "wrong-nonce",
        email: `${randomUUID()}@google.example`,
        emailVerified: true,
      }),
    );
    await expect(
      external.complete(
        { provider: "google", state: wrongNonce.state, code: "wrong-nonce" },
        request,
      ),
    ).rejects.toMatchObject({ code: "EXTERNAL_AUTH_FAILED" });
  });

  it("does not auto-link a matching verified email to a password account", async () => {
    const email = `${randomUUID()}@collision.example`;
    const user = await prisma.client.user.create({
      data: {
        email,
        normalizedEmail: email,
        displayName: "Existing merchant",
        passwordHash: await hashPassword("Existing password 2026!"),
        emailVerifiedAt: new Date(),
        termsVersion: "test",
        privacyVersion: "test",
        legalAcceptedAt: new Date(),
      },
    });
    const flow = await start("google", true);
    returnToken(
      await idToken({
        issuer: GOOGLE_ISSUER,
        audience: GOOGLE_CLIENT_ID,
        subject: `collision-${randomUUID()}`,
        nonce: flow.nonce,
        email,
        emailVerified: true,
      }),
    );
    await expect(
      external.complete({ provider: "google", state: flow.state, code: "collision" }, request),
    ).rejects.toMatchObject({ code: "EXTERNAL_AUTH_ACTION_REQUIRED" });
    expect(await prisma.client.externalIdentity.count({ where: { userId: user.id } })).toBe(0);
  });

  it("requires re-verification for explicit linking and rotates the source session", async () => {
    const password = "Link identity password 2026!";
    const email = `${randomUUID()}@link.example`;
    const user = await prisma.client.user.create({
      data: {
        email,
        normalizedEmail: email,
        displayName: "Link merchant",
        passwordHash: await hashPassword(password),
        emailVerifiedAt: new Date(),
        termsVersion: "test",
        privacyVersion: "test",
        legalAcceptedAt: new Date(),
      },
    });
    const sourceSession = await auth.createSession(user.id, request);
    await expect(
      external.startLink("google", user.id, sourceSession.sessionId, "wrong password", "en"),
    ).rejects.toMatchObject({ code: "REAUTHENTICATION_REQUIRED" });
    const started = await external.startLink(
      "google",
      user.id,
      sourceSession.sessionId,
      password,
      "en",
    );
    const flowUrl = new URL(started.authorizationUrl);
    const subject = `linked-${randomUUID()}`;
    returnToken(
      await idToken({
        issuer: GOOGLE_ISSUER,
        audience: GOOGLE_CLIENT_ID,
        subject,
        nonce: requiredQueryParameter(flowUrl, "nonce"),
        email,
        emailVerified: true,
      }),
    );
    await external.complete(
      {
        provider: "google",
        state: requiredQueryParameter(flowUrl, "state"),
        code: "link-code",
      },
      request,
    );
    expect(
      await prisma.client.externalIdentity.count({
        where: { userId: user.id, provider: "GOOGLE" },
      }),
    ).toBe(1);
    expect(
      (await prisma.client.session.findUniqueOrThrow({ where: { id: sourceSession.sessionId } }))
        .revocationReason,
    ).toBe("external_identity_link_rotation");
  });

  it("rejects a link callback after its reauthenticated session is revoked", async () => {
    const password = "Revoked link session 2026!";
    const email = `${randomUUID()}@revoked-link.example`;
    const user = await prisma.client.user.create({
      data: {
        email,
        normalizedEmail: email,
        displayName: "Revoked link merchant",
        passwordHash: await hashPassword(password),
        emailVerifiedAt: new Date(),
        termsVersion: "test",
        privacyVersion: "test",
        legalAcceptedAt: new Date(),
      },
    });
    const sourceSession = await auth.createSession(user.id, request);
    const started = await external.startLink(
      "google",
      user.id,
      sourceSession.sessionId,
      password,
      "en",
    );
    const flowUrl = new URL(started.authorizationUrl);
    await prisma.client.session.update({
      where: { id: sourceSession.sessionId },
      data: { revokedAt: new Date(), revocationReason: "security_revocation" },
    });
    returnToken(
      await idToken({
        issuer: GOOGLE_ISSUER,
        audience: GOOGLE_CLIENT_ID,
        subject: `revoked-link-${randomUUID()}`,
        nonce: requiredQueryParameter(flowUrl, "nonce"),
        email,
        emailVerified: true,
      }),
    );
    await expect(
      external.complete(
        {
          provider: "google",
          state: requiredQueryParameter(flowUrl, "state"),
          code: "revoked-link-code",
        },
        request,
      ),
    ).rejects.toMatchObject({ code: "EXTERNAL_AUTH_INVALID" });
    expect(await prisma.client.externalIdentity.count({ where: { userId: user.id } })).toBe(0);
  });

  it("keeps Google provider subject permanent while provider email metadata changes", async () => {
    const first = await start("google", true);
    const subject = `permanent-${randomUUID()}`;
    const firstEmail = `${randomUUID()}@first.example`;
    returnToken(
      await idToken({
        issuer: GOOGLE_ISSUER,
        audience: GOOGLE_CLIENT_ID,
        subject,
        nonce: first.nonce,
        email: firstEmail,
        emailVerified: true,
      }),
    );
    await external.complete({ provider: "google", state: first.state, code: "first" }, request);
    const second = await start("google", false);
    const changedEmail = `${randomUUID()}@changed.example`;
    returnToken(
      await idToken({
        issuer: GOOGLE_ISSUER,
        audience: GOOGLE_CLIENT_ID,
        subject,
        nonce: second.nonce,
        email: changedEmail,
        emailVerified: true,
      }),
    );
    await external.complete({ provider: "google", state: second.state, code: "second" }, request);
    const identities = await prisma.client.externalIdentity.findMany({
      where: { provider: "GOOGLE", issuer: GOOGLE_ISSUER, providerSubject: subject },
    });
    expect(identities).toHaveLength(1);
    expect(identities[0]?.providerEmail).toBe(changedEmail);
  });

  it("preserves Apple stable subject and relay metadata when later authorization omits email", async () => {
    const first = await start("apple", true);
    const subject = `apple-${randomUUID()}`;
    const relay = `${randomUUID()}@privaterelay.appleid.com`;
    returnToken(
      await idToken({
        issuer: APPLE_ISSUER,
        audience: APPLE_CLIENT_ID,
        subject,
        nonce: first.nonce,
        email: relay,
        emailVerified: true,
      }),
    );
    await external.complete(
      {
        provider: "apple",
        state: first.state,
        code: "apple-first-code",
        appleUser: JSON.stringify({
          email: relay,
          name: { firstName: "Relay", lastName: "Merchant" },
        }),
      },
      request,
    );
    const second = await start("apple", false);
    returnToken(
      await idToken({
        issuer: APPLE_ISSUER,
        audience: APPLE_CLIENT_ID,
        subject,
        nonce: second.nonce,
      }),
    );
    await external.complete(
      { provider: "apple", state: second.state, code: "apple-later-code" },
      request,
    );
    const identity = await prisma.client.externalIdentity.findUniqueOrThrow({
      where: {
        provider_issuer_providerSubject: {
          provider: "APPLE",
          issuer: APPLE_ISSUER,
          providerSubject: subject,
        },
      },
    });
    expect(identity.providerEmail).toBe(relay);
  });

  it("rejects Apple audience mismatch and cannot unlink the final authentication method", async () => {
    const invalid = await start("apple", true);
    returnToken(
      await idToken({
        issuer: APPLE_ISSUER,
        audience: "wrong.apple.client",
        subject: randomUUID(),
        nonce: invalid.nonce,
        email: `${randomUUID()}@privaterelay.appleid.com`,
        emailVerified: true,
      }),
    );
    await expect(
      external.complete({ provider: "apple", state: invalid.state, code: "wrong-aud" }, request),
    ).rejects.toMatchObject({ code: "EXTERNAL_AUTH_FAILED" });

    const valid = await start("apple", true);
    const subject = `final-method-${randomUUID()}`;
    returnToken(
      await idToken({
        issuer: APPLE_ISSUER,
        audience: APPLE_CLIENT_ID,
        subject,
        nonce: valid.nonce,
        email: `${randomUUID()}@privaterelay.appleid.com`,
        emailVerified: true,
      }),
    );
    await external.complete({ provider: "apple", state: valid.state, code: "valid" }, request);
    const identity = await prisma.client.externalIdentity.findUniqueOrThrow({
      where: {
        provider_issuer_providerSubject: {
          provider: "APPLE",
          issuer: APPLE_ISSUER,
          providerSubject: subject,
        },
      },
    });
    await expect(
      external.unlink("apple", identity.userId, randomUUID(), undefined, request),
    ).rejects.toMatchObject({ code: "FINAL_AUTH_METHOD" });
  });

  it("serializes concurrent identity unlinking so one authentication method always remains", async () => {
    const email = `${randomUUID()}@unlink-race.example`;
    const user = await prisma.client.user.create({
      data: {
        email,
        normalizedEmail: email,
        displayName: "Unlink race merchant",
        passwordHash: null,
        emailVerifiedAt: new Date(),
        termsVersion: "test",
        privacyVersion: "test",
        legalAcceptedAt: new Date(),
        externalIdentities: {
          create: [
            {
              provider: "GOOGLE",
              issuer: GOOGLE_ISSUER,
              providerSubject: `unlink-google-${randomUUID()}`,
              providerEmail: email,
              emailVerified: true,
            },
            {
              provider: "APPLE",
              issuer: APPLE_ISSUER,
              providerSubject: `unlink-apple-${randomUUID()}`,
              providerEmail: `${randomUUID()}@privaterelay.appleid.com`,
              emailVerified: true,
            },
          ],
        },
      },
    });
    const activeSession = await auth.createSession(user.id, request);
    const results = await Promise.allSettled([
      external.unlink("google", user.id, activeSession.sessionId, undefined, request),
      external.unlink("apple", user.id, activeSession.sessionId, undefined, request),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await prisma.client.externalIdentity.count({ where: { userId: user.id } })).toBe(1);
  });

  it("deactivation revokes sessions and external authorization material without erasing identity history", async () => {
    const email = `${randomUUID()}@deactivate.example`;
    const password = "Deactivate account 2026!";
    const user = await prisma.client.user.create({
      data: {
        email,
        normalizedEmail: email,
        displayName: "Deactivate merchant",
        passwordHash: await hashPassword(password),
        emailVerifiedAt: new Date(),
        termsVersion: "test",
        privacyVersion: "test",
        legalAcceptedAt: new Date(),
        externalIdentities: {
          create: {
            provider: "GOOGLE",
            issuer: GOOGLE_ISSUER,
            providerSubject: `deactivate-${randomUUID()}`,
            providerEmail: email,
            emailVerified: true,
          },
        },
      },
    });
    const activeSession = await auth.createSession(user.id, request);
    const result = await auth.requestAccountLifecycle(
      user.id,
      "DEACTIVATION",
      {
        commandId: randomUUID(),
        sessionId: activeSession.sessionId,
        confirmation: "DEACTIVATE",
        currentPassword: password,
      },
      request,
    );
    expect(result.status).toBe("COMPLETED");
    expect((await prisma.client.user.findUniqueOrThrow({ where: { id: user.id } })).status).toBe(
      "DEACTIVATED",
    );
    expect(await prisma.client.session.count({ where: { userId: user.id, revokedAt: null } })).toBe(
      0,
    );
    expect(await prisma.client.externalIdentity.count({ where: { userId: user.id } })).toBe(1);
  });

  it("records a deletion request truthfully as retained pending policy processing", async () => {
    const email = `${randomUUID()}@deletion.example`;
    const password = "Request deletion 2026!";
    const user = await prisma.client.user.create({
      data: {
        email,
        normalizedEmail: email,
        displayName: "Deletion request merchant",
        passwordHash: await hashPassword(password),
        emailVerifiedAt: new Date(),
        termsVersion: "test",
        privacyVersion: "test",
        legalAcceptedAt: new Date(),
      },
    });
    const activeSession = await auth.createSession(user.id, request);
    const result = await auth.requestAccountLifecycle(
      user.id,
      "DELETION",
      {
        commandId: randomUUID(),
        sessionId: activeSession.sessionId,
        confirmation: "REQUEST DELETION",
        currentPassword: password,
      },
      request,
    );
    expect(result).toMatchObject({
      status: "COMPLETED",
      outcomeDisposition: "RETAINED_BY_POLICY",
      retentionNoticeCode: "ACCOUNT_DISABLED_PENDING_POLICY_PROCESSING",
    });
    const persisted = await prisma.client.merchantAccountLifecycleRequest.findUniqueOrThrow({
      where: { id: result.publicId },
    });
    expect(persisted.outcomeDisposition).toBe("RETAINED_BY_POLICY");
    expect(await prisma.client.session.count({ where: { userId: user.id, revokedAt: null } })).toBe(
      0,
    );
  });

  it("organization closure revokes operational authority while retaining the organization record", async () => {
    const email = `${randomUUID()}@closure.example`;
    const password = "Close organization 2026!";
    const owner = await prisma.client.user.create({
      data: {
        email,
        normalizedEmail: email,
        displayName: "Closure owner",
        passwordHash: await hashPassword(password),
        emailVerifiedAt: new Date(),
        termsVersion: "test",
        privacyVersion: "test",
        legalAcceptedAt: new Date(),
      },
    });
    const suffix = randomUUID().slice(0, 8);
    const organization = await prisma.client.organization.create({
      data: {
        name: `Closure ${suffix}`,
        normalizedName: `closure ${suffix}`,
        merchantSlug: `closure-${suffix}`,
        timezone: "UTC",
        members: { create: { userId: owner.id, role: "OWNER" } },
        domains: {
          create: {
            hostname: `closure-${suffix}.example.test`,
            type: "SUBDOMAIN",
            status: "ACTIVE",
            isPrimary: true,
          },
        },
        locations: { create: { name: "Closure location", timezone: "UTC" } },
      },
    });
    await prisma.client.organizationInvitation.create({
      data: {
        organizationId: organization.id,
        email: `${suffix}@invite.example`,
        normalizedEmail: `${suffix}@invite.example`,
        intendedRole: "STAFF",
        tokenHash: randomUUID().replaceAll("-", "").padEnd(64, "0"),
        invitedByUserId: owner.id,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    const result = await organizations.close(
      owner.id,
      organization.id,
      { confirmation: "CLOSE ORGANIZATION", currentPassword: password, sessionId: randomUUID() },
      request,
    );
    expect(result).toEqual({ status: "ARCHIVED", replayed: false });
    expect(
      await prisma.client.organization.findUniqueOrThrow({ where: { id: organization.id } }),
    ).toMatchObject({ status: "ARCHIVED" });
    expect(
      await prisma.client.organizationMember.count({
        where: { organizationId: organization.id, status: "ACTIVE" },
      }),
    ).toBe(0);
    expect(
      await prisma.client.organizationDomain.count({
        where: { organizationId: organization.id, status: "ACTIVE" },
      }),
    ).toBe(0);
    expect(
      await prisma.client.organizationInvitation.count({
        where: { organizationId: organization.id, status: "PENDING" },
      }),
    ).toBe(0);
  });

  it("accepts, scopes, audits, and idempotently tracks a customer privacy request", async () => {
    async function customerContext(label: string) {
      const fixture = await createW3CustomerWalletFixture(prisma.client, label);
      const commandId = randomUUID();
      const response = await app.inject({
        method: "POST",
        url: `/v1/public/programs/${fixture.programSlug}/enroll`,
        headers: {
          host: fixture.merchantHost,
          "content-type": "application/json",
          "x-idempotency-key": commandId,
        },
        payload: {
          ...w3EnrollmentBase,
          displayName: `Privacy ${label}`,
          formStartedAt: Date.now() - 2_000,
        },
      });
      expect(response.statusCode).toBe(201);
      const setCookie = Array.isArray(response.headers["set-cookie"])
        ? response.headers["set-cookie"][0]
        : response.headers["set-cookie"];
      const rawToken = String(setCookie).split(";")[0]?.split("=")[1];
      if (!rawToken) throw new Error("Customer session cookie was not issued.");
      return {
        fixture,
        request: {
          ...request,
          method: "POST",
          hostname: fixture.merchantHost,
          cookies: { waflo_customer: rawToken },
          headers: { ...request.headers, host: fixture.merchantHost },
        } as unknown as WafloRequest,
      };
    }

    const first = await customerContext("privacy-intake-a");
    const commandId = randomUUID();
    const [left, right] = await Promise.all([
      cards.createPrivacyRequest(first.request, {
        commandId,
        requestType: "ERASURE",
        confirmation: "CONFIRM",
      }),
      cards.createPrivacyRequest(first.request, {
        commandId,
        requestType: "ERASURE",
        confirmation: "CONFIRM",
      }),
    ]);
    const created = left.replayed ? right : left;
    const replay = left.replayed ? left : right;
    expect(created.status).toBe("PENDING");
    expect(replay).toMatchObject({ publicId: created.publicId, replayed: true });
    expect([left.replayed, right.replayed].sort()).toEqual([false, true]);
    expect(await cards.privacyRequestStatus(first.request, created.publicId)).toMatchObject({
      publicId: created.publicId,
      requestType: "ERASURE",
      status: "PENDING",
    });
    const persisted = await prisma.client.customerPrivacyRequest.findUniqueOrThrow({
      where: { publicId: created.publicId },
    });
    expect(persisted.identityValidatedAt).not.toBeNull();
    expect(persisted.requestedByCustomerSessionId).not.toBeNull();

    const second = await customerContext("privacy-intake-b");
    await expect(
      cards.privacyRequestStatus(second.request, created.publicId),
    ).rejects.toMatchObject({
      code: "PRIVACY_REQUEST_NOT_FOUND",
    });
  });

  it("persists Wallet Worker readiness and graceful-stopping health without exposing payloads", async () => {
    const worker = new WalletWorker(
      prisma.client,
      { ping: vi.fn(async () => "PONG") } as never,
      environment.values,
      new Map(),
    );
    Object.defineProperty(worker, "objectStorage", {
      value: { send: vi.fn(async () => ({})) },
    });
    expect(await worker.readiness()).toMatchObject({ status: "ready", providerHealth: [] });
    let heartbeat = await prisma.client.workerHeartbeat.findUniqueOrThrow({
      where: { workerCode: "WALLET_WORKER" },
    });
    expect(heartbeat.safeFailureCode).toBeNull();
    expect(heartbeat.stoppingAt).toBeNull();
    await worker.stop();
    heartbeat = await prisma.client.workerHeartbeat.findUniqueOrThrow({
      where: { workerCode: "WALLET_WORKER" },
    });
    expect(heartbeat.stoppingAt).not.toBeNull();
    expect(JSON.stringify(heartbeat)).not.toMatch(/private|token|payload|certificate/i);
  });
});
