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
});
