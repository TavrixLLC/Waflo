import { createHmac, randomUUID } from "node:crypto";
import { hashPassword } from "../../packages/auth/src/index.js";
import type Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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

const runId = randomUUID().slice(0, 8);
const webhookSecret = `whsec_${randomUUID().replaceAll("-", "")}`;
const request = {
  requestId: `refund-flow-${runId}`,
  id: `refund-flow-${runId}`,
  ip: "127.0.0.1",
  headers: { "user-agent": "Refund integration tests" },
} as unknown as WafloRequest;

describe.sequential("Stripe refund review and execution", () => {
  let prisma: PrismaService;
  let environment: EnvironmentService;
  let audit: AuditService;
  let tenant: TenantService;
  let ownerId: string;
  let managerId: string;
  let staffId: string;
  let outsiderId: string;
  let organizationId: string;
  let customerId: string;
  const providerRefunds: Stripe.Refund[] = [];
  const invoices = new Map<string, Stripe.Invoice>();
  const createRefund = vi.fn(async (params: Stripe.RefundCreateParams): Promise<Stripe.Refund> => {
    const created = {
      id: `re_${randomUUID().replaceAll("-", "")}`,
      object: "refund",
      amount: params.amount ?? 0,
      balance_transaction: null,
      charge: `ch_${runId}`,
      created: Math.floor(Date.now() / 1000),
      currency: "usd",
      metadata: (params.metadata ?? {}) as Stripe.Metadata,
      payment_intent: params.payment_intent ?? null,
      reason: params.reason ?? null,
      receipt_number: null,
      source_transfer_reversal: null,
      status: "succeeded",
      transfer_reversal: null,
    } as unknown as Stripe.Refund;
    providerRefunds.push(created);
    return created;
  });

  beforeAll(async () => {
    process.env.STRIPE_SECRET_KEY = `sk_test_refund_${runId}`;
    process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
    process.env.STRIPE_STARTER_MONTHLY_PRICE_ID = `price_refund_starter_${runId}`;
    process.env.STRIPE_GROWTH_MONTHLY_PRICE_ID = `price_refund_growth_${runId}`;
    process.env.STRIPE_SCALE_MONTHLY_PRICE_ID = `price_refund_scale_${runId}`;
    environment = new EnvironmentService();
    prisma = new PrismaService(environment);
    audit = new AuditService(prisma);
    tenant = new TenantService(prisma, audit);
    const passwordHash = await hashPassword("Refund Integration 2026!");
    const users = await Promise.all(
      ["owner", "manager", "staff", "outsider"].map((label) => {
        const email = `${label}-${runId}@refund.waflo.local`;
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
    [ownerId, managerId, staffId, outsiderId] = users.map((user) => user.id);
    customerId = `cus_refund_${runId}`;
    const organization = await prisma.client.organization.create({
      data: {
        name: `Refund ${runId}`,
        normalizedName: `refund ${runId}`,
        merchantSlug: `refund-${runId}`,
        timezone: "Asia/Baghdad",
        selectedPlan: "GROWTH",
        members: {
          create: [
            { userId: ownerId, role: "OWNER" },
            { userId: managerId, role: "MANAGER" },
            { userId: staffId, role: "STAFF" },
          ],
        },
        billingProfile: {
          create: {
            stripeCustomerId: customerId,
            selectedPlan: "GROWTH",
            subscriptionStatus: "ACTIVE",
            billingEmail: `billing-${runId}@example.com`,
          },
        },
      },
    });
    organizationId = organization.id;
  });

  afterAll(async () => prisma.onModuleDestroy());

  function service(overrides: Partial<StripeSubscriptionProvider> = {}) {
    const notifications = { send: vi.fn(async () => undefined) } as unknown as NotificationService;
    const billing = new BillingService(prisma, environment, tenant, audit, notifications);
    billing.subscriptionProvider = {
      retrieveSubscription: vi.fn(async () => {
        throw new Error("not used");
      }),
      retrieveInvoice: vi.fn(async (invoiceId: string) => {
        const invoice = invoices.get(invoiceId);
        if (!invoice) throw new Error("invoice not found");
        return invoice;
      }),
      retrieveRefund: vi.fn(async (refundId: string) => {
        const refund = providerRefunds.find((item) => item.id === refundId);
        if (!refund) throw new Error("refund not found");
        return refund;
      }),
      listRefunds: vi.fn(async (paymentIntentId: string) =>
        providerRefunds.filter((refund) => refund.payment_intent === paymentIntentId),
      ),
      createRefund,
      ...overrides,
    };
    return billing;
  }

  async function paidInvoice(amount = 6900) {
    const suffix = randomUUID().slice(0, 8);
    const stripeInvoiceId = `in_refund_${suffix}`;
    const paymentIntentId = `pi_refund_${suffix}`;
    const timestamp = Math.floor(Date.now() / 1000);
    const local = await prisma.client.billingInvoice.create({
      data: {
        organizationId,
        stripeInvoiceId,
        invoiceNumber: `WF-${suffix}`,
        status: "paid",
        billingReason: "subscription_cycle",
        amountDue: amount,
        amountPaid: amount,
        amountRemaining: 0,
        currency: "USD",
        invoiceDate: new Date(timestamp * 1000),
        paidAt: new Date(timestamp * 1000),
        paymentMethodBrand: "visa",
        paymentMethodLast4: "4242",
        paymentMethodExpMonth: 8,
        paymentMethodExpYear: 2029,
      },
    });
    invoices.set(stripeInvoiceId, {
      id: stripeInvoiceId,
      object: "invoice",
      customer: customerId,
      status: "paid",
      amount_due: amount,
      amount_paid: amount,
      amount_remaining: 0,
      currency: "usd",
      created: timestamp,
      effective_at: timestamp,
      period_start: timestamp - 2_592_000,
      period_end: timestamp,
      billing_reason: "subscription_cycle",
      next_payment_attempt: null,
      metadata: { wafloOrganizationId: organizationId },
      payments: {
        object: "list",
        data: [
          {
            payment: {
              type: "payment_intent",
              payment_intent: paymentIntentId,
            },
          } as Stripe.InvoicePayment,
        ],
        has_more: false,
        url: "",
      },
      status_transitions: {
        finalized_at: timestamp,
        marked_uncollectible_at: null,
        paid_at: timestamp,
        voided_at: null,
      },
    } as unknown as Stripe.Invoice);
    return { local, paymentIntentId };
  }

  async function approvedRefund(amount?: number) {
    const { local, paymentIntentId } = await paidInvoice();
    const billing = service();
    const created = await billing.requestRefund(
      ownerId,
      organizationId,
      local.id,
      { reason: "incorrect_charge", ...(amount ? { amount } : {}) },
      randomUUID(),
      request,
    );
    await billing.reviewRefund(
      ownerId,
      organizationId,
      created.id,
      { action: "start_review" },
      request,
    );
    await billing.reviewRefund(
      ownerId,
      organizationId,
      created.id,
      { action: "approve", ...(amount ? { approvedAmount: amount } : {}) },
      request,
    );
    return { billing, created, local, paymentIntentId };
  }

  it("allows only the billing Owner and enforces tenant isolation", async () => {
    const { local } = await paidInvoice();
    for (const userId of [managerId, staffId, outsiderId]) {
      await expect(
        service().requestRefund(
          userId,
          organizationId,
          local.id,
          { reason: "duplicate_charge" },
          randomUUID(),
          request,
        ),
      ).rejects.toMatchObject({ status: 403 });
    }
  });

  it("refreshes authoritative plan, cadence, renewal, next charge, card, and invoice history", async () => {
    const billing = service();
    const renewalAt = new Date("2026-10-01T09:00:00.000Z");
    const invoice = await paidInvoice(19251);
    await Promise.all([
      prisma.client.organizationBillingProfile.update({
        where: { organizationId },
        data: { selectedPlan: "GROWTH", selectedCadence: "QUARTERLY" },
      }),
      prisma.client.subscription.create({
        data: {
          organizationId,
          stripeSubscriptionId: `sub_refund_refresh_${runId}`,
          stripePriceId: `price_refund_growth_quarterly_${runId}`,
          planCode: "GROWTH",
          cadence: "QUARTERLY",
          status: "ACTIVE",
          currentPeriodStart: new Date("2026-07-01T09:00:00.000Z"),
          currentPeriodEnd: renewalAt,
        },
      }),
      prisma.client.billingInvoice.update({
        where: { id: invoice.local.id },
        data: {
          periodStart: new Date("2026-07-01T09:00:00.000Z"),
          periodEnd: renewalAt,
          hostedInvoiceUrl: "https://invoice.stripe.test/hosted",
          invoicePdfUrl: "https://invoice.stripe.test/invoice.pdf",
        },
      }),
    ]);
    let card = { brand: "visa", last4: "4242", exp_month: 8, exp_year: 2029 };
    const stripe = (
      billing as unknown as {
        stripe: {
          customers: { retrieve: () => Promise<unknown> };
          paymentMethods: { list: () => Promise<unknown> };
          invoices: { createPreview: () => Promise<unknown> };
        };
      }
    ).stripe;
    stripe.customers.retrieve = async () => ({
      id: customerId,
      deleted: false,
      invoice_settings: { default_payment_method: { id: "pm_refresh" } },
    });
    stripe.paymentMethods.list = async () => ({
      data: [{ id: "pm_refresh", card }],
    });
    stripe.invoices.createPreview = async () => ({
      amount_due: 19251,
      currency: "usd",
      period_start: Math.floor(renewalAt.getTime() / 1000),
    });

    const first = await billing.get(ownerId, organizationId);
    expect(first).toMatchObject({
      selectedPlan: "GROWTH",
      selectedCadence: "quarterly",
      paymentMethod: {
        status: "saved",
        brand: "visa",
        last4: "4242",
        expMonth: 8,
        expYear: 2029,
      },
      authoritativeState: {
        renewalDate: renewalAt,
        nextExpectedChargeDate: renewalAt,
        nextExpectedAmount: 19251,
        currency: "USD",
      },
    });
    expect(first.invoices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: invoice.local.id,
          number: invoice.local.invoiceNumber,
          paymentStatus: "paid",
          amountPaid: 19251,
          refundable: true,
          hostedInvoiceUrl: "https://invoice.stripe.test/hosted",
          invoicePdfUrl: "https://invoice.stripe.test/invoice.pdf",
        }),
      ]),
    );

    card = { brand: "mastercard", last4: "4444", exp_month: 9, exp_year: 2031 };
    await expect(billing.get(ownerId, organizationId)).resolves.toMatchObject({
      paymentMethod: {
        status: "saved",
        brand: "mastercard",
        last4: "4444",
        expMonth: 9,
        expYear: 2031,
      },
    });
  });

  it("prevents duplicate active requests, idempotency drift, and over-refunds", async () => {
    const { local } = await paidInvoice(2900);
    const billing = service();
    const key = randomUUID();
    const first = await billing.requestRefund(
      ownerId,
      organizationId,
      local.id,
      { reason: "duplicate_charge", amount: 1200 },
      key,
      request,
    );
    await expect(
      billing.requestRefund(
        ownerId,
        organizationId,
        local.id,
        { reason: "duplicate_charge", amount: 1200 },
        key,
        request,
      ),
    ).resolves.toMatchObject({ id: first.id });
    await expect(
      billing.requestRefund(
        ownerId,
        organizationId,
        local.id,
        { reason: "service_failure", amount: 1200 },
        key,
        request,
      ),
    ).rejects.toMatchObject({ code: "REFUND_IDEMPOTENCY_KEY_CONFLICT" });
    await expect(
      billing.requestRefund(
        ownerId,
        organizationId,
        local.id,
        { reason: "other", amount: 3000 },
        randomUUID(),
        request,
      ),
    ).rejects.toMatchObject({ code: "REFUND_REQUEST_ALREADY_ACTIVE" });

    const overRefund = await paidInvoice(2900);
    await expect(
      billing.requestRefund(
        ownerId,
        organizationId,
        overRefund.local.id,
        { reason: "other", amount: 3000 },
        randomUUID(),
        request,
      ),
    ).rejects.toMatchObject({
      code: "REFUND_AMOUNT_EXCEEDS_AVAILABLE",
      details: { remainingRefundableAmount: 2900, currency: "USD" },
    });
  });

  it("executes full and partial refunds on the original PaymentIntent", async () => {
    const full = await approvedRefund();
    const fullResult = await full.billing.executeRefund(
      ownerId,
      organizationId,
      full.created.id,
      request,
    );
    expect(fullResult.status).toBe("SUCCEEDED");
    expect(createRefund).toHaveBeenLastCalledWith(
      expect.objectContaining({ payment_intent: full.paymentIntentId, amount: 6900 }),
      expect.stringMatching(/^waflo:refund:/),
    );

    const partial = await approvedRefund(1700);
    const partialResult = await partial.billing.executeRefund(
      ownerId,
      organizationId,
      partial.created.id,
      request,
    );
    expect(partialResult).toMatchObject({ status: "SUCCEEDED", approvedAmount: 1700 });
    expect(createRefund).toHaveBeenLastCalledWith(
      expect.objectContaining({ payment_intent: partial.paymentIntentId, amount: 1700 }),
      expect.stringMatching(/^waflo:refund:/),
    );
    expect(
      await prisma.client.billingEmailOutbox.count({
        where: {
          organizationId,
          kind: { in: ["REFUND_REQUEST_RECEIVED", "REFUND_APPROVED", "REFUND_SUCCEEDED"] },
        },
      }),
    ).toBeGreaterThanOrEqual(6);
  });

  it("leases concurrent execution and creates only one Stripe refund", async () => {
    const item = await approvedRefund(900);
    const baseline = createRefund.mock.calls.length;
    let release: (() => void) | undefined;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const delayedCreate = vi.fn(async (params: Stripe.RefundCreateParams) => {
      await wait;
      return createRefund(params, "ignored-by-mock");
    });
    item.billing.subscriptionProvider.createRefund = delayedCreate;
    const first = item.billing.executeRefund(ownerId, organizationId, item.created.id, request);
    await vi.waitFor(() => expect(delayedCreate).toHaveBeenCalledTimes(1));
    const second = item.billing.executeRefund(ownerId, organizationId, item.created.id, request);
    await expect(second).rejects.toMatchObject({ code: "REFUND_EXECUTION_IN_PROGRESS" });
    release?.();
    await expect(first).resolves.toMatchObject({ status: "SUCCEEDED" });
    expect(createRefund.mock.calls.length - baseline).toBe(1);
  });

  it("reconciles refund.failed by signed webhook without a success email", async () => {
    const item = await approvedRefund(500);
    const pending = {
      id: `re_pending_${randomUUID().replaceAll("-", "")}`,
      object: "refund",
      amount: 500,
      currency: "usd",
      payment_intent: item.paymentIntentId,
      metadata: {
        wafloOrganizationId: organizationId,
        wafloBillingInvoiceId: item.local.id,
        wafloRefundRequestId: item.created.id,
      },
      status: "failed",
      reason: "requested_by_customer",
    } as unknown as Stripe.Refund;
    providerRefunds.push(pending);
    await prisma.client.billingRefundRequest.update({
      where: { publicId: item.created.id },
      data: { status: "PROCESSING", stripeRefundId: pending.id },
    });
    item.billing.subscriptionProvider.retrieveRefund = vi.fn(async () => pending);
    const event = {
      id: `evt_refund_failed_${runId}_${randomUUID().slice(0, 6)}`,
      object: "event",
      api_version: "2026-06-24.dahlia",
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: pending.id, object: "refund" } },
      livemode: false,
      pending_webhooks: 1,
      request: null,
      type: "refund.failed",
    } as Stripe.Event;
    const payload = Buffer.from(JSON.stringify(event));
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac("sha256", webhookSecret)
      .update(`${timestamp}.${payload.toString("utf8")}`)
      .digest("hex");
    await item.billing.processWebhook(payload, `t=${timestamp},v1=${signature}`, request);
    expect(
      await prisma.client.billingRefundRequest.findUniqueOrThrow({
        where: { publicId: item.created.id },
      }),
    ).toMatchObject({ status: "FAILED", failureCode: "PROVIDER_REFUND_FAILED" });
    expect(
      await prisma.client.billingEmailOutbox.count({
        where: {
          dedupeKey: `refund-failed:${(await prisma.client.billingRefundRequest.findUniqueOrThrow({ where: { publicId: item.created.id } })).id}`,
        },
      }),
    ).toBe(1);
  });
});
