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

const runId = randomUUID().slice(0, 8);
const request = {
  requestId: `embedded-trial-${runId}`,
  ip: "127.0.0.1",
  headers: { "user-agent": "Embedded trial idempotency tests" },
} as unknown as WafloRequest;

const savedEnvironment: Record<string, string | undefined> = {};
let prisma: PrismaService;
let environment: EnvironmentService;
let audit: AuditService;
let tenant: TenantService;
let notifications: NotificationService;

const noopProvider: StripeSubscriptionProvider = {
  async retrieveSubscription() {
    throw new Error("Provider reconciliation is not used by embedded trial tests.");
  },
};

interface SetupIntentFixture {
  id: string;
  client_secret: string;
  status: Stripe.SetupIntent.Status;
  customer: string;
  payment_method: Stripe.PaymentMethod | null;
  metadata: Record<string, string>;
}

interface StripeFixture {
  namespace: string;
  setupByIdempotencyKey: Map<string, SetupIntentFixture>;
  setupById: Map<string, SetupIntentFixture>;
  subscriptionByIdempotencyKey: Map<string, Stripe.Subscription>;
  customerCreateKeys: string[];
  setupCreateKeys: string[];
  subscriptionCreateKeys: string[];
  subscriptionCreateParams: Stripe.SubscriptionCreateParams[];
  customerUpdates: Array<{ id: string; params: Stripe.CustomerUpdateParams }>;
  timeoutNextSetupAfterProviderCommit: boolean;
  priceMismatch: boolean;
}

const fixture = (): StripeFixture => ({
  namespace: randomUUID().slice(0, 8),
  setupByIdempotencyKey: new Map(),
  setupById: new Map(),
  subscriptionByIdempotencyKey: new Map(),
  customerCreateKeys: [],
  setupCreateKeys: [],
  subscriptionCreateKeys: [],
  subscriptionCreateParams: [],
  customerUpdates: [],
  timeoutNextSetupAfterProviderCommit: false,
  priceMismatch: false,
});

function priceFor(id: string, mismatch = false): Stripe.Price {
  const amount = id.includes("starter") ? 2900 : id.includes("scale") ? 12900 : 6900;
  return {
    id,
    object: "price",
    active: true,
    billing_scheme: "per_unit",
    created: 1,
    currency: "usd",
    livemode: false,
    lookup_key: null,
    metadata: {},
    nickname: null,
    product: "prod_waflo",
    recurring: {
      interval: "month",
      interval_count: 1,
      meter: null,
      trial_period_days: null,
      usage_type: "licensed",
    },
    tax_behavior: "unspecified",
    tiers_mode: null,
    transform_quantity: null,
    type: "recurring",
    unit_amount: mismatch ? amount + 1 : amount,
    unit_amount_decimal: String(mismatch ? amount + 1 : amount),
  } as unknown as Stripe.Price;
}

function paymentMethod(id: string, customer: string): Stripe.PaymentMethod {
  return {
    id,
    object: "payment_method",
    type: "card",
    customer,
    billing_details: { address: null, email: null, name: null, phone: null, tax_id: null },
    card: {
      brand: "visa",
      checks: null,
      country: "US",
      display_brand: "visa",
      exp_month: 12,
      exp_year: 2032,
      fingerprint: "fixture-fingerprint",
      funding: "credit",
      generated_from: null,
      last4: "4242",
      networks: null,
      regulated_status: "unregulated",
      three_d_secure_usage: null,
      wallet: null,
    },
    created: 1,
    livemode: false,
    metadata: {},
  } as unknown as Stripe.PaymentMethod;
}

function buildStripeMock(state: StripeFixture) {
  return {
    prices: {
      retrieve: async (id: string) => priceFor(id, state.priceMismatch),
    },
    customers: {
      search: async () => ({ data: [] }),
      create: async (params: Stripe.CustomerCreateParams, options?: Stripe.RequestOptions) => {
        const key = options?.idempotencyKey ?? "missing";
        state.customerCreateKeys.push(key);
        return {
          id: `cus_${String(params.metadata?.wafloOrganizationId).replaceAll("-", "")}`,
          object: "customer",
        } as Stripe.Customer;
      },
      update: async (id: string, params: Stripe.CustomerUpdateParams) => {
        state.customerUpdates.push({ id, params });
        return { id, object: "customer" } as Stripe.Customer;
      },
    },
    setupIntents: {
      create: async (params: Stripe.SetupIntentCreateParams, options?: Stripe.RequestOptions) => {
        const key = options?.idempotencyKey ?? "missing";
        state.setupCreateKeys.push(key);
        let setup = state.setupByIdempotencyKey.get(key);
        if (!setup) {
          setup = {
            id: `seti_${state.namespace}_${state.setupByIdempotencyKey.size + 1}`,
            client_secret: `seti_secret_${state.namespace}_${state.setupByIdempotencyKey.size + 1}`,
            status: "requires_payment_method",
            customer: String(params.customer),
            payment_method: null,
            metadata: Object.fromEntries(
              Object.entries(params.metadata ?? {}).map(([name, value]) => [name, String(value)]),
            ),
          };
          state.setupByIdempotencyKey.set(key, setup);
          state.setupById.set(setup.id, setup);
        }
        if (state.timeoutNextSetupAfterProviderCommit) {
          state.timeoutNextSetupAfterProviderCommit = false;
          throw Object.assign(new Error("Provider response timed out"), {
            type: "StripeConnectionError",
          });
        }
        return setup as unknown as Stripe.SetupIntent;
      },
      retrieve: async (id: string) => {
        const setup = state.setupById.get(id);
        if (!setup) throw new Error(`Unknown SetupIntent ${id}`);
        return setup as unknown as Stripe.SetupIntent;
      },
    },
    paymentMethods: {
      retrieve: async (id: string) => {
        for (const setup of state.setupById.values()) {
          if (setup.payment_method?.id === id) return setup.payment_method;
        }
        throw new Error(`Unknown payment method ${id}`);
      },
    },
    subscriptions: {
      create: async (params: Stripe.SubscriptionCreateParams, options?: Stripe.RequestOptions) => {
        const key = options?.idempotencyKey ?? "missing";
        state.subscriptionCreateKeys.push(key);
        state.subscriptionCreateParams.push(params);
        const existing = state.subscriptionByIdempotencyKey.get(key);
        if (existing) return existing;
        const start = Math.floor(Date.now() / 1000);
        const end = start + 7 * 24 * 60 * 60;
        const priceId = String(params.items?.[0]?.price);
        const invoice = {
          id: `in_trial_${state.namespace}`,
          object: "invoice",
          amount_due: 0,
          amount_paid: 0,
          amount_remaining: 0,
          total: 0,
          status: "paid",
          currency: "usd",
          created: start,
          effective_at: start,
          period_start: start,
          period_end: end,
          number: `WAFLO-${state.namespace}`,
          billing_reason: "subscription_create",
          hosted_invoice_url: null,
          invoice_pdf: null,
        } as unknown as Stripe.Invoice;
        const subscription = {
          id: `sub_trial_${state.namespace}`,
          object: "subscription",
          customer: String(params.customer),
          status: "trialing",
          trial_start: start,
          trial_end: end,
          cancel_at_period_end: false,
          latest_invoice: invoice,
          metadata: params.metadata ?? {},
          items: {
            object: "list",
            data: [
              {
                id: `si_trial_${state.namespace}`,
                object: "subscription_item",
                price: { id: priceId },
                current_period_start: start,
                current_period_end: end,
              },
            ],
            has_more: false,
            url: "/v1/subscription_items",
          },
        } as unknown as Stripe.Subscription;
        state.subscriptionByIdempotencyKey.set(key, subscription);
        return subscription;
      },
      update: async (id: string) => ({ id, object: "subscription" }),
    },
    invoices: {
      retrieve: async () => {
        throw new Error("Expanded trial invoice expected.");
      },
    },
    billingPortal: { sessions: { create: async () => ({ url: "" }) } },
    webhooks: {
      constructEvent: () => {
        throw new Error("Not used");
      },
    },
  };
}

function buildBilling(state = fixture()) {
  const service = new BillingService(prisma, environment, tenant, audit, notifications);
  service.subscriptionProvider = noopProvider;
  (service as unknown as { stripe: ReturnType<typeof buildStripeMock> }).stripe =
    buildStripeMock(state);
  return { service, state };
}

async function merchant(label: string) {
  const email = `${label}-${runId}-${randomUUID().slice(0, 6)}@trial.waflo.local`;
  const user = await prisma.client.user.create({
    data: {
      email,
      normalizedEmail: email,
      displayName: "Trial owner",
      passwordHash: await hashPassword("Embedded Trial 2026!"),
      emailVerifiedAt: new Date(),
      termsVersion: "test",
      privacyVersion: "test",
      legalAcceptedAt: new Date(),
    },
  });
  const slug = `${label}-${runId}-${randomUUID().slice(0, 6)}`.toLowerCase();
  const organization = await prisma.client.organization.create({
    data: {
      name: `Trial ${label}`,
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
  return { userId: user.id, organizationId: organization.id };
}

function trialInput(email = "billing@example.test") {
  return {
    plan: "growth" as const,
    cadence: "monthly" as const,
    billingIdentity: {
      name: "Waflo Trial Merchant",
      email,
      countryCode: "US",
      addressLine1: "1 Market Street",
      addressLine2: null,
      city: "San Francisco",
      region: "CA",
      postalCode: "94105",
    },
  };
}

function markSetupSucceeded(state: StripeFixture, setupIntentId: string) {
  const setup = state.setupById.get(setupIntentId);
  if (!setup) throw new Error("SetupIntent fixture missing.");
  setup.status = "succeeded";
  setup.payment_method = paymentMethod(`pm_${setupIntentId}`, setup.customer);
}

beforeAll(async () => {
  for (const key of [
    "STRIPE_SECRET_KEY",
    "STRIPE_PUBLISHABLE_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_STARTER_MONTHLY_PRICE_ID",
    "STRIPE_GROWTH_MONTHLY_PRICE_ID",
    "STRIPE_SCALE_MONTHLY_PRICE_ID",
  ]) {
    savedEnvironment[key] = process.env[key];
  }
  process.env.STRIPE_SECRET_KEY = "sk_test_embedded_trial";
  process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_embedded_trial";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_embedded_trial";
  process.env.STRIPE_STARTER_MONTHLY_PRICE_ID = "price_trial_starter_monthly";
  process.env.STRIPE_GROWTH_MONTHLY_PRICE_ID = "price_trial_growth_monthly";
  process.env.STRIPE_SCALE_MONTHLY_PRICE_ID = "price_trial_scale_monthly";
  environment = new EnvironmentService();
  prisma = new PrismaService(environment);
  audit = new AuditService(prisma);
  tenant = new TenantService(prisma, audit);
  notifications = { send: vi.fn(async () => undefined) } as unknown as NotificationService;
});

afterAll(async () => {
  await prisma.onModuleDestroy();
  for (const [key, value] of Object.entries(savedEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe.sequential("embedded Stripe seven-day trial idempotency", () => {
  it("keeps hosted Checkout permanently disabled", async () => {
    const { service } = buildBilling();
    await expect(service.checkout()).rejects.toMatchObject({ code: "HOSTED_CHECKOUT_REMOVED" });
  });

  it("creates a customer-bound off-session card SetupIntent without persisting its secret", async () => {
    const account = await merchant("prepare");
    const { service, state } = buildBilling();
    const key = randomUUID();
    const prepared = await service.prepareTrialSetup(
      account.userId,
      account.organizationId,
      trialInput(),
      request,
      key,
    );
    expect(prepared).toMatchObject({
      completed: false,
      publishableKey: "pk_test_embedded_trial",
      trialDays: 7,
      amount: 6900,
      currency: "USD",
    });
    expect(prepared.expectedFirstChargeAt.getTime() - prepared.expectedTrialStart.getTime()).toBe(
      7 * 24 * 60 * 60 * 1000,
    );
    const setup = state.setupById.get(String(prepared.setupIntentId));
    expect(setup).toMatchObject({
      customer: expect.stringMatching(/^cus_/),
      status: "requires_payment_method",
    });
    const stored = await prisma.client.checkoutIdempotencyKey.findUniqueOrThrow({
      where: {
        organizationId_idempotencyKey: {
          organizationId: account.organizationId,
          idempotencyKey: key,
        },
      },
    });
    expect(stored).toMatchObject({ status: "SETUP_PENDING", stripeSetupIntentId: setup?.id });
    expect(JSON.stringify(stored)).not.toContain(String(prepared.clientSecret));
    expect(JSON.stringify(stored)).not.toMatch(/424242|\bCVC\b|\bPAN\b/i);
    expect(state.setupCreateKeys[0]).toBe(`waflo:org:${account.organizationId}:trial-setup:${key}`);
  });

  it("replays parallel preparation with one command, customer, and SetupIntent", async () => {
    const account = await merchant("parallel-prepare");
    const { service, state } = buildBilling();
    const key = randomUUID();
    const prepare = () =>
      service.prepareTrialSetup(account.userId, account.organizationId, trialInput(), request, key);
    const [first, second] = await Promise.all([prepare(), prepare()]);
    expect(first.setupIntentId).toBe(second.setupIntentId);
    expect(first.clientSecret).toBe(second.clientSecret);
    expect(first.expectedTrialStart).toEqual(second.expectedTrialStart);
    expect(
      await prisma.client.checkoutIdempotencyKey.count({
        where: { organizationId: account.organizationId },
      }),
    ).toBe(1);
    expect(new Set(state.customerCreateKeys)).toEqual(
      new Set([`waflo:organization:${account.organizationId}:create-customer:v1`]),
    );
    expect(state.setupById.size).toBe(1);
  });

  it("rejects command replay with different billing choices", async () => {
    const account = await merchant("conflict");
    const { service } = buildBilling();
    const key = randomUUID();
    await service.prepareTrialSetup(
      account.userId,
      account.organizationId,
      trialInput(),
      request,
      key,
    );
    await expect(
      service.prepareTrialSetup(
        account.userId,
        account.organizationId,
        { ...trialInput(), plan: "starter" },
        request,
        key,
      ),
    ).rejects.toMatchObject({ code: "BILLING_COMMAND_CONFLICT" });
  });

  it("recovers after a provider timeout without creating a second SetupIntent", async () => {
    const account = await merchant("timeout");
    const { service, state } = buildBilling();
    const key = randomUUID();
    state.timeoutNextSetupAfterProviderCommit = true;
    await expect(
      service.prepareTrialSetup(account.userId, account.organizationId, trialInput(), request, key),
    ).rejects.toThrow("Provider response timed out");
    const retry = await service.prepareTrialSetup(
      account.userId,
      account.organizationId,
      trialInput(),
      request,
      key,
    );
    expect(retry.setupIntentId).toBe([...state.setupById.keys()][0]);
    expect(state.setupById.size).toBe(1);
    expect(
      await prisma.client.checkoutIdempotencyKey.count({
        where: { organizationId: account.organizationId, idempotencyKey: key },
      }),
    ).toBe(1);
  });

  it("requires a succeeded card setup before starting access", async () => {
    const account = await merchant("payment-required");
    const { service } = buildBilling();
    const key = randomUUID();
    const prepared = await service.prepareTrialSetup(
      account.userId,
      account.organizationId,
      trialInput(),
      request,
      key,
    );
    await expect(
      service.completeTrialSetup(
        account.userId,
        account.organizationId,
        { setupIntentId: String(prepared.setupIntentId) },
        request,
        key,
      ),
    ).rejects.toMatchObject({ code: "PAYMENT_METHOD_REQUIRED" });
    expect(
      await prisma.client.organizationBillingProfile.findUniqueOrThrow({
        where: { organizationId: account.organizationId },
      }),
    ).toMatchObject({ subscriptionStatus: "PENDING_ACTIVATION", trialStart: null, trialEnd: null });
    expect(
      await prisma.client.subscription.count({ where: { organizationId: account.organizationId } }),
    ).toBe(0);
  });

  it("creates exactly one authoritative seven-day trial and a zero-dollar invoice", async () => {
    const account = await merchant("complete");
    const { service, state } = buildBilling();
    const key = randomUUID();
    const prepared = await service.prepareTrialSetup(
      account.userId,
      account.organizationId,
      trialInput(),
      request,
      key,
    );
    markSetupSucceeded(state, String(prepared.setupIntentId));
    const completed = await service.completeTrialSetup(
      account.userId,
      account.organizationId,
      { setupIntentId: String(prepared.setupIntentId) },
      request,
      key,
    );
    expect(completed).toMatchObject({
      status: "trialing",
      amount: 6900,
      currency: "USD",
      initialInvoiceAmount: 0,
      paymentMethod: { brand: "visa", last4: "4242", expMonth: 12, expYear: 2032 },
    });
    expect(completed.trialEnd.getTime() - completed.trialStart.getTime()).toBe(
      7 * 24 * 60 * 60 * 1000,
    );
    expect(completed.firstChargeAt).toEqual(completed.trialEnd);
    expect(
      await prisma.client.subscription.count({ where: { organizationId: account.organizationId } }),
    ).toBe(1);
    expect(
      await prisma.client.billingInvoice.findFirstOrThrow({
        where: { organizationId: account.organizationId },
      }),
    ).toMatchObject({ amountDue: 0, amountPaid: 0, amountRemaining: 0 });
    expect(
      await prisma.client.organizationBillingProfile.findUniqueOrThrow({
        where: { organizationId: account.organizationId },
      }),
    ).toMatchObject({
      selectedPlan: "GROWTH",
      selectedCadence: "MONTHLY",
      subscriptionStatus: "TRIALING",
      trialTriggeringProgramId: null,
    });
    const create = state.subscriptionCreateParams[0];
    expect(create).toMatchObject({
      collection_method: "charge_automatically",
      trial_period_days: 7,
      trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
      payment_settings: {
        payment_method_types: ["card"],
        save_default_payment_method: "on_subscription",
      },
    });
    expect(state.subscriptionCreateKeys).toEqual([
      `waflo:org:${account.organizationId}:initial-trial-subscription:v1`,
    ]);
  });

  it("replays concurrent confirmation without duplicate subscription, invoice, or audit", async () => {
    const account = await merchant("parallel-complete");
    const { service, state } = buildBilling();
    const key = randomUUID();
    const prepared = await service.prepareTrialSetup(
      account.userId,
      account.organizationId,
      trialInput(),
      request,
      key,
    );
    markSetupSucceeded(state, String(prepared.setupIntentId));
    const complete = () =>
      service.completeTrialSetup(
        account.userId,
        account.organizationId,
        { setupIntentId: String(prepared.setupIntentId) },
        request,
        key,
      );
    const [first, second] = await Promise.all([complete(), complete()]);
    expect(second).toEqual(first);
    expect(
      await prisma.client.subscription.count({ where: { organizationId: account.organizationId } }),
    ).toBe(1);
    expect(
      await prisma.client.billingInvoice.count({
        where: { organizationId: account.organizationId },
      }),
    ).toBe(1);
    expect(
      await prisma.client.auditLog.count({
        where: {
          organizationId: account.organizationId,
          action: "billing.seven_day_trial_started",
        },
      }),
    ).toBe(1);
  });

  it("fails closed when the configured Stripe Price differs from Waflo pricing", async () => {
    const account = await merchant("price-mismatch");
    const { service, state } = buildBilling();
    state.priceMismatch = true;
    await expect(
      service.prepareTrialSetup(
        account.userId,
        account.organizationId,
        trialInput(),
        request,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "STRIPE_PRICE_CONFIGURATION_MISMATCH" });
    expect(
      await prisma.client.checkoutIdempotencyKey.count({
        where: { organizationId: account.organizationId },
      }),
    ).toBe(0);
  });

  it("does not grant a second trial to an organization with historical trial state", async () => {
    const account = await merchant("no-second-trial");
    await prisma.client.organizationBillingProfile.update({
      where: { organizationId: account.organizationId },
      data: {
        subscriptionStatus: "CANCELED",
        trialStart: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
        trialEnd: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      },
    });
    const { service } = buildBilling();
    await expect(
      service.prepareTrialSetup(
        account.userId,
        account.organizationId,
        trialInput(),
        request,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "TRIAL_NOT_ELIGIBLE" });
  });
});
