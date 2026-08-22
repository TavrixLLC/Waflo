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
  STRIPE_PUBLISHABLE_KEY: process.env.STRIPE_PUBLISHABLE_KEY,
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
    process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_waflo_http";
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
    await prisma.client.$transaction([
      prisma.client.organization.update({
        where: { id: organizationId },
        data: { onboardingState: "COMPLETE", onboardingCompletedAt: new Date() },
      }),
      prisma.client.organizationBillingProfile.update({
        where: { organizationId },
        data: { subscriptionStatus: "ACTIVE" },
      }),
    ]);
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

  it("accepts multipart images through private object storage and serves real variants", async () => {
    const csrfState = await csrf();
    const boundary = `waflo-http-${randomUUID()}`;
    const metadata = JSON.stringify({
      category: "STAMP_FILLED",
      crop: { x: 0, y: 0, width: 1, height: 1, zoom: 1 },
    });
    const image = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAARklEQVRYhe3XwQ0AMAhC0U7EOuyfuIfdor28g3cTET5nmv05xwLjBCXCeMNlRMOKK4wijheQDCQrKA0sX8VkVLMqp3mugwtMYqCIQ8Mt0gAAAABJRU5ErkJggg==",
      "base64",
    );
    const multipart = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n${metadata}\r\n`,
      ),
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="stamp.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      image,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const upload = await app.inject({
      method: "POST",
      url: `/v1/organizations/${organizationId}/assets`,
      headers: {
        ...mutationHeaders(csrfState, owner),
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: multipart,
    });
    expect(upload.statusCode).toBe(201);
    const asset = upload.json().data as {
      id: string;
      safeMetadata: { metadataStripped: boolean; rawUploadStored: boolean; storage: string };
      variants: Array<{
        variantCode: string;
        objectKey: string;
        width: number;
        height: number;
      }>;
    };
    expect(asset.safeMetadata).toMatchObject({
      metadataStripped: true,
      rawUploadStored: false,
      storage: "private-object-storage",
    });
    expect(asset.variants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ variantCode: "ORIGINAL_SAFE" }),
        expect.objectContaining({ variantCode: "STAMP_256", width: 256, height: 256 }),
        expect.objectContaining({ variantCode: "THUMBNAIL_96", width: 96, height: 96 }),
      ]),
    );

    const anonymous = await app.inject({
      method: "GET",
      url: `/v1/organizations/${organizationId}/assets/${asset.id}/content?variant=THUMBNAIL_96`,
    });
    expect(anonymous.statusCode).toBe(401);
    const content = await app.inject({
      method: "GET",
      url: `/v1/organizations/${organizationId}/assets/${asset.id}/content?variant=THUMBNAIL_96`,
      headers: { cookie: owner.sessionCookie },
    });
    expect(content.statusCode).toBe(200);
    expect(content.headers["content-type"]).toContain("image/png");
    expect(content.rawPayload.length).toBeGreaterThan(100);

    const storedVariant = asset.variants.find((variant) => variant.variantCode === "THUMBNAIL_96");
    expect(storedVariant?.objectKey).toMatch(
      new RegExp(`^organizations/${organizationId}/assets/`),
    );
    const anonymousObject = await fetch(
      `http://127.0.0.1:9000/waflo-private/${storedVariant?.objectKey}`,
    );
    expect(anonymousObject.status).toBe(403);
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

    const putPreflight = await app.inject({
      method: "OPTIONS",
      url: "/v1/organizations/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/members/44444444-4444-4444-8444-444444444444/location-assignments/a1111111-1111-4111-8111-111111111111",
      headers: {
        origin: allowedOrigin,
        "access-control-request-method": "PUT",
        "access-control-request-headers": "content-type,x-csrf-token",
      },
    });
    expect(putPreflight.statusCode).toBe(204);
    expect(putPreflight.headers["access-control-allow-methods"]).toContain("PUT");

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

  it("validates exact branch coordinates and derives timezone without trusting the client", async () => {
    const csrfState = await csrf();
    const coordinate = await app.inject({
      method: "POST",
      url: "/v1/location-tools/coordinate",
      headers: mutationHeaders(csrfState, owner),
      payload: { latitude: 33.3152, longitude: 44.3661 },
    });
    expect(coordinate.statusCode).toBe(201);
    expect(coordinate.json().data).toEqual({
      latitude: 33.3152,
      longitude: 44.3661,
      timezone: "Asia/Baghdad",
    });

    const missingCoordinate = await app.inject({
      method: "POST",
      url: `/v1/organizations/${organizationId}/locations`,
      headers: mutationHeaders(csrfState, owner),
      payload: {
        name: "Missing map confirmation",
        countryCode: "IQ",
        timezone: "Asia/Baghdad",
      },
    });
    expect(missingCoordinate.statusCode).toBe(422);
    expect(missingCoordinate.json().error.code).toBe("VALIDATION_FAILED");

    const created = await app.inject({
      method: "POST",
      url: `/v1/organizations/${organizationId}/locations`,
      headers: mutationHeaders(csrfState, owner),
      payload: {
        name: "Mapped branch",
        countryCode: "US",
        timezone: "UTC",
        latitude: 40.7128,
        longitude: -74.006,
        coordinatesConfirmed: true,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data).toMatchObject({
      timezone: "America/New_York",
      latitude: "40.7128",
      longitude: "-74.006",
    });

    const staffDenied = await app.inject({
      method: "POST",
      url: `/v1/organizations/${organizationId}/locations`,
      headers: mutationHeaders(csrfState, staff),
      payload: {
        name: "Denied branch",
        countryCode: "IQ",
        timezone: "Asia/Baghdad",
        latitude: 33.3152,
        longitude: 44.3661,
        coordinatesConfirmed: true,
      },
    });
    expect(staffDenied.statusCode).toBe(403);
    expect(staffDenied.json().error.code).toBe("PERMISSION_DENIED");

    const tenantDenied = await app.inject({
      method: "POST",
      url: `/v1/organizations/${organizationId}/locations`,
      headers: mutationHeaders(csrfState, intruder),
      payload: {
        name: "Cross tenant branch",
        countryCode: "IQ",
        timezone: "Asia/Baghdad",
        latitude: 33.3152,
        longitude: 44.3661,
        coordinatesConfirmed: true,
      },
    });
    expect(tenantDenied.statusCode).toBe(403);
    expect(tenantDenied.json().error.code).toBe("ORGANIZATION_ACCESS_DENIED");
  });

  it("enforces refund ownership and tenant isolation at the HTTP boundary", async () => {
    const paidAt = new Date();
    const invoice = await prisma.client.billingInvoice.create({
      data: {
        organizationId,
        stripeInvoiceId: `in_http_refund_${runId}_${randomUUID().slice(0, 8)}`,
        invoiceNumber: `WF-HTTP-${runId}`,
        status: "paid",
        billingReason: "subscription_cycle",
        amountDue: 6900,
        amountPaid: 6900,
        amountRemaining: 0,
        currency: "USD",
        invoiceDate: paidAt,
        paidAt,
      },
    });
    const csrfState = await csrf();
    const idempotencyKey = randomUUID();
    const url = `/v1/organizations/${organizationId}/billing/invoices/${invoice.id}/refunds`;
    const payload = { reason: "incorrect_charge", amount: 1700 };

    const created = await app.inject({
      method: "POST",
      url,
      headers: {
        ...mutationHeaders(csrfState, owner),
        "x-idempotency-key": idempotencyKey,
      },
      payload,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data).toMatchObject({
      status: "REQUESTED",
      requestedAmount: 1700,
      currency: "USD",
    });

    const staffDenied = await app.inject({
      method: "POST",
      url,
      headers: {
        ...mutationHeaders(csrfState, staff),
        "x-idempotency-key": randomUUID(),
      },
      payload,
    });
    expect(staffDenied.statusCode).toBe(403);
    expect(staffDenied.json().error.code).toBe("PERMISSION_DENIED");

    const crossTenant = await app.inject({
      method: "POST",
      url,
      headers: {
        ...mutationHeaders(csrfState, intruder),
        "x-idempotency-key": randomUUID(),
      },
      payload,
    });
    expect(crossTenant.statusCode).toBe(403);
    expect(crossTenant.json().error.code).toBe("ORGANIZATION_ACCESS_DENIED");
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
    const invalidCountry = await app.inject({
      method: "POST",
      url: `/v1/organizations/${organizationId}/locations`,
      headers: mutationHeaders(csrfState, owner),
      payload: { name: "Invalid country", countryCode: "ZZ", timezone: "UTC" },
    });
    const invalidTimezone = await app.inject({
      method: "POST",
      url: `/v1/organizations/${organizationId}/locations`,
      headers: mutationHeaders(csrfState, owner),
      payload: { name: "Invalid timezone", countryCode: "IQ", timezone: "UTC+03:00" },
    });
    for (const response of [
      malformedUuid,
      malformedCursor,
      malformedAction,
      malformedPagination,
      malformedHost,
      malformedToken,
      selectedPlanOutsideBilling,
      invalidCountry,
      invalidTimezone,
    ]) {
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe("VALIDATION_FAILED");
    }
  });

  it("validates embedded trial command IDs at the HTTP boundary before Stripe access", async () => {
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
    const payload = {
      plan: "growth",
      cadence: "monthly",
      billingIdentity: {
        name: "HTTP Merchant",
        email: "billing-http@example.test",
        countryCode: "US",
        addressLine1: "1 Test Street",
        addressLine2: null,
        city: "Austin",
        region: "TX",
        postalCode: "78701",
      },
    };
    for (const item of cases) {
      const response = await app.inject({
        method: "POST",
        url: `/v1/organizations/${organizationId}/billing/trial/setup`,
        headers: item.headers,
        payload,
      });
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe(item.code);
    }
  });

  it("replays concurrent embedded payment setup through the HTTP boundary", async () => {
    const replayOwner = await createIdentity("replay-owner");
    const replayOrganizationId = await createOrganization(replayOwner.userId, "replay");
    const billing = app.get(BillingService);
    const stripe = (
      billing as unknown as {
        stripe: {
          customers: {
            create: (...args: never[]) => Promise<{ id: string }>;
            search: (...args: never[]) => Promise<{ data: Array<{ id: string }> }>;
            update: (...args: never[]) => Promise<{ id: string }>;
          };
          prices: {
            retrieve: (...args: never[]) => Promise<unknown>;
          };
          setupIntents: {
            create: (...args: never[]) => Promise<{ id: string; client_secret: string }>;
          };
          billingPortal: { sessions: { create: (...args: never[]) => Promise<{ url: string }> } };
        };
      }
    ).stripe;
    stripe.customers.search = async () => ({ data: [] });
    stripe.customers.create = async () => ({ id: `cus_http_${runId}` });
    stripe.customers.update = async () => ({ id: `cus_http_${runId}` });
    stripe.prices.retrieve = async () => ({
      id: "price_test_growth",
      active: true,
      type: "recurring",
      unit_amount: 6900,
      currency: "usd",
      recurring: { interval: "month", interval_count: 1 },
    });
    stripe.setupIntents.create = async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return {
        id: `seti_http_${runId}`,
        client_secret: `seti_http_${runId}_secret_test`,
      };
    };
    const csrfState = await csrf();
    const key = randomUUID();
    const [first, second] = await Promise.all(
      [1, 2].map(() =>
        app.inject({
          method: "POST",
          url: `/v1/organizations/${replayOrganizationId}/billing/trial/setup`,
          headers: { ...mutationHeaders(csrfState, replayOwner), "x-idempotency-key": key },
          payload: {
            plan: "growth",
            cadence: "monthly",
            billingIdentity: {
              name: "Replay Merchant",
              email: "replay-billing@example.test",
              countryCode: "US",
              addressLine1: "1 Replay Street",
              addressLine2: null,
              city: "Austin",
              region: "TX",
              postalCode: "78701",
            },
          },
          remoteAddress: "127.0.0.2",
        }),
      ),
    );
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    const firstResult = first.json().data;
    const secondResult = second.json().data;
    expect(firstResult.setupIntentId).toBe(`seti_http_${runId}`);
    expect(firstResult.clientSecret).toBe(`seti_http_${runId}_secret_test`);
    expect(firstResult.trialDays).toBe(7);
    expect(firstResult).not.toHaveProperty("url");
    expect(secondResult).toMatchObject({
      completed: false,
      setupIntentId: firstResult.setupIntentId,
      clientSecret: firstResult.clientSecret,
      trialDays: 7,
      amount: firstResult.amount,
      currency: firstResult.currency,
    });
    expect(
      Math.abs(
        new Date(secondResult.expectedFirstChargeAt).getTime() -
          new Date(firstResult.expectedFirstChargeAt).getTime(),
      ),
    ).toBeLessThan(50);
    expect(
      await prisma.client.checkoutIdempotencyKey.count({
        where: { organizationId: replayOrganizationId, idempotencyKey: key },
      }),
    ).toBe(1);
  });

  it("keeps the operational Portal fallback separate from embedded billing commands", async () => {
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
    const originalDeploymentEnvironment = environment.values.DEPLOYMENT_ENVIRONMENT;
    try {
      Object.assign(environment.values, { DEPLOYMENT_ENVIRONMENT: "production" });
      const rejected = await app.inject({
        method: "GET",
        url: "/v1/public/merchant-host/resolve?host=unknown.localhost&tenant=boundary",
      });
      expect(rejected.statusCode).toBe(400);
      expect(rejected.json().error.code).toBe("TENANT_OVERRIDE_FORBIDDEN");
    } finally {
      Object.assign(environment.values, {
        DEPLOYMENT_ENVIRONMENT: originalDeploymentEnvironment,
      });
    }

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
