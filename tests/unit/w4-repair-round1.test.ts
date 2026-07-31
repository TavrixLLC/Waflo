import { describe, expect, it } from "vitest";
import {
  EMPTY_PROJECTION,
  reduceProjectionEvent,
} from "../../packages/loyalty-ledger/src/index.js";
import {
  cohortMetrics,
  digestMerchantTransactionReference,
  evaluateRiskRules,
  normalizeMerchantTransactionReference,
  riskDeduplicationKey,
  safeRate,
} from "../../packages/operational-analytics/src/index.js";

describe("W4 Repair Round 1 risk engine", () => {
  it("hard-blocks every mandatory security and integrity rule with a stable safe code", () => {
    const cases = [
      [{ deviceStatus: "REVOKED" as const }, "DEVICE_REVOKED"],
      [{ deviceStatus: "COMPROMISED" as const }, "DEVICE_COMPROMISED"],
      [{ signatureValid: false }, "SIGNATURE_FAILURE"],
      [{ nonceReplayed: true }, "NONCE_REPLAY"],
      [{ clockSkewed: true }, "CLOCK_SKEW"],
      [{ wrongLocation: true }, "WRONG_LOCATION"],
      [{ deviceOperationsLastMinute: 20, deviceOperationLimit: 20 }, "DEVICE_OPERATION_VELOCITY"],
      [{ staffOperationsLastHour: 200, staffOperationLimit: 200 }, "STAFF_OPERATION_VELOCITY"],
      [{ duplicateTransactionReference: true }, "DUPLICATE_TRANSACTION_REFERENCE"],
      [{ transferredOrRevokedCredential: true }, "TRANSFERRED_OR_REVOKED_CREDENTIAL"],
      [{ suspendedMembership: true }, "SUSPENDED_MEMBERSHIP_ATTEMPT"],
      [{ billingBlocked: true }, "BILLING_BLOCKED_ATTEMPT"],
      [{ projectionDrift: true }, "PROJECTION_DRIFT"],
      [{ ledgerHashFailure: true }, "LEDGER_HASH_FAILURE"],
    ] as const;
    for (const [input, ruleCode] of cases) {
      const decision = evaluateRiskRules(input);
      expect(decision.hardBlock, ruleCode).toBe(true);
      expect(decision.errorCode, ruleCode).toBeTruthy();
      expect(
        decision.signals.map((signal) => signal.ruleCode),
        ruleCode,
      ).toContain(ruleCode);
      expect(decision.signals.every((signal) => signal.ruleVersion === "w4r1-v1")).toBe(true);
    }
  });

  it("emits every reviewable behavior rule without leaking request secrets", () => {
    const decision = evaluateRiskRules({
      membershipsTouchedLastHour: 50,
      sameMembershipOperationsLastMinute: 10,
      secondsSinceLastStamp: 10,
      operationType: "REDEEM",
      reversalRate: 0.25,
      managerOverridesLastHour: 5,
      dailyCapOverride: true,
      purchasePolicyOverride: true,
    });
    expect(decision.hardBlock).toBe(false);
    expect(decision.signals.map((signal) => signal.ruleCode).sort()).toEqual(
      [
        "DAILY_CAP_OVERRIDE",
        "HIGH_REVERSAL_RATE",
        "IMMEDIATE_STAMP_REDEMPTION",
        "MANY_MEMBERSHIPS_TOUCHED",
        "PURCHASE_POLICY_OVERRIDE",
        "REPEATED_MANAGER_OVERRIDES",
        "REPEATED_MEMBERSHIP_ACTIVITY",
      ].sort(),
    );
    const evidence = JSON.stringify(decision.signals.map((signal) => signal.safeEvidence));
    expect(evidence).not.toMatch(/qr|nonce|signature|email|phone/i);
  });

  it("creates a deterministic rule/subject/window deduplication key", () => {
    const input = {
      ruleCode: "WRONG_LOCATION",
      organizationId: "10000000-0000-4000-8000-000000000001",
      subjectId: "10000000-0000-4000-8000-000000000002",
      windowStart: new Date("2026-07-31T10:00:00.000Z"),
    };
    expect(riskDeduplicationKey(input)).toMatch(/^[a-f0-9]{64}$/);
    expect(riskDeduplicationKey(input)).toBe(riskDeduplicationKey(input));
    expect(
      riskDeduplicationKey({ ...input, windowStart: new Date("2026-07-31T11:00:00.000Z") }),
    ).not.toBe(riskDeduplicationKey(input));
  });
});

describe("W4 Repair Round 1 transaction-reference security", () => {
  it("normalizes NFKC and whitespace before producing a keyed, versioned digest", () => {
    expect(normalizeMerchantTransactionReference("  invoice\u3000１２３  ")).toBe("INVOICE 123");
    const first = digestMerchantTransactionReference({
      reference: " invoice 123 ",
      key: "rotation-key-one-is-at-least-thirty-two-characters",
      keyVersion: 1,
    });
    const equivalent = digestMerchantTransactionReference({
      reference: "INVOICE\u3000１２３",
      key: "rotation-key-one-is-at-least-thirty-two-characters",
      keyVersion: 1,
    });
    expect(first).toEqual(equivalent);
    expect(first).toMatchObject({ keyVersion: 1, normalizationVersion: 1 });
    expect(first.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(first.digest).not.toContain("INVOICE");
  });

  it("supports key-version rotation without digest collisions", () => {
    const v1 = digestMerchantTransactionReference({
      reference: "receipt-42",
      key: "rotation-key-one-is-at-least-thirty-two-characters",
      keyVersion: 1,
    });
    const v2 = digestMerchantTransactionReference({
      reference: "receipt-42",
      key: "rotation-key-two-is-at-least-thirty-two-characters",
      keyVersion: 2,
    });
    expect(v2.keyVersion).toBe(2);
    expect(v2.digest).not.toBe(v1.digest);
  });
});

describe("W4 Repair Round 1 analytics and expiry projection", () => {
  it("calculates cohort timing, retention, and completion distribution", () => {
    const enrolledAt = new Date("2026-07-01T00:00:00.000Z");
    expect(
      cohortMetrics([
        {
          membershipId: "a",
          enrolledAt,
          firstActivityAt: new Date("2026-07-01T02:00:00.000Z"),
          firstRewardAt: new Date("2026-07-01T08:00:00.000Z"),
          firstRedemptionAt: new Date("2026-07-01T11:00:00.000Z"),
          active: true,
          completedCycles: 2,
        },
        {
          membershipId: "b",
          enrolledAt,
          firstActivityAt: new Date("2026-07-01T04:00:00.000Z"),
          firstRewardAt: null,
          firstRedemptionAt: null,
          active: false,
          completedCycles: 0,
        },
      ]),
    ).toEqual({
      cohortSize: 2,
      firstActivityCount: 2,
      retainedCount: 1,
      retainedRate: 0.5,
      averageHoursToFirstStamp: 3,
      averageHoursToReward: 8,
      averageHoursUnlockToRedemption: 3,
      completionDistribution: { 0: 1, 2: 1 },
    });
    expect(safeRate(1, 0)).toBe(0);
  });

  it("records reward expiry as an authoritative no-balance-change projection event", () => {
    const prior = {
      ...EMPTY_PROJECTION,
      currentCycleStampCount: 4,
      projectionVersion: 1,
      lastSourceEventId: "previous",
    };
    const next = reduceProjectionEvent(
      prior,
      {
        id: "expiry-event",
        eventType: "REWARD_EXPIRED",
        membershipSequence: 2,
        cycleNumber: 1,
        stampDelta: 0,
      },
      { requiredStampCount: 8 },
    );
    expect(next).toMatchObject({
      currentCycleStampCount: 4,
      completedCycleCount: 0,
      rewardReady: false,
      projectionVersion: 2,
      lastSourceEventId: "expiry-event",
    });
  });
});
