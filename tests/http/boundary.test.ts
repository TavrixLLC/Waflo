import { createHmac, randomUUID } from "node:crypto";
import { createOpaqueToken, hashOpaqueToken, hashPassword } from "../../packages/auth/src/index";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApplication } from "../../apps/api/src/app";
import { BillingService } from "../../apps/api/src/billing/billing.service";
import { EnvironmentService } from "../../apps/api/src/config/environment.service";
import { PrismaService } from "../../apps/api/src/database/prisma.service";

const runId = randomUUID().slice(0, 8);
const password = "HTTP Boundary Waflo 2026!";
const allowedOrigin = "http://localhost:3001";
const webhookSecret = `whsec_${randomUUID().replaceAll("-", "")}`;
const previousStripeEnvironment = {
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  STRIPE_STARTER_MONTHLY_PRICE_ID: process.env.STRIPE_STARTER_MONTHLY_PRICE_ID,
  STRIPE_GROWTH_MONTHLY_PRICE_ID: process.env.STRIPE_GROWTH_MONTHLY_PRICE_ID,
  STRIPE_SCALE_MONTHLY_PRICE_ID: process.env.STRIPE_SCALE_MONTHLY_PRICE_ID,
  STRIPE_CUSTOMER_PORTAL_CONFIGURATION_ID: process.env.STRIPE_CUSTOMER_PORTAL_CONFIGURATION_ID,
};

interface Identity {
  userId: string;
  sessionCookie: string;
}

let app: NestFastifyApplication;
let prisma: PrismaService;
let environment: EnvironmentService;
let owner: Identity;
let manager: Identity;
let staff: Identity;
let intruder: Identity;
let organizationId = "";
let otherOrganizationId = "";
let locationId = "";
let memberId = "";

async function createIdentity(label: string): Promise<Identity> {
  const email = `${label}-${runId}-${randomUUID().slice(0, 6)}@http.waflo.local`;
  const user = await prisma.client.user.create({
    data: {
      email,
      normalizedEmail: email,
      displayName: label,
      passwordHash: await hashPassword(password),
      emailVerifiedAt: new Date(),
      preferredLocale: "EN",
      termsVersion: "test",
      privacyVersion: "test",
      legalAcceptedAt: new Date(),
    },
  });
  const rawSession = createOpaqueToken();
  await prisma.client.session.create({
    data: {
      userId: user.id,
      tokenHash: hashOpaqueToken(rawSession),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  return {
    userId: user.id,
    sessionCookie: `${environment.values.COOKIE_NAME}=${rawSession}`,
  };
}

async function createOrganization(ownerId: string, slugPrefix: string): Promise<string> {
  const slug = `${slugPrefix}-${runId}-${randomUUID().slice(0, 6)}`.toLowerCase();
  const organization = await prisma.client.organization.create({
    data: {
      name: `HTTP ${slug}`,
      normalizedName: slug,
      merchantSlug: slug,
      timezone: "UTC",
      selectedPlan: "GROWTH",
      members: { create: { userId: ownerId, role: "OWNER" } },
      billingProfile: {
        create: { selectedPlan: "GROWTH", subscriptionStatus: "PENDING_ACTIVATION" },
      },
    },
  });
  return organization.id;
}

async function csrf(): Promise<{ cookie: string; token: string }> {
  const response = await app.inject({ method: "GET", url: "/v1/auth/csrf" });
  const setCookie = response.headers["set-cookie"];
  const rawCookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const cookie = rawCookie?.split(";")[0] ?? "";
  return { cookie, token: response.json().data.csrfToken as string };
}

function mutationHeaders(
  csrfState: { cookie: string; token: string },
  session?: Identity,
  origin = allowedOrigin,
) {
  return {
    origin,
    "x-csrf-token": csrfState.token,
    cookie: [csrfState.cookie, session?.sessionCookie].filter(Boolean).join("; "),
    "content-type": "application/json",
  };
}

describe.sequential("Waflo W1 real NestJS/Fastify HTTP boundary", () => {
  beforeAll(async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_waflo_http";
    process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
    process.env.STRIPE_STARTER_MONTHLY_PRICE_ID = "price_test_starter";
    process.env.STRIPE_GROWTH_MONTHLY_PRICE_ID = "price_test_growth";
    process.env.STRIPE_SCALE_MONTHLY_PRICE_ID = "price_test_scale";
    process.env.STRIPE_CUSTOMER_PORTAL_CONFIGURATION_ID = "bpc_test_w1_no_plan_switching";
    app = await createApiApplication({ logger: false });
    prisma = app.get(PrismaService);
    environment = app.get(EnvironmentService);

    owner = await createIdentity("owner");
    manager = await createIdentity("manager");
    staff = await createIdentity("staff");
    intruder = await createIdentity("intruder");
    organizationId = await createOrganization(owner.userId, "boundary");
    otherOrganizationId = await createOrganization(intruder.userId, "other");
    const managerMember = await prisma.client.organizationMember.create({
      data: { organizationId, userId: manager.userId, role: "MANAGER" },
    });
    memberId = managerMember.id;
    await prisma.client.organizationMember.create({
      data: { organizationId, userId: staff.userId, role: "STAFF" },
    });
    const location = await prisma.client.location.create({
      data: { organizationId, name: "HTTP location", timezone: "UTC" },
    });
    locationId = location.id;
  });

  afterAll(async () => {
    await app.close();
    for (const [key, value] of Object.entries(previousStripeEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("issues CSRF and authenticated session cookies with the required attributes", async () => {
    const csrfState = await csrf();
    expect(csrfState.token).toHaveLength(43);
    const csrfResponse = await app.inject({ method: "GET", url: "/v1/auth/csrf" });
    expect(String(csrfResponse.headers["set-cookie"])).toContain("waflo_csrf=");
    expect(String(csrfResponse.headers["set-cookie"])).toContain("SameSite=Strict");

    const loginEmail = `login-${runId}@http.waflo.local`;
    await prisma.client.user.create({
      data: {
        email: loginEmail,
        normalizedEmail: loginEmail,
        displayName: "HTTP Login",
        passwordHash: await hashPassword(password),
        emailVerifiedAt: new Date(),
        preferredLocale: "EN",
        termsVersion: "test",
        privacyVersion: "test",
        legalAcceptedAt: new Date(),
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: mutationHeaders(csrfState),
      payload: { email: loginEmail, password },
    });
    expect(response.statusCode).toBe(201);
    const sessionCookie = String(response.headers["set-cookie"]);
    expect(sessionCookie).toContain(`${environment.values.COOKIE_NAME}=`);
    expect(sessionCookie).toContain("HttpOnly");
    expect(sessionCookie).toContain("SameSite=Lax");
    expect(sessionCookie).toContain("Path=/");
  });

  it("accepts valid CSRF state and rejects missing, invalid, absent-origin, and disallowed-origin state", async () => {
    const good = await csrf();
    const success = await app.inject({
      method: "POST",
      url: "/v1/auth/forgot-password",
      headers: mutationHeaders(good),
      payload: { email: `absent-${runId}@http.waflo.local` },
    });
    expect(success.statusCode).toBe(201);

    const missing = await app.inject({
      method: "POST",
      url: "/v1/auth/forgot-password",
      headers: { origin: allowedOrigin, "content-type": "application/json" },
      payload: { email: `missing-${runId}@http.waflo.local` },
    });
    expect(missing.statusCode).toBe(403);
    expect(missing.json().error.code).toBe("CSRF_REJECTED");

    const invalid = await app.inject({
      method: "POST",
      url: "/v1/auth/forgot-password",
      headers: {
        ...mutationHeaders(good),
        "x-csrf-token": "invalid-token-value-that-is-long-enough",
      },
      payload: { email: `invalid-${runId}@http.waflo.local` },
    });
    expect(invalid.statusCode).toBe(403);

    const missingOrigin = await app.inject({
      method: "POST",
      url: "/v1/auth/forgot-password",
      headers: {
        cookie: good.cookie,
        "x-csrf-token": good.token,
        "content-type": "application/json",
      },
      payload: { email: `originless-${runId}@http.waflo.local` },
    });
    expect(missingOrigin.statusCode).toBe(403);

    const disallowed = await app.inject({
      method: "POST",
      url: "/v1/auth/forgot-password",
      headers: mutationHeaders(good, undefined, "https://attacker.example"),
      payload: { email: `disallowed-${runId}@http.waflo.local` },
    });
    expect(disallowed.statusCode).toBe(403);
  });

  it("returns credentialed CORS headers only for an allowed origin", async () => {
    const allowed = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: allowedOrigin },
    });
    expect(allowed.headers["access-control-allow-origin"]).toBe(allowedOrigin);
    expect(allowed.headers["access-control-allow-credentials"]).toBe("true");

    const denied = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "https://attacker.example" },
    });
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("protects authenticated routes and preserves stable envelopes and request IDs", async () => {
    const unauthenticated = await app.inject({
      method: "GET",
      url: "/v1/organizations",
    });
    expect(unauthenticated.statusCode).toBe(401);
    expect(unauthenticated.json()).toMatchObject({
      error: { code: "AUTH_REQUIRED", requestId: expect.any(String) },
    });
    expect(unauthenticated.headers["x-request-id"]).toBe(unauthenticated.json().error.requestId);

    const requestId = `caller-${runId}`;
    const authenticated = await app.inject({
      method: "GET",
      url: "/v1/organizations",
      headers: { cookie: owner.sessionCookie, "x-request-id": requestId },
    });
    expect(authenticated.statusCode).toBe(200);
    expect(authenticated.json()).toMatchObject({
      data: expect.any(Array),
      requestId,
    });
    expect(authenticated.headers["x-request-id"]).toBe(requestId);
    expect(authenticated.headers["cache-control"]).toBe("no-store");
    expect(authenticated.headers["referrer-policy"]).toBe("no-referrer");
  });

  it("enforces Owner, Manager, and Staff authorization through route guards", async () => {
    const ownerBilling = await app.inject({
      method: "GET",
      url: `/v1/organizations/${organizationId}/billing`,
      headers: { cookie: owner.sessionCookie },
    });
    expect(ownerBilling.statusCode).toBe(200);

    const managerLocations = await app.inject({
      method: "GET",
      url: `/v1/organizations/${organizationId}/locations`,
      headers: { cookie: manager.sessionCookie },
    });
    expect(managerLocations.statusCode).toBe(200);
    const managerBilling = await app.inject({
      method: "GET",
      url: `/v1/organizations/${organizationId}/billing`,
      headers: { cookie: manager.sessionCookie },
    });
    expect(managerBilling.statusCode).toBe(403);
    expect(managerBilling.json().error.code).toBe("PERMISSION_DENIED");

    const staffOrganization = await app.inject({
      method: "GET",
      url: `/v1/organizations/${organizationId}`,
      headers: { cookie: staff.sessionCookie },
    });
    expect(staffOrganization.statusCode).toBe(200);
    const staffTeam = await app.inject({
      method: "GET",
      url: `/v1/organizations/${organizationId}/members`,
      headers: { cookie: staff.sessionCookie },
    });
    expect(staffTeam.statusCode).toBe(403);
  });

  it("blocks cross-tenant organization, location, member, billing, and audit routes", async () => {
    const csrfState = await csrf();
    const requests = [
      app.inject({
        method: "GET",
        url: `/v1/organizations/${organizationId}`,
        headers: { cookie: intruder.sessionCookie },
      }),
      app.inject({
        method: "GET",
        url: `/v1/organizations/${organizationId}/locations/${locationId}`,
        headers: { cookie: intruder.sessionCookie },
      }),
      app.inject({
        method: "PATCH",
        url: `/v1/organizations/${organizationId}/members/${memberId}`,
        headers: mutationHeaders(csrfState, intruder),
        payload: { status: "SUSPENDED" },
      }),
      app.inject({
        method: "GET",
        url: `/v1/organizations/${organizationId}/billing`,
        headers: { cookie: intruder.sessionCookie },
      }),
      app.inject({
        method: "GET",
        url: `/v1/organizations/${organizationId}/audit`,
        headers: { cookie: intruder.sessionCookie },
      }),
    ];
    const responses = await Promise.all(requests);
    expect(responses.map((response) => response.statusCode)).toEqual([403, 403, 403, 403, 403]);
    expect(responses.map((response) => response.json().error.code)).toEqual([
      "ORGANIZATION_ACCESS_DENIED",
      "ORGANIZATION_ACCESS_DENIED",
      "ORGANIZATION_ACCESS_DENIED",
      "ORGANIZATION_ACCESS_DENIED",
      "ORGANIZATION_ACCESS_DENIED",
    ]);
    expect(otherOrganizationId).not.toBe(organizationId);
  });

  it("rejects malformed UUIDs, cursors, action filters, pagination, hosts, and tokens before Prisma", async () => {
    const malformedUuid = await app.inject({
      method: "GET",
      url: "/v1/organizations/not-a-uuid",
      headers: { cookie: owner.sessionCookie },
    });
    const malformedCursor = await app.inject({
      method: "GET",
      url: `/v1/organizations/${organizationId}/locations?cursor=not-a-uuid`,
      headers: { cookie: owner.sessionCookie },
    });
    const malformedAction = await app.inject({
      method: "GET",
      url: `/v1/organizations/${organizationId}/audit?action=${encodeURIComponent("<script>")}`,
      headers: { cookie: owner.sessionCookie },
    });
    const malformedPagination = await app.inject({
      method: "GET",
      url: `/v1/organizations/${organizationId}/audit?limit=1000`,
      headers: { cookie: owner.sessionCookie },
    });
    const malformedHost = await app.inject({
      method: "GET",
      url: "/v1/public/merchant-host/resolve?host=",
    });
    const csrfState = await csrf();
    const malformedToken = await app.inject({
      method: "POST",
      url: "/v1/invitations/inspect",
      headers: mutationHeaders(csrfState),
      payload: { token: "short" },
    });
    const selectedPlanOutsideBilling = await app.inject({
      method: "PATCH",
      url: `/v1/organizations/${organizationId}`,
      headers: mutationHeaders(csrfState, owner),
      payload: { selectedPlan: "starter" },
    });
    for (const response of [
      malformedUuid,
      malformedCursor,
      malformedAction,
      malformedPagination,
      malformedHost,
      malformedToken,
      selectedPlanOutsideBilling,
    ]) {
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe("VALIDATION_FAILED");
    }
  });

  it("validates Checkout command IDs at the HTTP boundary before Stripe access", async () => {
    const csrfState = await csrf();
    const cases = [
      {
        headers: mutationHeaders(csrfState, owner),
        code: "CHECKOUT_IDEMPOTENCY_KEY_REQUIRED",
      },
      {
        headers: { ...mutationHeaders(csrfState, owner), "x-idempotency-key": "not-a-uuid" },
        code: "CHECKOUT_IDEMPOTENCY_KEY_INVALID",
      },
      {
        headers: { ...mutationHeaders(csrfState, owner), "x-idempotency-key": "1234" },
        code: "CHECKOUT_IDEMPOTENCY_KEY_INVALID",
      },
      {
        headers: {
          ...mutationHeaders(csrfState, owner),
          "x-idempotency-key": "a".repeat(256),
        },
        code: "CHECKOUT_IDEMPOTENCY_KEY_INVALID",
      },
    ];
    for (const item of cases) {
      const response = await app.inject({
        method: "POST",
        url: `/v1/organizations/${organizationId}/billing/checkout`,
        headers: item.headers,
        payload: {},
      });
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe(item.code);
    }
  });

  it("replays concurrent Checkout requests through the HTTP boundary", async () => {
    const replayOwner = await createIdentity("replay-owner");
    const replayOrganizationId = await createOrganization(replayOwner.userId, "replay");
    const billing = app.get(BillingService);
    const stripe = (
      billing as unknown as {
        stripe: {
          customers: { create: (...args: never[]) => Promise<{ id: string }> };
          checkout: {
            sessions: {
              create: (...args: never[]) => Promise<{ id: string; url: string }>;
            };
          };
          billingPortal: { sessions: { create: (...args: never[]) => Promise<{ url: string }> } };
        };
      }
    ).stripe;
    stripe.customers.create = async () => ({ id: `cus_http_${runId}` });
    stripe.checkout.sessions.create = async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return {
        id: `cs_http_${runId}`,
        url: `https://checkout.stripe.com/pay/cs_http_${runId}`,
      };
    };
    const csrfState = await csrf();
    const key = randomUUID();
    const [first, second] = await Promise.all(
      [1, 2].map(() =>
        app.inject({
          method: "POST",
          url: `/v1/organizations/${replayOrganizationId}/billing/checkout`,
          headers: { ...mutationHeaders(csrfState, replayOwner), "x-idempotency-key": key },
          payload: {},
          remoteAddress: "127.0.0.2",
        }),
      ),
    );
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    const firstResult = first.json().data;
    const secondResult = second.json().data;
    expect(firstResult.sessionId).toBeTruthy();
    expect(firstResult.url).toBeTruthy();
    expect(secondResult).toEqual(firstResult);
    expect(
      await prisma.client.checkoutIdempotencyKey.count({
        where: { organizationId: replayOrganizationId, idempotencyKey: key },
      }),
    ).toBe(1);
  });

  it("keeps Portal requests separate from Checkout idempotency semantics", async () => {
    const billing = app.get(BillingService);
    const stripe = (
      billing as unknown as {
        stripe: {
          billingPortal: {
            sessions: { create: (...args: never[]) => Promise<{ url: string }> };
          };
        };
      }
    ).stripe;
    let portalArguments: unknown[] = [];
    stripe.billingPortal.sessions.create = async (...args) => {
      portalArguments = args;
      return { url: "https://billing.stripe.com/session/http-portal" };
    };
    await prisma.client.organizationBillingProfile.update({
      where: { organizationId },
      data: { stripeCustomerId: `cus_portal_${runId}` },
    });
    const portalCsrf = await csrf();
    const response = await app.inject({
      method: "POST",
      url: `/v1/organizations/${organizationId}/billing/portal`,
      headers: mutationHeaders(portalCsrf, owner),
      payload: {},
    });
    expect(response.statusCode).toBe(201);
    expect(portalArguments[1]).toBeUndefined();
  });

  it("verifies Stripe signatures against the exact raw HTTP body", async () => {
    const event = {
      id: `evt_http_${runId}`,
      object: "event",
      api_version: "2026-06-30.basil",
      created: Math.floor(Date.now() / 1000),
      data: { object: {} },
      livemode: false,
      pending_webhooks: 1,
      request: null,
      type: "ping",
    };
    const body = JSON.stringify(event);
    const timestamp = Math.floor(Date.now() / 1000);
    const digest = createHmac("sha256", webhookSecret).update(`${timestamp}.${body}`).digest("hex");
    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/stripe",
      headers: {
        "content-type": "application/json",
        "stripe-signature": `t=${timestamp},v1=${digest}`,
      },
      payload: body,
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().data).toEqual({ received: true, duplicate: false });
  });

  it("rejects production tenant query overrides without exposing organization UUIDs", async () => {
    const originalNodeEnvironment = environment.values.NODE_ENV;
    Object.assign(environment.values, { NODE_ENV: "production" });
    const rejected = await app.inject({
      method: "GET",
      url: "/v1/public/merchant-host/resolve?host=unknown.localhost&tenant=boundary",
    });
    Object.assign(environment.values, { NODE_ENV: originalNodeEnvironment });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error.code).toBe("TENANT_OVERRIDE_FORBIDDEN");

    const organization = await prisma.client.organization.findUniqueOrThrow({
      where: { id: organizationId },
    });
    const resolved = await app.inject({
      method: "GET",
      url: `/v1/public/merchant-host/resolve?host=${organization.merchantSlug}.localhost`,
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json().data.merchant.id).toBeUndefined();
    expect(resolved.json().data.merchant.slug).toBe(organization.merchantSlug);
  });
});
