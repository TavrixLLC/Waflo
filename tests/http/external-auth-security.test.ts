import { randomUUID } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import {
  createLocalJWKSet,
  decodeProtectedHeader,
  exportJWK,
  exportPKCS8,
  generateKeyPair,
  jwtVerify,
  type KeyLike,
  SignJWT,
} from "jose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApiApplication } from "../../apps/api/src/app.js";
import { AuthService } from "../../apps/api/src/auth/auth.service.js";
import { ExternalAuthService } from "../../apps/api/src/auth/external-auth.service.js";
import { EnvironmentService } from "../../apps/api/src/config/environment.service.js";
import { PrismaService } from "../../apps/api/src/database/prisma.service.js";

const GOOGLE_CLIENT_ID = "google-http-security-client";
const APPLE_CLIENT_ID = "app.waflo.http-security";
const GOOGLE_ISSUER = "https://accounts.google.com";
const APPLE_ISSUER = "https://appleid.apple.com";
const runId = randomUUID().slice(0, 8);
let remoteAddressCounter = 1;

function testRemoteAddress(): string {
  const value = remoteAddressCounter++;
  return `10.123.${Math.floor(value / 250)}.${(value % 250) + 1}`;
}

type Provider = "google" | "apple";

interface StartedFlow {
  provider: Provider;
  state: string;
  nonce: string;
  correlationCookie: string;
  correlationCookieName: string;
  authorizationUrl: URL;
}

function setCookies(response: { headers: Record<string, string | string[] | undefined> }) {
  const value = response.headers["set-cookie"];
  return Array.isArray(value) ? value : value ? [value] : [];
}

function bareCookie(value: string): string {
  return value.split(";", 1)[0] ?? "";
}

function envelope<T>(response: { json(): unknown }): T {
  return (response.json() as { data: T }).data;
}

describe.sequential("external-auth HTTP security boundary", () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let external: ExternalAuthService;
  let auth: AuthService;
  let environment: EnvironmentService;
  let providerPrivateKey: KeyLike;
  let invalidProviderPrivateKey: KeyLike;
  let appleClientPublicKey: KeyLike;
  let nextProviderTokenResponse: Record<string, unknown> | null = null;
  const providerCalls: Array<{ url: string; body: URLSearchParams }> = [];

  beforeAll(async () => {
    const appleClientKeys = await generateKeyPair("ES256", { extractable: true });
    appleClientPublicKey = appleClientKeys.publicKey;
    process.env.NODE_ENV = "test";
    process.env.DEPLOYMENT_ENVIRONMENT = "development";
    process.env.API_PUBLIC_URL = "http://localhost:4000";
    process.env.MERCHANT_DASHBOARD_URL = "http://localhost:3001";
    process.env.GOOGLE_SIGNIN_CLIENT_ID = GOOGLE_CLIENT_ID;
    process.env.GOOGLE_SIGNIN_CLIENT_SECRET = "google-http-test-secret";
    process.env.GOOGLE_SIGNIN_REDIRECT_URI =
      "http://localhost:4000/v1/auth/external/google/callback";
    process.env.APPLE_SIGNIN_CLIENT_ID = APPLE_CLIENT_ID;
    process.env.APPLE_SIGNIN_TEAM_ID = "WAFLOTEAM1";
    process.env.APPLE_SIGNIN_KEY_ID = "APPLEKEY1";
    process.env.APPLE_SIGNIN_PRIVATE_KEY = await exportPKCS8(appleClientKeys.privateKey);
    process.env.APPLE_SIGNIN_REDIRECT_URI = "http://localhost:4000/v1/auth/external/apple/callback";
    process.env.OAUTH_FLOW_SECRET = "oauth-http-security-secret-which-is-long-enough";
    process.env.EXTERNAL_AUTH_TOKEN_ENCRYPTION_KEYS_JSON = JSON.stringify({
      1: Buffer.alloc(32, 7).toString("base64"),
    });
    process.env.EXTERNAL_AUTH_TOKEN_ACTIVE_KEY_VERSION = "1";
    process.env.RATE_LIMIT_NAMESPACE = `external-auth-http-${runId}`;

    app = await createApiApplication({ logger: false });
    prisma = app.get(PrismaService);
    external = app.get(ExternalAuthService);
    auth = app.get(AuthService);
    environment = app.get(EnvironmentService);

    const providerKeys = await generateKeyPair("RS256", { extractable: true });
    const invalidProviderKeys = await generateKeyPair("RS256", { extractable: true });
    providerPrivateKey = providerKeys.privateKey;
    invalidProviderPrivateKey = invalidProviderKeys.privateKey;
    const publicJwk = await exportJWK(providerKeys.publicKey);
    const localJwks = createLocalJWKSet({
      keys: [{ ...publicJwk, kid: "external-auth-http-key", alg: "RS256", use: "sig" }],
    });
    external.googleJwks = localJwks;
    external.appleJwks = localJwks;
    external.providerFetch = vi.fn(async (url, init) => {
      if (!nextProviderTokenResponse) throw new Error("Missing provider response fixture.");
      providerCalls.push({
        url: String(url),
        body: new URLSearchParams(String(init?.body ?? "")),
      });
      return new Response(JSON.stringify(nextProviderTokenResponse), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
  }, 120_000);

  afterAll(async () => app?.close());

  async function start(provider: Provider, registration = true): Promise<StartedFlow> {
    const response = await app.inject({
      method: "GET",
      url: `/v1/auth/external/${provider}/start?locale=en&registration=${registration}&termsAccepted=true&privacyAccepted=true`,
      remoteAddress: testRemoteAddress(),
    });
    expect(response.statusCode).toBe(302);
    const authorizationUrl = new URL(response.headers.location ?? "");
    const state = authorizationUrl.searchParams.get("state") ?? "";
    const nonce = authorizationUrl.searchParams.get("nonce") ?? "";
    const correlation = setCookies(response).find((value) => value.includes("waflo_oauth_"));
    expect(correlation).toBeTruthy();
    expect(correlation).toContain("HttpOnly");
    expect(correlation).toContain(`Path=/v1/auth/external/${provider}/callback`);
    expect(correlation).toContain("SameSite=Lax");
    const correlationCookie = bareCookie(correlation ?? "");
    return {
      provider,
      state,
      nonce,
      correlationCookie,
      correlationCookieName: correlationCookie.split("=", 1)[0] ?? "",
      authorizationUrl,
    };
  }

  async function identityToken(input: {
    provider: Provider;
    subject: string;
    nonce: string;
    email?: string;
    emailVerified?: boolean;
    issuer?: string;
    audience?: string;
    key?: KeyLike;
  }) {
    return new SignJWT({
      nonce: input.nonce,
      ...(input.email ? { email: input.email } : {}),
      ...(input.emailVerified !== undefined ? { email_verified: input.emailVerified } : {}),
    })
      .setProtectedHeader({ alg: "RS256", kid: "external-auth-http-key" })
      .setIssuer(input.issuer ?? (input.provider === "google" ? GOOGLE_ISSUER : APPLE_ISSUER))
      .setAudience(
        input.audience ?? (input.provider === "google" ? GOOGLE_CLIENT_ID : APPLE_CLIENT_ID),
      )
      .setSubject(input.subject)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(input.key ?? providerPrivateKey);
  }

  async function prepareProviderResponse(input: {
    provider: Provider;
    subject: string;
    nonce: string;
    email?: string;
    emailVerified?: boolean;
    issuer?: string;
    audience?: string;
  }) {
    nextProviderTokenResponse = {
      id_token: await identityToken(input),
      access_token: `access-${randomUUID()}`,
      refresh_token: `refresh-${randomUUID()}`,
      expires_in: 3600,
      token_type: "Bearer",
    };
  }

  async function callback(
    flow: StartedFlow,
    input: {
      cookie?: string;
      code?: string;
      user?: string;
      error?: string;
      state?: string;
    } = {},
  ) {
    const state = input.state ?? flow.state;
    const code = input.code ?? "provider-code";
    const cookie = input.cookie;
    if (flow.provider === "google") {
      const query = new URLSearchParams({
        state,
        ...(input.error ? { error: input.error } : { code }),
      });
      return app.inject({
        method: "GET",
        url: `/v1/auth/external/google/callback?${query.toString()}`,
        remoteAddress: testRemoteAddress(),
        ...(cookie ? { headers: { cookie } } : {}),
      });
    }
    const form = new URLSearchParams({
      state,
      ...(input.error ? { error: input.error } : { code }),
      ...(input.user ? { user: input.user } : {}),
    });
    return app.inject({
      method: "POST",
      url: "/v1/auth/external/apple/callback",
      remoteAddress: testRemoteAddress(),
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...(cookie ? { cookie } : {}),
      },
      payload: form.toString(),
    });
  }

  function expectAuthenticated(response: Awaited<ReturnType<typeof callback>>) {
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toContain("result=authenticated");
    const session = setCookies(response).find((value) =>
      value.startsWith(`${environment.values.COOKIE_NAME}=`),
    );
    expect(session).toContain("HttpOnly");
    return bareCookie(session ?? "");
  }

  function expectFailed(response: Awaited<ReturnType<typeof callback>>, code?: string) {
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toContain("result=failed");
    expect(
      setCookies(response).some((value) => value.startsWith(`${environment.values.COOKIE_NAME}=`)),
    ).toBe(false);
    if (code) {
      expect(response.body).not.toContain(code);
      expect(response.headers.location).not.toContain(code);
    }
  }

  it.each(["google", "apple"] as const)(
    "rejects a %s callback transferred to another browser without consuming Browser A's flow",
    async (provider) => {
      const flow = await start(provider);
      const subject = `${provider}-browser-binding-${randomUUID()}`;
      await prepareProviderResponse({
        provider,
        subject,
        nonce: flow.nonce,
        email: `${randomUUID()}@${provider}.example`,
        emailVerified: true,
      });
      const victimEmail = `${randomUUID()}@victim.example`;
      const victim = await prisma.client.user.create({
        data: {
          email: victimEmail,
          normalizedEmail: victimEmail,
          displayName: "Victim merchant",
          passwordHash: "victim-password-hash",
          emailVerifiedAt: new Date(),
          termsVersion: "test",
          privacyVersion: "test",
          legalAcceptedAt: new Date(),
        },
      });
      const victimSession = await auth.createSession(victim.id, {
        requestId: `victim-${randomUUID()}`,
        id: `victim-${randomUUID()}`,
        ip: "127.0.0.1",
        headers: {},
      } as never);
      const victimCookie = `${environment.values.COOKIE_NAME}=${victimSession.rawToken}`;
      const callsBefore = providerCalls.length;
      expectFailed(await callback(flow, { cookie: victimCookie }), "provider-code");
      expect(providerCalls).toHaveLength(callsBefore);
      expect(
        await prisma.client.externalIdentity.count({ where: { providerSubject: subject } }),
      ).toBe(0);
      const victimMe = await app.inject({
        method: "GET",
        url: "/v1/auth/me",
        headers: { cookie: victimCookie },
        remoteAddress: testRemoteAddress(),
      });
      expect(envelope<{ id: string }>(victimMe).id).toBe(victim.id);

      const wrongCookie = `${flow.correlationCookieName}=${Buffer.alloc(32, 4).toString("base64url")}`;
      expectFailed(await callback(flow, { cookie: `${victimCookie}; ${wrongCookie}` }));
      expect(providerCalls).toHaveLength(callsBefore);

      const correct = await callback(flow, { cookie: flow.correlationCookie });
      expectAuthenticated(correct);
      expect(
        await prisma.client.externalIdentity.count({ where: { providerSubject: subject } }),
      ).toBe(1);
      expect(
        setCookies(correct).some(
          (value) =>
            value.startsWith(`${flow.correlationCookieName}=`) && value.includes("Expires="),
        ),
      ).toBe(true);
    },
  );

  it.each(["google", "apple"] as const)(
    "keeps parallel %s flows independently valid and rejects expired/reused flows",
    async (provider) => {
      const first = await start(provider);
      const second = await start(provider);
      expect(first.correlationCookieName).not.toBe(second.correlationCookieName);
      const browserCookies = `${first.correlationCookie}; ${second.correlationCookie}`;

      await prepareProviderResponse({
        provider,
        subject: `${provider}-parallel-one-${randomUUID()}`,
        nonce: first.nonce,
        email: `${randomUUID()}@parallel.example`,
        emailVerified: true,
      });
      expectAuthenticated(await callback(first, { cookie: browserCookies, code: "parallel-one" }));

      await prepareProviderResponse({
        provider,
        subject: `${provider}-parallel-two-${randomUUID()}`,
        nonce: second.nonce,
        email: `${randomUUID()}@parallel.example`,
        emailVerified: true,
      });
      expectAuthenticated(await callback(second, { cookie: browserCookies, code: "parallel-two" }));
      expectFailed(await callback(first, { cookie: first.correlationCookie, code: "reused" }));

      const expired = await start(provider);
      await prisma.client.oAuthAuthorizationRequest.update({
        where: {
          stateHash: (await import("../../packages/auth/src/index.js")).hashOpaqueToken(
            expired.state,
          ),
        },
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });
      await prepareProviderResponse({
        provider,
        subject: `${provider}-expired-${randomUUID()}`,
        nonce: expired.nonce,
        email: `${randomUUID()}@expired.example`,
        emailVerified: true,
      });
      expectFailed(await callback(expired, { cookie: expired.correlationCookie, code: "expired" }));
    },
  );

  it.each(["google", "apple"] as const)(
    "completes a %s flow on a different API replica without sticky sessions",
    async (provider) => {
      const flow = await start(provider);
      await prepareProviderResponse({
        provider,
        subject: `${provider}-replica-${randomUUID()}`,
        nonce: flow.nonce,
        email: `${randomUUID()}@replica.example`,
        emailVerified: true,
      });
      const replica = await createApiApplication({ logger: false });
      try {
        const replicaExternal = replica.get(ExternalAuthService);
        replicaExternal.googleJwks = external.googleJwks;
        replicaExternal.appleJwks = external.appleJwks;
        replicaExternal.providerFetch = external.providerFetch;
        const response =
          provider === "google"
            ? await replica.inject({
                method: "GET",
                url: `/v1/auth/external/google/callback?${new URLSearchParams({
                  state: flow.state,
                  code: "replica-code",
                }).toString()}`,
                headers: { cookie: flow.correlationCookie },
              })
            : await replica.inject({
                method: "POST",
                url: "/v1/auth/external/apple/callback",
                headers: {
                  cookie: flow.correlationCookie,
                  "content-type": "application/x-www-form-urlencoded",
                },
                payload: new URLSearchParams({
                  state: flow.state,
                  code: "replica-code",
                }).toString(),
              });
        expectAuthenticated(response);
      } finally {
        await replica.close();
      }
    },
  );

  it.each(["google", "apple"] as const)(
    "rejects %s wrong issuer, audience, and nonce at the HTTP callback",
    async (provider) => {
      for (const boundary of ["issuer", "audience", "nonce"] as const) {
        const flow = await start(provider);
        await prepareProviderResponse({
          provider,
          subject: `${provider}-${boundary}-${randomUUID()}`,
          nonce: boundary === "nonce" ? "wrong-nonce" : flow.nonce,
          email: `${randomUUID()}@boundary.example`,
          emailVerified: true,
          ...(boundary === "issuer" ? { issuer: "https://wrong-issuer.example" } : {}),
          ...(boundary === "audience" ? { audience: "wrong-audience" } : {}),
        });
        expectFailed(
          await callback(flow, { cookie: flow.correlationCookie, code: `wrong-${boundary}` }),
          `wrong-${boundary}`,
        );
      }
    },
  );

  it.each(["google", "apple"] as const)("rejects an unknown %s state", async (provider) => {
    const flow = await start(provider);
    const unknownState = Buffer.from(randomUUID().repeat(2)).toString("base64url").slice(0, 43);
    expectFailed(
      await callback(flow, {
        state: unknownState,
        cookie: flow.correlationCookie,
        code: "unknown-state-code",
      }),
      "unknown-state-code",
    );
  });

  it("uses Google PKCE, omits Apple PKCE, and sends Apple's exact documented token form", async () => {
    const google = await start("google");
    expect(google.authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(google.authorizationUrl.searchParams.get("code_challenge")).toBeTruthy();

    const apple = await start("apple");
    expect(apple.authorizationUrl.searchParams.get("response_mode")).toBe("form_post");
    expect(apple.authorizationUrl.searchParams.has("code_challenge")).toBe(false);
    expect(apple.authorizationUrl.searchParams.has("code_challenge_method")).toBe(false);
    await prepareProviderResponse({
      provider: "apple",
      subject: `apple-contract-${randomUUID()}`,
      nonce: apple.nonce,
      email: `${randomUUID()}@privaterelay.appleid.com`,
      emailVerified: true,
    });
    expectAuthenticated(
      await callback(apple, { cookie: apple.correlationCookie, code: "apple-form" }),
    );
    const exchange = providerCalls.at(-1);
    expect(exchange?.url).toBe("https://appleid.apple.com/auth/token");
    expect([...(exchange?.body.keys() ?? [])].sort()).toEqual(
      ["client_id", "client_secret", "code", "grant_type", "redirect_uri"].sort(),
    );
    expect(exchange?.body.has("code_verifier")).toBe(false);
    const clientSecret = exchange?.body.get("client_secret") ?? "";
    expect(decodeProtectedHeader(clientSecret)).toMatchObject({ alg: "ES256", kid: "APPLEKEY1" });
    const clientClaims = await jwtVerify(clientSecret, appleClientPublicKey, {
      issuer: "WAFLOTEAM1",
      audience: APPLE_ISSUER,
      subject: APPLE_CLIENT_ID,
    });
    expect(Number(clientClaims.payload.exp) - Number(clientClaims.payload.iat)).toBe(300);
  });

  it("issues a fresh merchant session cookie on external reauthentication", async () => {
    const subject = `google-session-rotation-${randomUUID()}`;
    const email = `${randomUUID()}@session.example`;
    const first = await start("google");
    await prepareProviderResponse({
      provider: "google",
      subject,
      nonce: first.nonce,
      email,
      emailVerified: true,
    });
    const firstSession = expectAuthenticated(
      await callback(first, { cookie: first.correlationCookie, code: "first-session" }),
    );

    const second = await start("google", false);
    await prepareProviderResponse({
      provider: "google",
      subject,
      nonce: second.nonce,
      email,
      emailVerified: true,
    });
    const secondSession = expectAuthenticated(
      await callback(second, {
        cookie: `${firstSession}; ${second.correlationCookie}`,
        code: "second-session",
      }),
    );
    expect(secondSession).not.toBe(firstSession);
    const identity = await prisma.client.externalIdentity.findFirstOrThrow({
      where: { provider: "GOOGLE", providerSubject: subject },
    });
    expect(
      await prisma.client.session.count({
        where: { userId: identity.userId, revokedAt: null, expiresAt: { gt: new Date() } },
      }),
    ).toBe(2);
  });

  it("accepts Apple form_post first-login name safely, ignores browser email, and supports repeat login", async () => {
    const subject = `apple-repeat-${randomUUID()}`;
    const relay = `${randomUUID()}@privaterelay.appleid.com`;
    const first = await start("apple");
    await prepareProviderResponse({
      provider: "apple",
      subject,
      nonce: first.nonce,
      email: relay,
      emailVerified: true,
    });
    expectAuthenticated(
      await callback(first, {
        cookie: first.correlationCookie,
        user: JSON.stringify({
          email: "untrusted-browser@example.test",
          name: { firstName: "  Relay\u0000", lastName: "Merchant  " },
        }),
      }),
    );
    const identity = await prisma.client.externalIdentity.findUniqueOrThrow({
      where: {
        provider_issuer_providerSubject: {
          provider: "APPLE",
          issuer: APPLE_ISSUER,
          providerSubject: subject,
        },
      },
      include: { user: true, appleCredential: true },
    });
    expect(identity.providerEmail).toBe(relay);
    expect(identity.user.displayName).toBe("Relay Merchant");
    expect(identity.appleCredential?.refreshTokenEncrypted).not.toContain("refresh-");

    const repeat = await start("apple", false);
    await prepareProviderResponse({ provider: "apple", subject, nonce: repeat.nonce });
    expectAuthenticated(await callback(repeat, { cookie: repeat.correlationCookie }));
    expect(
      await prisma.client.externalIdentity.count({ where: { providerSubject: subject } }),
    ).toBe(1);

    const malformedUser = await start("apple", false);
    await prepareProviderResponse({ provider: "apple", subject, nonce: malformedUser.nonce });
    expectAuthenticated(
      await callback(malformedUser, {
        cookie: malformedUser.correlationCookie,
        user: "{not-valid-json",
      }),
    );

    const untrustedOnly = await start("apple");
    const untrustedSubject = `apple-untrusted-email-${randomUUID()}`;
    await prepareProviderResponse({
      provider: "apple",
      subject: untrustedSubject,
      nonce: untrustedOnly.nonce,
    });
    expectFailed(
      await callback(untrustedOnly, {
        cookie: untrustedOnly.correlationCookie,
        user: JSON.stringify({
          email: `${randomUUID()}@browser-only.example`,
          name: { firstName: 42, lastName: ["invalid"] },
        }),
      }),
    );
    expect(
      await prisma.client.externalIdentity.count({ where: { providerSubject: untrustedSubject } }),
    ).toBe(0);
  });

  it("consumes a correctly correlated Apple cancellation without exposing provider details", async () => {
    const flow = await start("apple");
    const canceled = await callback(flow, {
      cookie: flow.correlationCookie,
      error: "user_cancelled_authorize",
    });
    expectFailed(canceled, "user_cancelled_authorize");
    expectFailed(await callback(flow, { cookie: flow.correlationCookie, code: "after-cancel" }));
  });

  it("verifies and idempotently processes Apple server notifications", async () => {
    const subject = `apple-notification-${randomUUID()}`;
    const email = `${randomUUID()}@privaterelay.appleid.com`;
    const user = await prisma.client.user.create({
      data: {
        email: `${randomUUID()}@notification-owner.example`,
        normalizedEmail: `${randomUUID()}@notification-normalized.example`,
        displayName: "Notification merchant",
        passwordHash: "password-enabled-for-lifecycle-test",
        emailVerifiedAt: new Date(),
        termsVersion: "test",
        privacyVersion: "test",
        legalAcceptedAt: new Date(),
        externalIdentities: {
          create: {
            provider: "APPLE",
            issuer: APPLE_ISSUER,
            providerSubject: subject,
            providerEmail: email,
            emailVerified: true,
          },
        },
      },
    });
    const session = await auth.createSession(user.id, {
      requestId: `notification-${runId}`,
      id: `notification-${runId}`,
      ip: "127.0.0.1",
      headers: {},
    } as never);

    async function notification(
      type: "email-enabled" | "email-disabled" | "consent-revoked" | "account-deleted",
      notificationId: string,
      key: KeyLike = providerPrivateKey,
      audience = APPLE_CLIENT_ID,
      issuedAt = Math.floor(Date.now() / 1_000),
    ) {
      return new SignJWT({
        events: {
          type,
          sub: subject,
          event_time: issuedAt,
          ...(type.startsWith("email-") ? { email, is_private_email: "true" } : {}),
        },
      })
        .setProtectedHeader({ alg: "RS256", kid: "external-auth-http-key" })
        .setIssuer(APPLE_ISSUER)
        .setAudience(audience)
        .setIssuedAt(issuedAt)
        .setJti(notificationId)
        .sign(key);
    }

    const emailPayload = await notification("email-disabled", `email-${randomUUID()}`);
    const emailResponse = await app.inject({
      method: "POST",
      url: "/v1/auth/external/apple/notifications",
      headers: { "content-type": "application/json" },
      payload: { payload: emailPayload },
    });
    expect(emailResponse.statusCode).toBe(200);
    expect(envelope<{ status: string }>(emailResponse).status).toBe("processed");
    expect(
      (
        await prisma.client.externalIdentity.findUniqueOrThrow({
          where: { userId_provider: { userId: user.id, provider: "APPLE" } },
        })
      ).emailForwardingEnabled,
    ).toBe(false);
    const duplicate = await app.inject({
      method: "POST",
      url: "/v1/auth/external/apple/notifications",
      headers: { "content-type": "application/json" },
      payload: { payload: emailPayload },
    });
    expect(envelope<{ status: string }>(duplicate).status).toBe("duplicate");

    for (const invalidPayload of [
      await notification(
        "consent-revoked",
        `bad-signature-${randomUUID()}`,
        invalidProviderPrivateKey,
      ),
      await notification(
        "consent-revoked",
        `bad-audience-${randomUUID()}`,
        providerPrivateKey,
        "wrong-audience",
      ),
      await notification(
        "consent-revoked",
        `expired-${randomUUID()}`,
        providerPrivateKey,
        APPLE_CLIENT_ID,
        Math.floor(Date.now() / 1_000) - 8 * 24 * 60 * 60,
      ),
    ]) {
      const invalid = await app.inject({
        method: "POST",
        url: "/v1/auth/external/apple/notifications",
        headers: { "content-type": "application/json" },
        payload: { payload: invalidPayload },
      });
      expect(invalid.statusCode).toBe(401);
    }

    const revokedPayload = await notification("consent-revoked", `revoke-${randomUUID()}`);
    const revoked = await app.inject({
      method: "POST",
      url: "/v1/auth/external/apple/notifications",
      headers: { "content-type": "application/json" },
      payload: { payload: revokedPayload },
    });
    expect(revoked.statusCode).toBe(200);
    expect(await prisma.client.externalIdentity.count({ where: { userId: user.id } })).toBe(0);
    expect(
      (await prisma.client.session.findUniqueOrThrow({ where: { id: session.sessionId } }))
        .revokedAt,
    ).not.toBeNull();
    expect((await prisma.client.user.findUniqueOrThrow({ where: { id: user.id } })).status).toBe(
      "ACTIVE",
    );
  });

  it("fails Apple HTTP start safely when the configured private key is malformed", async () => {
    const configuredKey = process.env.APPLE_SIGNIN_PRIVATE_KEY;
    process.env.APPLE_SIGNIN_PRIVATE_KEY = [
      "-----BEGIN",
      "PRIVATE KEY-----\nmalformed\n-----END",
      "PRIVATE KEY-----",
    ].join(" ");
    process.env.RATE_LIMIT_NAMESPACE = `external-auth-malformed-key-${runId}`;
    let malformedApp: NestFastifyApplication | undefined;
    try {
      malformedApp = await createApiApplication({ logger: false });
      const response = await malformedApp.inject({
        method: "GET",
        url: "/v1/auth/external/apple/start?locale=en",
        remoteAddress: testRemoteAddress(),
      });
      expect(response.statusCode).toBe(503);
      expect(response.body).not.toContain("malformed");
      expect(response.body).not.toContain("PRIVATE KEY");
    } finally {
      await malformedApp?.close();
      if (configuredKey === undefined) delete process.env.APPLE_SIGNIN_PRIVATE_KEY;
      else process.env.APPLE_SIGNIN_PRIVATE_KEY = configuredKey;
    }
  });
});
