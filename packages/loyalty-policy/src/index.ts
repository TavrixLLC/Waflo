export const loyaltyOperationErrorCodes = [
  "MEMBERSHIP_NOT_OPERATIONAL",
  "MEMBERSHIP_CREDENTIAL_INVALID",
  "PROGRAM_NOT_OPERATIONAL",
  "PROGRAM_VERSION_MISMATCH",
  "LOCATION_NOT_AUTHORIZED",
  "LOCATION_EARNING_DISABLED",
  "LOCATION_REDEMPTION_DISABLED",
  "STAFF_DEVICE_NOT_ACTIVE",
  "STAFF_DEVICE_SIGNATURE_INVALID",
  "STAFF_DEVICE_NONCE_REPLAYED",
  "STAFF_DEVICE_CLOCK_SKEW",
  "STAFF_ASSIGNMENT_REQUIRED",
  "STAMP_AMOUNT_INVALID",
  "STAMP_OPERATION_LIMIT_EXCEEDED",
  "DAILY_STAMP_LIMIT_REACHED",
  "PURCHASE_AMOUNT_REQUIRED",
  "PURCHASE_CURRENCY_MISMATCH",
  "PURCHASE_THRESHOLD_NOT_MET",
  "FINAL_REWARD_PENDING_REDEMPTION",
  "REWARD_NOT_AVAILABLE",
  "REWARD_EXPIRED",
  "REWARD_ALREADY_REDEEMED",
  "MANAGER_APPROVAL_REQUIRED",
  "MANAGER_APPROVAL_INVALID",
  "OPERATION_IDEMPOTENCY_CONFLICT",
  "OPERATION_NOT_REVERSIBLE",
  "REVERSAL_WINDOW_EXPIRED",
  "REVERSAL_DEPENDENCY_EXISTS",
  "MANUAL_ADJUSTMENT_INVALID",
  "LEDGER_INTEGRITY_FAILED",
  "PROJECTION_DRIFT_DETECTED",
  "OPERATION_BILLING_BLOCKED",
  "DEVICE_PAIRING_EXPIRED",
  "DEVICE_PAIRING_ALREADY_USED",
  "DEVICE_PAIRING_INVALID",
  "RISK_HARD_BLOCK",
] as const;

export type LoyaltyOperationErrorCode = (typeof loyaltyOperationErrorCodes)[number];

export class LoyaltyPolicyError extends Error {
  readonly code: LoyaltyOperationErrorCode;

  constructor(code: LoyaltyOperationErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "LoyaltyPolicyError";
  }
}

export const OPERATIONALLY_ALLOWED_BILLING_STATUSES = new Set([
  "TRIALING",
  "ACTIVE",
  "GRACE_PERIOD",
]);

export const OPERATIONALLY_BLOCKED_BILLING_STATUSES = new Set([
  "PENDING_ACTIVATION",
  "PAST_DUE",
  "SUSPENDED",
  "CANCELED",
]);

export interface StampPolicy {
  readonly requiredStampCount: number;
  readonly maximumStampsPerOperation: number;
  readonly maximumStampsPerCustomerPerDay: number | null;
  readonly minimumPurchaseAmountMinor: number | null;
  readonly minimumPurchaseCurrency: string | null;
  readonly operationalTimezone: string;
  readonly resetBehaviorAfterReward: "RESET_ON_FINAL_REWARD_REDEMPTION";
}

export interface StampPolicyContext {
  readonly requestedStamps: number;
  readonly currentCycleStampCount: number;
  readonly rewardReady: boolean;
  readonly grossPositiveStampsIssuedToday: number;
  readonly purchaseAmountMinor?: number | null;
  readonly purchaseCurrency?: string | null;
  readonly managerOverride?: {
    readonly dailyCap: boolean;
    readonly purchasePolicy: boolean;
    readonly reason: string;
    readonly permitted: boolean;
  } | null;
}

export interface StampPolicyDecision {
  readonly allowed: true;
  readonly nextCycleStampCount: number;
  readonly reachesFinalReward: boolean;
  readonly dailyCapOverridden: boolean;
  readonly purchasePolicyOverridden: boolean;
}

function validCurrency(value: string): boolean {
  return /^[A-Z]{3}$/.test(value);
}

export function normalizeResetBehavior(value: string): "RESET_ON_FINAL_REWARD_REDEMPTION" {
  if (value === "RESET" || value === "RESET_ON_FINAL_REWARD_REDEMPTION") {
    return "RESET_ON_FINAL_REWARD_REDEMPTION";
  }
  throw new LoyaltyPolicyError(
    "PROGRAM_NOT_OPERATIONAL",
    "Only reset on final reward redemption is supported.",
  );
}

export function assertOperationalTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date(0));
  } catch {
    throw new LoyaltyPolicyError("PROGRAM_NOT_OPERATIONAL", "Invalid operational timezone.");
  }
}

export function operationalLocalDate(timestamp: Date, timezone: string): string {
  assertOperationalTimezone(timezone);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(timestamp);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = values.year;
  const month = values.month;
  const day = values.day;
  if (!year || !month || !day) {
    throw new LoyaltyPolicyError("PROGRAM_NOT_OPERATIONAL", "Could not resolve operational day.");
  }
  return `${year}-${month}-${day}`;
}

function hasOverride(context: StampPolicyContext, policy: "dailyCap" | "purchasePolicy"): boolean {
  const override = context.managerOverride;
  return Boolean(override?.permitted && override[policy] && override.reason.trim().length >= 3);
}

export function evaluateStampPolicy(
  policy: StampPolicy,
  context: StampPolicyContext,
): StampPolicyDecision {
  assertOperationalTimezone(policy.operationalTimezone);
  normalizeResetBehavior(policy.resetBehaviorAfterReward);
  if (
    !Number.isInteger(policy.requiredStampCount) ||
    policy.requiredStampCount < 2 ||
    policy.requiredStampCount > 30
  ) {
    throw new LoyaltyPolicyError("PROGRAM_NOT_OPERATIONAL", "The stamp goal is invalid.");
  }
  if (!Number.isInteger(context.requestedStamps) || context.requestedStamps <= 0) {
    throw new LoyaltyPolicyError(
      "STAMP_AMOUNT_INVALID",
      "Stamp amount must be a positive integer.",
    );
  }
  if (
    !Number.isInteger(policy.maximumStampsPerOperation) ||
    policy.maximumStampsPerOperation <= 0 ||
    context.requestedStamps > policy.maximumStampsPerOperation
  ) {
    throw new LoyaltyPolicyError(
      "STAMP_OPERATION_LIMIT_EXCEEDED",
      "Stamp amount exceeds the operation limit.",
    );
  }
  if (context.rewardReady) {
    throw new LoyaltyPolicyError(
      "FINAL_REWARD_PENDING_REDEMPTION",
      "The final reward must be redeemed before more stamps can be issued.",
    );
  }
  const nextCycleStampCount = context.currentCycleStampCount + context.requestedStamps;
  if (nextCycleStampCount > policy.requiredStampCount) {
    throw new LoyaltyPolicyError(
      "STAMP_OPERATION_LIMIT_EXCEEDED",
      "The requested stamps would exceed the cycle goal.",
    );
  }

  const dailyCapOverridden = hasOverride(context, "dailyCap");
  if (
    policy.maximumStampsPerCustomerPerDay !== null &&
    context.grossPositiveStampsIssuedToday + context.requestedStamps >
      policy.maximumStampsPerCustomerPerDay &&
    !dailyCapOverridden
  ) {
    throw new LoyaltyPolicyError(
      "DAILY_STAMP_LIMIT_REACHED",
      "The membership has reached its daily stamp limit.",
    );
  }

  const purchasePolicyOverridden = hasOverride(context, "purchasePolicy");
  if (policy.minimumPurchaseAmountMinor !== null) {
    if (policy.minimumPurchaseCurrency === null || !validCurrency(policy.minimumPurchaseCurrency)) {
      throw new LoyaltyPolicyError("PROGRAM_NOT_OPERATIONAL", "Purchase currency is invalid.");
    }
    if (
      (context.purchaseAmountMinor === null ||
        context.purchaseAmountMinor === undefined ||
        !Number.isSafeInteger(context.purchaseAmountMinor) ||
        context.purchaseAmountMinor < 0) &&
      !purchasePolicyOverridden
    ) {
      throw new LoyaltyPolicyError(
        "PURCHASE_AMOUNT_REQUIRED",
        "A purchase amount in minor units is required.",
      );
    }
    const suppliedCurrency = context.purchaseCurrency?.toUpperCase() ?? null;
    if (suppliedCurrency !== policy.minimumPurchaseCurrency && !purchasePolicyOverridden) {
      throw new LoyaltyPolicyError(
        "PURCHASE_CURRENCY_MISMATCH",
        "The purchase currency does not match the program currency.",
      );
    }
    if (
      (context.purchaseAmountMinor ?? -1) < policy.minimumPurchaseAmountMinor &&
      !purchasePolicyOverridden
    ) {
      throw new LoyaltyPolicyError(
        "PURCHASE_THRESHOLD_NOT_MET",
        "The purchase does not meet the minimum amount.",
      );
    }
  }

  return {
    allowed: true,
    nextCycleStampCount,
    reachesFinalReward: nextCycleStampCount === policy.requiredStampCount,
    dailyCapOverridden,
    purchasePolicyOverridden,
  };
}

export interface OperationalEligibility {
  readonly organizationStatus: string;
  readonly billingStatus: string;
  readonly programStatus: string;
  readonly membershipStatus: string;
  readonly credentialStatus: string;
  readonly membershipProgramVersionId: string;
  readonly resolvedProgramVersionId: string;
  readonly locationActive: boolean;
  readonly staffAssignmentActive: boolean;
  readonly deviceAssignmentActive: boolean;
  readonly earningEnabled: boolean;
  readonly redemptionEnabled: boolean;
}

export function assertOperationalEligibility(
  input: OperationalEligibility,
  operation: "EARN" | "REDEEM",
): void {
  if (input.organizationStatus !== "ACTIVE") {
    throw new LoyaltyPolicyError("PROGRAM_NOT_OPERATIONAL", "Organization is not operational.");
  }
  if (!OPERATIONALLY_ALLOWED_BILLING_STATUSES.has(input.billingStatus)) {
    throw new LoyaltyPolicyError(
      "OPERATION_BILLING_BLOCKED",
      "Billing status does not permit loyalty operations.",
    );
  }
  if (input.programStatus !== "PUBLISHED") {
    throw new LoyaltyPolicyError("PROGRAM_NOT_OPERATIONAL", "Program is not operational.");
  }
  if (input.membershipStatus !== "ACTIVE") {
    throw new LoyaltyPolicyError("MEMBERSHIP_NOT_OPERATIONAL", "Membership is not operational.");
  }
  if (input.credentialStatus !== "ACTIVE") {
    throw new LoyaltyPolicyError(
      "MEMBERSHIP_CREDENTIAL_INVALID",
      "Membership credential is invalid.",
    );
  }
  if (input.membershipProgramVersionId !== input.resolvedProgramVersionId) {
    throw new LoyaltyPolicyError(
      "PROGRAM_VERSION_MISMATCH",
      "Membership program version does not match.",
    );
  }
  if (!input.locationActive || !input.staffAssignmentActive || !input.deviceAssignmentActive) {
    throw new LoyaltyPolicyError(
      input.staffAssignmentActive ? "LOCATION_NOT_AUTHORIZED" : "STAFF_ASSIGNMENT_REQUIRED",
      "The staff device is not assigned to this location.",
    );
  }
  if (operation === "EARN" && !input.earningEnabled) {
    throw new LoyaltyPolicyError(
      "LOCATION_EARNING_DISABLED",
      "Stamp earning is disabled at this location.",
    );
  }
  if (operation === "REDEEM" && !input.redemptionEnabled) {
    throw new LoyaltyPolicyError(
      "LOCATION_REDEMPTION_DISABLED",
      "Reward redemption is disabled at this location.",
    );
  }
}

export function grossPositiveDailyStampUnits(
  entries: readonly {
    readonly eventType: string;
    readonly stampDelta: number;
    readonly operationalLocalDate: string;
  }[],
  localDate: string,
): number {
  return entries.reduce(
    (total, entry) =>
      entry.operationalLocalDate === localDate &&
      (entry.eventType === "STAMP_ISSUED" || entry.eventType === "MANUAL_STAMP_ADJUSTMENT") &&
      entry.stampDelta > 0
        ? total + entry.stampDelta
        : total,
    0,
  );
}

export interface RewardRedemptionPolicy {
  readonly entitlementStatus: string;
  readonly redemptionCount: number;
  readonly maximumRedemptionCount: number;
  readonly expiresAt: Date | null;
  readonly requiresManagerApproval: boolean;
  readonly managerApprovalValid: boolean;
}

export function assertRewardRedeemable(input: RewardRedemptionPolicy, now: Date): void {
  if (!["AVAILABLE", "PARTIALLY_REDEEMED"].includes(input.entitlementStatus)) {
    throw new LoyaltyPolicyError(
      input.entitlementStatus === "REDEEMED" ? "REWARD_ALREADY_REDEEMED" : "REWARD_NOT_AVAILABLE",
      "Reward is not available.",
    );
  }
  if (input.expiresAt && input.expiresAt.getTime() <= now.getTime()) {
    throw new LoyaltyPolicyError("REWARD_EXPIRED", "Reward has expired.");
  }
  if (input.redemptionCount >= input.maximumRedemptionCount) {
    throw new LoyaltyPolicyError("REWARD_ALREADY_REDEEMED", "Reward is fully redeemed.");
  }
  if (input.requiresManagerApproval && !input.managerApprovalValid) {
    throw new LoyaltyPolicyError("MANAGER_APPROVAL_REQUIRED", "Manager approval is required.");
  }
}
