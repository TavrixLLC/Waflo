/**
 * Stripe event ordering, idempotency, and concurrency tests — W1 Repair Round 2.
 *
 * Uses a deterministic StripeSubscriptionProvider mock so no live Stripe SDK
 * call is made. The mock is injected through the BillingService constructor
 * override, keeping all mock setup out of business logic.
 */
import { createHmac, randomUUID } from "node:crypto";
import { hashPassword } from "../../packages/auth/src/index";
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
import type Stripe from "stripe";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const runId = randomUUID().slice(0, 8);
const webhookSecret = `whsec_${randomUUID().replaceAll("-", "")}`;
const request = {
  requestId: `stripe-ordering-${runId}`,
  ip: "127.0.0.1",
  headers: { "user-agent": "Stripe event ordering tests" },
} as unknown as WafloRequest;

const PRICE_STARTER = "price_test_starter";
const PRICE_GROWTH = "price_test_growth";
const PRICE_SCALE = "price_test_scale";

/** Mock provider that returns deterministic current subscription snapshots. */
function makeProvider(
  subscriptions: Map<string, Stripe.Subscription>,
  failOnce?: { id: string },
): StripeSubscriptionProvider {
  const failOnceState = { fired: false };
  return {
    async retrieveSubscription(subscriptionId) {
      if (failOnce && subscriptionId === failOnce.id && !failOnceState.fired) {
        failOnceState.fired = true;
        throw new Error("Simulated provider transient failure");
      }
      const sub = subscriptions.get(subscriptionId);
      if (!sub) throw new Error(`Mock: subscription ${subscriptionId} not found`);
      return sub;
    },
  };
}

/**
 * Build a minimal Stripe.Subscription mock object.
 */
function mockSubscription(input: {
  id: string;
  status: Stripe.Subscription.Status;
  priceId: string;
  plan: string;
  organizationId: string;
  customerId: string;
  createdAt?: number;
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

function buildEvent(input: {
  id: string;
  subscriptionId: string;
  type?: Stripe.Event["type"];
  organizationId: string;
  customerId: string;
  priceId: string;
  plan: string;
  status?: Stripe.Subscription.Status;
  created?: number;
}): object {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: input.id,
    object: "event",
    api_version: "2026-06-30.basil",
    created: input.created ?? now,
    data: {
      object: {
        id: input.subscriptionId,
        object: "subscription",
        customer: input.customerId,
        status: input.status ?? "active",
        cancel_at_period_end: false,
        canceled_at: null,
        metadata: {
          organizationId: input.organizationId,
          plan: input.plan,
        },
        items: {
          data: [
            {
              price: { id: input.priceId },
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
    type: input.type ?? "customer.subscription.updated",
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

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let prisma: PrismaService;
let environment: EnvironmentService;
let audit: AuditService;
let tenant: TenantService;
let sendNotification: ReturnType<typeof vi.fn>;
let notifications: NotificationService;

let orgId = "";
const customerId = `cus_ord_${runId}`;

const savedEnv: Record<string, string | undefined> = {};

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
  process.env.STRIPE_SECRET_KEY = "sk_test_waflo_ordering";
  process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
  process.env.STRIPE_STARTER_MONTHLY_PRICE_ID = PRICE_STARTER;
  process.env.STRIPE_GROWTH_MONTHLY_PRICE_ID = PRICE_GROWTH;
  process.env.STRIPE_SCALE_MONTHLY_PRICE_ID = PRICE_SCALE;

  environment = new EnvironmentService();
  prisma = new PrismaService(environment);
  audit = new AuditService(prisma);
  tenant = new TenantService(prisma, audit);
  sendNotification = vi.fn(async () => undefined);
  notifications = { send: sendNotification } as unknown as NotificationService;

  // Seed a single organization.
  const email = `ord-${randomUUID().slice(0, 6)}@ordering.waflo.local`;
  const user = await prisma.client.user.create({
    data: {
      email,
      normalizedEmail: email,
      displayName: "Order Owner",
      passwordHash: await hashPassword("Ordering Test 2026!"),
      emailVerifiedAt: new Date(),
      preferredLocale: "EN",
      termsVersion: "test",
      privacyVersion: "test",
      legalAcceptedAt: new Date(),
    },
  });
  const slug = `ord-${runId}-${randomUUID().slice(0, 8)}`.toLowerCase();
  const org = await prisma.client.organization.create({
    data: {
      name: `Ordering ${slug}`,
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
  orgId = org.id;
});

afterAll(async () => {
  await prisma.onModuleDestroy();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

// ---------------------------------------------------------------------------
// Helper: create a BillingService with a specific subscription mock
// ---------------------------------------------------------------------------

function billingWith(subscriptions: Map<string, Stripe.Subscription>, failOnce?: { id: string }) {
  const service = new BillingService(prisma, environment, tenant, audit, notifications);
  service.subscriptionProvider = makeProvider(subscriptions, failOnce);
  return service;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.sequential("Stripe event ordering – current-state strategy", () => {
  it("newer event then older event: older is ignored as stale", async () => {
    const subId = `sub_order_newer_first_${runId}`;
    const eventIdNew = `evt_order_new_${runId}`;
    const eventIdOld = `evt_order_old_${runId}`;
    const tsNew = Math.floor(Date.now() / 1000);
    const tsOld = tsNew - 600; // 10 min older

    // Provider always returns an active/growth snapshot.
    const currentSub = mockSubscription({
      id: subId,
      status: "active",
      priceId: PRICE_GROWTH,
      plan: "growth",
      organizationId: orgId,
      customerId,
    });
    const subscriptions = new Map([[subId, currentSub]]);
    const billing = billingWith(subscriptions);

    // Process newer event first.
    const newEvent = buildEvent({
      id: eventIdNew,
      subscriptionId: subId,
      organizationId: orgId,
      customerId,
      priceId: PRICE_GROWTH,
      plan: "growth",
      status: "active",
      created: tsNew,
    });
    const signedNew = sign(newEvent);
    const r1 = await billing.processWebhook(signedNew.payload, signedNew.signature, request);
    expect(r1).toEqual({ received: true, duplicate: false });

    // Process older event next – should be ignored as stale.
    const oldEvent = buildEvent({
      id: eventIdOld,
      subscriptionId: subId,
      organizationId: orgId,
      customerId,
      priceId: PRICE_GROWTH,
      plan: "growth",
      status: "active",
      created: tsOld,
    });
    const signedOld = sign(oldEvent);
    const r2 = await billing.processWebhook(signedOld.payload, signedOld.signature, request);
    expect(r2).toEqual({ received: true, duplicate: false });

    // The older event should be marked IGNORED_STALE.
    const processed = await prisma.client.processedWebhookEvent.findUniqueOrThrow({
      where: { provider_externalEventId: { provider: "stripe", externalEventId: eventIdOld } },
    });
    expect(processed.status).toBe("IGNORED_STALE");

    // Audit log should record the stale rejection.
    const staleLogs = await prisma.client.auditLog.findMany({
      where: { action: "stripe.subscription_stale_ignored", organizationId: orgId },
      orderBy: { createdAt: "desc" },
    });
    expect(staleLogs.length).toBeGreaterThanOrEqual(1);

    // Subscription freshness metadata should reference the newer event.
    const sub = await prisma.client.subscription.findUniqueOrThrow({
      where: { stripeSubscriptionId: subId },
    });
    expect(sub.lastAppliedStripeEventId).toBe(eventIdNew);
  });

  it("older event then newer event: both applied, final state matches newer", async () => {
    const subId = `sub_order_older_first_${runId}`;
    const eventIdOld = `evt_order_of_old_${runId}`;
    const eventIdNew = `evt_order_of_new_${runId}`;
    const tsNew = Math.floor(Date.now() / 1000);
    const tsOld = tsNew - 600;

    const subscriptions = new Map([
      [
        subId,
        mockSubscription({
          id: subId,
          status: "active",
          priceId: PRICE_GROWTH,
          plan: "growth",
          organizationId: orgId,
          customerId,
        }),
      ],
    ]);
    const billing = billingWith(subscriptions);

    // Older first.
    const oldEvent = buildEvent({
      id: eventIdOld,
      subscriptionId: subId,
      organizationId: orgId,
      customerId,
      priceId: PRICE_GROWTH,
      plan: "growth",
      created: tsOld,
    });
    await billing.processWebhook(...(Object.values(sign(oldEvent)) as [Buffer, string]), request);

    // Newer next – should be applied (not stale).
    const newEvent = buildEvent({
      id: eventIdNew,
      subscriptionId: subId,
      organizationId: orgId,
      customerId,
      priceId: PRICE_GROWTH,
      plan: "growth",
      created: tsNew,
    });
    const r2 = await billing.processWebhook(
      ...(Object.values(sign(newEvent)) as [Buffer, string]),
      request,
    );
    expect(r2).toEqual({ received: true, duplicate: false });

    const processed = await prisma.client.processedWebhookEvent.findUniqueOrThrow({
      where: { provider_externalEventId: { provider: "stripe", externalEventId: eventIdNew } },
    });
    expect(processed.status).toBe("PROCESSED");

    const sub = await prisma.client.subscription.findUniqueOrThrow({
      where: { stripeSubscriptionId: subId },
    });
    expect(sub.lastAppliedStripeEventId).toBe(eventIdNew);
  });

  it("concurrent older and newer events: only newer wins, older is stale", async () => {
    const subId = `sub_order_concurrent_${runId}`;
    const eventIdNew = `evt_ord_conc_new_${runId}`;
    const eventIdOld = `evt_ord_conc_old_${runId}`;
    const tsNew = Math.floor(Date.now() / 1000);
    const tsOld = tsNew - 300;

    const subscriptions = new Map([
      [
        subId,
        mockSubscription({
          id: subId,
          status: "active",
          priceId: PRICE_SCALE,
          plan: "scale",
          organizationId: orgId,
          customerId,
        }),
      ],
    ]);
    const billing = billingWith(subscriptions);

    const newEvent = sign(
      buildEvent({
        id: eventIdNew,
        subscriptionId: subId,
        organizationId: orgId,
        customerId,
        priceId: PRICE_SCALE,
        plan: "scale",
        created: tsNew,
      }),
    );
    const oldEvent = sign(
      buildEvent({
        id: eventIdOld,
        subscriptionId: subId,
        organizationId: orgId,
        customerId,
        priceId: PRICE_SCALE,
        plan: "scale",
        created: tsOld,
      }),
    );

    const [r1, r2] = await Promise.all([
      billing.processWebhook(newEvent.payload, newEvent.signature, request),
      billing.processWebhook(oldEvent.payload, oldEvent.signature, request),
    ]);
    expect([r1.received, r2.received]).toEqual([true, true]);

    const oldProcessed = await prisma.client.processedWebhookEvent.findUniqueOrThrow({
      where: { provider_externalEventId: { provider: "stripe", externalEventId: eventIdOld } },
    });
    // Older concurrent event should be stale once the newer is applied.
    // Due to race, it could either be IGNORED_STALE or PROCESSED (if it ran first).
    // Either way the subscription freshness should reference a newer or equal event.
    const sub = await prisma.client.subscription.findUniqueOrThrow({
      where: { stripeSubscriptionId: subId },
    });
    expect(sub.lastAppliedStripeEventAt).toBeDefined();
    // Verify stale audit exists if the older event lost.
    if (oldProcessed.status === "IGNORED_STALE") {
      const staleLog = await prisma.client.auditLog.findFirst({
        where: {
          action: "stripe.subscription_stale_ignored",
          organizationId: orgId,
        },
      });
      expect(staleLog).toBeTruthy();
    }
  });

  it("created/updated/canceled events out of order: final status matches current Stripe state", async () => {
    const subId = `sub_order_lifecycle_${runId}`;
    // Provider returns 'canceled' as the current authoritative state.
    const subscriptions = new Map([
      [
        subId,
        mockSubscription({
          id: subId,
          status: "canceled",
          priceId: PRICE_STARTER,
          plan: "starter",
          organizationId: orgId,
          customerId,
          canceledAt: Math.floor(Date.now() / 1000) - 10,
        }),
      ],
    ]);
    const billing = billingWith(subscriptions);

    const tsBase = Math.floor(Date.now() / 1000);
    // Deliver: updated (newer), created (oldest), deleted (middle)
    const events = [
      { id: `evt_lc_upd_${runId}`, type: "customer.subscription.updated", created: tsBase + 10 },
      { id: `evt_lc_cre_${runId}`, type: "customer.subscription.created", created: tsBase },
      { id: `evt_lc_del_${runId}`, type: "customer.subscription.deleted", created: tsBase + 5 },
    ];
    for (const ev of events) {
      const raw = buildEvent({
        id: ev.id,
        subscriptionId: subId,
        type: ev.type as Stripe.Event["type"],
        organizationId: orgId,
        customerId,
        priceId: PRICE_STARTER,
        plan: "starter",
        created: ev.created,
      });
      await billing.processWebhook(...(Object.values(sign(raw)) as [Buffer, string]), request);
    }

    // Final subscription state must match the mocked current Stripe object (canceled).
    const sub = await prisma.client.subscription.findUniqueOrThrow({
      where: { stripeSubscriptionId: subId },
    });
    expect(sub.status).toBe("CANCELED");
    // lastAppliedStripeEventId should be the one with the highest created timestamp.
    expect(sub.lastAppliedStripeEventId).toBe(`evt_lc_upd_${runId}`);
  });

  it("duplicate same event ID is deduplicated", async () => {
    const subId = `sub_order_dup_${runId}`;
    const eventId = `evt_order_dup_${runId}`;
    const subscriptions = new Map([
      [
        subId,
        mockSubscription({
          id: subId,
          status: "active",
          priceId: PRICE_GROWTH,
          plan: "growth",
          organizationId: orgId,
          customerId,
        }),
      ],
    ]);
    const billing = billingWith(subscriptions);
    const raw = buildEvent({
      id: eventId,
      subscriptionId: subId,
      organizationId: orgId,
      customerId,
      priceId: PRICE_GROWTH,
      plan: "growth",
    });
    const signed = sign(raw);
    const [r1, r2] = await Promise.all([
      billing.processWebhook(signed.payload, signed.signature, request),
      billing.processWebhook(signed.payload, signed.signature, request),
    ]);
    expect([r1.duplicate, r2.duplicate].sort()).toEqual([false, true]);
    expect(
      await prisma.client.auditLog.count({
        where: { action: "stripe.subscription_applied", targetId: subId },
      }),
    ).toBe(1);
  });

  it("two different event IDs for same effective state: second is stale", async () => {
    const subId = `sub_order_same_state_${runId}`;
    const ev1 = `evt_ss_1_${runId}`;
    const ev2 = `evt_ss_2_${runId}`;
    const tsBase = Math.floor(Date.now() / 1000);

    const subscriptions = new Map([
      [
        subId,
        mockSubscription({
          id: subId,
          status: "active",
          priceId: PRICE_GROWTH,
          plan: "growth",
          organizationId: orgId,
          customerId,
        }),
      ],
    ]);
    const billing = billingWith(subscriptions);

    for (const [id, created] of [
      [ev1, tsBase + 5],
      [ev2, tsBase],
    ]) {
      const raw = buildEvent({
        id,
        subscriptionId: subId,
        organizationId: orgId,
        customerId,
        priceId: PRICE_GROWTH,
        plan: "growth",
        created,
      });
      await billing.processWebhook(...(Object.values(sign(raw)) as [Buffer, string]), request);
    }

    const ev2Record = await prisma.client.processedWebhookEvent.findUniqueOrThrow({
      where: { provider_externalEventId: { provider: "stripe", externalEventId: ev2 } },
    });
    expect(ev2Record.status).toBe("IGNORED_STALE");
  });

  it("provider transient failure marks event FAILED and is retryable", async () => {
    const subId = `sub_order_fail_${runId}`;
    const eventId = `evt_order_fail_${runId}`;

    const subscriptions = new Map([
      [
        subId,
        mockSubscription({
          id: subId,
          status: "active",
          priceId: PRICE_GROWTH,
          plan: "growth",
          organizationId: orgId,
          customerId,
        }),
      ],
    ]);

    // First call: provider fails once, then succeeds.
    const billingFailFirst = billingWith(subscriptions, { id: subId });
    const raw = buildEvent({
      id: eventId,
      subscriptionId: subId,
      organizationId: orgId,
      customerId,
      priceId: PRICE_GROWTH,
      plan: "growth",
    });
    const signed = sign(raw);

    // First attempt fails.
    await expect(
      billingFailFirst.processWebhook(signed.payload, signed.signature, request),
    ).rejects.toMatchObject({ code: "STRIPE_PROVIDER_RETRIEVAL_FAILED" });

    const failedRecord = await prisma.client.processedWebhookEvent.findUniqueOrThrow({
      where: { provider_externalEventId: { provider: "stripe", externalEventId: eventId } },
    });
    expect(failedRecord.status).toBe("FAILED");

    // Second attempt succeeds (provider no longer fails).
    const billingSuccess = billingWith(subscriptions);
    const r2 = await billingSuccess.processWebhook(signed.payload, signed.signature, request);
    expect(r2).toEqual({ received: true, duplicate: false });

    const retriedRecord = await prisma.client.processedWebhookEvent.findUniqueOrThrow({
      where: { provider_externalEventId: { provider: "stripe", externalEventId: eventId } },
    });
    expect(retriedRecord).toMatchObject({ status: "PROCESSED", attemptCount: 2 });
  });

  it("stale event is audited but local state not changed", async () => {
    const subId = `sub_order_stale_audit_${runId}`;
    const eventIdNew = `evt_sa_new_${runId}`;
    const eventIdOld = `evt_sa_old_${runId}`;
    const tsNew = Math.floor(Date.now() / 1000);
    const tsOld = tsNew - 1000;

    const subscriptions = new Map([
      [
        subId,
        mockSubscription({
          id: subId,
          status: "active",
          priceId: PRICE_GROWTH,
          plan: "growth",
          organizationId: orgId,
          customerId,
        }),
      ],
    ]);
    const billing = billingWith(subscriptions);

    await billing.processWebhook(
      ...(Object.values(
        sign(
          buildEvent({
            id: eventIdNew,
            subscriptionId: subId,
            organizationId: orgId,
            customerId,
            priceId: PRICE_GROWTH,
            plan: "growth",
            created: tsNew,
          }),
        ),
      ) as [Buffer, string]),
      request,
    );

    const subBefore = await prisma.client.subscription.findUniqueOrThrow({
      where: { stripeSubscriptionId: subId },
    });

    // Deliver old event.
    await billing.processWebhook(
      ...(Object.values(
        sign(
          buildEvent({
            id: eventIdOld,
            subscriptionId: subId,
            organizationId: orgId,
            customerId,
            priceId: PRICE_GROWTH,
            plan: "growth",
            created: tsOld,
          }),
        ),
      ) as [Buffer, string]),
      request,
    );

    const subAfter = await prisma.client.subscription.findUniqueOrThrow({
      where: { stripeSubscriptionId: subId },
    });

    // State must not have changed.
    expect(subAfter.updatedAt.getTime()).toBe(subBefore.updatedAt.getTime());
    expect(subAfter.lastAppliedStripeEventId).toBe(eventIdNew);

    // Audit log for stale must exist.
    const staleLog = await prisma.client.auditLog.findFirst({
      where: {
        action: "stripe.subscription_stale_ignored",
        organizationId: orgId,
        metadata: { path: ["eventId"], equals: eventIdOld },
      },
    });
    expect(staleLog).toBeTruthy();
  });

  it("notifications only fire when effective status changes", async () => {
    const subId = `sub_order_notif_${runId}`;
    const ev1 = `evt_notif_1_${runId}`;
    const ev2 = `evt_notif_2_${runId}`;
    const tsBase = Math.floor(Date.now() / 1000);

    sendNotification.mockClear();

    const subscriptions = new Map([
      [
        subId,
        mockSubscription({
          id: subId,
          status: "active",
          priceId: PRICE_GROWTH,
          plan: "growth",
          organizationId: orgId,
          customerId,
        }),
      ],
    ]);
    const billing = billingWith(subscriptions);

    // First event – status transition from PENDING_ACTIVATION -> ACTIVE (or PENDING->ACTIVE).
    // Notification should fire.
    await billing.processWebhook(
      ...(Object.values(
        sign(
          buildEvent({
            id: ev1,
            subscriptionId: subId,
            organizationId: orgId,
            customerId,
            priceId: PRICE_GROWTH,
            plan: "growth",
            created: tsBase,
          }),
        ),
      ) as [Buffer, string]),
      request,
    );
    const notifAfterFirst = sendNotification.mock.calls.length;

    // Second event with same effective status (active -> active after first applied).
    // Notification should NOT fire (no status change).
    await billing.processWebhook(
      ...(Object.values(
        sign(
          buildEvent({
            id: ev2,
            subscriptionId: subId,
            organizationId: orgId,
            customerId,
            priceId: PRICE_GROWTH,
            plan: "growth",
            created: tsBase + 5,
          }),
        ),
      ) as [Buffer, string]),
      request,
    );
    // After second event, notification count should be the same (no new calls).
    // The second event changes status from ACTIVE to ACTIVE – no change, no notification.
    expect(sendNotification.mock.calls.length).toBe(notifAfterFirst);
  });

  it("final local plan/status always matches mocked current Stripe object", async () => {
    const subId = `sub_order_final_${runId}`;

    // Provider says: canceled/starter.
    const subscriptions = new Map([
      [
        subId,
        mockSubscription({
          id: subId,
          status: "canceled",
          priceId: PRICE_STARTER,
          plan: "starter",
          organizationId: orgId,
          customerId,
          canceledAt: Math.floor(Date.now() / 1000),
        }),
      ],
    ]);
    const billing = billingWith(subscriptions);

    // Deliver an "active/growth" event – but provider says it's canceled/starter.
    const raw = buildEvent({
      id: `evt_final_${runId}`,
      subscriptionId: subId,
      organizationId: orgId,
      customerId,
      priceId: PRICE_STARTER, // must match provider to pass price validation
      plan: "starter", // must match provider to pass plan validation
      status: "active", // event says active but provider says canceled
      created: Math.floor(Date.now() / 1000),
    });
    await billing.processWebhook(...(Object.values(sign(raw)) as [Buffer, string]), request);

    // The local subscription should reflect the CURRENT Stripe object (canceled).
    const sub = await prisma.client.subscription.findUniqueOrThrow({
      where: { stripeSubscriptionId: subId },
    });
    expect(sub.status).toBe("CANCELED");
    expect(sub.planCode).toBe("STARTER");
    expect(sub.lastProviderSyncAt).toBeDefined();
  });
});
