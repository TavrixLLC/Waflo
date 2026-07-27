import { HttpStatus, Injectable } from "@nestjs/common";
import type { BillingStatus, PlanCode } from "@waflo/contracts";
import { Prisma } from "@waflo/database";
import Stripe from "stripe";
import { AuditService } from "../audit/audit.service.js";
import { AppError } from "../common/app-error.js";
import type { WafloRequest } from "../common/request-context.js";
import { EnvironmentService } from "../config/environment.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { TenantService } from "../tenancy/tenant.service.js";

const planToDb = (plan: PlanCode) => plan.toUpperCase() as "STARTER" | "GROWTH" | "SCALE";

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

@Injectable()
export class BillingService {
  private readonly stripe: Stripe | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly environment: EnvironmentService,
    private readonly tenant: TenantService,
    private readonly audit: AuditService,
  ) {
    this.stripe = environment.values.STRIPE_SECRET_KEY
      ? new Stripe(environment.values.STRIPE_SECRET_KEY, {
          appInfo: { name: "Waflo", version: "1.0.0", url: "https://waflo.app" },
        })
      : null;
  }

  async get(userId: string, organizationId: string) {
    await this.tenant.requireMembership(userId, organizationId, "billing.view");
    const organization = await this.prisma.client.organization.findUniqueOrThrow({
      where: { id: organizationId },
      include: {
        billingProfile: true,
        subscriptions: { orderBy: { createdAt: "desc" }, take: 10 },
      },
    });
    return {
      selectedPlan: organization.selectedPlan,
      profile: organization.billingProfile,
      subscriptions: organization.subscriptions,
      stripeConfigured: this.environment.stripeConfigured,
      trialPolicy: {
        durationDays: 15,
        startsOnFirstProgramPublication: true,
        startedInW1: false,
      },
    };
  }

  async selectPlan(userId: string, organizationId: string, plan: PlanCode, request: WafloRequest) {
    await this.tenant.requireMembership(userId, organizationId, "billing.manage");
    const selectedPlan = planToDb(plan);
    await this.prisma.client.$transaction([
      this.prisma.client.organization.update({
        where: { id: organizationId },
        data: { selectedPlan },
      }),
      this.prisma.client.organizationBillingProfile.update({
        where: { organizationId },
        data: { selectedPlan },
      }),
    ]);
    await this.audit.record(
      {
        organizationId,
        actorUserId: userId,
        action: "billing.selected_plan_changed",
        targetType: "organization_billing_profile",
        targetId: organizationId,
        metadata: { selectedPlan },
      },
      request,
    );
    return { selectedPlan, subscriptionActivated: false, trialStarted: false };
  }

  async checkout(userId: string, organizationId: string, request: WafloRequest) {
    await this.tenant.requireMembership(userId, organizationId, "billing.manage");
    const stripe = this.requireStripe();
    const organization = await this.prisma.client.organization.findUniqueOrThrow({
      where: { id: organizationId },
      include: {
        billingProfile: true,
        members: {
          where: { userId, status: "ACTIVE" },
          include: { user: true },
          take: 1,
        },
      },
    });
    const owner = organization.members[0]?.user;
    if (!owner) {
      throw new AppError("BILLING_ACCESS_DENIED", "Billing access denied.", HttpStatus.FORBIDDEN);
    }
    let customerId = organization.billingProfile?.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: owner.email,
        name: organization.name,
        metadata: { organizationId },
      });
      customerId = customer.id;
      await this.prisma.client.organizationBillingProfile.update({
        where: { organizationId },
        data: { stripeCustomerId: customer.id },
      });
    }
    const plan = organization.selectedPlan.toLocaleLowerCase("en-US") as PlanCode;
    const priceId = this.priceId(plan);
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: organizationId,
      success_url: `${this.environment.values.MERCHANT_DASHBOARD_URL}/en/dashboard/billing?checkout=returned`,
      cancel_url: `${this.environment.values.MERCHANT_DASHBOARD_URL}/en/dashboard/billing?checkout=canceled`,
      allow_promotion_codes: true,
      metadata: { organizationId, plan },
      subscription_data: {
        metadata: { organizationId, plan },
      },
    });
    await this.audit.record(
      {
        organizationId,
        actorUserId: userId,
        action: "stripe.checkout_created",
        targetType: "stripe_checkout_session",
        targetId: session.id,
        metadata: { plan },
      },
      request,
    );
    return { url: session.url, sessionId: session.id };
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
    const portal = await stripe.billingPortal.sessions.create({
      customer: profile.stripeCustomerId,
      return_url: `${this.environment.values.MERCHANT_DASHBOARD_URL}/en/dashboard/billing`,
      ...(this.environment.values.STRIPE_CUSTOMER_PORTAL_CONFIGURATION_ID
        ? { configuration: this.environment.values.STRIPE_CUSTOMER_PORTAL_CONFIGURATION_ID }
        : {}),
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
    const existing = await this.prisma.client.processedWebhookEvent.findUnique({
      where: {
        provider_externalEventId: { provider: "stripe", externalEventId: event.id },
      },
    });
    if (existing?.status === "PROCESSED") return { received: true, duplicate: true };

    const processing = existing
      ? await this.prisma.client.processedWebhookEvent.update({
          where: { id: existing.id },
          data: {
            status: "PROCESSING",
            attemptCount: { increment: 1 },
            failureMetadata: Prisma.DbNull,
          },
        })
      : await this.prisma.client.processedWebhookEvent.create({
          data: {
            provider: "stripe",
            externalEventId: event.id,
            eventType: event.type,
            status: "PROCESSING",
          },
        });
    try {
      const organizationId = await this.applyStripeEvent(event);
      await this.prisma.client.processedWebhookEvent.update({
        where: { id: processing.id },
        data: {
          organizationId,
          status: "PROCESSED",
          processedAt: new Date(),
          failureMetadata: Prisma.DbNull,
        },
      });
      return { received: true, duplicate: false };
    } catch (error) {
      await this.prisma.client.processedWebhookEvent.update({
        where: { id: processing.id },
        data: {
          status: "FAILED",
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

  private async applyStripeEvent(event: Stripe.Event): Promise<string | null> {
    if (
      event.type !== "customer.subscription.created" &&
      event.type !== "customer.subscription.updated" &&
      event.type !== "customer.subscription.deleted"
    ) {
      return null;
    }
    const subscription = event.data.object as Stripe.Subscription;
    const customerId =
      typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
    const profile = await this.prisma.client.organizationBillingProfile.findFirst({
      where: {
        OR: [
          { stripeCustomerId: customerId },
          ...(subscription.metadata.organizationId
            ? [{ organizationId: subscription.metadata.organizationId }]
            : []),
        ],
      },
    });
    if (!profile) {
      throw new AppError(
        "STRIPE_ORGANIZATION_NOT_FOUND",
        "The Stripe event could not be matched to an organization.",
      );
    }
    const plan = (subscription.metadata.plan ?? profile.selectedPlan.toLocaleLowerCase("en-US")) as
      | "starter"
      | "growth"
      | "scale";
    const localStatus = billingStatusFromStripe(subscription.status);
    const priceId = subscription.items.data[0]?.price.id ?? "unknown";
    await this.prisma.client.$transaction([
      this.prisma.client.subscription.upsert({
        where: { stripeSubscriptionId: subscription.id },
        update: {
          stripePriceId: priceId,
          planCode: planToDb(plan),
          status: statusToDb(localStatus),
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
          canceledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null,
        },
        create: {
          organizationId: profile.organizationId,
          stripeSubscriptionId: subscription.id,
          stripePriceId: priceId,
          planCode: planToDb(plan),
          status: statusToDb(localStatus),
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
          canceledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null,
        },
      }),
      this.prisma.client.organizationBillingProfile.update({
        where: { organizationId: profile.organizationId },
        data: {
          subscriptionStatus: statusToDb(localStatus),
          selectedPlan: planToDb(plan),
        },
      }),
      this.prisma.client.organization.update({
        where: { id: profile.organizationId },
        data: { selectedPlan: planToDb(plan) },
      }),
    ]);
    return profile.organizationId;
  }

  private requireStripe(): Stripe {
    if (!this.stripe || !this.environment.stripeConfigured) {
      throw new AppError(
        "STRIPE_NOT_CONFIGURED",
        "Stripe test configuration is required for this action.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return this.stripe;
  }

  private priceId(plan: PlanCode): string {
    const priceIds: Record<PlanCode, string | undefined> = {
      starter: this.environment.values.STRIPE_STARTER_MONTHLY_PRICE_ID,
      growth: this.environment.values.STRIPE_GROWTH_MONTHLY_PRICE_ID,
      scale: this.environment.values.STRIPE_SCALE_MONTHLY_PRICE_ID,
    };
    const priceId = priceIds[plan];
    if (!priceId) {
      throw new AppError(
        "STRIPE_PRICE_NOT_CONFIGURED",
        "The selected plan does not have a Stripe test price configured.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return priceId;
  }
}
