import { createHash, randomUUID } from "node:crypto";
import { HttpStatus, Injectable } from "@nestjs/common";
import {
  billingFailurePolicy,
  billingGraceDeadline,
  billingRecoverySchedule,
  cadencePrice,
  planCatalog,
  planDowngradeViolations,
  programPublicationFeatureViolations,
} from "@waflo/billing";
import type { PlanDowngradeViolation } from "@waflo/billing";
import type {
  BillingCadence,
  BillingIdentityInput,
  BillingTrialSetupInput,
  BillingStatus,
  PlanCode,
  RefundRequestInput,
  RefundReviewInput,
} from "@waflo/contracts";
import { Prisma } from "@waflo/database";
import Stripe from "stripe";
import { AuditService } from "../audit/audit.service.js";
import { AppError } from "../common/app-error.js";
import {
  withInvariantLock,
  withOrganizationInvariantLock,
} from "../common/organization-transaction.js";
import type { WafloRequest } from "../common/request-context.js";
import { EnvironmentService } from "../config/environment.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { NotificationService } from "../notifications/notification.service.js";
import { TenantService } from "../tenancy/tenant.service.js";

// ---------------------------------------------------------------------------
// Types / utilities
// ---------------------------------------------------------------------------

const planToDb = (plan: PlanCode) => plan.toUpperCase() as "STARTER" | "GROWTH" | "SCALE";
const dbToPlan = (plan: "STARTER" | "GROWTH" | "SCALE") =>
  plan.toLocaleLowerCase("en-US") as PlanCode;
const cadenceToDb = (cadence: BillingCadence) =>
  cadence.toUpperCase() as "MONTHLY" | "QUARTERLY" | "YEARLY";
const dbToCadence = (cadence: "MONTHLY" | "QUARTERLY" | "YEARLY") =>
  cadence.toLocaleLowerCase("en-US") as BillingCadence;
const planRank: Readonly<Record<PlanCode, number>> = { starter: 0, growth: 1, scale: 2 };
const WEBHOOK_LEASE_MS = 2 * 60 * 1000;
const REFUND_EXECUTION_LEASE_MS = 2 * 60 * 1000;
const activeRefundStatuses = ["REQUESTED", "UNDER_REVIEW", "APPROVED", "PROCESSING"] as const;
const committedRefundStatuses = ["APPROVED", "PROCESSING", "SUCCEEDED"] as const;
const TRIAL_DAYS = 7;
const TRIAL_SECONDS = TRIAL_DAYS * 24 * 60 * 60;

function cleanBillingIdentity(input: BillingIdentityInput) {
  const clean = (value: string | null | undefined) => value?.trim() || null;
  return {
    name: input.name.trim(),
    email: input.email.trim().toLocaleLowerCase("en-US"),
    countryCode: input.countryCode?.toUpperCase() ?? null,
    addressLine1: clean(input.addressLine1),
    addressLine2: clean(input.addressLine2),
    city: clean(input.city),
    region: clean(input.region),
    postalCode: clean(input.postalCode),
  };
}

function refundReasonToDb(reason: RefundRequestInput["reason"]) {
  return reason.toUpperCase() as
    | "DUPLICATE_CHARGE"
    | "INCORRECT_CHARGE"
    | "SERVICE_FAILURE"
    | "UNAUTHORIZED_PAYMENT"
    | "OTHER";
}

function refundReasonForStripe(
  reason:
    | RefundRequestInput["reason"]
    | "DUPLICATE_CHARGE"
    | "INCORRECT_CHARGE"
    | "SERVICE_FAILURE"
    | "UNAUTHORIZED_PAYMENT"
    | "OTHER",
): Stripe.RefundCreateParams.Reason {
  const normalized = reason.toLocaleLowerCase("en-US");
  if (normalized === "duplicate_charge") return "duplicate";
  if (normalized === "unauthorized_payment") return "fraudulent";
  return "requested_by_customer";
}

function refundStatusFromStripe(status: string | null): "PROCESSING" | "SUCCEEDED" | "FAILED" {
  if (status === "succeeded") return "SUCCEEDED";
  if (status === "failed" || status === "canceled") return "FAILED";
  return "PROCESSING";
}

function downgradeViolationMessage(violation: PlanDowngradeViolation): string {
  const label: Record<PlanDowngradeViolation["code"], string> = {
    LOCATIONS: "Archive locations until the active location count fits the target plan.",
    TEAM_SEATS: "Remove or cancel Staff and Manager seats until the team fits the target plan.",
    ACTIVE_PROGRAMS: "Archive loyalty cards until the active card count fits the target plan.",
    PRO_MODE: "Move Pro Mode loyalty cards to supported settings before downgrading.",
    MULTIPLE_REWARDS: "Reduce loyalty cards to one reward before downgrading.",
    MILESTONE_REWARDS: "Remove milestone rewards before downgrading.",
    ADVANCED_LAYOUT: "Change PATH or RING stamp layouts to a supported layout before downgrading.",
    ACTIVE_ADVANCED_EXPORTS: "Wait for advanced exports to finish or expire before downgrading.",
  };
  return `${label[violation.code]} Current: ${violation.currentUsage}; allowed: ${violation.limit ?? "unlimited"}.`;
}

function billingStatusFromStripe(status: Stripe.Subscription.Status): BillingStatus {
  switch (status) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    case "incomplete":
    case "paused":
      return "suspended";
    default:
      return "suspended";
  }
}

function statusToDb(status: BillingStatus) {
  return status.toUpperCase() as
    | "PENDING_ACTIVATION"
    | "TRIALING"
    | "ACTIVE"
    | "PAST_DUE"
    | "GRACE_PERIOD"
    | "SUSPENDED"
    | "CANCELED";
}

// ---------------------------------------------------------------------------
// Stripe provider adapter interface
// ---------------------------------------------------------------------------

/** Typed adapter so Stripe SDK calls can be mocked deterministically in tests. */
export interface StripeSubscriptionProvider {
  /** Retrieve the current canonical subscription object from the provider. */
  retrieveSubscription(subscriptionId: string): Promise<Stripe.Subscription>;
  retrieveInvoice?(invoiceId: string): Promise<Stripe.Invoice>;
  retrieveRefund?(refundId: string): Promise<Stripe.Refund>;
  listRefunds?(paymentIntentId: string): Promise<readonly Stripe.Refund[]>;
  createRefund?(params: Stripe.RefundCreateParams, idempotencyKey: string): Promise<Stripe.Refund>;
}

// ---------------------------------------------------------------------------
// BillingService
// ---------------------------------------------------------------------------

@Injectable()
export class BillingService {
  private readonly stripe: Stripe | null;
  /**
   * Overridable subscription provider.
   * In production this calls stripe.subscriptions.retrieve().
   * Tests replace this with a deterministic mock after construction:
   *   const svc = new BillingService(...deps);
   *   svc.subscriptionProvider = mockProvider;
   */
  subscriptionProvider: StripeSubscriptionProvider;

  constructor(
    private readonly prisma: PrismaService,
    private readonly environment: EnvironmentService,
    private readonly tenant: TenantService,
    private readonly audit: AuditService,
    _notifications: NotificationService,
  ) {
    this.stripe = environment.values.STRIPE_SECRET_KEY
      ? new Stripe(environment.values.STRIPE_SECRET_KEY, {
          appInfo: { name: "Waflo", version: "1.0.0", url: "https://waflo.app" },
        })
      : null;

    // Default live provider — replaced by tests via property assignment.
    this.subscriptionProvider = {
      retrieveSubscription: async (subscriptionId: string) => {
        const stripe = this.requireStripe();
        return stripe.subscriptions.retrieve(subscriptionId, {
          expand: ["items.data.price"],
        });
      },
      retrieveInvoice: async (invoiceId: string) => {
        const stripe = this.requireStripe();
        return stripe.invoices.retrieve(invoiceId, {
          expand: [
            "default_payment_method",
            "parent.subscription_details.subscription",
            "payments.data.payment.payment_intent.payment_method",
          ],
        });
      },
      retrieveRefund: async (refundId: string) => this.requireStripe().refunds.retrieve(refundId),
      listRefunds: async (paymentIntentId: string) => {
        const page = await this.requireStripe().refunds.list({
          payment_intent: paymentIntentId,
          limit: 100,
        });
        return page.data;
      },
      createRefund: async (params: Stripe.RefundCreateParams, idempotencyKey: string) =>
        this.requireStripe().refunds.create(params, { idempotencyKey }),
    };
  }

  async get(userId: string, organizationId: string) {
    const membership = await this.tenant.requireMembership(userId, organizationId, "billing.view");
    const organization = await this.prisma.client.organization.findUniqueOrThrow({
      where: { id: organizationId },
      include: {
        billingProfile: true,
        subscriptions: { orderBy: { createdAt: "desc" }, take: 10 },
        billingInvoices: {
          orderBy: { invoiceDate: "desc" },
          take: 36,
          include: { refundRequests: { orderBy: { createdAt: "desc" } } },
        },
        members: {
          where: { role: "OWNER", status: "ACTIVE" },
          include: { user: true },
          take: 1,
        },
      },
    });
    const currentPlan = dbToPlan(organization.selectedPlan);
    const lowerPlans = (["starter", "growth", "scale"] as const).filter(
      (plan) => planRank[plan] < planRank[currentPlan],
    );
    const downgradeOptions = await this.prisma.client.$transaction(async (transaction) =>
      Promise.all(
        lowerPlans.map(async (plan) => ({
          plan,
          violations: await this.downgradeViolations(transaction, organizationId, plan),
        })),
      ),
    );
    const paymentMethod = organization.billingProfile?.stripeCustomerId
      ? await this.authoritativePaymentMethod(organization.billingProfile.stripeCustomerId)
      : { status: "none" as const };
    const currentSubscription = organization.subscriptions[0] ?? null;
    const upcomingCharge = await this.authoritativeUpcomingCharge(
      organization.billingProfile?.stripeCustomerId ?? null,
      currentSubscription?.stripeSubscriptionId ?? null,
    );
    const latestInvoice = organization.billingInvoices[0] ?? null;
    const outstandingInvoice =
      organization.billingInvoices.find(
        (invoice) => invoice.amountRemaining > 0 && invoice.status !== "void",
      ) ?? null;
    const owner = organization.members[0]?.user;
    return {
      selectedPlan: organization.selectedPlan,
      canManageBilling: membership.role === "OWNER",
      selectedCadence: dbToCadence(organization.billingProfile?.selectedCadence ?? "MONTHLY"),
      profile: organization.billingProfile
        ? {
            selectedPlan: organization.billingProfile.selectedPlan,
            selectedCadence: organization.billingProfile.selectedCadence,
            subscriptionStatus: organization.billingProfile.subscriptionStatus,
            trialStart: organization.billingProfile.trialStart,
            trialEnd: organization.billingProfile.trialEnd,
            gracePeriodEnd: organization.billingProfile.gracePeriodEnd,
          }
        : null,
      customerPortalAvailable: Boolean(organization.billingProfile?.stripeCustomerId),
      subscriptions: organization.subscriptions,
      stripeConfigured: this.environment.stripeConfigured,
      cadenceAvailability: {
        monthly: this.cadenceConfigured("monthly"),
        quarterly: this.cadenceConfigured("quarterly"),
        yearly: this.cadenceConfigured("yearly"),
      },
      paymentMethod,
      billingIdentity: {
        name: organization.billingProfile?.billingName ?? organization.name,
        email: organization.billingProfile?.billingEmail ?? owner?.email ?? null,
        countryCode: organization.billingProfile?.billingCountryCode ?? null,
        addressLine1: organization.billingProfile?.billingAddressLine1 ?? null,
        addressLine2: organization.billingProfile?.billingAddressLine2 ?? null,
        city: organization.billingProfile?.billingCity ?? null,
        region: organization.billingProfile?.billingRegion ?? null,
        postalCode: organization.billingProfile?.billingPostalCode ?? null,
        locale: organization.defaultLocale === "AR" ? "ar" : "en",
        timezone: organization.timezone,
        syncedAt: organization.billingProfile?.stripeIdentitySyncedAt ?? null,
      },
      authoritativeState: {
        subscriptionStatus: organization.billingProfile?.subscriptionStatus ?? "PENDING_ACTIVATION",
        trialStart: organization.billingProfile?.trialStart ?? null,
        trialEnd: organization.billingProfile?.trialEnd ?? null,
        renewalDate: currentSubscription?.currentPeriodEnd ?? null,
        nextExpectedChargeDate:
          upcomingCharge?.date ?? currentSubscription?.currentPeriodEnd ?? null,
        nextExpectedAmount: upcomingCharge?.amount ?? null,
        currency: upcomingCharge?.currency ?? latestInvoice?.currency ?? null,
        latestPaymentStatus: latestInvoice?.status ?? null,
        outstandingInvoice,
        gracePeriodEnd:
          outstandingInvoice?.graceEndsAt ?? organization.billingProfile?.gracePeriodEnd ?? null,
      },
      invoices: organization.billingInvoices.map((invoice) => {
        const committedRefundAmount = invoice.refundRequests
          .filter((refund) =>
            committedRefundStatuses.includes(
              refund.status as (typeof committedRefundStatuses)[number],
            ),
          )
          .reduce((total, refund) => total + (refund.approvedAmount ?? refund.requestedAmount), 0);
        const succeededRefundAmount = invoice.refundRequests
          .filter((refund) => refund.status === "SUCCEEDED")
          .reduce((total, refund) => total + (refund.approvedAmount ?? refund.requestedAmount), 0);
        return {
          id: invoice.id,
          number: invoice.invoiceNumber,
          status: invoice.status,
          paymentStatus:
            invoice.status === "paid"
              ? "paid"
              : invoice.amountRemaining > 0
                ? "outstanding"
                : "not_due",
          amountDue: invoice.amountDue,
          amountPaid: invoice.amountPaid,
          amountRemaining: invoice.amountRemaining,
          currency: invoice.currency,
          date: invoice.invoiceDate,
          periodStart: invoice.periodStart,
          periodEnd: invoice.periodEnd,
          paidAt: invoice.paidAt,
          hostedInvoiceUrl: invoice.hostedInvoiceUrl,
          invoicePdfUrl: invoice.invoicePdfUrl,
          refundable: invoice.status === "paid" && invoice.amountPaid > committedRefundAmount,
          amountRefunded: succeededRefundAmount,
          remainingRefundableAmount: Math.max(0, invoice.amountPaid - committedRefundAmount),
          paymentMethod:
            invoice.paymentMethodBrand && invoice.paymentMethodLast4
              ? {
                  brand: invoice.paymentMethodBrand,
                  last4: invoice.paymentMethodLast4,
                  expMonth: invoice.paymentMethodExpMonth,
                  expYear: invoice.paymentMethodExpYear,
                }
              : null,
          refunds: invoice.refundRequests.map((refund) => ({
            id: refund.publicId,
            status: refund.status,
            reason: refund.reason,
            explanation: refund.explanation,
            requestedAmount: refund.requestedAmount,
            approvedAmount: refund.approvedAmount,
            currency: refund.currency,
            requestedAt: refund.requestedAt,
            completedAt: refund.completedAt,
            failureCode: refund.failureCode,
          })),
        };
      }),
      downgradeOptions,
      trialPolicy: {
        durationDays: TRIAL_DAYS,
        startsOnFirstProgramPublication: false,
        paymentMethodRequired: true,
      },
    };
  }

  async prepareTrialSetup(
    userId: string,
    organizationId: string,
    input: BillingTrialSetupInput,
    request: WafloRequest,
    idempotencyKey: string,
  ) {
    await this.tenant.requireMembership(userId, organizationId, "billing.manage");
    const stripe = this.requireStripe();
    const publishableKey = this.environment.values.STRIPE_PUBLISHABLE_KEY;
    if (!publishableKey) {
      throw new AppError(
        "STRIPE_PUBLISHABLE_KEY_NOT_CONFIGURED",
        "Secure payment setup is temporarily unavailable.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const identity = cleanBillingIdentity(input.billingIdentity);
    const planKey = `${input.plan.toUpperCase()}:${input.cadence.toUpperCase()}`;
    const requestFingerprint = createHash("sha256")
      .update(JSON.stringify({ plan: input.plan, cadence: input.cadence, identity }), "utf8")
      .digest("hex");
    const priceId = this.priceId(input.plan, input.cadence);
    const price = await stripe.prices.retrieve(priceId);
    const charge = this.assertTrialPrice(price, input.plan, input.cadence);
    const now = new Date();

    let command = await this.prisma.client.checkoutIdempotencyKey.findUnique({
      where: { organizationId_idempotencyKey: { organizationId, idempotencyKey } },
    });
    if (command) {
      if (command.requestFingerprint !== requestFingerprint || command.planCode !== planKey) {
        throw new AppError(
          "BILLING_COMMAND_CONFLICT",
          "This billing action was already used with different details.",
          HttpStatus.CONFLICT,
        );
      }
      if (command.status === "SUBSCRIPTION_CREATED") {
        const expectedTrialStart = command.completedAt ?? command.createdAt;
        return {
          completed: true,
          clientSecret: null,
          setupIntentId: command.stripeSetupIntentId,
          publishableKey,
          trialDays: TRIAL_DAYS,
          amount: charge.amount,
          currency: charge.currency,
          expectedTrialStart,
          expectedFirstChargeAt: new Date(expectedTrialStart.getTime() + TRIAL_SECONDS * 1000),
        };
      }
      if (command.expiresAt && command.expiresAt <= now) {
        throw new AppError(
          "BILLING_SETUP_EXPIRED",
          "This payment setup expired. Start again to continue.",
          HttpStatus.GONE,
        );
      }
      if (command.stripeSetupIntentId) {
        const existingIntent = await stripe.setupIntents.retrieve(command.stripeSetupIntentId);
        const expectedTrialStart = command.createdAt;
        return {
          completed: false,
          clientSecret: existingIntent.client_secret,
          setupIntentId: existingIntent.id,
          publishableKey,
          trialDays: TRIAL_DAYS,
          amount: charge.amount,
          currency: charge.currency,
          expectedTrialStart,
          expectedFirstChargeAt: new Date(expectedTrialStart.getTime() + TRIAL_SECONDS * 1000),
        };
      }
    }

    const organization = await this.prisma.client.organization.findUniqueOrThrow({
      where: { id: organizationId },
      include: {
        billingProfile: true,
        subscriptions: {
          where: { status: { not: "CANCELED" } },
          select: { id: true, status: true },
          take: 1,
        },
      },
    });
    const profile = organization.billingProfile;
    if (!profile) {
      throw new AppError(
        "BILLING_PROFILE_MISSING",
        "Billing setup could not be started.",
        HttpStatus.CONFLICT,
      );
    }
    if (
      organization.subscriptions.length > 0 ||
      profile.subscriptionStatus !== "PENDING_ACTIVATION" ||
      profile.trialStart !== null ||
      profile.trialTriggeringProgramId !== null
    ) {
      throw new AppError(
        "TRIAL_NOT_ELIGIBLE",
        "This organization already has or previously used a subscription trial.",
        HttpStatus.CONFLICT,
      );
    }

    if (!command) {
      try {
        command = await this.prisma.client.checkoutIdempotencyKey.create({
          data: {
            organizationId,
            idempotencyKey,
            planCode: planKey,
            selectedCadence: cadenceToDb(input.cadence),
            requestFingerprint,
            status: "SETUP_PENDING",
            expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
          },
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
          throw error;
        }
        command = await this.prisma.client.checkoutIdempotencyKey.findUniqueOrThrow({
          where: { organizationId_idempotencyKey: { organizationId, idempotencyKey } },
        });
        if (command.requestFingerprint !== requestFingerprint) {
          throw new AppError(
            "BILLING_COMMAND_CONFLICT",
            "This billing action was already used with different details.",
            HttpStatus.CONFLICT,
          );
        }
      }
    }

    const customerId = await this.ensureTrialCustomer(
      userId,
      organizationId,
      input.plan,
      input.cadence,
      identity,
    );
    const setupIntent = await stripe.setupIntents.create(
      {
        customer: customerId,
        usage: "off_session",
        payment_method_types: ["card"],
        metadata: {
          wafloOrganizationId: organizationId,
          wafloBillingCommandId: command.id,
          plan: input.plan,
          cadence: input.cadence,
        },
      },
      { idempotencyKey: `waflo:org:${organizationId}:trial-setup:${idempotencyKey}` },
    );
    if (!setupIntent.client_secret) {
      throw new AppError(
        "STRIPE_SETUP_INTENT_INVALID",
        "Secure payment setup could not be initialized.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    await this.prisma.client.checkoutIdempotencyKey.update({
      where: { id: command.id },
      data: { stripeCustomerId: customerId, stripeSetupIntentId: setupIntent.id },
    });
    await this.audit.record(
      {
        organizationId,
        actorUserId: userId,
        action: "billing.trial_payment_setup_started",
        targetType: "organization_billing_profile",
        targetId: organizationId,
        metadata: { plan: input.plan, cadence: input.cadence },
      },
      request,
    );
    const expectedTrialStart = command.createdAt;
    return {
      completed: false,
      clientSecret: setupIntent.client_secret,
      setupIntentId: setupIntent.id,
      publishableKey,
      trialDays: TRIAL_DAYS,
      amount: charge.amount,
      currency: charge.currency,
      expectedTrialStart,
      expectedFirstChargeAt: new Date(expectedTrialStart.getTime() + TRIAL_SECONDS * 1000),
    };
  }

  async completeTrialSetup(
    userId: string,
    organizationId: string,
    input: { setupIntentId: string },
    request: WafloRequest,
    idempotencyKey: string,
  ) {
    await this.tenant.requireMembership(userId, organizationId, "billing.manage");
    const stripe = this.requireStripe();
    const command = await this.prisma.client.checkoutIdempotencyKey.findUnique({
      where: { organizationId_idempotencyKey: { organizationId, idempotencyKey } },
    });
    if (!command || command.stripeSetupIntentId !== input.setupIntentId) {
      throw new AppError(
        "BILLING_SETUP_INVALID",
        "This payment setup is invalid or has expired.",
        HttpStatus.GONE,
      );
    }
    const plan = command.planCode.split(":")[0]?.toLocaleLowerCase("en-US") as PlanCode;
    const cadence = dbToCadence(command.selectedCadence);
    if (!(["starter", "growth", "scale"] as string[]).includes(plan)) {
      throw new AppError(
        "BILLING_SETUP_INVALID",
        "This payment setup is invalid.",
        HttpStatus.GONE,
      );
    }
    const priceId = this.priceId(plan, cadence);
    const price = await stripe.prices.retrieve(priceId);
    const charge = this.assertTrialPrice(price, plan, cadence);

    const setupIntent = await stripe.setupIntents.retrieve(input.setupIntentId, {
      expand: ["payment_method"],
    });
    if (setupIntent.status !== "succeeded") {
      throw new AppError(
        "PAYMENT_METHOD_REQUIRED",
        "Complete the secure card form before starting your trial.",
        HttpStatus.UNPROCESSABLE_ENTITY,
        { setupStatus: setupIntent.status },
      );
    }
    const customerId =
      typeof setupIntent.customer === "string"
        ? setupIntent.customer
        : setupIntent.customer && !setupIntent.customer.deleted
          ? setupIntent.customer.id
          : null;
    if (!customerId || customerId !== command.stripeCustomerId) {
      throw new AppError(
        "STRIPE_CUSTOMER_ORGANIZATION_MISMATCH",
        "The payment method does not belong to this organization.",
        HttpStatus.CONFLICT,
      );
    }
    const paymentMethod =
      typeof setupIntent.payment_method === "string"
        ? await stripe.paymentMethods.retrieve(setupIntent.payment_method)
        : setupIntent.payment_method;
    if (
      paymentMethod?.type !== "card" ||
      !paymentMethod.card ||
      (typeof paymentMethod.customer === "string" && paymentMethod.customer !== customerId)
    ) {
      throw new AppError(
        "PAYMENT_METHOD_REQUIRED",
        "A valid card is required before starting your trial.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethod.id },
    });
    const subscription = await stripe.subscriptions.create(
      {
        customer: customerId,
        items: [{ price: priceId, quantity: 1 }],
        default_payment_method: paymentMethod.id,
        collection_method: "charge_automatically",
        payment_settings: {
          payment_method_types: ["card"],
          save_default_payment_method: "on_subscription",
        },
        trial_period_days: TRIAL_DAYS,
        trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
        metadata: {
          organizationId,
          wafloOrganizationId: organizationId,
          wafloService: "Waflo loyalty platform",
          plan,
          cadence,
        },
        expand: ["latest_invoice"],
      },
      // One organization can own only one initial trial. This provider key is
      // deliberately organization-stable so parallel browser tabs or distinct
      // command IDs cannot create a second Stripe subscription.
      { idempotencyKey: `waflo:org:${organizationId}:initial-trial-subscription:v1` },
    );
    const trialStartSeconds = subscription.trial_start;
    const trialEndSeconds = subscription.trial_end;
    if (
      subscription.status !== "trialing" ||
      !trialStartSeconds ||
      !trialEndSeconds ||
      trialEndSeconds - trialStartSeconds !== TRIAL_SECONDS
    ) {
      throw new AppError(
        "STRIPE_TRIAL_CONTRACT_INVALID",
        "Stripe did not create the required 7-day trial.",
        HttpStatus.CONFLICT,
      );
    }
    const invoice =
      typeof subscription.latest_invoice === "string"
        ? await stripe.invoices.retrieve(subscription.latest_invoice)
        : subscription.latest_invoice;
    if (invoice?.amount_due !== 0 || invoice.total !== 0) {
      throw new AppError(
        "STRIPE_TRIAL_INVOICE_INVALID",
        "Stripe did not create the required $0 trial invoice.",
        HttpStatus.CONFLICT,
      );
    }
    const item = subscription.items.data[0];
    if (!item || item.price.id !== priceId) {
      throw new AppError(
        "STRIPE_TRIAL_PRICE_INVALID",
        "Stripe did not attach the selected plan and cadence.",
        HttpStatus.CONFLICT,
      );
    }
    const trialStart = new Date(trialStartSeconds * 1000);
    const trialEnd = new Date(trialEndSeconds * 1000);
    const currentPeriodStart = item.current_period_start
      ? new Date(item.current_period_start * 1000)
      : trialStart;
    const currentPeriodEnd = item.current_period_end
      ? new Date(item.current_period_end * 1000)
      : trialEnd;
    const now = new Date();

    await withOrganizationInvariantLock(this.prisma.client, organizationId, async (transaction) => {
      const profile = await transaction.organizationBillingProfile.findUniqueOrThrow({
        where: { organizationId },
      });
      const currentCommand = await transaction.checkoutIdempotencyKey.findUniqueOrThrow({
        where: { id: command.id },
      });
      if (currentCommand.status === "SUBSCRIPTION_CREATED") {
        if (currentCommand.stripeSubscriptionId !== subscription.id) {
          throw new AppError(
            "BILLING_COMMAND_CONFLICT",
            "This billing action already completed with a different subscription.",
            HttpStatus.CONFLICT,
          );
        }
        return;
      }
      if (profile.trialStart !== null && currentCommand.stripeSubscriptionId !== subscription.id) {
        throw new AppError(
          "TRIAL_NOT_ELIGIBLE",
          "This organization already used its subscription trial.",
          HttpStatus.CONFLICT,
        );
      }
      await transaction.subscription.upsert({
        where: { stripeSubscriptionId: subscription.id },
        update: {
          stripePriceId: priceId,
          planCode: planToDb(plan),
          cadence: cadenceToDb(cadence),
          status: "TRIALING",
          currentPeriodStart,
          currentPeriodEnd,
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
          lastProviderSyncAt: now,
        },
        create: {
          organizationId,
          stripeSubscriptionId: subscription.id,
          stripePriceId: priceId,
          planCode: planToDb(plan),
          cadence: cadenceToDb(cadence),
          status: "TRIALING",
          currentPeriodStart,
          currentPeriodEnd,
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
          lastProviderSyncAt: now,
        },
      });
      await transaction.organizationBillingProfile.update({
        where: { organizationId },
        data: {
          stripeCustomerId: customerId,
          selectedPlan: planToDb(plan),
          selectedCadence: cadenceToDb(cadence),
          subscriptionStatus: "TRIALING",
          trialStart,
          trialEnd,
          trialTriggeringProgramId: null,
          trialTriggeringUserId: null,
        },
      });
      await transaction.organization.update({
        where: { id: organizationId },
        data: { selectedPlan: planToDb(plan) },
      });
      await transaction.checkoutIdempotencyKey.update({
        where: { id: command.id },
        data: {
          stripePaymentMethodId: paymentMethod.id,
          stripeSubscriptionId: subscription.id,
          status: "SUBSCRIPTION_CREATED",
          completedAt: now,
        },
      });
      await transaction.billingInvoice.upsert({
        where: { stripeInvoiceId: invoice.id },
        update: {
          status: invoice.status ?? "paid",
          amountDue: invoice.amount_due,
          amountPaid: invoice.amount_paid,
          amountRemaining: invoice.amount_remaining,
          paymentMethodBrand: paymentMethod.card?.brand ?? null,
          paymentMethodLast4: paymentMethod.card?.last4 ?? null,
          paymentMethodExpMonth: paymentMethod.card?.exp_month ?? null,
          paymentMethodExpYear: paymentMethod.card?.exp_year ?? null,
        },
        create: {
          organizationId,
          stripeInvoiceId: invoice.id,
          stripeSubscriptionId: subscription.id,
          stripePaymentMethodId: paymentMethod.id,
          invoiceNumber: invoice.number,
          status: invoice.status ?? "paid",
          billingReason: invoice.billing_reason,
          amountDue: invoice.amount_due,
          amountPaid: invoice.amount_paid,
          amountRemaining: invoice.amount_remaining,
          currency: invoice.currency.toUpperCase(),
          invoiceDate: new Date((invoice.effective_at ?? invoice.created) * 1000),
          periodStart: invoice.period_start ? new Date(invoice.period_start * 1000) : null,
          periodEnd: invoice.period_end ? new Date(invoice.period_end * 1000) : null,
          hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
          invoicePdfUrl: invoice.invoice_pdf ?? null,
          paymentMethodBrand: paymentMethod.card?.brand ?? null,
          paymentMethodLast4: paymentMethod.card?.last4 ?? null,
          paymentMethodExpMonth: paymentMethod.card?.exp_month ?? null,
          paymentMethodExpYear: paymentMethod.card?.exp_year ?? null,
          paidAt: invoice.status === "paid" ? now : null,
        },
      });
      await this.audit.recordInTransaction(
        transaction,
        {
          organizationId,
          actorUserId: userId,
          action: "billing.seven_day_trial_started",
          targetType: "subscription",
          targetId: subscription.id,
          metadata: {
            plan,
            cadence,
            trialDays: TRIAL_DAYS,
            initialInvoiceAmount: invoice.amount_due,
          },
        },
        request,
      );
    });

    return {
      status: "trialing" as const,
      trialStart,
      trialEnd,
      firstChargeAt: trialEnd,
      amount: charge.amount,
      currency: charge.currency,
      initialInvoiceAmount: invoice.amount_due,
      paymentMethod: {
        brand: paymentMethod.card.brand,
        last4: paymentMethod.card.last4,
        expMonth: paymentMethod.card.exp_month,
        expYear: paymentMethod.card.exp_year,
      },
    };
  }

  async previewTrialSetup(
    userId: string,
    organizationId: string,
    input: { setupIntentId: string },
    idempotencyKey: string,
  ) {
    await this.tenant.requireMembership(userId, organizationId, "billing.manage");
    const stripe = this.requireStripe();
    const command = await this.prisma.client.checkoutIdempotencyKey.findUnique({
      where: { organizationId_idempotencyKey: { organizationId, idempotencyKey } },
    });
    if (!command || command.stripeSetupIntentId !== input.setupIntentId) {
      throw new AppError(
        "BILLING_SETUP_INVALID",
        "This payment setup is invalid or has expired.",
        HttpStatus.GONE,
      );
    }
    const setupIntent = await stripe.setupIntents.retrieve(input.setupIntentId, {
      expand: ["payment_method"],
    });
    const customerId =
      typeof setupIntent.customer === "string"
        ? setupIntent.customer
        : setupIntent.customer && !setupIntent.customer.deleted
          ? setupIntent.customer.id
          : null;
    const paymentMethod =
      typeof setupIntent.payment_method === "string"
        ? await stripe.paymentMethods.retrieve(setupIntent.payment_method)
        : setupIntent.payment_method;
    if (
      setupIntent.status !== "succeeded" ||
      !customerId ||
      customerId !== command.stripeCustomerId ||
      !paymentMethod?.card ||
      paymentMethod.type !== "card"
    ) {
      throw new AppError(
        "PAYMENT_METHOD_REQUIRED",
        "Complete the secure card form before reviewing your trial.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const plan = command.planCode.split(":")[0]?.toLocaleLowerCase("en-US") as PlanCode;
    const cadence = dbToCadence(command.selectedCadence);
    if (!(["starter", "growth", "scale"] as string[]).includes(plan)) {
      throw new AppError(
        "BILLING_SETUP_INVALID",
        "This payment setup is invalid.",
        HttpStatus.GONE,
      );
    }
    const price = await stripe.prices.retrieve(this.priceId(plan, cadence));
    const charge = this.assertTrialPrice(price, plan, cadence);
    const expectedTrialStart = new Date();
    return {
      plan,
      cadence,
      trialDays: TRIAL_DAYS,
      amount: charge.amount,
      currency: charge.currency,
      expectedTrialStart,
      expectedFirstChargeAt: new Date(expectedTrialStart.getTime() + TRIAL_SECONDS * 1000),
      paymentMethod: {
        brand: paymentMethod.card.brand,
        last4: paymentMethod.card.last4,
        expMonth: paymentMethod.card.exp_month,
        expYear: paymentMethod.card.exp_year,
      },
    };
  }

  async preparePaymentMethodReplacement(
    userId: string,
    organizationId: string,
    request: WafloRequest,
    idempotencyKey: string,
  ) {
    await this.tenant.requireMembership(userId, organizationId, "billing.manage");
    const stripe = this.requireStripe();
    const publishableKey = this.environment.values.STRIPE_PUBLISHABLE_KEY;
    if (!publishableKey) {
      throw new AppError(
        "STRIPE_PUBLISHABLE_KEY_NOT_CONFIGURED",
        "Secure payment setup is temporarily unavailable.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const profile = await this.prisma.client.organizationBillingProfile.findUniqueOrThrow({
      where: { organizationId },
    });
    if (!profile.stripeCustomerId) {
      throw new AppError(
        "PAYMENT_PROFILE_NOT_READY",
        "Start subscription setup before adding a payment method.",
        HttpStatus.CONFLICT,
      );
    }
    const setupIntent = await stripe.setupIntents.create(
      {
        customer: profile.stripeCustomerId,
        usage: "off_session",
        payment_method_types: ["card"],
        metadata: {
          wafloOrganizationId: organizationId,
          purpose: "payment_method_replacement",
          wafloCommandKeyHash: createHash("sha256").update(idempotencyKey).digest("hex"),
        },
      },
      { idempotencyKey: `waflo:org:${organizationId}:replace-payment:${idempotencyKey}` },
    );
    if (!setupIntent.client_secret) {
      throw new AppError(
        "STRIPE_SETUP_INTENT_INVALID",
        "Secure payment setup could not be initialized.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    await this.audit.record(
      {
        organizationId,
        actorUserId: userId,
        action: "billing.payment_method_replacement_started",
        targetType: "organization_billing_profile",
        targetId: organizationId,
        metadata: {},
      },
      request,
    );
    return {
      clientSecret: setupIntent.client_secret,
      setupIntentId: setupIntent.id,
      publishableKey,
    };
  }

  async completePaymentMethodReplacement(
    userId: string,
    organizationId: string,
    input: { setupIntentId: string },
    request: WafloRequest,
    idempotencyKey: string,
  ) {
    await this.tenant.requireMembership(userId, organizationId, "billing.manage");
    const stripe = this.requireStripe();
    const profile = await this.prisma.client.organizationBillingProfile.findUniqueOrThrow({
      where: { organizationId },
    });
    const setupIntent = await stripe.setupIntents.retrieve(input.setupIntentId, {
      expand: ["payment_method"],
    });
    const customerId =
      typeof setupIntent.customer === "string"
        ? setupIntent.customer
        : setupIntent.customer && !setupIntent.customer.deleted
          ? setupIntent.customer.id
          : null;
    const paymentMethod =
      typeof setupIntent.payment_method === "string"
        ? await stripe.paymentMethods.retrieve(setupIntent.payment_method)
        : setupIntent.payment_method;
    if (
      setupIntent.status !== "succeeded" ||
      setupIntent.metadata?.wafloOrganizationId !== organizationId ||
      setupIntent.metadata?.purpose !== "payment_method_replacement" ||
      setupIntent.metadata?.wafloCommandKeyHash !==
        createHash("sha256").update(idempotencyKey).digest("hex") ||
      !customerId ||
      customerId !== profile.stripeCustomerId ||
      !paymentMethod?.card ||
      paymentMethod.type !== "card"
    ) {
      throw new AppError(
        "PAYMENT_METHOD_REQUIRED",
        "Complete the secure card form before saving.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const subscriptions = await this.prisma.client.subscription.findMany({
      where: { organizationId, status: { in: ["TRIALING", "ACTIVE", "PAST_DUE"] } },
      select: { stripeSubscriptionId: true },
    });
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethod.id },
    });
    await Promise.all(
      subscriptions.map((subscription) =>
        stripe.subscriptions.update(subscription.stripeSubscriptionId, {
          default_payment_method: paymentMethod.id,
        }),
      ),
    );
    await this.audit.record(
      {
        organizationId,
        actorUserId: userId,
        action: "billing.payment_method_replaced",
        targetType: "organization_billing_profile",
        targetId: organizationId,
        metadata: { brand: paymentMethod.card.brand, last4: paymentMethod.card.last4 },
      },
      request,
    );
    return {
      paymentMethod: {
        brand: paymentMethod.card.brand,
        last4: paymentMethod.card.last4,
        expMonth: paymentMethod.card.exp_month,
        expYear: paymentMethod.card.exp_year,
      },
    };
  }

  async updateBillingIdentity(
    userId: string,
    organizationId: string,
    input: BillingIdentityInput,
    request: WafloRequest,
  ) {
    await this.tenant.requireMembership(userId, organizationId, "billing.manage");
    const current = await this.prisma.client.organization.findUniqueOrThrow({
      where: { id: organizationId },
      include: { billingProfile: true },
    });
    const clean = (value: string | null | undefined) => value?.trim() || null;
    const address = {
      line1: clean(input.addressLine1) ?? "",
      line2: clean(input.addressLine2) ?? "",
      city: clean(input.city) ?? "",
      state: clean(input.region) ?? "",
      postal_code: clean(input.postalCode) ?? "",
      country: input.countryCode ?? "",
    };
    const stripeCustomerId = current.billingProfile?.stripeCustomerId;
    if (stripeCustomerId) {
      const stripe = this.requireStripe();
      await stripe.customers.update(stripeCustomerId, {
        name: input.name,
        email: input.email,
        address,
        preferred_locales: [current.defaultLocale === "AR" ? "ar" : "en"],
        metadata: { wafloOrganizationId: organizationId },
      });
    }
    const profile = await this.prisma.client.organizationBillingProfile.update({
      where: { organizationId },
      data: {
        billingName: input.name,
        billingEmail: input.email,
        billingCountryCode: input.countryCode ?? null,
        billingAddressLine1: clean(input.addressLine1),
        billingAddressLine2: clean(input.addressLine2),
        billingCity: clean(input.city),
        billingRegion: clean(input.region),
        billingPostalCode: clean(input.postalCode),
        stripeIdentitySyncedAt: stripeCustomerId ? new Date() : null,
      },
    });
    await this.audit.record(
      {
        organizationId,
        actorUserId: userId,
        action: "billing.identity_updated",
        targetType: "organization_billing_profile",
        targetId: profile.id,
        metadata: {
          countryCode: input.countryCode ?? null,
          stripeSynchronized: Boolean(stripeCustomerId),
        },
      },
      request,
    );
    return { updated: true, stripeSynchronized: Boolean(stripeCustomerId) };
  }

  /**
   * Re-read the provider's canonical subscription snapshot for one organization.
   * This intentionally reuses the same locked apply path as webhooks, so it is
   * safe to retry and cannot trust a browser-provided plan or billing status.
   */
  async reconcileOrganization(userId: string, organizationId: string, request: WafloRequest) {
    await this.tenant.requireMembership(userId, organizationId, "billing.manage");
    const local = await this.prisma.client.subscription.findFirst({
      where: { organizationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    if (!local) {
      await this.audit.record(
        {
          organizationId,
          actorUserId: userId,
          action: "stripe.reconciliation_no_subscription",
          targetType: "organization",
          targetId: organizationId,
        },
        request,
      );
      return { reconciled: false, reason: "NO_LOCAL_SUBSCRIPTION" as const };
    }
    let snapshot: Stripe.Subscription;
    try {
      snapshot = await this.subscriptionProvider.retrieveSubscription(local.stripeSubscriptionId);
    } catch (error) {
      const missing =
        (error instanceof Stripe.errors.StripeInvalidRequestError &&
          error.code === "resource_missing") ||
        (typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "resource_missing");
      if (!missing) {
        await this.audit.record(
          {
            organizationId,
            actorUserId: userId,
            action: "stripe.reconciliation_failed",
            targetType: "subscription",
            targetId: local.stripeSubscriptionId,
            metadata: { reason: "PROVIDER_RETRIEVAL_FAILED" },
          },
          request,
        );
        throw new AppError(
          "STRIPE_RECONCILIATION_FAILED",
          "Billing reconciliation is unavailable.",
          503,
        );
      }
      await withOrganizationInvariantLock(
        this.prisma.client,
        organizationId,
        async (transaction) => {
          await transaction.subscription.update({
            where: { id: local.id },
            data: { status: "CANCELED", canceledAt: new Date(), lastProviderSyncAt: new Date() },
          });
          await transaction.organizationBillingProfile.update({
            where: { organizationId },
            data: { subscriptionStatus: "CANCELED" },
          });
          await transaction.auditLog.create({
            data: {
              organizationId,
              actorUserId: userId,
              action: "stripe.reconciliation_missing_subscription",
              targetType: "subscription",
              targetId: local.stripeSubscriptionId,
              requestId: request.requestId,
            },
          });
        },
      );
      return { reconciled: true, reason: "MISSING_CANCELED" as const };
    }
    const profile = await this.prisma.client.organizationBillingProfile.findUniqueOrThrow({
      where: { organizationId },
    });
    const snapshotCustomerId =
      typeof snapshot.customer === "string" ? snapshot.customer : snapshot.customer.id;
    if (
      snapshot.id !== local.stripeSubscriptionId ||
      snapshot.metadata.organizationId !== organizationId ||
      !profile.stripeCustomerId ||
      snapshotCustomerId !== profile.stripeCustomerId
    ) {
      await this.audit.record(
        {
          organizationId,
          actorUserId: userId,
          action: "stripe.reconciliation_ownership_mismatch",
          targetType: "subscription",
          targetId: local.stripeSubscriptionId,
        },
        request,
      );
      throw new AppError(
        "STRIPE_RECONCILIATION_OWNERSHIP_MISMATCH",
        "The Stripe subscription does not belong to this organization.",
        HttpStatus.CONFLICT,
      );
    }
    const reconciliationEvent = {
      id: `reconciliation:${snapshot.id}:${Math.floor(Date.now() / 1000)}`,
      type: "customer.subscription.updated",
      created: Math.floor(Date.now() / 1000),
      data: { object: snapshot },
    } as Stripe.Event;
    await withInvariantLock(
      this.prisma.client,
      `stripe-subscription:${snapshot.id}`,
      async (transaction) =>
        this.applyStripeEvent(reconciliationEvent, transaction, request, snapshot),
    );
    await this.audit.record(
      {
        organizationId,
        actorUserId: userId,
        action: "stripe.reconciled",
        targetType: "subscription",
        targetId: snapshot.id,
      },
      request,
    );
    return { reconciled: true, reason: "APPLIED" as const };
  }

  async selectPlan(
    userId: string,
    organizationId: string,
    plan: PlanCode,
    cadenceOrRequest: BillingCadence | WafloRequest,
    maybeRequest?: WafloRequest,
  ) {
    const cadence = typeof cadenceOrRequest === "string" ? cadenceOrRequest : "monthly";
    if (typeof cadenceOrRequest === "string" && !maybeRequest) {
      throw new Error("The billing request context is required.");
    }
    const request = typeof cadenceOrRequest === "string" ? maybeRequest : cadenceOrRequest;
    await this.tenant.requireMembership(userId, organizationId, "billing.manage");
    const selectedPlan = planToDb(plan);
    await withOrganizationInvariantLock(this.prisma.client, organizationId, async (transaction) => {
      const [actor, organization] = await Promise.all([
        transaction.organizationMember.findUnique({
          where: { organizationId_userId: { organizationId, userId } },
        }),
        transaction.organization.findUniqueOrThrow({
          where: { id: organizationId },
          include: {
            billingProfile: true,
            subscriptions: {
              where: { status: { in: ["TRIALING", "ACTIVE", "PAST_DUE", "GRACE_PERIOD"] } },
              select: { id: true },
              take: 1,
            },
          },
        }),
      ]);
      if (actor?.status !== "ACTIVE" || actor.role !== "OWNER") {
        throw new AppError(
          "PERMISSION_DENIED",
          "Your role does not allow this action.",
          HttpStatus.FORBIDDEN,
        );
      }
      if (
        organization.billingProfile?.subscriptionStatus !== "PENDING_ACTIVATION" ||
        organization.subscriptions.length > 0
      ) {
        throw new AppError(
          "BILLING_PLAN_CHANGE_UNAVAILABLE",
          "This subscription cannot be changed from the current billing state.",
          HttpStatus.CONFLICT,
        );
      }
      const previousPlan = dbToPlan(organization.selectedPlan);
      if (planRank[plan] < planRank[previousPlan]) {
        const violations = await this.downgradeViolations(transaction, organizationId, plan);
        if (violations.length > 0) {
          const locationViolation = violations.find((violation) => violation.code === "LOCATIONS");
          const teamViolation = violations.find((violation) => violation.code === "TEAM_SEATS");
          const programViolation = violations.find(
            (violation) => violation.code === "ACTIVE_PROGRAMS",
          );
          throw new AppError(
            "PLAN_DOWNGRADE_BLOCKED",
            "Reduce usage before switching to this plan.",
            HttpStatus.CONFLICT,
            {
              requestedPlan: plan,
              violations,
              ...(locationViolation
                ? {
                    locationUsage: locationViolation.actual,
                    locationLimit: locationViolation.limit,
                  }
                : {}),
              ...(teamViolation
                ? { teamUsage: teamViolation.actual, teamLimit: teamViolation.limit }
                : {}),
              ...(programViolation
                ? { programUsage: programViolation.actual, programLimit: programViolation.limit }
                : {}),
            },
          );
        }
      }
      await transaction.organization.update({
        where: { id: organizationId },
        data: { selectedPlan },
      });
      await transaction.organizationBillingProfile.update({
        where: { organizationId },
        data: { selectedPlan, selectedCadence: cadenceToDb(cadence) },
      });
      await this.audit.recordInTransaction(
        transaction,
        {
          organizationId,
          actorUserId: userId,
          action: "billing.selected_plan_changed",
          targetType: "organization_billing_profile",
          targetId: organizationId,
          metadata: { selectedPlan, selectedCadence: cadenceToDb(cadence) },
        },
        request,
      );
    });
    return {
      selectedPlan,
      selectedCadence: cadenceToDb(cadence),
      subscriptionActivated: false,
      trialStarted: false,
    };
  }

  /**
   * Hosted Checkout was intentionally retired. Initial subscription setup and
   * payment-method changes stay inside Waflo through Stripe Elements.
   */
  async checkout(): Promise<never> {
    throw new AppError(
      "HOSTED_CHECKOUT_REMOVED",
      "Use the embedded Waflo billing flow.",
      HttpStatus.GONE,
    );
  }

  async portal(userId: string, organizationId: string, request: WafloRequest) {
    await this.tenant.requireMembership(userId, organizationId, "billing.manage");
    const stripe = this.requireStripe();
    const profile = await this.prisma.client.organizationBillingProfile.findUniqueOrThrow({
      where: { organizationId },
    });
    if (!profile.stripeCustomerId) {
      throw new AppError(
        "BILLING_PORTAL_UNAVAILABLE",
        "The billing portal becomes available after a Stripe customer is created.",
        HttpStatus.CONFLICT,
      );
    }
    const portalConfigurationId = this.environment.values.STRIPE_CUSTOMER_PORTAL_CONFIGURATION_ID;
    if (!portalConfigurationId) {
      throw new AppError(
        "STRIPE_PORTAL_CONFIGURATION_REQUIRED",
        "Stripe Customer Portal is not configured for W1 plan policy.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const portal = await stripe.billingPortal.sessions.create({
      customer: profile.stripeCustomerId,
      return_url: `${this.environment.values.MERCHANT_DASHBOARD_URL}/en/dashboard/billing`,
      configuration: portalConfigurationId,
    });
    await this.audit.record(
      {
        organizationId,
        actorUserId: userId,
        action: "stripe.portal_opened",
        targetType: "stripe_customer",
        targetId: profile.stripeCustomerId,
      },
      request,
    );
    return { url: portal.url };
  }

  async requestRefund(
    userId: string,
    organizationId: string,
    billingInvoiceId: string,
    input: RefundRequestInput,
    idempotencyKey: string,
    request: WafloRequest,
  ) {
    await this.requireBillingOwner(userId, organizationId);
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          billingInvoiceId,
          reason: input.reason,
          amount: input.amount ?? null,
          explanation: input.explanation?.trim() || null,
        }),
        "utf8",
      )
      .digest("hex");
    const existing = await this.prisma.client.billingRefundRequest.findUnique({
      where: { organizationId_idempotencyKey: { organizationId, idempotencyKey } },
    });
    if (existing) {
      if (existing.requestFingerprint !== fingerprint) {
        throw new AppError(
          "REFUND_IDEMPOTENCY_KEY_CONFLICT",
          "This refund command ID was already used for a different request.",
          HttpStatus.CONFLICT,
        );
      }
      return this.refundResponse(existing);
    }

    return withOrganizationInvariantLock(
      this.prisma.client,
      organizationId,
      async (transaction) => {
        const replay = await transaction.billingRefundRequest.findUnique({
          where: { organizationId_idempotencyKey: { organizationId, idempotencyKey } },
        });
        if (replay) {
          if (replay.requestFingerprint !== fingerprint) {
            throw new AppError(
              "REFUND_IDEMPOTENCY_KEY_CONFLICT",
              "This refund command ID was already used for a different request.",
              HttpStatus.CONFLICT,
            );
          }
          return this.refundResponse(replay);
        }
        const invoice = await transaction.billingInvoice.findFirst({
          where: { id: billingInvoiceId, organizationId },
          include: {
            refundRequests: true,
            organization: {
              include: {
                billingProfile: true,
                members: {
                  where: { role: "OWNER", status: "ACTIVE" },
                  include: { user: true },
                  take: 1,
                },
              },
            },
          },
        });
        if (!invoice) {
          throw new AppError(
            "BILLING_INVOICE_NOT_FOUND",
            "The invoice does not belong to this organization.",
            HttpStatus.NOT_FOUND,
          );
        }
        if (invoice.status !== "paid" || invoice.amountPaid <= 0 || !invoice.paidAt) {
          throw new AppError(
            "REFUND_INVOICE_NOT_ELIGIBLE",
            "Only a successfully paid invoice can be reviewed for a refund.",
            HttpStatus.CONFLICT,
          );
        }
        if (
          invoice.refundRequests.some((refund) =>
            activeRefundStatuses.includes(refund.status as (typeof activeRefundStatuses)[number]),
          )
        ) {
          throw new AppError(
            "REFUND_REQUEST_ALREADY_ACTIVE",
            "This invoice already has an active refund request.",
            HttpStatus.CONFLICT,
          );
        }
        const committed = invoice.refundRequests
          .filter((refund) =>
            committedRefundStatuses.includes(
              refund.status as (typeof committedRefundStatuses)[number],
            ),
          )
          .reduce((total, refund) => total + (refund.approvedAmount ?? refund.requestedAmount), 0);
        const remaining = Math.max(0, invoice.amountPaid - committed);
        const requestedAmount = input.amount ?? remaining;
        if (requestedAmount <= 0 || requestedAmount > remaining) {
          throw new AppError(
            "REFUND_AMOUNT_EXCEEDS_AVAILABLE",
            "The requested amount is greater than the remaining refundable amount.",
            HttpStatus.UNPROCESSABLE_ENTITY,
            { remainingRefundableAmount: remaining, currency: invoice.currency },
          );
        }
        const created = await transaction.billingRefundRequest.create({
          data: {
            organizationId,
            billingInvoiceId,
            requestedByUserId: userId,
            reason: refundReasonToDb(input.reason),
            explanation: input.explanation?.trim() || null,
            requestedAmount,
            currency: invoice.currency,
            idempotencyKey,
            requestFingerprint: fingerprint,
            executionIdempotencyKey: `waflo:refund:${organizationId}:${idempotencyKey}:v1`,
          },
        });
        const recipient =
          invoice.organization.billingProfile?.billingEmail ??
          invoice.organization.members[0]?.user.email;
        if (recipient) {
          await this.queueBillingEmail(transaction, {
            organizationId,
            billingInvoiceId,
            kind: "REFUND_REQUEST_RECEIVED",
            dedupeKey: `refund-requested:${created.id}`,
            recipientEmail: recipient,
            locale: invoice.organization.defaultLocale,
            payload: {
              organizationName:
                invoice.organization.billingProfile?.billingName ?? invoice.organization.name,
              invoiceNumber: invoice.invoiceNumber,
              amount: requestedAmount,
              currency: invoice.currency,
              refundStatus: "REQUESTED",
              refundReason: created.reason,
              billingUrl: this.billingUrl(invoice.organization.defaultLocale),
              timezone: invoice.organization.timezone,
            },
          });
        }
        await this.audit.recordInTransaction(
          transaction,
          {
            organizationId,
            actorUserId: userId,
            action: "billing.refund_requested",
            targetType: "billing_refund_request",
            targetId: created.publicId,
            metadata: {
              invoiceId: billingInvoiceId,
              amount: requestedAmount,
              currency: invoice.currency,
              reason: created.reason,
            },
          },
          request,
        );
        return this.refundResponse(created);
      },
    );
  }

  async reviewRefund(
    userId: string,
    organizationId: string,
    refundRequestId: string,
    input: RefundReviewInput,
    request: WafloRequest,
  ) {
    await this.requireBillingOwner(userId, organizationId);
    return withInvariantLock(
      this.prisma.client,
      `billing-refund:${refundRequestId}`,
      async (transaction) => {
        const current = await transaction.billingRefundRequest.findFirst({
          where: { publicId: refundRequestId, organizationId },
          include: {
            billingInvoice: { include: { refundRequests: true } },
            organization: {
              include: {
                billingProfile: true,
                members: {
                  where: { role: "OWNER", status: "ACTIVE" },
                  include: { user: true },
                  take: 1,
                },
              },
            },
          },
        });
        if (!current) {
          throw new AppError(
            "REFUND_REQUEST_NOT_FOUND",
            "The refund request does not belong to this organization.",
            HttpStatus.NOT_FOUND,
          );
        }
        const allowed =
          input.action === "start_review"
            ? current.status === "REQUESTED"
            : input.action === "approve"
              ? current.status === "REQUESTED" || current.status === "UNDER_REVIEW"
              : ["REQUESTED", "UNDER_REVIEW", "APPROVED"].includes(current.status);
        if (!allowed) {
          throw new AppError(
            "REFUND_STATE_TRANSITION_INVALID",
            "The refund request cannot make that transition from its current state.",
            HttpStatus.CONFLICT,
            { status: current.status, action: input.action },
          );
        }
        let status: "UNDER_REVIEW" | "APPROVED" | "REJECTED";
        let approvedAmount: number | null = current.approvedAmount;
        if (input.action === "start_review") {
          status = "UNDER_REVIEW";
        } else if (input.action === "reject") {
          status = "REJECTED";
          approvedAmount = null;
        } else {
          const committedByOthers = current.billingInvoice.refundRequests
            .filter(
              (refund) =>
                refund.id !== current.id &&
                committedRefundStatuses.includes(
                  refund.status as (typeof committedRefundStatuses)[number],
                ),
            )
            .reduce(
              (total, refund) => total + (refund.approvedAmount ?? refund.requestedAmount),
              0,
            );
          const available = Math.max(0, current.billingInvoice.amountPaid - committedByOthers);
          approvedAmount = input.approvedAmount ?? current.requestedAmount;
          if (approvedAmount <= 0 || approvedAmount > available) {
            throw new AppError(
              "REFUND_AMOUNT_EXCEEDS_AVAILABLE",
              "The approved amount is greater than the remaining refundable amount.",
              HttpStatus.UNPROCESSABLE_ENTITY,
              { remainingRefundableAmount: available, currency: current.currency },
            );
          }
          status = "APPROVED";
        }
        const now = new Date();
        const updated = await transaction.billingRefundRequest.update({
          where: { id: current.id },
          data: {
            status,
            approvedAmount,
            reviewedByUserId: userId,
            reviewedAt: now,
            reviewNote: input.note?.trim() || null,
            failureCode: null,
          },
        });
        const recipient =
          current.organization.billingProfile?.billingEmail ??
          current.organization.members[0]?.user.email;
        if (recipient && (status === "APPROVED" || status === "REJECTED")) {
          await this.queueBillingEmail(transaction, {
            organizationId,
            billingInvoiceId: current.billingInvoiceId,
            kind: status === "APPROVED" ? "REFUND_APPROVED" : "REFUND_REJECTED",
            dedupeKey: `refund-${status.toLocaleLowerCase("en-US")}:${current.id}`,
            recipientEmail: recipient,
            locale: current.organization.defaultLocale,
            payload: {
              organizationName:
                current.organization.billingProfile?.billingName ?? current.organization.name,
              invoiceNumber: current.billingInvoice.invoiceNumber,
              amount: approvedAmount ?? current.requestedAmount,
              currency: current.currency,
              refundStatus: status,
              refundReason: current.reason,
              billingUrl: this.billingUrl(current.organization.defaultLocale),
              timezone: current.organization.timezone,
            },
          });
        }
        await this.audit.recordInTransaction(
          transaction,
          {
            organizationId,
            actorUserId: userId,
            action: `billing.refund_${status.toLocaleLowerCase("en-US")}`,
            targetType: "billing_refund_request",
            targetId: current.publicId,
            metadata: {
              previousStatus: current.status,
              status,
              amount: approvedAmount ?? current.requestedAmount,
              currency: current.currency,
            },
          },
          request,
        );
        return this.refundResponse(updated);
      },
    );
  }

  async executeRefund(
    userId: string,
    organizationId: string,
    refundRequestId: string,
    request: WafloRequest,
  ) {
    await this.requireBillingOwner(userId, organizationId);
    this.requireStripe();
    const now = new Date();
    const leaseOwner = `${request.requestId}:${randomUUID()}`.slice(0, 120);
    const leaseExpiresAt = new Date(now.getTime() + REFUND_EXECUTION_LEASE_MS);
    const claimed = await this.prisma.client.billingRefundRequest.updateMany({
      where: {
        publicId: refundRequestId,
        organizationId,
        OR: [
          { status: "APPROVED" },
          {
            status: "PROCESSING",
            executionLeaseExpiresAt: { lte: now },
          },
        ],
      },
      data: {
        status: "PROCESSING",
        processingAt: now,
        executionLeaseOwner: leaseOwner,
        executionLeaseExpiresAt: leaseExpiresAt,
        executionAttemptCount: { increment: 1 },
        failureCode: null,
      },
    });
    if (claimed.count !== 1) {
      const current = await this.prisma.client.billingRefundRequest.findFirst({
        where: { publicId: refundRequestId, organizationId },
      });
      if (!current) {
        throw new AppError(
          "REFUND_REQUEST_NOT_FOUND",
          "The refund request does not belong to this organization.",
          HttpStatus.NOT_FOUND,
        );
      }
      if (current.status === "SUCCEEDED" || current.status === "FAILED") {
        return this.refundResponse(current);
      }
      throw new AppError(
        "REFUND_EXECUTION_IN_PROGRESS",
        "This refund is already being processed.",
        HttpStatus.CONFLICT,
      );
    }

    const refundRequest = await this.prisma.client.billingRefundRequest.findFirstOrThrow({
      where: {
        publicId: refundRequestId,
        organizationId,
        executionLeaseOwner: leaseOwner,
        executionLeaseExpiresAt: leaseExpiresAt,
      },
      include: {
        billingInvoice: true,
        organization: {
          include: {
            billingProfile: true,
            members: {
              where: { role: "OWNER", status: "ACTIVE" },
              include: { user: true },
              take: 1,
            },
          },
        },
      },
    });
    try {
      const invoice = await this.retrieveCurrentInvoice(
        refundRequest.billingInvoice.stripeInvoiceId,
      );
      const customerId =
        typeof invoice.customer === "string"
          ? invoice.customer
          : invoice.customer && !invoice.customer.deleted
            ? invoice.customer.id
            : null;
      if (
        !customerId ||
        customerId !== refundRequest.organization.billingProfile?.stripeCustomerId ||
        invoice.id !== refundRequest.billingInvoice.stripeInvoiceId
      ) {
        throw new AppError(
          "REFUND_STRIPE_OWNERSHIP_MISMATCH",
          "The Stripe payment does not belong to this organization.",
          HttpStatus.CONFLICT,
        );
      }
      if (invoice.status !== "paid" || invoice.amount_paid <= 0) {
        throw new AppError(
          "REFUND_INVOICE_NOT_ELIGIBLE",
          "The authoritative Stripe invoice is not paid.",
          HttpStatus.CONFLICT,
        );
      }
      const paymentIntentId = this.invoicePaymentIntentId(invoice);
      if (!paymentIntentId) {
        throw new AppError(
          "REFUND_PAYMENT_SOURCE_UNAVAILABLE",
          "The original Stripe payment could not be resolved safely.",
          HttpStatus.CONFLICT,
        );
      }
      const listRefunds = this.subscriptionProvider.listRefunds;
      const createRefund = this.subscriptionProvider.createRefund;
      if (!listRefunds || !createRefund) {
        throw new AppError(
          "REFUND_PROVIDER_UNAVAILABLE",
          "Stripe refund processing is unavailable.",
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      const providerRefunds = await listRefunds(paymentIntentId);
      const existingProviderRefund = providerRefunds.find(
        (refund) =>
          refund.id === refundRequest.stripeRefundId ||
          refund.metadata?.wafloRefundRequestId === refundRequest.publicId,
      );
      const otherCommittedAmount = providerRefunds
        .filter(
          (refund) =>
            refund.id !== existingProviderRefund?.id &&
            refund.status !== "failed" &&
            refund.status !== "canceled",
        )
        .reduce((total, refund) => total + refund.amount, 0);
      const amount = refundRequest.approvedAmount ?? refundRequest.requestedAmount;
      const providerRemaining = Math.max(0, invoice.amount_paid - otherCommittedAmount);
      if (amount > providerRemaining) {
        throw new AppError(
          "REFUND_AMOUNT_EXCEEDS_AVAILABLE",
          "The approved amount is greater than Stripe's remaining refundable amount.",
          HttpStatus.CONFLICT,
          {
            remainingRefundableAmount: providerRemaining,
            currency: invoice.currency.toUpperCase(),
          },
        );
      }
      const providerRefund =
        existingProviderRefund ??
        (await createRefund(
          {
            payment_intent: paymentIntentId,
            amount,
            reason: refundReasonForStripe(refundRequest.reason),
            metadata: {
              wafloOrganizationId: organizationId,
              wafloBillingInvoiceId: refundRequest.billingInvoiceId,
              wafloRefundRequestId: refundRequest.publicId,
            },
          },
          refundRequest.executionIdempotencyKey,
        ));
      const status = refundStatusFromStripe(providerRefund.status);
      const completedAt = status === "SUCCEEDED" || status === "FAILED" ? new Date() : null;
      const updated = await this.prisma.client.$transaction(async (transaction) => {
        const update = await transaction.billingRefundRequest.updateMany({
          where: {
            id: refundRequest.id,
            status: "PROCESSING",
            executionLeaseOwner: leaseOwner,
            executionLeaseExpiresAt: leaseExpiresAt,
          },
          data: {
            status,
            stripeRefundId: providerRefund.id,
            stripePaymentIntentId: paymentIntentId,
            providerStatus: providerRefund.status,
            failureCode: status === "FAILED" ? "PROVIDER_REFUND_FAILED" : null,
            completedAt,
            executionLeaseOwner: null,
            executionLeaseExpiresAt: null,
          },
        });
        if (update.count !== 1) {
          throw new AppError(
            "REFUND_EXECUTION_LEASE_LOST",
            "This refund attempt no longer owns the execution lease.",
            HttpStatus.CONFLICT,
          );
        }
        const current = await transaction.billingRefundRequest.findUniqueOrThrow({
          where: { id: refundRequest.id },
        });
        const recipient =
          refundRequest.organization.billingProfile?.billingEmail ??
          refundRequest.organization.members[0]?.user.email;
        if (recipient && (status === "SUCCEEDED" || status === "FAILED")) {
          await this.queueRefundResultEmail(transaction, {
            refund: current,
            invoice: refundRequest.billingInvoice,
            organization: refundRequest.organization,
            recipient,
            status,
          });
        }
        await this.audit.recordInTransaction(
          transaction,
          {
            organizationId,
            actorUserId: userId,
            action: `billing.refund_${status.toLocaleLowerCase("en-US")}`,
            targetType: "billing_refund_request",
            targetId: refundRequest.publicId,
            metadata: {
              amount,
              currency: refundRequest.currency,
              providerStatus: providerRefund.status,
            },
          },
          request,
        );
        return current;
      });
      return this.refundResponse(updated);
    } catch (error) {
      await this.prisma.client.billingRefundRequest.updateMany({
        where: {
          id: refundRequest.id,
          status: "PROCESSING",
          executionLeaseOwner: leaseOwner,
          executionLeaseExpiresAt: leaseExpiresAt,
        },
        data: {
          executionLeaseExpiresAt: new Date(Date.now() + 30_000),
          failureCode: "PROVIDER_RESULT_UNCONFIRMED",
        },
      });
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Webhook processing – event ordering with current-state retrieval
  // ---------------------------------------------------------------------------

  async processWebhook(
    payload: Buffer,
    signature: string | undefined,
    request: WafloRequest,
  ): Promise<{ received: true; duplicate: boolean }> {
    const stripe = this.requireStripe();
    const secret = this.environment.values.STRIPE_WEBHOOK_SECRET;
    if (!secret || !signature) {
      await this.audit.security(
        { eventType: "stripe.webhook_verification_failed", severity: "HIGH" },
        request,
      );
      throw new AppError(
        "STRIPE_SIGNATURE_INVALID",
        "Webhook signature verification failed.",
        HttpStatus.BAD_REQUEST,
      );
    }
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(payload, signature, secret);
    } catch {
      await this.audit.security(
        { eventType: "stripe.webhook_verification_failed", severity: "HIGH" },
        request,
      );
      throw new AppError(
        "STRIPE_SIGNATURE_INVALID",
        "Webhook signature verification failed.",
        HttpStatus.BAD_REQUEST,
      );
    }
    const claim = await this.claimWebhook(event);
    if (!claim) return { received: true, duplicate: true };

    try {
      // Retrieve the provider's current snapshot before opening the database
      // transaction. The lease is revalidated inside the subscription lock
      // before any local business state can be committed.
      const subscriptionId = this.subscriptionIdFromEvent(event);
      const invoiceId = this.invoiceIdFromEvent(event);
      const refundId = this.refundIdFromEvent(event);
      const currentSubscription = subscriptionId
        ? await this.retrieveCurrentSubscription(subscriptionId)
        : undefined;
      const currentInvoice = invoiceId ? await this.retrieveCurrentInvoice(invoiceId) : undefined;
      const currentRefund = refundId ? await this.retrieveCurrentRefund(refundId) : undefined;
      const customerChangeId = this.customerIdFromPaymentMethodEvent(event);
      const businessLockKey = refundId
        ? `stripe-refund:${refundId}`
        : invoiceId
          ? `stripe-invoice:${invoiceId}`
          : subscriptionId
            ? `stripe-subscription:${subscriptionId}`
            : customerChangeId
              ? `stripe-customer:${customerChangeId}`
              : `stripe-event:${event.id}`;
      await withInvariantLock(this.prisma.client, businessLockKey, async (transaction) => {
        const ownership = await transaction.processedWebhookEvent.findUniqueOrThrow({
          where: { id: claim.id },
        });
        if (
          ownership.status !== "PROCESSING" ||
          ownership.leaseExpiresAt?.getTime() !== claim.leaseExpiresAt.getTime()
        ) {
          throw new AppError(
            "STRIPE_WEBHOOK_LEASE_LOST",
            "This webhook attempt no longer owns the processing lease.",
            HttpStatus.CONFLICT,
          );
        }
        const result = await this.applyStripeEvent(
          event,
          transaction,
          request,
          currentSubscription,
          currentInvoice,
          currentRefund,
        );
        const statusValue = result.staleness === "ignored_stale" ? "IGNORED_STALE" : "PROCESSED";
        const completed = await transaction.processedWebhookEvent.updateMany({
          where: {
            id: claim.id,
            status: "PROCESSING",
            leaseExpiresAt: claim.leaseExpiresAt,
          },
          data: {
            organizationId: result.organizationId,
            status: statusValue,
            processedAt: new Date(),
            leaseExpiresAt: null,
            failureMetadata: Prisma.DbNull,
          },
        });
        if (completed.count !== 1) {
          throw new AppError(
            "STRIPE_WEBHOOK_LEASE_LOST",
            "This webhook attempt no longer owns the processing lease.",
            HttpStatus.CONFLICT,
          );
        }
        return result;
      });
      return { received: true, duplicate: false };
    } catch (error) {
      await this.prisma.client.processedWebhookEvent.updateMany({
        where: {
          id: claim.id,
          status: "PROCESSING",
          leaseExpiresAt: claim.leaseExpiresAt,
        },
        data: {
          status: "FAILED",
          leaseExpiresAt: null,
          failureMetadata: {
            name: error instanceof Error ? error.name : "UnknownError",
            retryable: true,
          },
        },
      });
      await this.audit.record(
        {
          action: "stripe.webhook_failed",
          targetType: "stripe_event",
          targetId: event.id,
          metadata: { eventType: event.type },
        },
        request,
      );
      throw error;
    }
  }

  private async claimWebhook(
    event: Stripe.Event,
  ): Promise<{ id: string; leaseExpiresAt: Date } | null> {
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + WEBHOOK_LEASE_MS);
    try {
      const created = await this.prisma.client.processedWebhookEvent.create({
        data: {
          provider: "stripe",
          externalEventId: event.id,
          eventType: event.type,
          status: "PROCESSING",
          leaseExpiresAt,
        },
      });
      return { id: created.id, leaseExpiresAt };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
        throw error;
      }
    }
    const existing = await this.prisma.client.processedWebhookEvent.findUniqueOrThrow({
      where: {
        provider_externalEventId: { provider: "stripe", externalEventId: event.id },
      },
    });
    if (
      existing.status === "PROCESSED" ||
      existing.status === "IGNORED_STALE" ||
      (existing.status === "PROCESSING" &&
        existing.leaseExpiresAt !== null &&
        existing.leaseExpiresAt > now)
    ) {
      return null;
    }
    const claimed = await this.prisma.client.processedWebhookEvent.updateMany({
      where: {
        id: existing.id,
        OR: [
          { status: "FAILED" },
          { status: "PROCESSING", leaseExpiresAt: { lte: now } },
          { status: "PROCESSING", leaseExpiresAt: null },
        ],
      },
      data: {
        status: "PROCESSING",
        eventType: event.type,
        attemptCount: { increment: 1 },
        leaseExpiresAt,
        processedAt: null,
        failureMetadata: Prisma.DbNull,
      },
    });
    return claimed.count === 1 ? { id: existing.id, leaseExpiresAt } : null;
  }

  private subscriptionIdFromEvent(event: Stripe.Event): string | null {
    if (
      event.type !== "customer.subscription.created" &&
      event.type !== "customer.subscription.updated" &&
      event.type !== "customer.subscription.deleted"
    ) {
      return null;
    }
    const id = (event.data.object as { id?: unknown }).id;
    return typeof id === "string" && id.length > 0 ? id : null;
  }

  private invoiceIdFromEvent(event: Stripe.Event): string | null {
    if (
      event.type !== "invoice.created" &&
      event.type !== "invoice.finalized" &&
      event.type !== "invoice.paid" &&
      event.type !== "invoice.payment_failed" &&
      event.type !== "invoice.payment_action_required" &&
      event.type !== "invoice.updated"
    ) {
      return null;
    }
    const id = (event.data.object as { id?: unknown }).id;
    return typeof id === "string" && id.length > 0 ? id : null;
  }

  private refundIdFromEvent(event: Stripe.Event): string | null {
    if (
      event.type !== "refund.created" &&
      event.type !== "refund.updated" &&
      event.type !== "refund.failed"
    ) {
      return null;
    }
    const id = (event.data.object as { id?: unknown }).id;
    return typeof id === "string" && id.length > 0 ? id : null;
  }

  private customerIdFromPaymentMethodEvent(event: Stripe.Event): string | null {
    if (event.type === "customer.updated") {
      const previous = event.data.previous_attributes;
      if (!previous || (!("invoice_settings" in previous) && !("default_source" in previous))) {
        return null;
      }
      const id = (event.data.object as { id?: unknown }).id;
      return typeof id === "string" ? id : null;
    }
    return null;
  }

  private async retrieveCurrentSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    try {
      return await this.subscriptionProvider.retrieveSubscription(subscriptionId);
    } catch {
      throw new AppError(
        "STRIPE_PROVIDER_RETRIEVAL_FAILED",
        "Failed to retrieve current subscription state from Stripe. Will retry.",
        HttpStatus.SERVICE_UNAVAILABLE,
        { subscriptionId },
      );
    }
  }

  private async retrieveCurrentInvoice(invoiceId: string): Promise<Stripe.Invoice> {
    try {
      if (this.subscriptionProvider.retrieveInvoice) {
        return await this.subscriptionProvider.retrieveInvoice(invoiceId);
      }
      return await this.requireStripe().invoices.retrieve(invoiceId, {
        expand: [
          "default_payment_method",
          "parent.subscription_details.subscription",
          "payments.data.payment.payment_intent.payment_method",
        ],
      });
    } catch {
      throw new AppError(
        "STRIPE_PROVIDER_RETRIEVAL_FAILED",
        "Failed to retrieve current invoice state from Stripe. Will retry.",
        HttpStatus.SERVICE_UNAVAILABLE,
        { invoiceId },
      );
    }
  }

  private async retrieveCurrentRefund(refundId: string): Promise<Stripe.Refund> {
    try {
      if (this.subscriptionProvider.retrieveRefund) {
        return await this.subscriptionProvider.retrieveRefund(refundId);
      }
      return await this.requireStripe().refunds.retrieve(refundId);
    } catch {
      throw new AppError(
        "STRIPE_REFUND_RETRIEVAL_FAILED",
        "Failed to retrieve current refund state from Stripe. Will retry.",
        HttpStatus.SERVICE_UNAVAILABLE,
        { refundId },
      );
    }
  }

  // ---------------------------------------------------------------------------
  // applyStripeEvent – event ordering via current-state retrieval
  // ---------------------------------------------------------------------------

  private async applyStripeEvent(
    event: Stripe.Event,
    transaction: Prisma.TransactionClient,
    request: WafloRequest,
    currentSubscription?: Stripe.Subscription,
    currentInvoice?: Stripe.Invoice,
    currentRefund?: Stripe.Refund,
  ): Promise<{
    organizationId: string | null;
    staleness: "applied" | "ignored_stale";
    notification: {
      organizationName: string;
      recipients: Array<{ email: string; locale: "en" | "ar" }>;
    } | null;
  }> {
    if (currentRefund) {
      return this.applyStripeRefundEvent(event, transaction, request, currentRefund);
    }
    if (currentInvoice) {
      return this.applyStripeInvoiceEvent(event, transaction, request, currentInvoice);
    }
    const changedCustomerId = this.customerIdFromPaymentMethodEvent(event);
    if (changedCustomerId) {
      return this.applyStripePaymentMethodChange(transaction, request, changedCustomerId);
    }
    if (event.type === "invoice.upcoming") {
      await transaction.auditLog.create({
        data: {
          action: "stripe.invoice_upcoming_observed",
          targetType: "stripe_event",
          targetId: event.id,
          requestId: request.requestId,
          metadata: {
            eventType: event.type,
            reminderOwner: "WAFLO_SCHEDULED_LOCAL_CALENDAR_DATE",
          },
          userAgent: request.headers["user-agent"]?.slice(0, 512) ?? null,
        },
      });
      return { organizationId: null, staleness: "applied", notification: null };
    }
    if (
      event.type !== "customer.subscription.created" &&
      event.type !== "customer.subscription.updated" &&
      event.type !== "customer.subscription.deleted"
    ) {
      await transaction.auditLog.create({
        data: {
          action: "stripe.webhook_ignored",
          targetType: "stripe_event",
          targetId: event.id,
          requestId: request.requestId,
          metadata: { eventType: event.type },
          userAgent: request.headers["user-agent"]?.slice(0, 512) ?? null,
        },
      });
      return { organizationId: null, staleness: "applied", notification: null };
    }

    const subscriptionId = this.subscriptionIdFromEvent(event);
    if (!subscriptionId || !currentSubscription) {
      throw new AppError(
        "STRIPE_SUBSCRIPTION_ID_MISSING",
        "The Stripe subscription ID is missing.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    // Step 3: Resolve organization / customer / price from CURRENT object.
    const customerId =
      typeof currentSubscription.customer === "string"
        ? currentSubscription.customer
        : currentSubscription.customer.id;
    const metadataOrganizationId = currentSubscription.metadata.organizationId;
    const [customerProfile, metadataProfile] = await Promise.all([
      transaction.organizationBillingProfile.findUnique({
        where: { stripeCustomerId: customerId },
      }),
      metadataOrganizationId
        ? transaction.organizationBillingProfile.findUnique({
            where: { organizationId: metadataOrganizationId },
          })
        : Promise.resolve(null),
    ]);
    if (
      customerProfile &&
      metadataProfile &&
      customerProfile.organizationId !== metadataProfile.organizationId
    ) {
      throw new AppError(
        "STRIPE_CUSTOMER_ORGANIZATION_MISMATCH",
        "Stripe customer and organization metadata do not match.",
        HttpStatus.CONFLICT,
      );
    }
    const profile = customerProfile ?? metadataProfile;
    if (!profile) {
      throw new AppError(
        "STRIPE_ORGANIZATION_NOT_FOUND",
        "The Stripe event could not be matched to an organization.",
      );
    }
    if (
      (metadataOrganizationId && metadataOrganizationId !== profile.organizationId) ||
      (profile.stripeCustomerId && profile.stripeCustomerId !== customerId)
    ) {
      throw new AppError(
        "STRIPE_CUSTOMER_ORGANIZATION_MISMATCH",
        "Stripe customer and organization metadata do not match.",
        HttpStatus.CONFLICT,
      );
    }

    const item = currentSubscription.items.data[0];
    const priceId = item?.price.id;
    if (!priceId) {
      throw new AppError(
        "STRIPE_PRICE_UNKNOWN",
        "The Stripe subscription has no supported price.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const { plan, cadence } = this.planForPrice(priceId);
    const metadataPlan = currentSubscription.metadata.plan;
    const metadataCadence = currentSubscription.metadata.cadence;
    if (
      metadataPlan !== undefined &&
      metadataPlan !== "starter" &&
      metadataPlan !== "growth" &&
      metadataPlan !== "scale"
    ) {
      throw new AppError(
        "STRIPE_PLAN_INVALID",
        "Stripe plan metadata is invalid.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (metadataPlan && metadataPlan !== plan) {
      throw new AppError(
        "STRIPE_PLAN_PRICE_MISMATCH",
        "Stripe plan metadata does not match its configured price.",
        HttpStatus.CONFLICT,
      );
    }
    if (
      metadataCadence !== undefined &&
      metadataCadence !== "monthly" &&
      metadataCadence !== "quarterly" &&
      metadataCadence !== "yearly"
    ) {
      throw new AppError(
        "STRIPE_CADENCE_INVALID",
        "Stripe cadence metadata is invalid.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (metadataCadence && metadataCadence !== cadence) {
      throw new AppError(
        "STRIPE_CADENCE_PRICE_MISMATCH",
        "Stripe cadence metadata does not match its configured price.",
        HttpStatus.CONFLICT,
      );
    }

    // Step 4: Check freshness while holding the subscription invariant lock.
    // Same-second events have equal authority; only strictly older timestamps
    // are stale. A different event ID remains independently claimable.
    const eventCreatedAt = new Date(event.created * 1000);

    const existingSubscription = await transaction.subscription.findUnique({
      where: { stripeSubscriptionId: subscriptionId },
    });

    if (
      existingSubscription?.lastAppliedStripeEventAt &&
      eventCreatedAt < existingSubscription.lastAppliedStripeEventAt
    ) {
      // This event is strictly older than the last applied event.
      await transaction.auditLog.create({
        data: {
          organizationId: profile.organizationId,
          action: "stripe.subscription_stale_ignored",
          targetType: "stripe_event",
          targetId: event.id,
          requestId: request.requestId,
          metadata: {
            eventId: event.id,
            eventType: event.type,
            eventCreatedAt: eventCreatedAt.toISOString(),
            lastAppliedStripeEventAt: existingSubscription.lastAppliedStripeEventAt.toISOString(),
            lastAppliedStripeEventId: existingSubscription.lastAppliedStripeEventId,
            subscriptionId,
          },
          userAgent: request.headers["user-agent"]?.slice(0, 512) ?? null,
        },
      });
      return {
        organizationId: profile.organizationId,
        staleness: "ignored_stale",
        notification: null,
      };
    }

    // Step 5: Apply state from the CURRENT Stripe object.
    const providerStatus = billingStatusFromStripe(currentSubscription.status);
    const localStatus: BillingStatus =
      providerStatus === "past_due" &&
      profile.subscriptionStatus === "GRACE_PERIOD" &&
      profile.gracePeriodEnd !== null &&
      profile.gracePeriodEnd > new Date()
        ? "grace_period"
        : providerStatus;
    const currentPeriodStart = item.current_period_start
      ? new Date(item.current_period_start * 1000)
      : null;
    const currentPeriodEnd = item.current_period_end
      ? new Date(item.current_period_end * 1000)
      : null;
    const nowTs = new Date();

    const organization = await transaction.organization.findUniqueOrThrow({
      where: { id: profile.organizationId },
      include: {
        members: {
          where: { role: "OWNER", status: "ACTIVE" },
          include: { user: true },
        },
      },
    });
    const previousPlan = organization.selectedPlan;
    const previousStatus = profile.subscriptionStatus;
    const previousPlanCode = dbToPlan(previousPlan);
    if (planRank[plan] < planRank[previousPlanCode]) {
      const violations = await this.downgradeViolations(transaction, profile.organizationId, plan);
      if (violations.length) {
        throw new AppError(
          "PLAN_DOWNGRADE_BLOCKED_FROM_PROVIDER",
          "Stripe requested a lower plan before the organization met its limits.",
          HttpStatus.CONFLICT,
          { requestedPlan: plan, violations },
        );
      }
    }

    await transaction.subscription.upsert({
      where: { stripeSubscriptionId: subscriptionId },
      update: {
        stripePriceId: priceId,
        planCode: planToDb(plan),
        cadence: cadenceToDb(cadence),
        status: statusToDb(localStatus),
        currentPeriodStart,
        currentPeriodEnd,
        cancelAtPeriodEnd: currentSubscription.cancel_at_period_end,
        canceledAt: currentSubscription.canceled_at
          ? new Date(currentSubscription.canceled_at * 1000)
          : null,
        lastAppliedStripeEventAt: eventCreatedAt,
        lastAppliedStripeEventId: event.id,
        lastProviderSyncAt: nowTs,
        reconciliationLeaseOwner: null,
        reconciliationLeaseExpiresAt: null,
        reconciliationFailureCode: null,
      },
      create: {
        organizationId: profile.organizationId,
        stripeSubscriptionId: subscriptionId,
        stripePriceId: priceId,
        planCode: planToDb(plan),
        cadence: cadenceToDb(cadence),
        status: statusToDb(localStatus),
        currentPeriodStart,
        currentPeriodEnd,
        cancelAtPeriodEnd: currentSubscription.cancel_at_period_end,
        canceledAt: currentSubscription.canceled_at
          ? new Date(currentSubscription.canceled_at * 1000)
          : null,
        lastAppliedStripeEventAt: eventCreatedAt,
        lastAppliedStripeEventId: event.id,
        lastProviderSyncAt: nowTs,
      },
    });

    await transaction.organizationBillingProfile.update({
      where: { organizationId: profile.organizationId },
      data: {
        ...(profile.stripeCustomerId ? {} : { stripeCustomerId: customerId }),
        subscriptionStatus: statusToDb(localStatus),
        selectedPlan: planToDb(plan),
        selectedCadence: cadenceToDb(cadence),
        trialStart: currentSubscription.trial_start
          ? new Date(currentSubscription.trial_start * 1000)
          : null,
        trialEnd: currentSubscription.trial_end
          ? new Date(currentSubscription.trial_end * 1000)
          : null,
      },
    });
    await transaction.organization.update({
      where: { id: profile.organizationId },
      data: { selectedPlan: planToDb(plan) },
    });

    const [locationUsage, activeSeatUsage, pendingSeatUsage, programUsage] = await Promise.all([
      transaction.location.count({
        where: { organizationId: profile.organizationId, status: "ACTIVE" },
      }),
      transaction.organizationMember.count({
        where: {
          organizationId: profile.organizationId,
          status: "ACTIVE",
          role: { in: ["MANAGER", "STAFF"] },
        },
      }),
      transaction.organizationInvitation.count({
        where: {
          organizationId: profile.organizationId,
          status: "PENDING",
          expiresAt: { gt: nowTs },
          intendedRole: { in: ["MANAGER", "STAFF"] },
        },
      }),
      transaction.loyaltyProgram.count({
        where: {
          organizationId: profile.organizationId,
          status: { not: "ARCHIVED" },
        },
      }),
    ]);
    const locationLimit =
      plan === "scale"
        ? (this.environment.values.SCALE_LOCATION_LIMIT ?? null)
        : planCatalog[plan].limits.locations;
    const teamSeatLimit =
      plan === "scale"
        ? (this.environment.values.SCALE_TEAM_LIMIT ?? null)
        : planCatalog[plan].limits.teamSeats;
    const teamSeatUsage = activeSeatUsage + pendingSeatUsage;
    const programLimit = planCatalog[plan].limits.programs;
    const overLimit =
      (locationLimit !== null && locationUsage > locationLimit) ||
      (teamSeatLimit !== null && teamSeatUsage > teamSeatLimit) ||
      (programLimit !== null && programUsage > programLimit);

    await transaction.auditLog.create({
      data: {
        organizationId: profile.organizationId,
        action: "stripe.subscription_applied",
        targetType: "subscription",
        targetId: subscriptionId,
        requestId: request.requestId,
        metadata: {
          eventId: event.id,
          eventType: event.type,
          previousPlan,
          selectedPlan: planToDb(plan),
          selectedCadence: cadenceToDb(cadence),
          previousStatus,
          subscriptionStatus: statusToDb(localStatus),
          overLimit,
          locationUsage,
          locationLimit,
          teamSeatUsage,
          teamSeatLimit,
          programUsage,
          programLimit,
          overLimitPolicy: overLimit
            ? "preserve_resources_and_block_new_capacity"
            : "within_entitlements",
        },
        userAgent: request.headers["user-agent"]?.slice(0, 512) ?? null,
      },
    });

    return {
      organizationId: profile.organizationId,
      staleness: "applied",
      // Financial emails are owned by the durable BillingEmailOutbox. Do not
      // synchronously emit a second generic status email from the webhook path.
      notification: null,
    };
  }

  private async applyStripeInvoiceEvent(
    event: Stripe.Event,
    transaction: Prisma.TransactionClient,
    request: WafloRequest,
    invoice: Stripe.Invoice,
  ): Promise<{
    organizationId: string | null;
    staleness: "applied" | "ignored_stale";
    notification: null;
  }> {
    const customerId =
      typeof invoice.customer === "string"
        ? invoice.customer
        : invoice.customer && !invoice.customer.deleted
          ? invoice.customer.id
          : null;
    const subscription = invoice.parent?.subscription_details?.subscription;
    const subscriptionId =
      typeof subscription === "string" ? subscription : (subscription?.id ?? null);
    const metadataOrganizationId =
      invoice.metadata?.wafloOrganizationId ??
      invoice.metadata?.organizationId ??
      invoice.parent?.subscription_details?.metadata?.wafloOrganizationId ??
      invoice.parent?.subscription_details?.metadata?.organizationId ??
      null;
    const [customerProfile, metadataProfile] = await Promise.all([
      customerId
        ? transaction.organizationBillingProfile.findUnique({
            where: { stripeCustomerId: customerId },
          })
        : Promise.resolve(null),
      metadataOrganizationId
        ? transaction.organizationBillingProfile.findUnique({
            where: { organizationId: metadataOrganizationId },
          })
        : Promise.resolve(null),
    ]);
    if (
      customerProfile &&
      metadataProfile &&
      customerProfile.organizationId !== metadataProfile.organizationId
    ) {
      throw new AppError(
        "STRIPE_CUSTOMER_ORGANIZATION_MISMATCH",
        "Stripe customer and organization metadata do not match.",
        HttpStatus.CONFLICT,
      );
    }
    const profile = customerProfile ?? metadataProfile;
    if (!profile || (profile.stripeCustomerId && profile.stripeCustomerId !== customerId)) {
      throw new AppError(
        "STRIPE_ORGANIZATION_NOT_FOUND",
        "The Stripe invoice could not be matched to an organization.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const organization = await transaction.organization.findUniqueOrThrow({
      where: { id: profile.organizationId },
      include: {
        members: {
          where: { role: "OWNER", status: "ACTIVE" },
          include: { user: true },
          orderBy: { createdAt: "asc" },
          take: 1,
        },
      },
    });
    const existing = await transaction.billingInvoice.findUnique({
      where: { stripeInvoiceId: invoice.id },
    });
    const eventCreatedAt = new Date(event.created * 1000);
    if (existing?.lastStripeEventAt && eventCreatedAt < existing.lastStripeEventAt) {
      return {
        organizationId: profile.organizationId,
        staleness: "ignored_stale",
        notification: null,
      };
    }
    const paymentMethod = this.invoicePaymentMethod(invoice);
    const invoiceDate = new Date((invoice.effective_at ?? invoice.created) * 1000);
    const eventIsFailure =
      event.type === "invoice.payment_failed" || event.type === "invoice.payment_action_required";
    const isRecurringRenewal = invoice.billing_reason === "subscription_cycle";
    const firstFailedAt =
      eventIsFailure && isRecurringRenewal
        ? (existing?.firstFailedAt ?? eventCreatedAt)
        : (existing?.firstFailedAt ?? null);
    const failure = eventIsFailure ? billingFailurePolicy(this.invoiceFailureCode(invoice)) : null;
    const graceEndsAt = firstFailedAt
      ? (existing?.graceEndsAt ?? billingGraceDeadline(firstFailedAt))
      : null;
    const recoverySchedule = firstFailedAt ? billingRecoverySchedule(firstFailedAt) : [];
    const isPaid = invoice.status === "paid" || event.type === "invoice.paid";
    const data = {
      organizationId: profile.organizationId,
      stripeSubscriptionId: subscriptionId,
      stripePaymentMethodId: paymentMethod?.id ?? existing?.stripePaymentMethodId ?? null,
      invoiceNumber: invoice.number,
      status: invoice.status ?? "open",
      billingReason: invoice.billing_reason,
      amountDue: invoice.amount_due,
      amountPaid: invoice.amount_paid,
      amountRemaining: invoice.amount_remaining,
      currency: invoice.currency.toUpperCase(),
      invoiceDate,
      periodStart: invoice.period_start ? new Date(invoice.period_start * 1000) : null,
      periodEnd: invoice.period_end ? new Date(invoice.period_end * 1000) : null,
      nextPaymentAttemptAt: invoice.next_payment_attempt
        ? new Date(invoice.next_payment_attempt * 1000)
        : null,
      hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
      invoicePdfUrl: invoice.invoice_pdf ?? null,
      customerName: invoice.customer_name ?? profile.billingName ?? organization.name,
      customerEmail:
        invoice.customer_email ??
        profile.billingEmail ??
        organization.members[0]?.user.email ??
        null,
      paymentMethodBrand: paymentMethod?.brand ?? existing?.paymentMethodBrand ?? null,
      paymentMethodLast4: paymentMethod?.last4 ?? existing?.paymentMethodLast4 ?? null,
      paymentMethodExpMonth: paymentMethod?.expMonth ?? existing?.paymentMethodExpMonth ?? null,
      paymentMethodExpYear: paymentMethod?.expYear ?? existing?.paymentMethodExpYear ?? null,
      firstFailedAt,
      graceEndsAt,
      failureCategory: failure?.category ?? existing?.failureCategory ?? null,
      recoveryStatus: isPaid
        ? ("RECOVERED" as const)
        : eventIsFailure && isRecurringRenewal
          ? failure?.automaticRetryEligible
            ? ("GRACE" as const)
            : ("ACTION_REQUIRED" as const)
          : (existing?.recoveryStatus ?? "NONE"),
      automaticRetryEligible: isPaid
        ? false
        : (failure?.automaticRetryEligible ?? existing?.automaticRetryEligible ?? false),
      nextRecoveryAttemptAt: isPaid
        ? null
        : eventIsFailure && isRecurringRenewal && failure?.automaticRetryEligible
          ? (recoverySchedule.find((date) => date > new Date()) ?? graceEndsAt)
          : (existing?.nextRecoveryAttemptAt ?? null),
      recoveryLeaseOwner: isPaid ? null : (existing?.recoveryLeaseOwner ?? null),
      recoveryLeaseExpiresAt: isPaid ? null : (existing?.recoveryLeaseExpiresAt ?? null),
      recoveryFailureCode: isPaid ? null : (existing?.recoveryFailureCode ?? null),
      paidAt: isPaid
        ? new Date((invoice.status_transitions.paid_at ?? event.created) * 1000)
        : (existing?.paidAt ?? null),
      lastStripeEventAt: eventCreatedAt,
      lastStripeEventId: event.id,
    };
    const saved = await transaction.billingInvoice.upsert({
      where: { stripeInvoiceId: invoice.id },
      update: data,
      create: { stripeInvoiceId: invoice.id, ...data },
    });
    const recipient = data.customerEmail;
    const locale = organization.defaultLocale;
    if (isPaid) {
      await transaction.organizationBillingProfile.update({
        where: { organizationId: profile.organizationId },
        data: { subscriptionStatus: "ACTIVE", gracePeriodEnd: null },
      });
      await transaction.billingEmailOutbox.updateMany({
        where: {
          billingInvoiceId: saved.id,
          status: { in: ["PENDING", "PROCESSING"] },
          kind: { in: ["PAYMENT_FAILED", "BILLING_GRACE_EXPIRED"] },
        },
        data: { status: "CANCELED", leaseOwner: null, leaseExpiresAt: null },
      });
      if (recipient) {
        await this.queueBillingEmail(transaction, {
          organizationId: profile.organizationId,
          billingInvoiceId: saved.id,
          kind: "INVOICE_PAID",
          dedupeKey: `invoice-paid:${invoice.id}`,
          recipientEmail: recipient,
          locale,
          payload: {
            organizationName: data.customerName,
            invoiceNumber: invoice.number,
            invoiceDate: invoiceDate.toISOString(),
            amount: invoice.amount_paid,
            currency: invoice.currency.toUpperCase(),
            status: "paid",
            plan: invoice.parent?.subscription_details?.metadata?.plan ?? null,
            cadence: invoice.parent?.subscription_details?.metadata?.cadence ?? null,
            paymentMethod: paymentMethod
              ? { brand: paymentMethod.brand, last4: paymentMethod.last4 }
              : null,
            hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
            invoicePdfUrl: invoice.invoice_pdf ?? null,
            timezone: organization.timezone,
          },
        });
      }
    } else if (eventIsFailure && isRecurringRenewal && firstFailedAt && graceEndsAt) {
      await transaction.organizationBillingProfile.update({
        where: { organizationId: profile.organizationId },
        data: { subscriptionStatus: "GRACE_PERIOD", gracePeriodEnd: graceEndsAt },
      });
      if (recipient) {
        await this.queueBillingEmail(transaction, {
          organizationId: profile.organizationId,
          billingInvoiceId: saved.id,
          kind: "PAYMENT_FAILED",
          dedupeKey: `invoice-failed:${invoice.id}:${firstFailedAt.toISOString()}`,
          recipientEmail: recipient,
          locale,
          payload: {
            organizationName: data.customerName,
            invoiceNumber: invoice.number,
            amount: invoice.amount_remaining || invoice.amount_due,
            currency: invoice.currency.toUpperCase(),
            failureCategory: failure?.category ?? "CUSTOMER_ACTION_REQUIRED",
            automaticRetryEligible: failure?.automaticRetryEligible ?? false,
            failedAt: firstFailedAt.toISOString(),
            graceEndsAt: graceEndsAt.toISOString(),
            paymentMethod: paymentMethod
              ? { brand: paymentMethod.brand, last4: paymentMethod.last4 }
              : null,
            billingUrl: `${this.environment.values.MERCHANT_DASHBOARD_URL}/${locale === "AR" ? "ar" : "en"}/dashboard/billing`,
            hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
            timezone: organization.timezone,
          },
        });
      }
    }
    await transaction.auditLog.create({
      data: {
        organizationId: profile.organizationId,
        action: `stripe.${event.type.replaceAll(".", "_")}`,
        targetType: "billing_invoice",
        targetId: invoice.id,
        requestId: request.requestId,
        metadata: {
          invoiceStatus: invoice.status,
          billingReason: invoice.billing_reason,
          recoveryStatus: data.recoveryStatus,
          graceEndsAt: graceEndsAt?.toISOString() ?? null,
        },
        userAgent: request.headers["user-agent"]?.slice(0, 512) ?? null,
      },
    });
    return { organizationId: profile.organizationId, staleness: "applied", notification: null };
  }

  private async applyStripeRefundEvent(
    event: Stripe.Event,
    transaction: Prisma.TransactionClient,
    request: WafloRequest,
    refund: Stripe.Refund,
  ): Promise<{
    organizationId: string | null;
    staleness: "applied" | "ignored_stale";
    notification: null;
  }> {
    const publicId = refund.metadata?.wafloRefundRequestId;
    const current = await transaction.billingRefundRequest.findFirst({
      where: {
        OR: [{ stripeRefundId: refund.id }, ...(publicId ? [{ publicId }] : [])],
      },
      include: {
        billingInvoice: true,
        organization: {
          include: {
            billingProfile: true,
            members: {
              where: { role: "OWNER", status: "ACTIVE" },
              include: { user: true },
              take: 1,
            },
          },
        },
      },
    });
    if (!current) {
      await transaction.auditLog.create({
        data: {
          action: "stripe.refund_unmatched",
          targetType: "stripe_refund",
          targetId: refund.id,
          requestId: request.requestId,
          metadata: { eventType: event.type },
          userAgent: request.headers["user-agent"]?.slice(0, 512) ?? null,
        },
      });
      return { organizationId: null, staleness: "applied", notification: null };
    }
    if (
      (refund.metadata?.wafloOrganizationId &&
        refund.metadata.wafloOrganizationId !== current.organizationId) ||
      (refund.metadata?.wafloBillingInvoiceId &&
        refund.metadata.wafloBillingInvoiceId !== current.billingInvoiceId) ||
      (publicId && publicId !== current.publicId)
    ) {
      throw new AppError(
        "REFUND_STRIPE_OWNERSHIP_MISMATCH",
        "Stripe refund metadata does not match the authoritative Waflo request.",
        HttpStatus.CONFLICT,
      );
    }
    const eventCreatedAt = new Date(event.created * 1000);
    if (
      current.lastStripeEventAt &&
      current.lastStripeEventAt > eventCreatedAt &&
      current.lastStripeEventId !== event.id
    ) {
      return {
        organizationId: current.organizationId,
        staleness: "ignored_stale",
        notification: null,
      };
    }
    const status = refundStatusFromStripe(refund.status);
    const paymentIntentId =
      typeof refund.payment_intent === "string"
        ? refund.payment_intent
        : (refund.payment_intent?.id ?? current.stripePaymentIntentId);
    const updated = await transaction.billingRefundRequest.update({
      where: { id: current.id },
      data: {
        status,
        stripeRefundId: refund.id,
        stripePaymentIntentId: paymentIntentId,
        providerStatus: refund.status,
        failureCode: status === "FAILED" ? "PROVIDER_REFUND_FAILED" : null,
        completedAt:
          status === "SUCCEEDED" || status === "FAILED"
            ? (current.completedAt ?? eventCreatedAt)
            : null,
        executionLeaseOwner: null,
        executionLeaseExpiresAt: null,
        lastStripeEventAt: eventCreatedAt,
        lastStripeEventId: event.id,
      },
    });
    const recipient =
      current.organization.billingProfile?.billingEmail ??
      current.organization.members[0]?.user.email;
    if (recipient && (status === "SUCCEEDED" || status === "FAILED")) {
      await this.queueRefundResultEmail(transaction, {
        refund: updated,
        invoice: current.billingInvoice,
        organization: current.organization,
        recipient,
        status,
      });
    }
    await transaction.auditLog.create({
      data: {
        organizationId: current.organizationId,
        action: `stripe.${event.type.replaceAll(".", "_")}`,
        targetType: "billing_refund_request",
        targetId: current.publicId,
        requestId: request.requestId,
        metadata: {
          refundStatus: status,
          providerStatus: refund.status,
          amount: refund.amount,
          currency: refund.currency.toUpperCase(),
        },
        userAgent: request.headers["user-agent"]?.slice(0, 512) ?? null,
      },
    });
    return { organizationId: current.organizationId, staleness: "applied", notification: null };
  }

  private async applyStripePaymentMethodChange(
    transaction: Prisma.TransactionClient,
    request: WafloRequest,
    customerId: string,
  ): Promise<{
    organizationId: string | null;
    staleness: "applied";
    notification: null;
  }> {
    const profile = await transaction.organizationBillingProfile.findUnique({
      where: { stripeCustomerId: customerId },
    });
    if (!profile) return { organizationId: null, staleness: "applied", notification: null };
    const updated = await transaction.billingInvoice.updateMany({
      where: {
        organizationId: profile.organizationId,
        amountRemaining: { gt: 0 },
        recoveryStatus: { in: ["GRACE", "ACTION_REQUIRED"] },
        graceEndsAt: { gt: new Date() },
      },
      data: {
        automaticRetryEligible: true,
        recoveryStatus: "GRACE",
        nextRecoveryAttemptAt: new Date(),
        recoveryFailureCode: null,
      },
    });
    await transaction.auditLog.create({
      data: {
        organizationId: profile.organizationId,
        action: "billing.payment_method_recovery_requested",
        targetType: "stripe_customer",
        targetId: customerId,
        requestId: request.requestId,
        metadata: { outstandingInvoicesWoken: updated.count, graceDeadlineReset: false },
        userAgent: request.headers["user-agent"]?.slice(0, 512) ?? null,
      },
    });
    return { organizationId: profile.organizationId, staleness: "applied", notification: null };
  }

  private invoicePaymentMethod(invoice: Stripe.Invoice): {
    id: string;
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
  } | null {
    const direct = invoice.default_payment_method;
    if (direct && typeof direct !== "string" && direct.card) {
      return {
        id: direct.id,
        brand: direct.card.brand,
        last4: direct.card.last4,
        expMonth: direct.card.exp_month,
        expYear: direct.card.exp_year,
      };
    }
    for (const payment of invoice.payments?.data ?? []) {
      const intent = payment.payment.payment_intent;
      if (!intent || typeof intent === "string") continue;
      const method = intent.payment_method;
      if (method && typeof method !== "string" && method.card) {
        return {
          id: method.id,
          brand: method.card.brand,
          last4: method.card.last4,
          expMonth: method.card.exp_month,
          expYear: method.card.exp_year,
        };
      }
    }
    return null;
  }

  private invoicePaymentIntentId(invoice: Stripe.Invoice): string | null {
    const ids = new Set<string>();
    for (const payment of invoice.payments?.data ?? []) {
      const intent = payment.payment.payment_intent;
      const id = typeof intent === "string" ? intent : intent?.id;
      if (id) ids.add(id);
    }
    return ids.size === 1 ? (ids.values().next().value ?? null) : null;
  }

  private invoiceFailureCode(invoice: Stripe.Invoice): string | null {
    for (const payment of invoice.payments?.data ?? []) {
      const intent = payment.payment.payment_intent;
      if (intent && typeof intent !== "string") {
        return intent.last_payment_error?.decline_code ?? intent.last_payment_error?.code ?? null;
      }
    }
    return null;
  }

  private async queueBillingEmail(
    transaction: Prisma.TransactionClient,
    input: {
      organizationId: string;
      billingInvoiceId?: string;
      kind: string;
      dedupeKey: string;
      recipientEmail: string;
      locale: "EN" | "AR";
      payload: Prisma.InputJsonValue;
    },
  ): Promise<void> {
    await transaction.billingEmailOutbox.upsert({
      where: { dedupeKey: input.dedupeKey },
      update: {},
      create: {
        organizationId: input.organizationId,
        ...(input.billingInvoiceId ? { billingInvoiceId: input.billingInvoiceId } : {}),
        kind: input.kind,
        dedupeKey: input.dedupeKey,
        recipientEmail: input.recipientEmail,
        locale: input.locale,
        payload: input.payload,
      },
    });
  }

  private async requireBillingOwner(userId: string, organizationId: string) {
    const membership = await this.tenant.requireMembership(
      userId,
      organizationId,
      "billing.manage",
    );
    if (membership.role !== "OWNER") {
      throw new AppError(
        "PERMISSION_DENIED",
        "Only an organization Owner can authorize billing refunds.",
        HttpStatus.FORBIDDEN,
      );
    }
    return membership;
  }

  private refundResponse(refund: {
    publicId: string;
    status: string;
    reason: string;
    explanation: string | null;
    requestedAmount: number;
    approvedAmount: number | null;
    currency: string;
    requestedAt: Date;
    reviewedAt: Date | null;
    processingAt: Date | null;
    completedAt: Date | null;
    failureCode: string | null;
  }) {
    return {
      id: refund.publicId,
      status: refund.status,
      reason: refund.reason,
      explanation: refund.explanation,
      requestedAmount: refund.requestedAmount,
      approvedAmount: refund.approvedAmount,
      currency: refund.currency,
      requestedAt: refund.requestedAt,
      reviewedAt: refund.reviewedAt,
      processingAt: refund.processingAt,
      completedAt: refund.completedAt,
      failureCode: refund.failureCode,
    };
  }

  private billingUrl(locale: "EN" | "AR"): string {
    return `${this.environment.values.MERCHANT_DASHBOARD_URL}/${locale === "AR" ? "ar" : "en"}/dashboard/billing`;
  }

  private async queueRefundResultEmail(
    transaction: Prisma.TransactionClient,
    input: {
      refund: {
        id: string;
        status: string;
        reason: string;
        requestedAmount: number;
        approvedAmount: number | null;
        currency: string;
      };
      invoice: {
        id: string;
        invoiceNumber: string | null;
        paidAt: Date | null;
        paymentMethodBrand: string | null;
        paymentMethodLast4: string | null;
        paymentMethodExpMonth: number | null;
        paymentMethodExpYear: number | null;
      };
      organization: {
        id: string;
        name: string;
        defaultLocale: "EN" | "AR";
        timezone: string;
        billingProfile: { billingName: string | null } | null;
      };
      recipient: string;
      status: "SUCCEEDED" | "FAILED";
    },
  ): Promise<void> {
    const { refund, invoice, organization, recipient, status } = input;
    await this.queueBillingEmail(transaction, {
      organizationId: organization.id,
      billingInvoiceId: invoice.id,
      kind: status === "SUCCEEDED" ? "REFUND_SUCCEEDED" : "REFUND_FAILED",
      dedupeKey: `refund-${status.toLocaleLowerCase("en-US")}:${refund.id}`,
      recipientEmail: recipient,
      locale: organization.defaultLocale,
      payload: {
        organizationName: organization.billingProfile?.billingName ?? organization.name,
        invoiceNumber: invoice.invoiceNumber,
        amount: refund.approvedAmount ?? refund.requestedAmount,
        currency: refund.currency,
        refundStatus: status,
        refundReason: refund.reason,
        originalPaymentDate: invoice.paidAt?.toISOString() ?? null,
        paymentMethod:
          invoice.paymentMethodBrand && invoice.paymentMethodLast4
            ? {
                brand: invoice.paymentMethodBrand,
                last4: invoice.paymentMethodLast4,
                ...(invoice.paymentMethodExpMonth
                  ? { expMonth: invoice.paymentMethodExpMonth }
                  : {}),
                ...(invoice.paymentMethodExpYear ? { expYear: invoice.paymentMethodExpYear } : {}),
              }
            : null,
        billingUrl: this.billingUrl(organization.defaultLocale),
        timezone: organization.timezone,
      },
    });
  }

  private async downgradeViolations(
    transaction: Prisma.TransactionClient,
    organizationId: string,
    targetPlan: PlanCode,
  ) {
    const now = new Date();
    const [locations, activeSeats, pendingSeats, programs, activeAdvancedExports] =
      await Promise.all([
        transaction.location.count({ where: { organizationId, status: "ACTIVE" } }),
        transaction.organizationMember.count({
          where: {
            organizationId,
            status: "ACTIVE",
            role: { in: ["MANAGER", "STAFF"] },
          },
        }),
        transaction.organizationInvitation.count({
          where: {
            organizationId,
            status: "PENDING",
            expiresAt: { gt: now },
            intendedRole: { in: ["MANAGER", "STAFF"] },
          },
        }),
        transaction.loyaltyProgram.findMany({
          where: { organizationId, status: { not: "ARCHIVED" } },
          select: {
            currentDraftVersion: {
              select: {
                editingMode: true,
                stampRule: { select: { requiredStampCount: true } },
                rewards: { select: { thresholdStampCount: true } },
                visualTheme: { select: { layoutType: true } },
              },
            },
            currentPublishedVersion: {
              select: {
                editingMode: true,
                stampRule: { select: { requiredStampCount: true } },
                rewards: { select: { thresholdStampCount: true } },
                visualTheme: { select: { layoutType: true } },
              },
            },
          },
        }),
        transaction.exportCommand.count({
          where: { organizationId, status: { in: ["PENDING", "PROCESSING"] } },
        }),
      ]);
    const programFeatures: Partial<
      Record<"PRO_MODE" | "MULTIPLE_REWARDS" | "MILESTONE_REWARDS" | "ADVANCED_LAYOUT", number>
    > = {};
    for (const program of programs) {
      const version = program.currentDraftVersion ?? program.currentPublishedVersion;
      if (!version) continue;
      const requiredStampCount = version.stampRule?.requiredStampCount ?? 8;
      const featureViolations = programPublicationFeatureViolations(targetPlan, {
        editingMode: version.editingMode === "PRO" ? "PRO" : "QUICK",
        rewardThresholds: version.rewards.map((reward) => reward.thresholdStampCount),
        requiredStampCount,
        layoutType: version.visualTheme?.layoutType ?? "GRID",
      });
      for (const code of new Set(featureViolations)) {
        programFeatures[code] = (programFeatures[code] ?? 0) + 1;
      }
    }
    return planDowngradeViolations(
      targetPlan,
      {
        locations,
        teamSeats: activeSeats + pendingSeats,
        programs: programs.length,
        activeAdvancedExports,
        programFeatures,
      },
      {
        ...(this.environment.values.SCALE_LOCATION_LIMIT
          ? { locations: this.environment.values.SCALE_LOCATION_LIMIT }
          : {}),
        ...(this.environment.values.SCALE_TEAM_LIMIT
          ? { teamSeats: this.environment.values.SCALE_TEAM_LIMIT }
          : {}),
      },
    ).map((violation) => ({
      code: violation.code,
      actual: violation.currentUsage,
      limit: violation.limit,
      message: downgradeViolationMessage(violation),
    }));
  }

  private async authoritativePaymentMethod(customerId: string) {
    if (!this.stripe || !this.environment.stripeConfigured) {
      return { status: "unavailable" as const, reason: "STRIPE_NOT_CONFIGURED" as const };
    }
    try {
      const [customer, cards] = await Promise.all([
        this.stripe.customers.retrieve(customerId, {
          expand: ["invoice_settings.default_payment_method"],
        }),
        this.stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 10 }),
      ]);
      if (customer.deleted) return { status: "none" as const };
      const defaultValue = customer.invoice_settings.default_payment_method;
      const defaultId =
        typeof defaultValue === "string" ? defaultValue : (defaultValue?.id ?? null);
      const paymentMethod = cards.data.find((card) => card.id === defaultId) ?? cards.data[0];
      if (!paymentMethod?.card) return { status: "none" as const };
      return {
        status: "saved" as const,
        brand: paymentMethod.card.brand,
        last4: paymentMethod.card.last4,
        expMonth: paymentMethod.card.exp_month,
        expYear: paymentMethod.card.exp_year,
        isDefault: paymentMethod.id === defaultId,
      };
    } catch {
      return { status: "unavailable" as const, reason: "STRIPE_LOOKUP_FAILED" as const };
    }
  }

  private async authoritativeUpcomingCharge(
    customerId: string | null,
    subscriptionId: string | null,
  ): Promise<{ amount: number; currency: string; date: Date | null } | null> {
    if (!customerId || !subscriptionId || !this.stripe || !this.environment.stripeConfigured) {
      return null;
    }
    try {
      const preview = await this.stripe.invoices.createPreview({
        customer: customerId,
        subscription: subscriptionId,
      });
      return {
        amount: preview.amount_due,
        currency: preview.currency.toUpperCase(),
        date: preview.period_start ? new Date(preview.period_start * 1000) : null,
      };
    } catch {
      return null;
    }
  }

  private async ensureTrialCustomer(
    userId: string,
    organizationId: string,
    plan: PlanCode,
    cadence: BillingCadence,
    identity: ReturnType<typeof cleanBillingIdentity>,
  ): Promise<string> {
    const stripe = this.requireStripe();
    const organization = await this.prisma.client.organization.findUniqueOrThrow({
      where: { id: organizationId },
      include: { billingProfile: true },
    });
    const user = await this.prisma.client.user.findUniqueOrThrow({ where: { id: userId } });
    let customerId = organization.billingProfile?.stripeCustomerId ?? null;
    if (!customerId) {
      const [canonicalMatches, legacyMatches] = await Promise.all([
        stripe.customers.search({
          query: `metadata['wafloOrganizationId']:'${organizationId}'`,
          limit: 10,
        }),
        stripe.customers.search({
          query: `metadata['organizationId']:'${organizationId}'`,
          limit: 10,
        }),
      ]);
      const matches = new Map(
        [...canonicalMatches.data, ...legacyMatches.data].map((customer) => [
          customer.id,
          customer,
        ]),
      );
      if (matches.size > 1) {
        throw new AppError(
          "STRIPE_CUSTOMER_DUPLICATE",
          "Billing is locked while duplicate customer records are reviewed.",
          HttpStatus.CONFLICT,
        );
      }
      customerId = matches.values().next().value?.id ?? null;
    }
    if (!customerId) {
      const customer = await stripe.customers.create(
        {
          email: identity.email || user.email,
          name: identity.name || organization.name,
          address: {
            line1: identity.addressLine1 ?? "",
            line2: identity.addressLine2 ?? "",
            city: identity.city ?? "",
            state: identity.region ?? "",
            postal_code: identity.postalCode ?? "",
            country: identity.countryCode ?? "",
          },
          preferred_locales: [organization.defaultLocale === "AR" ? "ar" : "en"],
          metadata: { organizationId, wafloOrganizationId: organizationId },
        },
        { idempotencyKey: `waflo:organization:${organizationId}:create-customer:v1` },
      );
      customerId = customer.id;
    }
    const authoritativeCustomerId = customerId;
    await stripe.customers.update(authoritativeCustomerId, {
      email: identity.email,
      name: identity.name,
      address: {
        line1: identity.addressLine1 ?? "",
        line2: identity.addressLine2 ?? "",
        city: identity.city ?? "",
        state: identity.region ?? "",
        postal_code: identity.postalCode ?? "",
        country: identity.countryCode ?? "",
      },
      preferred_locales: [organization.defaultLocale === "AR" ? "ar" : "en"],
      metadata: { organizationId, wafloOrganizationId: organizationId },
    });
    await withOrganizationInvariantLock(this.prisma.client, organizationId, async (transaction) => {
      const current = await transaction.organizationBillingProfile.findUniqueOrThrow({
        where: { organizationId },
      });
      if (current.stripeCustomerId && current.stripeCustomerId !== authoritativeCustomerId) {
        throw new AppError(
          "STRIPE_CUSTOMER_DUPLICATE",
          "The billing customer changed while payment setup was in progress.",
          HttpStatus.CONFLICT,
        );
      }
      await transaction.organizationBillingProfile.update({
        where: { organizationId },
        data: {
          stripeCustomerId: authoritativeCustomerId,
          selectedPlan: planToDb(plan),
          selectedCadence: cadenceToDb(cadence),
          billingName: identity.name,
          billingEmail: identity.email,
          billingCountryCode: identity.countryCode,
          billingAddressLine1: identity.addressLine1,
          billingAddressLine2: identity.addressLine2,
          billingCity: identity.city,
          billingRegion: identity.region,
          billingPostalCode: identity.postalCode,
          stripeIdentitySyncedAt: new Date(),
        },
      });
      await transaction.organization.update({
        where: { id: organizationId },
        data: { selectedPlan: planToDb(plan) },
      });
    });
    return authoritativeCustomerId;
  }

  private assertTrialPrice(price: Stripe.Price, plan: PlanCode, cadence: BillingCadence) {
    const expectedAmount = Math.round(cadencePrice(plan, cadence).billedAmountUsd * 100);
    const expectedInterval = cadence === "yearly" ? "year" : "month";
    const expectedIntervalCount = cadence === "quarterly" ? 3 : 1;
    if (
      !price.active ||
      price.type !== "recurring" ||
      price.unit_amount !== expectedAmount ||
      price.currency.toLocaleLowerCase("en-US") !== "usd" ||
      price.recurring?.interval !== expectedInterval ||
      price.recurring.interval_count !== expectedIntervalCount
    ) {
      throw new AppError(
        "STRIPE_PRICE_CONFIGURATION_MISMATCH",
        "The selected plan price is not configured correctly.",
        HttpStatus.CONFLICT,
      );
    }
    return { amount: price.unit_amount, currency: price.currency.toUpperCase() };
  }

  private requireStripe(): Stripe {
    if (!this.stripe || !this.environment.stripeConfigured) {
      throw new AppError(
        "BILLING_CONFIGURATION_INCOMPLETE",
        "Billing setup is not configured right now. Try again or contact Waflo support.",
        HttpStatus.SERVICE_UNAVAILABLE,
        { configurationState: "incomplete" },
      );
    }
    return this.stripe;
  }

  private cadenceConfigured(cadence: BillingCadence): boolean {
    return (["starter", "growth", "scale"] as const).every((plan) =>
      Boolean(this.configuredPriceId(plan, cadence)),
    );
  }

  private configuredPriceId(plan: PlanCode, cadence: BillingCadence): string | undefined {
    const priceIds: Record<BillingCadence, Record<PlanCode, string | undefined>> = {
      monthly: {
        starter: this.environment.values.STRIPE_STARTER_MONTHLY_PRICE_ID,
        growth: this.environment.values.STRIPE_GROWTH_MONTHLY_PRICE_ID,
        scale: this.environment.values.STRIPE_SCALE_MONTHLY_PRICE_ID,
      },
      quarterly: {
        starter: this.environment.values.STRIPE_STARTER_QUARTERLY_PRICE_ID,
        growth: this.environment.values.STRIPE_GROWTH_QUARTERLY_PRICE_ID,
        scale: this.environment.values.STRIPE_SCALE_QUARTERLY_PRICE_ID,
      },
      yearly: {
        starter: this.environment.values.STRIPE_STARTER_YEARLY_PRICE_ID,
        growth: this.environment.values.STRIPE_GROWTH_YEARLY_PRICE_ID,
        scale: this.environment.values.STRIPE_SCALE_YEARLY_PRICE_ID,
      },
    };
    return priceIds[cadence][plan];
  }

  private priceId(plan: PlanCode, cadence: BillingCadence): string {
    const priceId = this.configuredPriceId(plan, cadence);
    if (!priceId) {
      throw new AppError(
        "STRIPE_PRICE_NOT_CONFIGURED",
        "The selected plan and billing cadence do not have a Stripe price configured.",
        HttpStatus.SERVICE_UNAVAILABLE,
        { plan, cadence },
      );
    }
    return priceId;
  }

  private planForPrice(priceId: string): { plan: PlanCode; cadence: BillingCadence } {
    const configured = new Map<string, { plan: PlanCode; cadence: BillingCadence }>();
    for (const cadence of ["monthly", "quarterly", "yearly"] as const) {
      for (const plan of ["starter", "growth", "scale"] as const) {
        const configuredPriceId = this.configuredPriceId(plan, cadence);
        if (configuredPriceId) configured.set(configuredPriceId, { plan, cadence });
      }
    }
    const result = configured.get(priceId);
    if (!result) {
      throw new AppError(
        "STRIPE_PRICE_UNKNOWN",
        "The Stripe price is not present in the configured plan map.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return result;
  }
}
