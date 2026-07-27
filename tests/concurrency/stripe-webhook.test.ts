import { createHmac, randomUUID } from "node:crypto";
import { hashPassword } from "../../packages/auth/src/index";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AuditService } from "../../apps/api/src/audit/audit.service";
import { BillingService } from "../../apps/api/src/billing/billing.service";
import type { WafloRequest } from "../../apps/api/src/common/request-context";
import { EnvironmentService } from "../../apps/api/src/config/environment.service";
import { PrismaService } from "../../apps/api/src/database/prisma.service";
import type { NotificationService } from "../../apps/api/src/notifications/notification.service";
import { TenantService } from "../../apps/api/src/tenancy/tenant.service";

const runId = randomUUID().slice(0, 8);
const webhookSecret = `whsec_${randomUUID().replaceAll("-", "")}`;
const request = {
  requestId: `stripe-concurrency-${runId}`,
  ip: "127.0.0.1",
  headers: { "user-agent": "Stripe webhook concurrency tests" },
} as unknown as WafloRequest;
const previousStripeEnvironment = {
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  STRIPE_STARTER_MONTHLY_PRICE_ID: process.env.STRIPE_STARTER_MONTHLY_PRICE_ID,
  STRIPE_GROWTH_MONTHLY_PRICE_ID: process.env.STRIPE_GROWTH_MONTHLY_PRICE_ID,
  STRIPE_SCALE_MONTHLY_PRICE_ID: process.env.STRIPE_SCALE_MONTHLY_PRICE_ID,
};

let prisma: PrismaService;
let billing: BillingService;
let sendNotification: ReturnType<typeof vi.fn>;
let organizationAId = "";
let organizationBId = "";
const customerA = `cus_a_${runId}`;
const customerB = `cus_b_${runId}`;

function subscriptionEvent(input: {
  id: string;
  customer?: string;
  organizationId?: string;
  priceId?: string;
  plan?: string;
}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: input.id,
    object: "event",
    api_version: "2026-06-30.basil",
    created: now,
    data: {
      object: {
        id: `sub_${input.id}`,
        object: "subscription",
        customer: input.customer ?? customerA,
        status: "active",
        cancel_at_period_end: false,
        canceled_at: null,
        metadata: {
          ...(input.organizationId ? { organizationId: input.organizationId } : {}),
          ...(input.plan ? { plan: input.plan } : {}),
        },
        items: {
          data: [
            {
              price: { id: input.priceId ?? "price_test_growth" },
              current_period_start: now - 60,
              current_period_end: now + 2_592_000,
            },
          ],
        },
      },
    },
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type: "customer.subscription.updated",
  };
}

function sign(event: object): { payload: Buffer; signature: string } {
  const payload = Buffer.from(JSON.stringify(event));
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = createHmac("sha256", webhookSecret)
    .update(`${timestamp}.${payload.toString()}`)
    .digest("hex");
  return { payload, signature: `t=${timestamp},v1=${digest}` };
}

async function createOrganization(customerId: string): Promise<string> {
  const email = `stripe-${randomUUID().slice(0, 6)}@concurrency.waflo.local`;
  const user = await prisma.client.user.create({
    data: {
      email,
      normalizedEmail: email,
      displayName: "Stripe Owner",
      passwordHash: await hashPassword("Stripe Webhook Test 2026!"),
      emailVerifiedAt: new Date(),
      preferredLocale: "EN",
      termsVersion: "test",
      privacyVersion: "test",
      legalAcceptedAt: new Date(),
    },
  });
  const slug = `s-${runId}-${randomUUID().slice(0, 8)}`.toLowerCase();
  const organization = await prisma.client.organization.create({
    data: {
      name: `Stripe ${slug}`,
      normalizedName: slug,
      merchantSlug: slug,
      timezone: "UTC",
      selectedPlan: "GROWTH",
      members: { create: { userId: user.id, role: "OWNER" } },
      billingProfile: {
        create: {
          stripeCustomerId: customerId,
          selectedPlan: "GROWTH",
          subscriptionStatus: "PENDING_ACTIVATION",
        },
      },
    },
  });
  return organization.id;
}

describe.sequential("Stripe webhook claim, lease, and validation", () => {
  beforeAll(async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_waflo_concurrency";
    process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
    process.env.STRIPE_STARTER_MONTHLY_PRICE_ID = "price_test_starter";
    process.env.STRIPE_GROWTH_MONTHLY_PRICE_ID = "price_test_growth";
    process.env.STRIPE_SCALE_MONTHLY_PRICE_ID = "price_test_scale";
    const environment = new EnvironmentService();
    prisma = new PrismaService(environment);
    const audit = new AuditService(prisma);
    const tenant = new TenantService(prisma, audit);
    sendNotification = vi.fn(async () => undefined);
    const notifications = { send: sendNotification } as unknown as NotificationService;
    billing = new BillingService(prisma, environment, tenant, audit, notifications);
    organizationAId = await createOrganization(customerA);
    organizationBId = await createOrganization(customerB);
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
    for (const [key, value] of Object.entries(previousStripeEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("atomically accepts one of two concurrent duplicate deliveries", async () => {
    const eventId = `evt_duplicate_${runId}`;
    const signed = sign(
      subscriptionEvent({
        id: eventId,
        organizationId: organizationAId,
        plan: "growth",
      }),
    );
    const results = await Promise.all([
      billing.processWebhook(signed.payload, signed.signature, request),
      billing.processWebhook(signed.payload, signed.signature, request),
    ]);
    expect(results.map((result) => result.duplicate).sort()).toEqual([false, true]);
    const subscription = await prisma.client.subscription.findUniqueOrThrow({
      where: { stripeSubscriptionId: `sub_${eventId}` },
    });
    expect(subscription.currentPeriodStart).toBeInstanceOf(Date);
    expect(subscription.currentPeriodEnd).toBeInstanceOf(Date);
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "subscription_status",
        organizationName: expect.any(String),
      }),
    );
    expect(
      await prisma.client.auditLog.count({
        where: { action: "stripe.subscription_applied", targetId: `sub_${eventId}` },
      }),
    ).toBe(1);
  });

  it("retries a FAILED event and applies business state once", async () => {
    const eventId = `evt_retry_${runId}`;
    const invalid = sign(
      subscriptionEvent({
        id: eventId,
        organizationId: organizationAId,
        priceId: "price_unknown_retry",
      }),
    );
    await expect(
      billing.processWebhook(invalid.payload, invalid.signature, request),
    ).rejects.toMatchObject({ code: "STRIPE_PRICE_UNKNOWN" });
    const valid = sign(
      subscriptionEvent({
        id: eventId,
        organizationId: organizationAId,
        priceId: "price_test_growth",
        plan: "growth",
      }),
    );
    await expect(billing.processWebhook(valid.payload, valid.signature, request)).resolves.toEqual({
      received: true,
      duplicate: false,
    });
    const processing = await prisma.client.processedWebhookEvent.findUniqueOrThrow({
      where: {
        provider_externalEventId: { provider: "stripe", externalEventId: eventId },
      },
    });
    expect(processing).toMatchObject({ status: "PROCESSED", attemptCount: 2 });
    expect(
      await prisma.client.auditLog.count({
        where: { action: "stripe.subscription_applied", targetId: `sub_${eventId}` },
      }),
    ).toBe(1);
  });

  it("reclaims an expired PROCESSING lease", async () => {
    const eventId = `evt_lease_${runId}`;
    await prisma.client.processedWebhookEvent.create({
      data: {
        provider: "stripe",
        externalEventId: eventId,
        eventType: "customer.subscription.updated",
        status: "PROCESSING",
        leaseExpiresAt: new Date(Date.now() - 1_000),
      },
    });
    const signed = sign(
      subscriptionEvent({
        id: eventId,
        organizationId: organizationAId,
        plan: "growth",
      }),
    );
    await expect(
      billing.processWebhook(signed.payload, signed.signature, request),
    ).resolves.toEqual({ received: true, duplicate: false });
    expect(
      await prisma.client.processedWebhookEvent.findUniqueOrThrow({
        where: {
          provider_externalEventId: { provider: "stripe", externalEventId: eventId },
        },
      }),
    ).toMatchObject({ status: "PROCESSED", attemptCount: 2, leaseExpiresAt: null });
  });

  it("rejects customer and organization metadata mismatches", async () => {
    const signed = sign(
      subscriptionEvent({
        id: `evt_mismatch_${runId}`,
        customer: customerA,
        organizationId: organizationBId,
        plan: "growth",
      }),
    );
    await expect(
      billing.processWebhook(signed.payload, signed.signature, request),
    ).rejects.toMatchObject({ code: "STRIPE_CUSTOMER_ORGANIZATION_MISMATCH" });
  });

  it("rejects invalid plan metadata, mismatched plans, and unknown prices", async () => {
    const invalidPlan = sign(
      subscriptionEvent({
        id: `evt_invalid_plan_${runId}`,
        organizationId: organizationAId,
        plan: "enterprise",
      }),
    );
    await expect(
      billing.processWebhook(invalidPlan.payload, invalidPlan.signature, request),
    ).rejects.toMatchObject({ code: "STRIPE_PLAN_INVALID" });

    const mismatch = sign(
      subscriptionEvent({
        id: `evt_plan_mismatch_${runId}`,
        organizationId: organizationAId,
        priceId: "price_test_growth",
        plan: "starter",
      }),
    );
    await expect(
      billing.processWebhook(mismatch.payload, mismatch.signature, request),
    ).rejects.toMatchObject({ code: "STRIPE_PLAN_PRICE_MISMATCH" });

    const unknown = sign(
      subscriptionEvent({
        id: `evt_unknown_price_${runId}`,
        organizationId: organizationAId,
        priceId: "price_not_configured",
      }),
    );
    await expect(
      billing.processWebhook(unknown.payload, unknown.signature, request),
    ).rejects.toMatchObject({ code: "STRIPE_PRICE_UNKNOWN" });
  });

  it("preserves over-limit resources on a Stripe downgrade and records the policy", async () => {
    await prisma.client.location.createMany({
      data: [
        { organizationId: organizationAId, name: "Over limit 1", timezone: "UTC" },
        { organizationId: organizationAId, name: "Over limit 2", timezone: "UTC" },
      ],
    });
    const eventId = `evt_overlimit_${runId}`;
    const signed = sign(
      subscriptionEvent({
        id: eventId,
        organizationId: organizationAId,
        priceId: "price_test_starter",
        plan: "starter",
      }),
    );
    await billing.processWebhook(signed.payload, signed.signature, request);
    expect(
      await prisma.client.location.count({
        where: { organizationId: organizationAId, status: "ACTIVE" },
      }),
    ).toBe(2);
    const audit = await prisma.client.auditLog.findFirstOrThrow({
      where: { action: "stripe.subscription_applied", targetId: `sub_${eventId}` },
    });
    expect(audit.metadata).toMatchObject({
      overLimit: true,
      overLimitPolicy: "preserve_resources_and_block_new_capacity",
    });
  });
});
