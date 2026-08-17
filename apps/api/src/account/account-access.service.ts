import { HttpStatus, Injectable } from "@nestjs/common";
import { hasMerchantOperationalBillingAccess } from "@waflo/billing";
import { AppError } from "../common/app-error.js";
import { PrismaService } from "../database/prisma.service.js";

export type MerchantEmailState = "unverified" | "verified";
export type MerchantOnboardingState =
  | "business_required"
  | "location_required"
  | "billing_identity_required"
  | "payment_method_required"
  | "trial_confirmation_required"
  | "complete";
export type MerchantBillingState =
  | "none"
  | "trialing"
  | "active"
  | "past_due_grace"
  | "action_required"
  | "restricted"
  | "canceled"
  | "paused";
export type MerchantAccessState = "onboarding_only" | "full" | "read_only_billing_recovery";

export interface MerchantAccountState {
  email: MerchantEmailState;
  onboarding: MerchantOnboardingState;
  billing: MerchantBillingState;
  access: MerchantAccessState;
  organizationId: string | null;
  billingAttention: boolean;
}

interface OrganizationAccessInput {
  id: string;
  onboardingState: "BUSINESS" | "LOCATION" | "COMPLETE";
  activeLocationCount: number;
  billingProfile: {
    subscriptionStatus:
      | "PENDING_ACTIVATION"
      | "TRIALING"
      | "ACTIVE"
      | "PAST_DUE"
      | "GRACE_PERIOD"
      | "SUSPENDED"
      | "CANCELED";
    trialEnd: Date | null;
    gracePeriodEnd: Date | null;
    billingName: string | null;
    billingEmail: string | null;
    billingCountryCode: string | null;
    billingAddressLine1: string | null;
    billingCity: string | null;
  } | null;
  latestBillingCommandStatus: string | null;
  outstandingInvoice: {
    failureCategory: string | null;
    graceEndsAt: Date | null;
  } | null;
}

function billingIdentityComplete(profile: OrganizationAccessInput["billingProfile"]): boolean {
  return Boolean(
    profile?.billingName &&
      profile.billingEmail &&
      profile.billingCountryCode &&
      profile.billingAddressLine1 &&
      profile.billingCity,
  );
}

export function resolveMerchantOrganizationAccess(
  organization: OrganizationAccessInput,
  now = new Date(),
): Omit<MerchantAccountState, "email"> {
  const profile = organization.billingProfile;
  const graceEnd = organization.outstandingInvoice?.graceEndsAt ?? profile?.gracePeriodEnd ?? null;
  const graceActive = graceEnd !== null && graceEnd > now;
  const actionRequired =
    graceActive &&
    ["AUTHENTICATION_REQUIRED", "PAYMENT_ACTION_REQUIRED"].includes(
      organization.outstandingInvoice?.failureCategory?.toLocaleUpperCase("en-US") ?? "",
    );

  let billing: MerchantBillingState;
  switch (profile?.subscriptionStatus ?? "PENDING_ACTIVATION") {
    case "TRIALING":
      billing = hasMerchantOperationalBillingAccess(
        {
          status: "TRIALING",
          trialEnd: profile?.trialEnd,
          gracePeriodEnd: profile?.gracePeriodEnd,
        },
        now,
      )
        ? "trialing"
        : "restricted";
      break;
    case "ACTIVE":
      billing = "active";
      break;
    case "GRACE_PERIOD":
      billing = !hasMerchantOperationalBillingAccess(
        {
          status: "GRACE_PERIOD",
          trialEnd: profile?.trialEnd,
          gracePeriodEnd: graceEnd,
        },
        now,
      )
        ? "restricted"
        : actionRequired
          ? "action_required"
          : "past_due_grace";
      break;
    case "SUSPENDED":
      billing = "paused";
      break;
    case "CANCELED":
      billing = "canceled";
      break;
    case "PAST_DUE":
      billing = "restricted";
      break;
    default:
      billing = "none";
  }

  let onboarding: MerchantOnboardingState;
  if (organization.onboardingState === "BUSINESS") {
    onboarding = "business_required";
  } else if (organization.onboardingState === "COMPLETE") {
    // Completion is durable evidence for active and legacy organizations. Missing
    // locations or provider state is handled in the relevant recovery/preflight
    // flow instead of replaying onboarding.
    onboarding = "complete";
  } else if (organization.activeLocationCount < 1) {
    onboarding = "location_required";
  } else if (!billingIdentityComplete(profile)) {
    onboarding = "billing_identity_required";
  } else if (billing === "none") {
    onboarding =
      organization.latestBillingCommandStatus === "SETUP_SUCCEEDED" ||
      organization.latestBillingCommandStatus === "SUBSCRIPTION_CREATED"
        ? "trial_confirmation_required"
        : "payment_method_required";
  } else {
    onboarding = "trial_confirmation_required";
  }

  const fullBillingAccess = ["trialing", "active", "past_due_grace", "action_required"].includes(
    billing,
  );
  const access: MerchantAccessState =
    onboarding !== "complete"
      ? "onboarding_only"
      : fullBillingAccess
        ? "full"
        : "read_only_billing_recovery";

  return {
    onboarding,
    billing,
    access,
    organizationId: organization.id,
    billingAttention: [
      "none",
      "past_due_grace",
      "action_required",
      "restricted",
      "canceled",
      "paused",
    ].includes(billing),
  };
}

@Injectable()
export class AccountAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveOrganization(organizationId: string, now = new Date()) {
    const organization = await this.prisma.client.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        onboardingState: true,
        billingProfile: {
          select: {
            subscriptionStatus: true,
            trialEnd: true,
            gracePeriodEnd: true,
            billingName: true,
            billingEmail: true,
            billingCountryCode: true,
            billingAddressLine1: true,
            billingCity: true,
          },
        },
        locations: { where: { status: "ACTIVE" }, select: { id: true }, take: 1 },
        checkoutIdempotencyKeys: {
          orderBy: { createdAt: "desc" },
          select: { status: true },
          take: 1,
        },
        billingInvoices: {
          where: { amountRemaining: { gt: 0 }, status: { not: "void" } },
          orderBy: { invoiceDate: "desc" },
          select: { failureCategory: true, graceEndsAt: true },
          take: 1,
        },
      },
    });
    if (!organization) return null;
    return resolveMerchantOrganizationAccess(
      {
        id: organization.id,
        onboardingState: organization.onboardingState,
        activeLocationCount: organization.locations.length,
        billingProfile: organization.billingProfile,
        latestBillingCommandStatus: organization.checkoutIdempotencyKeys[0]?.status ?? null,
        outstandingInvoice: organization.billingInvoices[0] ?? null,
      },
      now,
    );
  }

  async resolveUser(userId: string, preferredOrganizationId?: string | null) {
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: {
        emailVerifiedAt: true,
        lastSelectedOrganizationId: true,
        memberships: {
          where: { status: "ACTIVE", organization: { status: { not: "ARCHIVED" } } },
          select: { organizationId: true },
          orderBy: { joinedAt: "asc" },
        },
      },
    });
    if (!user) return null;
    const organizationId =
      (preferredOrganizationId &&
      user.memberships.some((membership) => membership.organizationId === preferredOrganizationId)
        ? preferredOrganizationId
        : null) ??
      (user.lastSelectedOrganizationId &&
      user.memberships.some(
        (membership) => membership.organizationId === user.lastSelectedOrganizationId,
      )
        ? user.lastSelectedOrganizationId
        : null) ??
      user.memberships[0]?.organizationId ??
      null;
    if (!organizationId) {
      return {
        email: user.emailVerifiedAt ? "verified" : "unverified",
        onboarding: "business_required",
        billing: "none",
        access: "onboarding_only",
        organizationId: null,
        billingAttention: false,
      } satisfies MerchantAccountState;
    }
    const organization = await this.resolveOrganization(organizationId);
    if (!organization) return null;
    return {
      email: user.emailVerifiedAt ? "verified" : "unverified",
      ...organization,
    } satisfies MerchantAccountState;
  }

  async requireOperationalAccess(organizationId: string, customerFacing = false) {
    const state = await this.resolveOrganization(organizationId);
    if (state?.access === "full") return state;
    throw new AppError(
      customerFacing ? "LOYALTY_PROGRAM_TEMPORARILY_UNAVAILABLE" : "BILLING_ACTION_REQUIRED",
      customerFacing
        ? "This loyalty program is temporarily unavailable."
        : "Your subscription needs attention before you can make changes.",
      HttpStatus.PAYMENT_REQUIRED,
      customerFacing
        ? { accessState: "restricted" }
        : {
            accessState: state?.access ?? "read_only_billing_recovery",
            billingState: state?.billing ?? "restricted",
            billingUrl: "/dashboard/billing",
          },
    );
  }
}
