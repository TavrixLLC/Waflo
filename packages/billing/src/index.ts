import type { BillingStatus, PlanCode } from "@waflo/contracts";

export interface PlanLimits {
  readonly locations: number | null;
  readonly teamSeats: number | null;
  readonly programs: number | null;
}

export interface PlanFeatures {
  readonly advancedCustomization: boolean;
  readonly advancedAnalytics: boolean;
  readonly campaigns: boolean;
  readonly customDomains: boolean;
  readonly apiAccess: boolean;
  readonly webhooks: boolean;
  readonly advancedExports: boolean;
}

export interface PlanDefinition {
  readonly code: PlanCode;
  readonly name: string;
  readonly monthlyPriceUsd: number;
  readonly limits: PlanLimits;
  readonly features: PlanFeatures;
}

export const planCatalog: Readonly<Record<PlanCode, PlanDefinition>> = {
  starter: {
    code: "starter",
    name: "Starter",
    monthlyPriceUsd: 29,
    limits: { locations: 1, teamSeats: 3, programs: 1 },
    features: {
      advancedCustomization: false,
      advancedAnalytics: false,
      campaigns: false,
      customDomains: false,
      apiAccess: false,
      webhooks: false,
      advancedExports: false,
    },
  },
  growth: {
    code: "growth",
    name: "Growth",
    monthlyPriceUsd: 69,
    limits: { locations: 3, teamSeats: 10, programs: null },
    features: {
      advancedCustomization: true,
      advancedAnalytics: true,
      campaigns: false,
      customDomains: false,
      apiAccess: false,
      webhooks: false,
      advancedExports: false,
    },
  },
  scale: {
    code: "scale",
    name: "Scale",
    monthlyPriceUsd: 129,
    limits: { locations: null, teamSeats: null, programs: null },
    features: {
      advancedCustomization: true,
      advancedAnalytics: true,
      campaigns: false,
      customDomains: false,
      apiAccess: false,
      webhooks: false,
      advancedExports: true,
    },
  },
} as const;

export interface EntitlementDecision {
  readonly allowed: boolean;
  readonly limit: number | null;
  readonly currentUsage: number;
  readonly remaining: number | null;
  readonly reasonCode: "ALLOWED" | "LIMIT_REACHED" | "FEATURE_UNAVAILABLE";
  readonly recommendedPlan: PlanCode | null;
}

export function usageDecision(
  plan: PlanCode,
  kind: "locations" | "teamSeats" | "programs",
  currentUsage: number,
  configuredScaleLimit?: number,
): EntitlementDecision {
  const catalogLimit = planCatalog[plan].limits[kind];
  const limit = plan === "scale" ? (configuredScaleLimit ?? catalogLimit) : catalogLimit;
  const allowed = limit === null || currentUsage < limit;
  const remaining = limit === null ? null : Math.max(0, limit - currentUsage);
  return {
    allowed,
    limit,
    currentUsage,
    remaining,
    reasonCode: allowed ? "ALLOWED" : "LIMIT_REACHED",
    recommendedPlan: allowed
      ? null
      : plan === "starter"
        ? "growth"
        : plan === "growth"
          ? "scale"
          : null,
  };
}

export function canCreateLocation(
  plan: PlanCode,
  currentUsage: number,
  configuredScaleLimit?: number,
): EntitlementDecision {
  return usageDecision(plan, "locations", currentUsage, configuredScaleLimit);
}

export function canInviteTeamMember(
  plan: PlanCode,
  currentUsage: number,
  configuredScaleLimit?: number,
): EntitlementDecision {
  return usageDecision(plan, "teamSeats", currentUsage, configuredScaleLimit);
}

export type ProgramEntitlement =
  | "canCreateProgram"
  | "canRestoreProgram"
  | "canPublishProgram"
  | "canUseProMode"
  | "canUseAdvancedLayouts"
  | "canUseCustomStampUploads"
  | "canUseMilestoneRewards"
  | "canUseMultipleRewards"
  | "canUseAdvancedWalletPreviewControls";

export function programEntitlement(plan: PlanCode, entitlement: ProgramEntitlement): boolean {
  if (
    entitlement === "canUseProMode" ||
    entitlement === "canUseAdvancedLayouts" ||
    entitlement === "canUseMultipleRewards" ||
    entitlement === "canUseMilestoneRewards" ||
    entitlement === "canUseAdvancedWalletPreviewControls"
  )
    return plan !== "starter";
  if (entitlement === "canUseCustomStampUploads") return true;
  return true;
}

export function canCreateProgram(plan: PlanCode, currentUsage: number): EntitlementDecision {
  return usageDecision(plan, "programs", currentUsage);
}

export function canRestoreProgram(plan: PlanCode, currentUsage: number): EntitlementDecision {
  return canCreateProgram(plan, currentUsage);
}

export function formatPlanPrice(plan: PlanCode): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(planCatalog[plan].monthlyPriceUsd);
}

export interface TrialState {
  readonly status: BillingStatus;
  readonly started: boolean;
  readonly trialStart: Date | null;
  readonly trialEnd: Date | null;
  readonly messageKey: "trial.pending" | "trial.active" | "trial.inactive";
}

export function calculateTrialState(input: {
  status: BillingStatus;
  trialStart: Date | null;
  trialEnd: Date | null;
}): TrialState {
  if (input.status === "pending_activation") {
    return {
      status: input.status,
      started: false,
      trialStart: null,
      trialEnd: null,
      messageKey: "trial.pending",
    };
  }
  return {
    status: input.status,
    started: input.trialStart !== null,
    trialStart: input.trialStart,
    trialEnd: input.trialEnd,
    messageKey: input.status === "trialing" ? "trial.active" : "trial.inactive",
  };
}
