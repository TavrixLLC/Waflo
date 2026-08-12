/**
 * Stripe webhook claim, lease, and duplicate-delivery tests.
 * Updated for W1 Repair Round 2: injects a deterministic StripeSubscriptionProvider
 * mock so no live Stripe SDK subscription retrieval is attempted.
 */
import { createHmac, randomUUID } from "node:crypto";
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
import { OperationalWorker } from "../../apps/operational-worker/src/main";
import { hashPassword } from "../../packages/auth/src/index";

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
let _billing: BillingService;
let sendNotification: ReturnType<typeof vi.fn>;
let organizationAId = "";
let organizationBId = "";
const customerA = `cus_a_${runId}`;
const customerB = `cus_b_${runId}`;

/**
 * Build a minimal mock Stripe.Subscription that satisfies the provider adapter.
 * The subscriptionId maps to the event's sub_<eventId> pattern used below.
 */
function buildMockSub(input: {
  id: string;
  status: Stripe.Subscription.Status;
  priceId: string;
  plan: string;
  organizationId: string;
  customerId: string;
  canceledAt?: number | null;
}): Stripe.Subscription {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: input.id,
    object: "subscription",
    status: input.status,
    customer: input.customerId,
    cancel_at_period_end: false,
    canceled_at: input.canceledAt ?? null,
    metadata: { organizationId: input.organizationId, plan: input.plan },
    items: {
      object: "list",
      data: [
        {
          id: `si_${input.id}`,
          object: "subscription_item",
          price: { id: input.priceId } as Stripe.Price,
          current_period_start: now - 60,
          current_period_end: now + 2_592_000,
        } as Stripe.SubscriptionItem,
      ],
      has_more: false,
      url: "",
    },
  } as unknown as Stripe.Subscription;
}

/**
 * Creates a deterministic provider that resolves subscriptions from a map.
 * This replaces the live stripe.subscriptions.retrieve() call in tests.
 */
function makeMockProvider(
  subscriptions: Map<string, Stripe.Subscription>,
  invoices: Map<string, Stripe.Invoice> = new Map(),
): StripeSubscriptionProvider {
  return {
    async retrieveSubscription(subscriptionId: string) {
      const sub = subscriptions.get(subscriptionId);
      if (!sub) throw new Error(`Mock provider: subscription ${subscriptionId} not found`);
      return sub;
    },
    async retrieveInvoice(invoiceId: string) {
      const invoice = invoices.get(invoiceId);
      if (!invoice) throw new Error(`Mock provider: invoice ${invoiceId} not found`);
      return invoice;
    },
  };
}

function buildInvoice(input: {
  id: string;
  organizationId: string;
  customerId: string;
  status: "open" | "paid";
  failureCode?: string;
  created: number;
}): Stripe.Invoice {
  const paid = input.status === "paid";
  return {
    id: input.id,
    object: "invoice",
    customer: input.customerId,
    customer_name: "Stripe Test Organization",
    customer_email: `billing-${runId}@example.com`,
    metadata: { wafloOrganizationId: input.organizationId },
    parent: {
      type: "subscription_details",
      quote_details: null,
      subscription_details: {
        subscription: `sub_invoice_${runId}`,
        metadata: { organizationId: input.organizationId, plan: "growth", cadence: "monthly" },
      },
    },
    status: input.status,
    billing_reason: "subscription_cycle",
    amount_due: 6900,
    amount_paid: paid ? 6900 : 0,
    amount_remaining: paid ? 0 : 6900,
    currency: "usd",
    created: input.created,
    effective_at: input.created,
    period_start: input.created,
    period_end: input.created + 2_592_000,
    next_payment_attempt: null,
    number: `WF-${runId}`,
    hosted_invoice_url: `https://invoice.stripe.com/i/${input.id}`,
    invoice_pdf: `https://pay.stripe.com/invoice/${input.id}/pdf`,
    default_payment_method: {
      id: `pm_${runId}`,
      object: "payment_method",
      card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2028 },
    } as Stripe.PaymentMethod,
    payments: {
      object: "list",
      data: input.failureCode
        ? [
            {
              payment: {
                type: "payment_intent",
                payment_intent: {
                  id: `pi_${input.id}`,
                  object: "payment_intent",
                  payment_method: `pm_${runId}`,
                  last_payment_error: {
                    code: "card_declined",
                    decline_code: input.failureCode,
                  },
                } as Stripe.PaymentIntent,
              },
            } as Stripe.InvoicePayment,
          ]
        : [],
      has_more: false,
      url: "",
    },
    status_transitions: {
      finalized_at: input.created,
      marked_uncollectible_at: null,
      paid_at: paid ? input.created + 60 : null,
      voided_at: null,
    },
  } as unknown as Stripe.Invoice;
}

function invoiceEvent(
  eventId: string,
  type: "invoice.payment_failed" | "invoice.paid",
  invoice: Stripe.Invoice,
) {
  return {
    id: eventId,
    object: "event",
    api_version: "2026-06-24.dahlia",
    created: invoice.created + (type === "invoice.paid" ? 60 : 0),
    data: { object: { id: invoice.id, object: "invoice" } },
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type,
  };
}

function subscriptionEvent(input: {
  id: string;
  customer?: string;
  organizationId?: string;
  priceId?: string;
  plan?: string;
  status?: Stripe.Subscription.Status;
}) {
  const now = Math.floor(Date.now() / 1000);
  const subId = `sub_${input.id}`;
  return {
    event: {
      id: input.id,
      object: "event",
      api_version: "2026-06-30.basil",
      created: now,
      data: {
        object: {
          id: subId,
          object: "subscription",
          customer: input.customer ?? customerA,
          status: input.status ?? "active",
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
    },
    subId,
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
    organizationAId = await createOrganization(customerA);
    organizationBId = await createOrganization(customerB);

    function createTestBilling(subsMap: Map<string, Stripe.Subscription>) {
      const b = new BillingService(prisma, environment, tenant, audit, notifications);
      b.subscriptionProvider = makeMockProvider(subsMap);
      return b;
    }

    _billing = createTestBilling(new Map());
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
    const { event, subId } = subscriptionEvent({
      id: eventId,
      organizationId: organizationAId,
      plan: "growth",
    });
    const signed = sign(event);

    const environment = new EnvironmentService();
    const audit = new AuditService(prisma);
    const tenant = new TenantService(prisma, audit);
    const sendN = vi.fn(async () => undefined);
    const notifications = { send: sendN } as unknown as NotificationService;
    const subs = new Map([
      [
        subId,
        buildMockSub({
          id: subId,
          status: "active",
          priceId: "price_test_growth",
          plan: "growth",
          organizationId: organizationAId,
          customerId: customerA,
        }),
      ],
    ]);
    const b = new BillingService(prisma, environment, tenant, audit, notifications);
    b.subscriptionProvider = makeMockProvider(subs);

    const results = await Promise.all([
      b.processWebhook(signed.payload, signed.signature, request),
      b.processWebhook(signed.payload, signed.signature, request),
    ]);
    expect(results.map((r) => r.duplicate).sort()).toEqual([false, true]);
    const subscription = await prisma.client.subscription.findUniqueOrThrow({
      where: { stripeSubscriptionId: subId },
    });
    expect(subscription.currentPeriodStart).toBeInstanceOf(Date);
    expect(subscription.currentPeriodEnd).toBeInstanceOf(Date);
    expect(
      await prisma.client.auditLog.count({
        where: { action: "stripe.subscription_applied", targetId: subId },
      }),
    ).toBe(1);
  });

  it("deduplicates failed-invoice mail, preserves grace on card replacement, and recovers the same invoice", async () => {
    const environment = new EnvironmentService();
    const audit = new AuditService(prisma);
    const tenant = new TenantService(prisma, audit);
    const notifications = { send: vi.fn(async () => undefined) } as unknown as NotificationService;
    const invoiceId = `in_recovery_${runId}`;
    const created = Math.floor(Date.now() / 1000) - 10;
    const failedInvoice = buildInvoice({
      id: invoiceId,
      organizationId: organizationAId,
      customerId: customerA,
      status: "open",
      failureCode: "insufficient_funds",
      created,
    });
    const invoices = new Map([[invoiceId, failedInvoice]]);
    const billing = new BillingService(prisma, environment, tenant, audit, notifications);
    billing.subscriptionProvider = makeMockProvider(new Map(), invoices);
    const failedEvent = invoiceEvent(
      `evt_invoice_failed_${runId}`,
      "invoice.payment_failed",
      failedInvoice,
    );
    const failedSigned = sign(failedEvent);

    const duplicateResults = await Promise.all([
      billing.processWebhook(failedSigned.payload, failedSigned.signature, request),
      billing.processWebhook(failedSigned.payload, failedSigned.signature, request),
    ]);
    expect(duplicateResults.map((result) => result.duplicate).sort()).toEqual([false, true]);
    const failedRow = await prisma.client.billingInvoice.findUniqueOrThrow({
      where: { stripeInvoiceId: invoiceId },
    });
    expect(failedRow.recoveryStatus).toBe("GRACE");
    expect(failedRow.automaticRetryEligible).toBe(true);
    expect(failedRow.graceEndsAt?.getTime()).toBe(created * 1000 + 48 * 60 * 60 * 1000);
    expect(
      await prisma.client.billingEmailOutbox.count({
        where: { billingInvoiceId: failedRow.id, kind: "PAYMENT_FAILED" },
      }),
    ).toBe(1);

    const originalDeadline = failedRow.graceEndsAt;
    const cardEvent = {
      id: `evt_customer_card_${runId}`,
      object: "event",
      api_version: "2026-06-24.dahlia",
      created: created + 20,
      data: {
        object: { id: customerA, object: "customer" },
        previous_attributes: { invoice_settings: { default_payment_method: `pm_old_${runId}` } },
      },
      livemode: false,
      pending_webhooks: 1,
      request: null,
      type: "customer.updated",
    };
    const cardSigned = sign(cardEvent);
    await billing.processWebhook(cardSigned.payload, cardSigned.signature, request);
    const woken = await prisma.client.billingInvoice.findUniqueOrThrow({
      where: { stripeInvoiceId: invoiceId },
    });
    expect(woken.graceEndsAt).toEqual(originalDeadline);
    expect(woken.nextRecoveryAttemptAt?.getTime()).toBeLessThanOrEqual(Date.now() + 1_000);
    expect(
      await prisma.client.billingInvoice.count({ where: { stripeInvoiceId: invoiceId } }),
    ).toBe(1);

    const paidInvoice = buildInvoice({
      id: invoiceId,
      organizationId: organizationAId,
      customerId: customerA,
      status: "paid",
      created,
    });
    invoices.set(invoiceId, paidInvoice);
    const paidEvent = invoiceEvent(`evt_invoice_paid_${runId}`, "invoice.paid", paidInvoice);
    const paidSigned = sign(paidEvent);
    await billing.processWebhook(paidSigned.payload, paidSigned.signature, request);
    const paidRow = await prisma.client.billingInvoice.findUniqueOrThrow({
      where: { stripeInvoiceId: invoiceId },
    });
    const profile = await prisma.client.organizationBillingProfile.findUniqueOrThrow({
      where: { organizationId: organizationAId },
    });
    expect(paidRow.status).toBe("paid");
    expect(paidRow.amountRemaining).toBe(0);
    expect(paidRow.recoveryStatus).toBe("RECOVERED");
    expect(profile.subscriptionStatus).toBe("ACTIVE");
    expect(profile.gracePeriodEnd).toBeNull();
    expect(
      await prisma.client.billingEmailOutbox.count({
        where: { billingInvoiceId: failedRow.id, kind: "INVOICE_PAID" },
      }),
    ).toBe(1);
    expect(
      await prisma.client.billingEmailOutbox.findFirstOrThrow({
        where: { billingInvoiceId: failedRow.id, kind: "PAYMENT_FAILED" },
      }),
    ).toMatchObject({ status: "CANCELED" });
  });

  it("does not auto-retry a hard decline and deterministically expires then recovers grace", async () => {
    const environment = new EnvironmentService();
    const audit = new AuditService(prisma);
    const tenant = new TenantService(prisma, audit);
    const notifications = { send: vi.fn(async () => undefined) } as unknown as NotificationService;
    const invoiceId = `in_hard_decline_${runId}`;
    const created = Math.floor((Date.now() - 49 * 60 * 60 * 1000) / 1000);
    const failed = buildInvoice({
      id: invoiceId,
      organizationId: organizationAId,
      customerId: customerA,
      status: "open",
      failureCode: "stolen_card",
      created,
    });
    const invoices = new Map([[invoiceId, failed]]);
    const billing = new BillingService(prisma, environment, tenant, audit, notifications);
    billing.subscriptionProvider = makeMockProvider(new Map(), invoices);
    const event = invoiceEvent(`evt_hard_decline_${runId}`, "invoice.payment_failed", failed);
    const signed = sign(event);
    await billing.processWebhook(signed.payload, signed.signature, request);
    const failedRow = await prisma.client.billingInvoice.findUniqueOrThrow({
      where: { stripeInvoiceId: invoiceId },
    });
    expect(failedRow.failureCategory).toBe("HARD_DECLINE");
    expect(failedRow.recoveryStatus).toBe("ACTION_REQUIRED");
    expect(failedRow.automaticRetryEligible).toBe(false);
    expect(failedRow.nextRecoveryAttemptAt).toBeNull();

    const worker = new OperationalWorker(prisma.client, environment.values);
    try {
      expect(await worker.expireBillingGracePeriods()).toBeGreaterThanOrEqual(1);
    } finally {
      worker.close();
    }
    const expired = await prisma.client.billingInvoice.findUniqueOrThrow({
      where: { stripeInvoiceId: invoiceId },
    });
    const pastDue = await prisma.client.organizationBillingProfile.findUniqueOrThrow({
      where: { organizationId: organizationAId },
    });
    expect(expired.recoveryStatus).toBe("EXPIRED");
    expect(pastDue.subscriptionStatus).toBe("PAST_DUE");
    expect(
      await prisma.client.billingEmailOutbox.count({
        where: { billingInvoiceId: expired.id, kind: "BILLING_GRACE_EXPIRED" },
      }),
    ).toBe(1);

    const paid = buildInvoice({
      id: invoiceId,
      organizationId: organizationAId,
      customerId: customerA,
      status: "paid",
      created,
    });
    invoices.set(invoiceId, paid);
    const paidEvent = invoiceEvent(`evt_hard_decline_paid_${runId}`, "invoice.paid", paid);
    const paidSigned = sign(paidEvent);
    await billing.processWebhook(paidSigned.payload, paidSigned.signature, request);
    expect(
      (
        await prisma.client.organizationBillingProfile.findUniqueOrThrow({
          where: { organizationId: organizationAId },
        })
      ).subscriptionStatus,
    ).toBe("ACTIVE");
  });

  it("retries a FAILED event and applies business state once", async () => {
    const eventId = `evt_retry_${runId}`;
    const environment = new EnvironmentService();
    const audit = new AuditService(prisma);
    const tenant = new TenantService(prisma, audit);
    const sendN = vi.fn(async () => undefined);
    const notifications = { send: sendN } as unknown as NotificationService;

    // First attempt: use an unknown price — applyStripeEvent will throw before provider call.
    const { event: invalidEvent, subId } = subscriptionEvent({
      id: eventId,
      organizationId: organizationAId,
      priceId: "price_unknown_retry",
    });
    const invalid = sign(invalidEvent);

    // Need a provider that returns a sub with the invalid priceId for the first attempt.
    const invalidSubs = new Map([
      [
        subId,
        buildMockSub({
          id: subId,
          status: "active",
          priceId: "price_unknown_retry",
          plan: "growth",
          organizationId: organizationAId,
          customerId: customerA,
        }),
      ],
    ]);
    const bInvalid = new BillingService(prisma, environment, tenant, audit, notifications);
    bInvalid.subscriptionProvider = makeMockProvider(invalidSubs);
    await expect(
      bInvalid.processWebhook(invalid.payload, invalid.signature, request),
    ).rejects.toMatchObject({ code: "STRIPE_PRICE_UNKNOWN" });

    // Second attempt: valid price.
    const { event: validEvent } = subscriptionEvent({
      id: eventId,
      organizationId: organizationAId,
      priceId: "price_test_growth",
      plan: "growth",
    });
    const valid = sign(validEvent);
    const validSubs = new Map([
      [
        subId,
        buildMockSub({
          id: subId,
          status: "active",
          priceId: "price_test_growth",
          plan: "growth",
          organizationId: organizationAId,
          customerId: customerA,
        }),
      ],
    ]);
    const bValid = new BillingService(prisma, environment, tenant, audit, notifications);
    bValid.subscriptionProvider = makeMockProvider(validSubs);
    await expect(bValid.processWebhook(valid.payload, valid.signature, request)).resolves.toEqual({
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
        where: { action: "stripe.subscription_applied", targetId: subId },
      }),
    ).toBe(1);
  });

  it("reclaims an expired PROCESSING lease", async () => {
    const eventId = `evt_lease_${runId}`;
    const { event, subId } = subscriptionEvent({
      id: eventId,
      organizationId: organizationAId,
      plan: "growth",
    });
    await prisma.client.processedWebhookEvent.create({
      data: {
        provider: "stripe",
        externalEventId: eventId,
        eventType: "customer.subscription.updated",
        status: "PROCESSING",
        leaseExpiresAt: new Date(Date.now() - 1_000),
      },
    });
    const signed = sign(event);
    const environment = new EnvironmentService();
    const audit = new AuditService(prisma);
    const tenant = new TenantService(prisma, audit);
    const sendN = vi.fn(async () => undefined);
    const notifications = { send: sendN } as unknown as NotificationService;
    const subs = new Map([
      [
        subId,
        buildMockSub({
          id: subId,
          status: "active",
          priceId: "price_test_growth",
          plan: "growth",
          organizationId: organizationAId,
          customerId: customerA,
        }),
      ],
    ]);
    const b = new BillingService(prisma, environment, tenant, audit, notifications);
    b.subscriptionProvider = makeMockProvider(subs);
    await expect(b.processWebhook(signed.payload, signed.signature, request)).resolves.toEqual({
      received: true,
      duplicate: false,
    });
    expect(
      await prisma.client.processedWebhookEvent.findUniqueOrThrow({
        where: {
          provider_externalEventId: { provider: "stripe", externalEventId: eventId },
        },
      }),
    ).toMatchObject({ status: "PROCESSED", attemptCount: 2, leaseExpiresAt: null });
  });

  it("rejects customer and organization metadata mismatches", async () => {
    const { event, subId } = subscriptionEvent({
      id: `evt_mismatch_${runId}`,
      customer: customerA,
      organizationId: organizationBId,
      plan: "growth",
    });
    const signed = sign(event);
    const environment = new EnvironmentService();
    const audit = new AuditService(prisma);
    const tenant = new TenantService(prisma, audit);
    const sendN = vi.fn(async () => undefined);
    const notifications = { send: sendN } as unknown as NotificationService;
    const subs = new Map([
      [
        subId,
        buildMockSub({
          id: subId,
          status: "active",
          priceId: "price_test_growth",
          plan: "growth",
          organizationId: organizationBId,
          customerId: customerA,
        }),
      ],
    ]);
    const b = new BillingService(prisma, environment, tenant, audit, notifications);
    b.subscriptionProvider = makeMockProvider(subs);
    await expect(b.processWebhook(signed.payload, signed.signature, request)).rejects.toMatchObject(
      { code: "STRIPE_CUSTOMER_ORGANIZATION_MISMATCH" },
    );
  });

  it("rejects invalid plan metadata, mismatched plans, and unknown prices", async () => {
    const environment = new EnvironmentService();
    const audit = new AuditService(prisma);
    const tenant = new TenantService(prisma, audit);
    const sendN = vi.fn(async () => undefined);
    const notifications = { send: sendN } as unknown as NotificationService;

    // Invalid plan.
    const { event: invalidPlanEvent, subId: subIdIp } = subscriptionEvent({
      id: `evt_invalid_plan_${runId}`,
      organizationId: organizationAId,
      plan: "enterprise",
    });
    const invalidPlanSubs = new Map([
      [
        subIdIp,
        buildMockSub({
          id: subIdIp,
          status: "active",
          priceId: "price_test_growth",
          plan: "enterprise",
          organizationId: organizationAId,
          customerId: customerA,
        }),
      ],
    ]);
    const bIp = new BillingService(prisma, environment, tenant, audit, notifications);
    bIp.subscriptionProvider = makeMockProvider(invalidPlanSubs);
    await expect(
      bIp.processWebhook(...(Object.values(sign(invalidPlanEvent)) as [Buffer, string]), request),
    ).rejects.toMatchObject({ code: "STRIPE_PLAN_INVALID" });

    // Mismatched plan (price says growth, metadata says starter).
    const { event: mismatchEvent, subId: subIdMm } = subscriptionEvent({
      id: `evt_plan_mismatch_${runId}`,
      organizationId: organizationAId,
      priceId: "price_test_growth",
      plan: "starter",
    });
    const mismatchSubs = new Map([
      [
        subIdMm,
        buildMockSub({
          id: subIdMm,
          status: "active",
          priceId: "price_test_growth",
          plan: "starter",
          organizationId: organizationAId,
          customerId: customerA,
        }),
      ],
    ]);
    const bMm = new BillingService(prisma, environment, tenant, audit, notifications);
    bMm.subscriptionProvider = makeMockProvider(mismatchSubs);
    await expect(
      bMm.processWebhook(...(Object.values(sign(mismatchEvent)) as [Buffer, string]), request),
    ).rejects.toMatchObject({ code: "STRIPE_PLAN_PRICE_MISMATCH" });

    // Unknown price.
    const { event: unknownEvent, subId: subIdUk } = subscriptionEvent({
      id: `evt_unknown_price_${runId}`,
      organizationId: organizationAId,
      priceId: "price_not_configured",
    });
    const unknownSubs = new Map([
      [
        subIdUk,
        buildMockSub({
          id: subIdUk,
          status: "active",
          priceId: "price_not_configured",
          plan: "growth",
          organizationId: organizationAId,
          customerId: customerA,
        }),
      ],
    ]);
    const bUk = new BillingService(prisma, environment, tenant, audit, notifications);
    bUk.subscriptionProvider = makeMockProvider(unknownSubs);
    await expect(
      bUk.processWebhook(...(Object.values(sign(unknownEvent)) as [Buffer, string]), request),
    ).rejects.toMatchObject({ code: "STRIPE_PRICE_UNKNOWN" });
  });

  it("rejects a Stripe downgrade while the organization exceeds the target limits", async () => {
    await prisma.client.location.createMany({
      data: [
        { organizationId: organizationAId, name: "Over limit 1", timezone: "UTC" },
        { organizationId: organizationAId, name: "Over limit 2", timezone: "UTC" },
      ],
    });
    const organizationOwner = await prisma.client.organizationMember.findFirstOrThrow({
      where: { organizationId: organizationAId, role: "OWNER" },
      select: { userId: true },
    });
    await prisma.client.loyaltyProgram.createMany({
      data: [
        {
          organizationId: organizationAId,
          internalName: "Stripe downgrade program A",
          createdByUserId: organizationOwner.userId,
        },
        {
          organizationId: organizationAId,
          internalName: "Stripe downgrade program B",
          createdByUserId: organizationOwner.userId,
        },
      ],
    });
    const eventId = `evt_overlimit_${runId}`;
    const { event, subId } = subscriptionEvent({
      id: eventId,
      organizationId: organizationAId,
      priceId: "price_test_starter",
      plan: "starter",
    });
    const signed = sign(event);
    const environment = new EnvironmentService();
    const audit = new AuditService(prisma);
    const tenant = new TenantService(prisma, audit);
    const sendN = vi.fn(async () => undefined);
    const notifications = { send: sendN } as unknown as NotificationService;
    const subs = new Map([
      [
        subId,
        buildMockSub({
          id: subId,
          status: "active",
          priceId: "price_test_starter",
          plan: "starter",
          organizationId: organizationAId,
          customerId: customerA,
        }),
      ],
    ]);
    const b = new BillingService(prisma, environment, tenant, audit, notifications);
    b.subscriptionProvider = makeMockProvider(subs);
    await expect(b.processWebhook(signed.payload, signed.signature, request)).rejects.toMatchObject(
      {
        code: "PLAN_DOWNGRADE_BLOCKED_FROM_PROVIDER",
        details: {
          requestedPlan: "starter",
          violations: expect.arrayContaining([
            expect.objectContaining({ code: "LOCATIONS" }),
            expect.objectContaining({ code: "ACTIVE_PROGRAMS" }),
          ]),
        },
      },
    );
    expect(
      await prisma.client.location.count({
        where: { organizationId: organizationAId, status: "ACTIVE" },
      }),
    ).toBeGreaterThanOrEqual(2);
    const organization = await prisma.client.organization.findUniqueOrThrow({
      where: { id: organizationAId },
      select: { selectedPlan: true },
    });
    expect(organization.selectedPlan).toBe("GROWTH");
    expect(
      await prisma.client.auditLog.findFirst({
        where: { action: "stripe.subscription_applied", targetId: subId },
      }),
    ).toBeNull();
  });
});
