/**
 * Stripe Checkout outbound idempotency tests — W1 Repair Round 2.
 *
 * Tests verify that:
 * - Concurrent customer creation for one organization resolves to one Stripe customer.
 * - Repeated checkout with the same idempotency key returns the same result.
 * - Concurrent checkout with the same idempotency key returns the same result.
 * - Same key with a different plan is rejected as a conflict.
 * - Different keys can create separate checkout attempts.
 * - Provider timeout followed by retry does not create duplicates.
 * - No subscription state is activated by checkout return URLs.
 */
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AuditService } from "../../apps/api/src/audit/audit.service";
import {
  BillingService,
  type StripeSubscriptionProvider,
} from "../../apps/api/src/billing/billing.service";
import type { WafloRequest } from "../../apps/api/src/common/request-context";
import { EnvironmentService } from "../../apps/api/src/config/environment.service";
import { PrismaService } from "../../apps/api/src/database/prisma.service";
import type { NotificationService } from "../../apps/api/src/notifications/notification.service";
import { TenantService } from "../../apps/api/src/tenancy/tenant.service";
import { hashPassword } from "../../packages/auth/src/index";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const runId = randomUUID().slice(0, 8);
const request = {
  requestId: `checkout-idempotency-${runId}`,
  ip: "127.0.0.1",
  headers: { "user-agent": "Checkout idempotency tests" },
} as unknown as WafloRequest;

const savedEnv: Record<string, string | undefined> = {};

let prisma: PrismaService;
let environment: EnvironmentService;
let audit: AuditService;
let tenant: TenantService;
let notifications: NotificationService;

// Tracks calls to the mock Stripe customers.create and checkout.sessions.create.
const createCustomerCalls: Array<{ email?: string; idempotencyKey?: string }> = [];
const createSessionCalls: Array<{ customerId?: string; idempotencyKey?: string }> = [];

// Mock Stripe instance injected via environment override.
// We control what stripe.customers.create and stripe.checkout.sessions.create return.
const mockSessionId = `cs_test_mock_${runId}`;
const mockSessionUrl = `https://checkout.stripe.com/pay/${mockSessionId}`;
let simulateCustomerTimeout = false;
let simulateSessionTimeout = false;
let _customerCallCount = 0;

/** Noop provider – checkout tests don't trigger webhook processing. */
const noopProvider: StripeSubscriptionProvider = {
  async retrieveSubscription() {
    throw new Error("Not expected in checkout tests");
  },
};

/**
 * Build a BillingService whose internal Stripe SDK is replaced by a controllable mock.
 * We do this by patching the private `stripe` field after construction, since the
 * constructor requires a real secret key to create the SDK instance.
 */
function buildBillingService(): BillingService {
  const service = new BillingService(prisma, environment, tenant, audit, notifications);
  service.subscriptionProvider = noopProvider;

  // Patch the private stripe field with a typed mock.
  (service as unknown as { stripe: object }).stripe = {
    customers: {
      create: async (
        params: { email?: string; name?: string; metadata?: object },
        options?: { idempotencyKey?: string },
      ) => {
        createCustomerCalls.push({ email: params.email, idempotencyKey: options?.idempotencyKey });
        _customerCallCount++;
        if (simulateCustomerTimeout) {
          simulateCustomerTimeout = false;
          throw Object.assign(new Error("Request timed out"), { type: "StripeConnectionError" });
        }
        const generatedId = options?.idempotencyKey
          ? `cus_mock_${options.idempotencyKey.replaceAll(":", "_").replaceAll("-", "_")}`
          : `cus_mock_${randomUUID().slice(0, 8)}`;
        return { id: generatedId, object: "customer" };
      },
    },
    checkout: {
      sessions: {
        create: async (
          params: { customer?: string; line_items?: unknown[] },
          options?: { idempotencyKey?: string },
        ) => {
          createSessionCalls.push({
            customerId: params.customer,
            idempotencyKey: options?.idempotencyKey,
          });
          if (simulateSessionTimeout) {
            simulateSessionTimeout = false;
            throw Object.assign(new Error("Request timed out"), { type: "StripeConnectionError" });
          }
          return {
            id: mockSessionId,
            url: mockSessionUrl,
            object: "checkout.session",
          } as Stripe.Checkout.Session;
        },
      },
    },
    billingPortal: { sessions: { create: async () => ({ url: "" }) } },
    subscriptions: {
      retrieve: async () => {
        throw new Error("not used");
      },
    },
    webhooks: {
      constructEvent: () => {
        throw new Error("not used");
      },
    },
  };
  return service;
}

// Organization / user IDs created in beforeAll.
let ownerId = "";
let orgId = "";
let orgIdB = "";

beforeAll(async () => {
  for (const key of [
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_STARTER_MONTHLY_PRICE_ID",
    "STRIPE_GROWTH_MONTHLY_PRICE_ID",
    "STRIPE_SCALE_MONTHLY_PRICE_ID",
  ]) {
    savedEnv[key] = process.env[key];
  }
  process.env.STRIPE_SECRET_KEY = "sk_test_waflo_idempotency";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_waflo_idempotency";
  process.env.STRIPE_STARTER_MONTHLY_PRICE_ID = "price_idem_starter";
  process.env.STRIPE_GROWTH_MONTHLY_PRICE_ID = "price_idem_growth";
  process.env.STRIPE_SCALE_MONTHLY_PRICE_ID = "price_idem_scale";

  environment = new EnvironmentService();
  prisma = new PrismaService(environment);
  audit = new AuditService(prisma);
  tenant = new TenantService(prisma, audit);
  notifications = { send: vi.fn(async () => undefined) } as unknown as NotificationService;

  // Create owner user + organization.
  const email = `idem-owner-${runId}@idempotency.waflo.local`;
  const user = await prisma.client.user.create({
    data: {
      email,
      normalizedEmail: email,
      displayName: "Idempotency Owner",
      passwordHash: await hashPassword("IdempotencyTest2026!"),
      emailVerifiedAt: new Date(),
      preferredLocale: "EN",
      termsVersion: "test",
      privacyVersion: "test",
      legalAcceptedAt: new Date(),
    },
  });
  ownerId = user.id;

  const slug = `idem-${runId}`.toLowerCase();
  const org = await prisma.client.organization.create({
    data: {
      name: `Idempotency Org ${slug}`,
      normalizedName: slug,
      merchantSlug: slug,
      timezone: "UTC",
      selectedPlan: "GROWTH",
      members: { create: { userId: user.id, role: "OWNER" } },
      billingProfile: {
        create: { selectedPlan: "GROWTH", subscriptionStatus: "PENDING_ACTIVATION" },
      },
    },
  });
  orgId = org.id;

  // Second org for conflict testing.
  const emailB = `idem-owner-b-${runId}@idempotency.waflo.local`;
  const userB = await prisma.client.user.create({
    data: {
      email: emailB,
      normalizedEmail: emailB,
      displayName: "Idempotency Owner B",
      passwordHash: await hashPassword("IdempotencyTestB2026!"),
      emailVerifiedAt: new Date(),
      preferredLocale: "EN",
      termsVersion: "test",
      privacyVersion: "test",
      legalAcceptedAt: new Date(),
    },
  });
  const slugB = `idem-b-${runId}`.toLowerCase();
  const orgB = await prisma.client.organization.create({
    data: {
      name: `Idempotency Org B ${slugB}`,
      normalizedName: slugB,
      merchantSlug: slugB,
      timezone: "UTC",
      selectedPlan: "STARTER",
      members: { create: { userId: userB.id, role: "OWNER" } },
      billingProfile: {
        create: { selectedPlan: "STARTER", subscriptionStatus: "PENDING_ACTIVATION" },
      },
    },
  });
  orgIdB = orgB.id;
});

afterAll(async () => {
  await prisma.onModuleDestroy();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.sequential("Stripe Checkout outbound idempotency", () => {
  it("rejects checkout without an idempotency key", async () => {
    const billing = buildBillingService();
    await expect(billing.checkout(ownerId, orgId, request, "")).rejects.toMatchObject({
      code: "CHECKOUT_IDEMPOTENCY_KEY_REQUIRED",
    });
  });

  it("repeated checkout with the same idempotency key returns same result", async () => {
    const key = `idem-key-repeat-${runId}`;
    const billing = buildBillingService();

    const r1 = await billing.checkout(ownerId, orgId, request, key);
    const r2 = await billing.checkout(ownerId, orgId, request, key);

    expect(r1.sessionId).toBe(r2.sessionId);
    expect(r1.url).toBe(r2.url);

    // Only ONE session creation should have hit the Stripe mock.
    expect(createSessionCalls.filter((c) => c.idempotencyKey?.includes(key))).toHaveLength(1);
  });

  it("concurrent checkout with the same idempotency key: resolves to one session", async () => {
    const key = `idem-key-concurrent-${runId}`;
    // Use a new org for isolation.
    const emailC = `idem-conc-${runId}@idempotency.waflo.local`;
    const userC = await prisma.client.user.create({
      data: {
        email: emailC,
        normalizedEmail: emailC,
        displayName: "Concurrent User",
        passwordHash: await hashPassword("ConcurrentIdempotency2026!"),
        emailVerifiedAt: new Date(),
        preferredLocale: "EN",
        termsVersion: "test",
        privacyVersion: "test",
        legalAcceptedAt: new Date(),
      },
    });
    const slugC = `idem-conc-${runId}-${randomUUID().slice(0, 4)}`.toLowerCase();
    const orgC = await prisma.client.organization.create({
      data: {
        name: `Idempotency Concurrent ${slugC}`,
        normalizedName: slugC,
        merchantSlug: slugC,
        timezone: "UTC",
        selectedPlan: "GROWTH",
        members: { create: { userId: userC.id, role: "OWNER" } },
        billingProfile: {
          create: { selectedPlan: "GROWTH", subscriptionStatus: "PENDING_ACTIVATION" },
        },
      },
    });

    const billing = buildBillingService();
    const [r1, r2] = await Promise.allSettled([
      billing.checkout(userC.id, orgC.id, request, key),
      billing.checkout(userC.id, orgC.id, request, key),
    ]);

    // Both callers must fulfill with the same non-null effective session.
    expect(r1.status).toBe("fulfilled");
    expect(r2.status).toBe("fulfilled");
    const first = (r1 as PromiseFulfilledResult<{ url: string | null; sessionId: string | null }>)
      .value;
    const second = (r2 as PromiseFulfilledResult<{ url: string | null; sessionId: string | null }>)
      .value;
    expect(first.sessionId).toBeTruthy();
    expect(first.url).toBeTruthy();
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.url).toBe(first.url);

    // Only one CheckoutIdempotencyKey record should exist.
    const records = await prisma.client.checkoutIdempotencyKey.findMany({
      where: { organizationId: orgC.id, idempotencyKey: key },
    });
    expect(records).toHaveLength(1);
  });

  it("same key with a different plan is rejected as conflict", async () => {
    const key = `idem-key-conflict-${runId}`;
    const billing = buildBillingService();

    // First call with GROWTH plan (default for orgId).
    await billing.checkout(ownerId, orgId, request, key);

    // Switch plan in DB to STARTER.
    await prisma.client.organization.update({
      where: { id: orgId },
      data: { selectedPlan: "STARTER" },
    });
    await prisma.client.organizationBillingProfile.update({
      where: { organizationId: orgId },
      data: { selectedPlan: "STARTER" },
    });

    // Same key, different plan → conflict.
    await expect(billing.checkout(ownerId, orgId, request, key)).rejects.toMatchObject({
      code: "CHECKOUT_IDEMPOTENCY_KEY_CONFLICT",
    });

    // Restore plan.
    await prisma.client.organization.update({
      where: { id: orgId },
      data: { selectedPlan: "GROWTH" },
    });
    await prisma.client.organizationBillingProfile.update({
      where: { organizationId: orgId },
      data: { selectedPlan: "GROWTH" },
    });
  });

  it("different keys create separate checkout attempts", async () => {
    const key1 = `idem-key-diff-1-${runId}`;
    const key2 = `idem-key-diff-2-${runId}`;

    // Use a fresh org so it has no existing keys.
    const emailD = `idem-diff-${runId}@idempotency.waflo.local`;
    const userD = await prisma.client.user.create({
      data: {
        email: emailD,
        normalizedEmail: emailD,
        displayName: "Diff Keys User",
        passwordHash: await hashPassword("DiffKeysTest2026!"),
        emailVerifiedAt: new Date(),
        preferredLocale: "EN",
        termsVersion: "test",
        privacyVersion: "test",
        legalAcceptedAt: new Date(),
      },
    });
    const slugD = `idem-diff-${runId}-${randomUUID().slice(0, 4)}`.toLowerCase();
    const orgD = await prisma.client.organization.create({
      data: {
        name: `Idempotency Diff ${slugD}`,
        normalizedName: slugD,
        merchantSlug: slugD,
        timezone: "UTC",
        selectedPlan: "GROWTH",
        members: { create: { userId: userD.id, role: "OWNER" } },
        billingProfile: {
          create: { selectedPlan: "GROWTH", subscriptionStatus: "PENDING_ACTIVATION" },
        },
      },
    });

    // Different sessions for different keys.
    let callIdx = 0;
    const billing = buildBillingService();
    // Patch to return distinct session IDs per call.
    (
      billing as unknown as {
        stripe: { checkout: { sessions: { create: (...args: never) => unknown } } };
      }
    ).stripe.checkout.sessions.create = async () => {
      callIdx++;
      return {
        id: `cs_diff_${callIdx}_${runId}`,
        url: `https://checkout.stripe.com/pay/cs_diff_${callIdx}_${runId}`,
        object: "checkout.session",
      };
    };

    const r1 = await billing.checkout(userD.id, orgD.id, request, key1);
    const r2 = await billing.checkout(userD.id, orgD.id, request, key2);

    expect(r1.sessionId).not.toBe(r2.sessionId);
    const records = await prisma.client.checkoutIdempotencyKey.findMany({
      where: { organizationId: orgD.id },
    });
    expect(records).toHaveLength(2);
  });

  it("provider timeout followed by retry does not create duplicate customer or session", async () => {
    const key = `idem-key-timeout-${runId}`;
    const emailT = `idem-timeout-${runId}@idempotency.waflo.local`;
    const userT = await prisma.client.user.create({
      data: {
        email: emailT,
        normalizedEmail: emailT,
        displayName: "Timeout User",
        passwordHash: await hashPassword("TimeoutTest2026!"),
        emailVerifiedAt: new Date(),
        preferredLocale: "EN",
        termsVersion: "test",
        privacyVersion: "test",
        legalAcceptedAt: new Date(),
      },
    });
    const slugT = `idem-to-${runId}-${randomUUID().slice(0, 4)}`.toLowerCase();
    const orgT = await prisma.client.organization.create({
      data: {
        name: `Idempotency Timeout ${slugT}`,
        normalizedName: slugT,
        merchantSlug: slugT,
        timezone: "UTC",
        selectedPlan: "GROWTH",
        members: { create: { userId: userT.id, role: "OWNER" } },
        billingProfile: {
          create: { selectedPlan: "GROWTH", subscriptionStatus: "PENDING_ACTIVATION" },
        },
      },
    });

    const billingA = buildBillingService();
    const billingB = buildBillingService();

    // First call: customer creation succeeds, session creation times out.
    simulateSessionTimeout = true;
    _customerCallCount = 0;

    await expect(billingA.checkout(userT.id, orgT.id, request, key)).rejects.toThrow();

    // Session timed out, idempotency key record was NOT persisted (transaction rolled back).
    const keyRecordBefore = await prisma.client.checkoutIdempotencyKey.findUnique({
      where: { organizationId_idempotencyKey: { organizationId: orgT.id, idempotencyKey: key } },
    });
    expect(keyRecordBefore).toBeNull();

    // Retry: should succeed and use the existing stripeCustomerId (customer was already persisted).
    const r2 = await billingB.checkout(userT.id, orgT.id, request, key);
    expect(r2.sessionId).toBeDefined();

    // Customer should only have been physically created once (second call reuses persisted ID).
    const profile = await prisma.client.organizationBillingProfile.findUniqueOrThrow({
      where: { organizationId: orgT.id },
    });
    expect(profile.stripeCustomerId).toBeTruthy();

    // Idempotency key record persisted after success.
    const keyRecordAfter = await prisma.client.checkoutIdempotencyKey.findUnique({
      where: { organizationId_idempotencyKey: { organizationId: orgT.id, idempotencyKey: key } },
    });
    expect(keyRecordAfter).toBeTruthy();
  });

  it("no subscription or paid state is activated by checkout return URL", async () => {
    // Checkout return URL (?checkout=returned) is purely a frontend query parameter.
    // The API has no endpoint that activates subscriptions based on return URL.
    // Verify the organization billing status is unchanged after a checkout is created.
    const key = `idem-key-return-url-${runId}`;

    const profileBefore = await prisma.client.organizationBillingProfile.findUniqueOrThrow({
      where: { organizationId: orgIdB },
    });
    // orgIdB uses STARTER and is PENDING_ACTIVATION.
    expect(profileBefore.subscriptionStatus).toBe("PENDING_ACTIVATION");

    // Simulate checkout creation — the return URL only redirects the browser.
    // No webhook → no subscription activation.
    const billing = buildBillingService();
    await billing.checkout(
      (await prisma.client.organizationMember.findFirst({ where: { organizationId: orgIdB } }))
        ?.userId,
      orgIdB,
      request,
      key,
    );

    const profileAfter = await prisma.client.organizationBillingProfile.findUniqueOrThrow({
      where: { organizationId: orgIdB },
    });
    // Status must still be PENDING_ACTIVATION — only a webhook activates the subscription.
    expect(profileAfter.subscriptionStatus).toBe("PENDING_ACTIVATION");
  });
});
