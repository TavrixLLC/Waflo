import { HttpStatus, Injectable } from "@nestjs/common";
import { planCatalog } from "@waflo/billing";
import type { BillingStatus, PlanCode } from "@waflo/contracts";
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

const planToDb = (plan: PlanCode) => plan.toUpperCase() as "STARTER" | "GROWTH" | "SCALE";
const dbToPlan = (plan: "STARTER" | "GROWTH" | "SCALE") =>
  plan.toLocaleLowerCase("en-US") as PlanCode;
const planRank: Readonly<Record<PlanCode, number>> = { starter: 0, growth: 1, scale: 2 };
const WEBHOOK_LEASE_MS = 2 * 60 * 1000;

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
    private readonly notifications: NotificationService,
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
    await withOrganizationInvariantLock(this.prisma.client, organizationId, async (transaction) => {
      const [actor, organization] = await Promise.all([
        transaction.organizationMember.findUnique({
          where: { organizationId_userId: { organizationId, userId } },
        }),
        transaction.organization.findUniqueOrThrow({ where: { id: organizationId } }),
      ]);
      if (actor?.status !== "ACTIVE" || actor.role !== "OWNER") {
        throw new AppError(
          "PERMISSION_DENIED",
          "Your role does not allow this action.",
          HttpStatus.FORBIDDEN,
        );
      }
      const previousPlan = dbToPlan(organization.selectedPlan);
      if (planRank[plan] < planRank[previousPlan]) {
        const now = new Date();
        const [locationUsage, activeSeatUsage, pendingSeatUsage] = await Promise.all([
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
        ]);
        const teamSeatUsage = activeSeatUsage + pendingSeatUsage;
        const locationLimit =
          plan === "scale"
            ? (this.environment.values.SCALE_LOCATION_LIMIT ?? null)
            : planCatalog[plan].limits.locations;
        const teamSeatLimit =
          plan === "scale"
            ? (this.environment.values.SCALE_TEAM_LIMIT ?? null)
            : planCatalog[plan].limits.teamSeats;
        if (
          (locationLimit !== null && locationUsage > locationLimit) ||
          (teamSeatLimit !== null && teamSeatUsage > teamSeatLimit)
        ) {
          throw new AppError(
            "PLAN_DOWNGRADE_BLOCKED",
            "Reduce usage before switching to this plan.",
            HttpStatus.CONFLICT,
            {
              requestedPlan: plan,
              locationUsage,
              locationLimit,
              teamSeatUsage,
              teamSeatLimit,
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
        data: { selectedPlan },
      });
    });
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
    const claim = await this.claimWebhook(event);
    if (!claim) return { received: true, duplicate: true };
    try {
      const applied = await withInvariantLock(
        this.prisma.client,
        `stripe-event:${event.id}`,
        async (transaction) => {
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
          const result = await this.applyStripeEvent(event, transaction, request);
          const completed = await transaction.processedWebhookEvent.updateMany({
            where: {
              id: claim.id,
              status: "PROCESSING",
              leaseExpiresAt: claim.leaseExpiresAt,
            },
            data: {
              organizationId: result.organizationId,
              status: "PROCESSED",
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
        },
      );
      if (applied.notification) {
        const notification = applied.notification;
        const notificationResults = await Promise.allSettled(
          notification.recipients.map((recipient) =>
            this.notifications.send({
              to: recipient.email,
              locale: recipient.locale,
              kind: "subscription_status",
              organizationName: notification.organizationName,
            }),
          ),
        );
        const failedNotificationCount = notificationResults.filter(
          (result) => result.status === "rejected",
        ).length;
        if (failedNotificationCount > 0) {
          await this.audit.record(
            {
              action: "stripe.subscription_notification_failed",
              organizationId: applied.organizationId,
              targetType: "stripe_event",
              targetId: event.id,
              metadata: {
                failedNotificationCount,
                recipientCount: notification.recipients.length,
              },
            },
            request,
          );
        }
      }
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

  private async applyStripeEvent(
    event: Stripe.Event,
    transaction: Prisma.TransactionClient,
    request: WafloRequest,
  ): Promise<{
    organizationId: string | null;
    notification: {
      organizationName: string;
      recipients: Array<{ email: string; locale: "en" | "ar" }>;
    } | null;
  }> {
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
      return { organizationId: null, notification: null };
    }
    const subscription = event.data.object as Stripe.Subscription;
    const customerId =
      typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
    const metadataOrganizationId = subscription.metadata.organizationId;
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
    const item = subscription.items.data[0];
    const priceId = item?.price.id;
    if (!priceId) {
      throw new AppError(
        "STRIPE_PRICE_UNKNOWN",
        "The Stripe subscription has no supported price.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const plan = this.planForPrice(priceId);
    const metadataPlan = subscription.metadata.plan;
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
    const localStatus = billingStatusFromStripe(subscription.status);
    const currentPeriodStart = item.current_period_start
      ? new Date(item.current_period_start * 1000)
      : null;
    const currentPeriodEnd = item.current_period_end
      ? new Date(item.current_period_end * 1000)
      : null;
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
    await transaction.subscription.upsert({
      where: { stripeSubscriptionId: subscription.id },
      update: {
        stripePriceId: priceId,
        planCode: planToDb(plan),
        status: statusToDb(localStatus),
        currentPeriodStart,
        currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        canceledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null,
      },
      create: {
        organizationId: profile.organizationId,
        stripeSubscriptionId: subscription.id,
        stripePriceId: priceId,
        planCode: planToDb(plan),
        status: statusToDb(localStatus),
        currentPeriodStart,
        currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        canceledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null,
      },
    });
    await transaction.organizationBillingProfile.update({
      where: { organizationId: profile.organizationId },
      data: {
        ...(profile.stripeCustomerId ? {} : { stripeCustomerId: customerId }),
        subscriptionStatus: statusToDb(localStatus),
        selectedPlan: planToDb(plan),
      },
    });
    await transaction.organization.update({
      where: { id: profile.organizationId },
      data: { selectedPlan: planToDb(plan) },
    });
    const now = new Date();
    const [locationUsage, activeSeatUsage, pendingSeatUsage] = await Promise.all([
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
          expiresAt: { gt: now },
          intendedRole: { in: ["MANAGER", "STAFF"] },
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
    const overLimit =
      (locationLimit !== null && locationUsage > locationLimit) ||
      (teamSeatLimit !== null && teamSeatUsage > teamSeatLimit);
    await transaction.auditLog.create({
      data: {
        organizationId: profile.organizationId,
        action: "stripe.subscription_applied",
        targetType: "subscription",
        targetId: subscription.id,
        requestId: request.requestId,
        metadata: {
          eventId: event.id,
          eventType: event.type,
          previousPlan,
          selectedPlan: planToDb(plan),
          previousStatus,
          subscriptionStatus: statusToDb(localStatus),
          overLimit,
          locationUsage,
          locationLimit,
          teamSeatUsage,
          teamSeatLimit,
          overLimitPolicy: overLimit
            ? "preserve_resources_and_block_new_capacity"
            : "within_entitlements",
        },
        userAgent: request.headers["user-agent"]?.slice(0, 512) ?? null,
      },
    });
    return {
      organizationId: profile.organizationId,
      notification: {
        organizationName: organization.name,
        recipients: organization.members.map(({ user }) => ({
          email: user.email,
          locale: user.preferredLocale === "AR" ? "ar" : "en",
        })),
      },
    };
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

  private planForPrice(priceId: string): PlanCode {
    const configured = new Map<string, PlanCode>();
    const candidates: Array<[string | undefined, PlanCode]> = [
      [this.environment.values.STRIPE_STARTER_MONTHLY_PRICE_ID, "starter"],
      [this.environment.values.STRIPE_GROWTH_MONTHLY_PRICE_ID, "growth"],
      [this.environment.values.STRIPE_SCALE_MONTHLY_PRICE_ID, "scale"],
    ];
    for (const [configuredPriceId, plan] of candidates) {
      if (configuredPriceId) configured.set(configuredPriceId, plan);
    }
    const plan = configured.get(priceId);
    if (!plan) {
      throw new AppError(
        "STRIPE_PRICE_UNKNOWN",
        "The Stripe price is not present in the configured plan map.",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return plan;
  }
}
