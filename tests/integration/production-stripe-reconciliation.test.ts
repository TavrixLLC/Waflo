import { randomUUID } from "node:crypto";
import { hashPassword } from "../../packages/auth/src/index.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { AuditService } from "../../apps/api/src/audit/audit.service.js";
import {
  BillingService,
  type StripeSubscriptionProvider,
} from "../../apps/api/src/billing/billing.service.js";
import type { WafloRequest } from "../../apps/api/src/common/request-context.js";
import { EnvironmentService } from "../../apps/api/src/config/environment.service.js";
import { PrismaService } from "../../apps/api/src/database/prisma.service.js";
import type { NotificationService } from "../../apps/api/src/notifications/notification.service.js";
import { TenantService } from "../../apps/api/src/tenancy/tenant.service.js";
import { OperationalWorker } from "../../apps/operational-worker/src/main.js";

const PRICE_STARTER = "price_reconcile_starter";
const PRICE_GROWTH = "price_reconcile_growth";
const PRICE_SCALE = "price_reconcile_scale";

describe.sequential("production Stripe subscription reconciliation", () => {
  let prisma: PrismaService;
  let environment: EnvironmentService;
  let audit: AuditService;
  let tenant: TenantService;
  let ownerId: string;
  let outsiderId: string;

  const request = {
    requestId: "stripe-reconciliation-proof",
    id: "stripe-reconciliation-proof",
    ip: "127.0.0.1",
    headers: { "user-agent": "Stripe reconciliation proof" },
  } as unknown as WafloRequest;

  beforeAll(async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_reconciliation";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_reconciliation";
    process.env.STRIPE_STARTER_MONTHLY_PRICE_ID = PRICE_STARTER;
    process.env.STRIPE_GROWTH_MONTHLY_PRICE_ID = PRICE_GROWTH;
    process.env.STRIPE_SCALE_MONTHLY_PRICE_ID = PRICE_SCALE;
    environment = new EnvironmentService();
    prisma = new PrismaService(environment);
    audit = new AuditService(prisma);
    tenant = new TenantService(prisma, audit);
    const passwordHash = await hashPassword("Reconciliation Test 2026!");
    const [owner, outsider] = await Promise.all(
      ["owner", "outsider"].map((label) => {
        const email = `${label}-${randomUUID()}@reconcile.waflo.local`;
        return prisma.client.user.create({
          data: {
            email,
            normalizedEmail: email,
            displayName: label,
            passwordHash,
            emailVerifiedAt: new Date(),
            preferredLocale: "EN",
            termsVersion: "test",
            privacyVersion: "test",
            legalAcceptedAt: new Date(),
          },
        });
      }),
    );
    ownerId = owner.id;
    outsiderId = outsider.id;
  });

  afterAll(async () => prisma.onModuleDestroy());

  async function fixture(initialStatus: "ACTIVE" | "CANCELED" | "PAST_DUE" = "PAST_DUE") {
    const suffix = randomUUID().slice(0, 8);
    const customerId = `cus_reconcile_${suffix}`;
    const subscriptionId = `sub_reconcile_${suffix}`;
    const organization = await prisma.client.organization.create({
      data: {
        name: `Reconcile ${suffix}`,
        normalizedName: `reconcile ${suffix}`,
        merchantSlug: `reconcile-${suffix}`,
        timezone: "UTC",
        selectedPlan: "STARTER",
        members: { create: { userId: ownerId, role: "OWNER" } },
        billingProfile: {
          create: {
            stripeCustomerId: customerId,
            selectedPlan: "STARTER",
            subscriptionStatus: initialStatus,
          },
        },
        subscriptions: {
          create: {
            stripeSubscriptionId: subscriptionId,
            stripePriceId: PRICE_STARTER,
            planCode: "STARTER",
            status: initialStatus,
          },
        },
      },
    });
    return { organizationId: organization.id, customerId, subscriptionId };
  }

  function snapshot(
    input: Awaited<ReturnType<typeof fixture>>,
    status: Stripe.Subscription.Status,
    priceId = PRICE_GROWTH,
    plan = "growth",
  ) {
    const now = Math.floor(Date.now() / 1000);
    return {
      id: input.subscriptionId,
      object: "subscription",
      status,
      customer: input.customerId,
      metadata: { organizationId: input.organizationId, plan },
      cancel_at_period_end: false,
      canceled_at: status === "canceled" ? now : null,
      items: {
        object: "list",
        data: [
          {
            id: `si_${input.subscriptionId}`,
            object: "subscription_item",
            price: { id: priceId } as Stripe.Price,
            current_period_start: now - 60,
            current_period_end: now + 86_400,
          } as Stripe.SubscriptionItem,
        ],
        has_more: false,
        url: "",
      },
    } as unknown as Stripe.Subscription;
  }

  function service(provider: StripeSubscriptionProvider) {
    const notifications = { send: vi.fn(async () => undefined) } as unknown as NotificationService;
    const billing = new BillingService(prisma, environment, tenant, audit, notifications);
    billing.subscriptionProvider = provider;
    return billing;
  }

  function provider(value: Stripe.Subscription): StripeSubscriptionProvider {
    return { retrieveSubscription: vi.fn(async () => value) };
  }

  function scheduledWorker(retrieve: (subscriptionId: string) => Promise<Stripe.Subscription>) {
    const worker = new OperationalWorker(prisma.client, environment.values);
    Object.defineProperty(worker, "stripe", {
      value: { subscriptions: { retrieve } },
    });
    return worker;
  }

  it("requires billing.manage", async () => {
    const item = await fixture();
    await expect(
      service(provider(snapshot(item, "active"))).reconcileOrganization(
        outsiderId,
        item.organizationId,
        request,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("rejects a provider snapshot belonging to another organization", async () => {
    const item = await fixture();
    const other = await fixture();
    const foreign = snapshot(
      { ...item, organizationId: other.organizationId, customerId: other.customerId },
      "active",
    );
    await expect(
      service(provider(foreign)).reconcileOrganization(ownerId, item.organizationId, request),
    ).rejects.toBeDefined();
    expect(
      (
        await prisma.client.organizationBillingProfile.findUniqueOrThrow({
          where: { organizationId: item.organizationId },
        })
      ).subscriptionStatus,
    ).toBe("PAST_DUE");
  });

  for (const [providerStatus, expected] of [
    ["active", "ACTIVE"],
    ["canceled", "CANCELED"],
    ["past_due", "PAST_DUE"],
  ] as const) {
    it(`reconciles canonical ${providerStatus} state`, async () => {
      const item = await fixture("PAST_DUE");
      await service(provider(snapshot(item, providerStatus))).reconcileOrganization(
        ownerId,
        item.organizationId,
        request,
      );
      const [profile, local] = await Promise.all([
        prisma.client.organizationBillingProfile.findUniqueOrThrow({
          where: { organizationId: item.organizationId },
        }),
        prisma.client.subscription.findUniqueOrThrow({
          where: { stripeSubscriptionId: item.subscriptionId },
        }),
      ]);
      expect(profile.subscriptionStatus).toBe(expected);
      expect(local.status).toBe(expected);
    });
  }

  it("treats resource_missing as canonical deletion", async () => {
    const item = await fixture("ACTIVE");
    const missing = Object.assign(new Error("missing"), { code: "resource_missing" });
    await service({
      retrieveSubscription: vi.fn(async () => {
        throw missing;
      }),
    }).reconcileOrganization(ownerId, item.organizationId, request);
    expect(
      (
        await prisma.client.subscription.findUniqueOrThrow({
          where: { stripeSubscriptionId: item.subscriptionId },
        })
      ).status,
    ).toBe("CANCELED");
  });

  it("is idempotent when repeated", async () => {
    const item = await fixture();
    const billing = service(provider(snapshot(item, "active")));
    await billing.reconcileOrganization(ownerId, item.organizationId, request);
    await billing.reconcileOrganization(ownerId, item.organizationId, request);
    expect(
      await prisma.client.subscription.count({ where: { organizationId: item.organizationId } }),
    ).toBe(1);
  });

  it("ignores client plan/status because reconciliation accepts no such input", async () => {
    const item = await fixture();
    await service(provider(snapshot(item, "active", PRICE_SCALE, "scale"))).reconcileOrganization(
      ownerId,
      item.organizationId,
      request,
    );
    expect(
      (await prisma.client.organization.findUniqueOrThrow({ where: { id: item.organizationId } }))
        .selectedPlan,
    ).toBe("SCALE");
  });

  it("preserves local state and audits provider failure", async () => {
    const item = await fixture("ACTIVE");
    await expect(
      service({
        retrieveSubscription: vi.fn(async () => {
          throw new Error("transient");
        }),
      }).reconcileOrganization(ownerId, item.organizationId, request),
    ).rejects.toMatchObject({ code: "STRIPE_RECONCILIATION_FAILED" });
    expect(
      (
        await prisma.client.subscription.findUniqueOrThrow({
          where: { stripeSubscriptionId: item.subscriptionId },
        })
      ).status,
    ).toBe("ACTIVE");
    expect(
      await prisma.client.auditLog.count({
        where: { organizationId: item.organizationId, action: "stripe.reconciliation_failed" },
      }),
    ).toBe(1);
  });

  it("periodically reconciles a bounded stale subscription, records health, and reruns idempotently", async () => {
    await prisma.client.subscription.updateMany({ data: { lastProviderSyncAt: new Date() } });
    const item = await fixture("PAST_DUE");
    const retrieve = vi.fn(async () => snapshot(item, "active"));
    const worker = scheduledWorker(retrieve);
    await worker.readiness();
    expect(await worker.reconcileStripeSubscriptions()).toBe(1);
    expect(await worker.reconcileStripeSubscriptions()).toBe(0);
    const local = await prisma.client.subscription.findUniqueOrThrow({
      where: { stripeSubscriptionId: item.subscriptionId },
    });
    expect(local.status).toBe("ACTIVE");
    expect(local.lastProviderSyncAt).not.toBeNull();
    expect(local.reconciliationLeaseOwner).toBeNull();
    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(
      await prisma.client.auditLog.count({
        where: { organizationId: item.organizationId, action: "stripe.scheduled_reconciled" },
      }),
    ).toBe(1);
    await worker.stop();
    expect(
      (
        await prisma.client.workerHeartbeat.findFirstOrThrow({
          where: { workerCode: "OPERATIONAL_WORKER" },
        })
      ).stoppingAt,
    ).not.toBeNull();
  });

  it("scheduled reconciliation safely cancels a provider-missing subscription", async () => {
    await prisma.client.subscription.updateMany({ data: { lastProviderSyncAt: new Date() } });
    const item = await fixture("ACTIVE");
    const worker = scheduledWorker(async () => {
      throw Object.assign(new Error("not returned by provider"), { code: "resource_missing" });
    });
    expect(await worker.reconcileStripeSubscriptions()).toBe(1);
    expect(
      (
        await prisma.client.subscription.findUniqueOrThrow({
          where: { stripeSubscriptionId: item.subscriptionId },
        })
      ).status,
    ).toBe("CANCELED");
    expect(
      await prisma.client.auditLog.count({
        where: {
          organizationId: item.organizationId,
          action: "stripe.scheduled_reconciliation_missing_subscription",
        },
      }),
    ).toBe(1);
  });

  it("scheduled provider failure preserves local state and records only a safe diagnostic", async () => {
    await prisma.client.subscription.updateMany({ data: { lastProviderSyncAt: new Date() } });
    const item = await fixture("ACTIVE");
    const rawProviderMessage = "provider failed with sk_live_should_never_be_stored";
    const worker = scheduledWorker(async () => {
      throw new Error(rawProviderMessage);
    });
    expect(await worker.reconcileStripeSubscriptions()).toBe(0);
    const local = await prisma.client.subscription.findUniqueOrThrow({
      where: { stripeSubscriptionId: item.subscriptionId },
    });
    expect(local.status).toBe("ACTIVE");
    expect(local.reconciliationFailureCode).toBe("PROVIDER_RETRIEVAL_FAILED");
    const auditEntry = await prisma.client.auditLog.findFirstOrThrow({
      where: {
        organizationId: item.organizationId,
        action: "stripe.scheduled_reconciliation_failed",
      },
      orderBy: { createdAt: "desc" },
    });
    expect(JSON.stringify(auditEntry)).not.toContain(rawProviderMessage);
  });

  it("serializes recovery and pays the same outstanding invoice with the replacement card", async () => {
    const item = await fixture("PAST_DUE");
    const invoiceId = `in_recovery_${randomUUID().slice(0, 8)}`;
    const firstFailedAt = new Date(Date.now() - 13 * 60 * 60 * 1000);
    const graceEndsAt = new Date(firstFailedAt.getTime() + 48 * 60 * 60 * 1000);
    const row = await prisma.client.billingInvoice.create({
      data: {
        organizationId: item.organizationId,
        stripeInvoiceId: invoiceId,
        stripeSubscriptionId: item.subscriptionId,
        stripePaymentMethodId: "pm_stale",
        invoiceNumber: "WAFLO-RECOVERY-1",
        status: "open",
        billingReason: "subscription_cycle",
        amountDue: 3_000,
        amountPaid: 0,
        amountRemaining: 3_000,
        currency: "USD",
        invoiceDate: firstFailedAt,
        customerName: "Recovery fixture",
        customerEmail: `billing-${randomUUID()}@reconcile.waflo.local`,
        paymentMethodBrand: "visa",
        paymentMethodLast4: "1111",
        firstFailedAt,
        graceEndsAt,
        recoveryStatus: "GRACE",
        automaticRetryEligible: true,
        nextRecoveryAttemptAt: new Date(Date.now() - 1_000),
      },
    });
    await prisma.client.organizationBillingProfile.update({
      where: { organizationId: item.organizationId },
      data: { subscriptionStatus: "GRACE_PERIOD", gracePeriodEnd: graceEndsAt },
    });
    const baseInvoice = {
      id: invoiceId,
      object: "invoice",
      customer: item.customerId,
      status: "open",
      amount_due: 3_000,
      amount_paid: 0,
      amount_remaining: 3_000,
      currency: "usd",
      created: Math.floor(firstFailedAt.getTime() / 1000),
      effective_at: Math.floor(firstFailedAt.getTime() / 1000),
      number: "WAFLO-RECOVERY-1",
      parent: { subscription_details: { subscription: item.subscriptionId, metadata: {} } },
      status_transitions: { paid_at: null },
      hosted_invoice_url: "https://invoice.stripe.com/i/test",
      invoice_pdf: "https://pay.stripe.com/invoice/test/pdf",
    } as unknown as Stripe.Invoice;
    const paidInvoice = {
      ...baseInvoice,
      status: "paid",
      amount_paid: 3_000,
      amount_remaining: 0,
      status_transitions: { paid_at: Math.floor(Date.now() / 1000) },
    } as Stripe.Invoice;
    const retrieve = vi.fn(async () => baseInvoice);
    const updateInvoice = vi.fn(async () => baseInvoice);
    const pay = vi.fn(async () => paidInvoice);
    const updateSubscription = vi.fn(async () => ({}));
    const worker = new OperationalWorker(prisma.client, environment.values);
    Object.defineProperty(worker, "stripe", {
      value: {
        customers: {
          retrieve: vi.fn(async () => ({
            id: item.customerId,
            deleted: false,
            invoice_settings: { default_payment_method: "pm_replacement" },
          })),
        },
        invoices: { retrieve, update: updateInvoice, pay },
        subscriptions: { update: updateSubscription },
      },
    });

    const results = await Promise.all([
      worker.processBillingRecoveries(),
      worker.processBillingRecoveries(),
    ]);
    expect(results.reduce((sum, value) => sum + value, 0)).toBe(1);
    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(updateSubscription).toHaveBeenCalledWith(item.subscriptionId, {
      default_payment_method: "pm_replacement",
    });
    expect(updateInvoice).toHaveBeenCalledWith(invoiceId, {
      default_payment_method: "pm_replacement",
    });
    expect(pay).toHaveBeenCalledWith(
      invoiceId,
      { payment_method: "pm_replacement" },
      { idempotencyKey: expect.stringContaining(`waflo:invoice:${invoiceId}:recovery:`) },
    );
    expect(
      await prisma.client.billingInvoice.count({ where: { stripeInvoiceId: invoiceId } }),
    ).toBe(1);
    expect(
      await prisma.client.billingInvoice.findUniqueOrThrow({ where: { id: row.id } }),
    ).toMatchObject({
      status: "paid",
      amountRemaining: 0,
      recoveryStatus: "RECOVERED",
      nextRecoveryAttemptAt: null,
    });
    expect(
      await prisma.client.billingEmailOutbox.count({
        where: { billingInvoiceId: row.id, kind: "INVOICE_PAID" },
      }),
    ).toBe(1);
    expect(
      await prisma.client.organizationBillingProfile.findUniqueOrThrow({
        where: { organizationId: item.organizationId },
      }),
    ).toMatchObject({ subscriptionStatus: "ACTIVE", gracePeriodEnd: null });
    worker.close();
  });

  it("bounded retention cleanup removes only expired security material after its policy window", async () => {
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    const session = await prisma.client.session.create({
      data: {
        userId: ownerId,
        tokenHash: randomUUID().replaceAll("-", "").padEnd(64, "a"),
        expiresAt: old,
      },
    });
    const verification = await prisma.client.emailVerificationToken.create({
      data: {
        userId: ownerId,
        tokenHash: randomUUID().replaceAll("-", "").padEnd(64, "b"),
        expiresAt: old,
      },
    });
    const reset = await prisma.client.passwordResetToken.create({
      data: {
        userId: ownerId,
        tokenHash: randomUUID().replaceAll("-", "").padEnd(64, "c"),
        expiresAt: old,
      },
    });
    const oauth = await prisma.client.oAuthAuthorizationRequest.create({
      data: {
        stateHash: randomUUID().replaceAll("-", "").padEnd(64, "d"),
        provider: "GOOGLE",
        intent: "SIGN_IN",
        nonceHash: randomUUID().replaceAll("-", "").padEnd(64, "e"),
        browserBindingHash: randomUUID().replaceAll("-", "").padEnd(64, "f"),
        codeVerifierCiphertext: "expired-and-no-longer-usable",
        expiresAt: old,
      },
    });
    const worker = scheduledWorker(async () => {
      throw new Error("not used by cleanup");
    });
    expect(await worker.cleanupExpiredState()).toBeGreaterThanOrEqual(4);
    expect(await prisma.client.session.findUnique({ where: { id: session.id } })).toBeNull();
    expect(
      await prisma.client.emailVerificationToken.findUnique({ where: { id: verification.id } }),
    ).toBeNull();
    expect(
      await prisma.client.passwordResetToken.findUnique({ where: { id: reset.id } }),
    ).toBeNull();
    expect(
      await prisma.client.oAuthAuthorizationRequest.findUnique({ where: { id: oauth.id } }),
    ).toBeNull();
  });
});
