import { createHash, createHmac } from "node:crypto";

export type RiskSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface RiskSignalDecision {
  readonly ruleCode: string;
  readonly severity: RiskSeverity;
  readonly score: number;
  readonly ruleVersion: "w4r1-v1";
  readonly hardBlock: boolean;
  readonly errorCode: string | null;
  readonly safeEvidence: Readonly<Record<string, string | number | boolean | null>>;
}

export interface RiskRuleInput {
  readonly deviceStatus?: "ACTIVE" | "REVOKED" | "COMPROMISED" | "INVALID";
  readonly signatureValid?: boolean;
  readonly nonceReplayed?: boolean;
  readonly clockSkewed?: boolean;
  readonly wrongLocation?: boolean;
  readonly deviceOperationsLastMinute?: number;
  readonly deviceOperationLimit?: number;
  readonly staffOperationsLastHour?: number;
  readonly staffOperationLimit?: number;
  readonly membershipsTouchedLastHour?: number;
  readonly sameMembershipOperationsLastMinute?: number;
  readonly secondsSinceLastStamp?: number | null;
  readonly operationType?: "STAMP" | "REDEEM" | "REVERSE" | "OTHER";
  readonly reversalRate?: number;
  readonly managerOverridesLastHour?: number;
  readonly dailyCapOverride?: boolean;
  readonly purchasePolicyOverride?: boolean;
  readonly duplicateTransactionReference?: boolean;
  readonly transferredOrRevokedCredential?: boolean;
  readonly suspendedMembership?: boolean;
  readonly billingBlocked?: boolean;
  readonly projectionDrift?: boolean;
  readonly ledgerHashFailure?: boolean;
}

function signal(
  ruleCode: string,
  severity: RiskSeverity,
  score: number,
  hardBlock: boolean,
  errorCode: string | null,
  safeEvidence: RiskSignalDecision["safeEvidence"],
): RiskSignalDecision {
  return {
    ruleCode,
    severity,
    score,
    hardBlock,
    errorCode,
    safeEvidence,
    ruleVersion: "w4r1-v1",
  };
}

export function evaluateRiskRules(input: RiskRuleInput): {
  readonly hardBlock: boolean;
  readonly errorCode: string | null;
  readonly signals: readonly RiskSignalDecision[];
} {
  const signals: RiskSignalDecision[] = [];
  if (input.deviceStatus && input.deviceStatus !== "ACTIVE") {
    signals.push(
      signal(
        `DEVICE_${input.deviceStatus}`,
        input.deviceStatus === "COMPROMISED" ? "CRITICAL" : "HIGH",
        input.deviceStatus === "COMPROMISED" ? 100 : 90,
        true,
        "STAFF_DEVICE_NOT_ACTIVE",
        { deviceStatus: input.deviceStatus },
      ),
    );
  }
  if (input.signatureValid === false)
    signals.push(
      signal("SIGNATURE_FAILURE", "CRITICAL", 100, true, "STAFF_DEVICE_SIGNATURE_INVALID", {}),
    );
  if (input.nonceReplayed)
    signals.push(signal("NONCE_REPLAY", "CRITICAL", 100, true, "STAFF_DEVICE_NONCE_REPLAYED", {}));
  if (input.clockSkewed)
    signals.push(signal("CLOCK_SKEW", "HIGH", 85, true, "STAFF_DEVICE_CLOCK_SKEW", {}));
  if (input.wrongLocation)
    signals.push(signal("WRONG_LOCATION", "HIGH", 90, true, "LOCATION_NOT_AUTHORIZED", {}));
  if (
    input.deviceOperationsLastMinute !== undefined &&
    input.deviceOperationLimit !== undefined &&
    input.deviceOperationsLastMinute >= input.deviceOperationLimit
  ) {
    signals.push(
      signal("DEVICE_OPERATION_VELOCITY", "HIGH", 80, true, "RISK_HARD_BLOCK", {
        observed: input.deviceOperationsLastMinute,
        limit: input.deviceOperationLimit,
      }),
    );
  }
  if (
    input.staffOperationsLastHour !== undefined &&
    input.staffOperationLimit !== undefined &&
    input.staffOperationsLastHour >= input.staffOperationLimit
  ) {
    signals.push(
      signal("STAFF_OPERATION_VELOCITY", "HIGH", 80, true, "RISK_HARD_BLOCK", {
        observed: input.staffOperationsLastHour,
        limit: input.staffOperationLimit,
      }),
    );
  }
  if ((input.membershipsTouchedLastHour ?? 0) >= 50)
    signals.push(
      signal("MANY_MEMBERSHIPS_TOUCHED", "MEDIUM", 60, false, null, {
        observed: input.membershipsTouchedLastHour ?? 0,
      }),
    );
  if ((input.sameMembershipOperationsLastMinute ?? 0) >= 10)
    signals.push(
      signal("REPEATED_MEMBERSHIP_ACTIVITY", "MEDIUM", 65, false, null, {
        observed: input.sameMembershipOperationsLastMinute ?? 0,
      }),
    );
  if (
    input.operationType === "REDEEM" &&
    input.secondsSinceLastStamp !== null &&
    (input.secondsSinceLastStamp ?? Number.POSITIVE_INFINITY) <= 30
  )
    signals.push(
      signal("IMMEDIATE_STAMP_REDEMPTION", "HIGH", 75, false, null, {
        seconds: input.secondsSinceLastStamp ?? 0,
      }),
    );
  if ((input.reversalRate ?? 0) >= 0.25)
    signals.push(
      signal("HIGH_REVERSAL_RATE", "HIGH", 75, false, null, {
        basisPoints: Math.round((input.reversalRate ?? 0) * 10_000),
      }),
    );
  if ((input.managerOverridesLastHour ?? 0) >= 5)
    signals.push(
      signal("REPEATED_MANAGER_OVERRIDES", "HIGH", 75, false, null, {
        observed: input.managerOverridesLastHour ?? 0,
      }),
    );
  if (input.dailyCapOverride)
    signals.push(signal("DAILY_CAP_OVERRIDE", "MEDIUM", 55, false, null, { override: true }));
  if (input.purchasePolicyOverride)
    signals.push(signal("PURCHASE_POLICY_OVERRIDE", "MEDIUM", 55, false, null, { override: true }));
  if (input.duplicateTransactionReference)
    signals.push(
      signal("DUPLICATE_TRANSACTION_REFERENCE", "HIGH", 85, true, "RISK_HARD_BLOCK", {
        duplicate: true,
      }),
    );
  if (input.transferredOrRevokedCredential)
    signals.push(
      signal(
        "TRANSFERRED_OR_REVOKED_CREDENTIAL",
        "HIGH",
        90,
        true,
        "MEMBERSHIP_CREDENTIAL_INVALID",
        {},
      ),
    );
  if (input.suspendedMembership)
    signals.push(
      signal("SUSPENDED_MEMBERSHIP_ATTEMPT", "HIGH", 85, true, "MEMBERSHIP_NOT_OPERATIONAL", {}),
    );
  if (input.billingBlocked)
    signals.push(
      signal("BILLING_BLOCKED_ATTEMPT", "HIGH", 85, true, "OPERATION_BILLING_BLOCKED", {}),
    );
  if (input.projectionDrift)
    signals.push(signal("PROJECTION_DRIFT", "CRITICAL", 95, true, "PROJECTION_DRIFT_DETECTED", {}));
  if (input.ledgerHashFailure)
    signals.push(
      signal("LEDGER_HASH_FAILURE", "CRITICAL", 100, true, "LEDGER_INTEGRITY_FAILED", {}),
    );
  const blocking = signals.find((item) => item.hardBlock);
  return { hardBlock: Boolean(blocking), errorCode: blocking?.errorCode ?? null, signals };
}

export function riskDeduplicationKey(input: {
  readonly ruleCode: string;
  readonly organizationId: string;
  readonly subjectId: string;
  readonly windowStart: Date;
}): string {
  return createHash("sha256")
    .update(
      `${input.ruleCode}:${input.organizationId}:${input.subjectId}:${input.windowStart.toISOString()}`,
      "utf8",
    )
    .digest("hex");
}

export function normalizeMerchantTransactionReference(reference: string): string {
  const normalized = reference
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleUpperCase("en-US");
  if (normalized.length < 1 || normalized.length > 160) {
    throw new Error("MERCHANT_TRANSACTION_REFERENCE_INVALID");
  }
  return normalized;
}

export function digestMerchantTransactionReference(input: {
  readonly reference: string;
  readonly key: string;
  readonly keyVersion: number;
}): { readonly digest: string; readonly keyVersion: number; readonly normalizationVersion: 1 } {
  if (input.key.length < 32 || !Number.isInteger(input.keyVersion) || input.keyVersion < 1) {
    throw new Error("MERCHANT_TRANSACTION_REFERENCE_KEY_INVALID");
  }
  const normalized = normalizeMerchantTransactionReference(input.reference);
  return {
    digest: createHmac("sha256", input.key)
      .update(`waflo-merchant-transaction:v1:${normalized}`, "utf8")
      .digest("hex"),
    keyVersion: input.keyVersion,
    normalizationVersion: 1,
  };
}
