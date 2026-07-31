import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  calculateLedgerEntryHash,
  crossedRewardThresholds,
  EMPTY_PROJECTION,
  LEDGER_GENESIS_HASH,
  type LedgerHashableEntry,
  type LedgerHashPayloadV1,
  type ProjectionEvent,
  rebuildProjection,
  validateReversal,
  verifyLedgerHashChain,
} from "../../packages/loyalty-ledger/src/index.js";
import {
  evaluateStampPolicy,
  grossPositiveDailyStampUnits,
  operationalLocalDate,
} from "../../packages/loyalty-policy/src/index.js";
import {
  createCsv,
  EMPTY_OPERATIONAL_AGGREGATE,
  operationalDateBucket,
  reduceOperationalAggregate,
} from "../../packages/operational-analytics/src/index.js";
import {
  bodySha256,
  canonicalDeviceRequestEnvelope,
  verifyDeviceRequestSignature,
} from "../../packages/staff-device-security/src/index.js";

const ledgerSecret = "w4-unit-ledger-secret-that-is-at-least-thirty-two-characters";
const baseLedger = {
  organizationId: "10000000-0000-4000-8000-000000000001",
  membershipId: "10000000-0000-4000-8000-000000000002",
  customerId: "10000000-0000-4000-8000-000000000003",
  programId: "10000000-0000-4000-8000-000000000004",
  programVersionId: "10000000-0000-4000-8000-000000000005",
  locationId: "10000000-0000-4000-8000-000000000006",
  staffOrganizationMemberId: "10000000-0000-4000-8000-000000000007",
  staffDeviceId: "10000000-0000-4000-8000-000000000008",
  rewardEntitlementId: null,
  rewardRedemptionId: null,
  reversalOfEntryId: null,
  operationCommandId: "10000000-0000-4000-8000-000000000009",
  purchaseAmountMinor: null,
  purchaseCurrency: null,
  merchantTransactionReference: null,
  operationalTimezone: "Asia/Baghdad",
  operationalLocalDate: "2026-07-30",
  occurredAt: "2026-07-30T12:00:00.000Z",
  safeMetadata: null,
} as const;

function ledgerEntry(
  id: string,
  sequence: number,
  eventType: LedgerHashPayloadV1["eventType"],
  stampDelta: number,
  previousEntryHash: string,
  cycleNumber = 1,
): LedgerHashableEntry {
  const payload: LedgerHashPayloadV1 = {
    ...baseLedger,
    id,
    eventType,
    membershipSequence: sequence,
    cycleNumber,
    stampDelta,
    previousEntryHash,
  };
  return {
    ...payload,
    ledgerHashVersion: 1,
    entryHash: calculateLedgerEntryHash(payload, ledgerSecret),
  };
}

describe("W4 immutable loyalty ledger", () => {
  it("verifies a versioned HMAC chain and rejects tampering", () => {
    const first = ledgerEntry(
      "20000000-0000-4000-8000-000000000001",
      1,
      "STAMP_ISSUED",
      3,
      LEDGER_GENESIS_HASH,
    );
    const second = ledgerEntry(
      "20000000-0000-4000-8000-000000000002",
      2,
      "MILESTONE_REWARD_UNLOCKED",
      0,
      first.entryHash,
    );
    expect(verifyLedgerHashChain([first, second], () => ledgerSecret)).toEqual({
      valid: true,
      finalHash: second.entryHash,
      finalSequence: 2,
    });
    expect(() =>
      verifyLedgerHashChain([{ ...first, stampDelta: 4 }, second], () => ledgerSecret),
    ).toThrow(/hash mismatch/i);
  });

  it("rebuilds final-ready progress and resets only after redemption", () => {
    const events: ProjectionEvent[] = [
      {
        id: "30000000-0000-4000-8000-000000000001",
        eventType: "STAMP_ISSUED",
        membershipSequence: 1,
        cycleNumber: 1,
        stampDelta: 8,
      },
      {
        id: "30000000-0000-4000-8000-000000000002",
        eventType: "FINAL_REWARD_UNLOCKED",
        membershipSequence: 2,
        cycleNumber: 1,
        stampDelta: 0,
      },
    ];
    const ready = rebuildProjection(events, { requiredStampCount: 8 });
    expect(ready).toMatchObject({
      currentCycleStampCount: 8,
      completedCycleCount: 0,
      rewardReady: true,
      projectionVersion: 2,
    });
    const reset = rebuildProjection(
      [
        ...events,
        {
          id: "30000000-0000-4000-8000-000000000003",
          eventType: "REWARD_REDEEMED",
          membershipSequence: 3,
          cycleNumber: 1,
          stampDelta: 0,
        },
        {
          id: "30000000-0000-4000-8000-000000000004",
          eventType: "CYCLE_RESET",
          membershipSequence: 4,
          cycleNumber: 1,
          stampDelta: 0,
        },
      ],
      { requiredStampCount: 8 },
      EMPTY_PROJECTION,
    );
    expect(reset).toMatchObject({
      currentCycleStampCount: 0,
      completedCycleCount: 1,
      rewardReady: false,
      projectionVersion: 4,
    });
  });

  it("unlocks every crossed threshold and blocks unsafe reversals", () => {
    expect(
      crossedRewardThresholds(2, 8, [
        { rewardDefinitionId: "milestone", threshold: 4, final: false },
        { rewardDefinitionId: "final", threshold: 8, final: true },
      ]),
    ).toHaveLength(2);
    expect(
      validateReversal(
        {
          eventType: "STAMP_ISSUED",
          occurredAt: new Date("2026-07-30T12:00:00Z"),
          staffOrganizationMemberId: "staff",
          staffDeviceId: "device",
          alreadyReversed: false,
          hasDependentEvents: true,
          unlockedRewardRedeemed: false,
        },
        {
          now: new Date("2026-07-30T12:00:10Z"),
          actorKind: "STAFF_OWN",
          actorStaffOrganizationMemberId: "staff",
          actorStaffDeviceId: "device",
          staffWindowSeconds: 120,
          managerWindowMinutes: 1440,
        },
      ),
    ).toEqual({ allowed: false, code: "REVERSAL_DEPENDENCY_EXISTS" });
  });

  it("rebuilds 10,000 ordered ledger events without changing the final balance", () => {
    const events: ProjectionEvent[] = Array.from({ length: 10_000 }, (_, index) => ({
      id: `load-event-${String(index + 1).padStart(5, "0")}`,
      eventType: index % 2 === 0 ? "STAMP_ISSUED" : "STAMP_REVERSED",
      membershipSequence: index + 1,
      cycleNumber: 1,
      stampDelta: index % 2 === 0 ? 1 : -1,
    }));
    expect(rebuildProjection(events, { requiredStampCount: 8 })).toMatchObject({
      currentCycleStampCount: 0,
      completedCycleCount: 0,
      rewardReady: false,
      projectionVersion: 10_000,
    });
  });
});

describe("W4 operational policy", () => {
  const policy = {
    requiredStampCount: 8,
    maximumStampsPerOperation: 5,
    maximumStampsPerCustomerPerDay: 5,
    minimumPurchaseAmountMinor: 10_000,
    minimumPurchaseCurrency: "IQD",
    operationalTimezone: "Asia/Baghdad",
    resetBehaviorAfterReward: "RESET_ON_FINAL_REWARD_REDEMPTION" as const,
  };

  it("uses the pinned operational timezone at day boundaries", () => {
    const instant = new Date("2026-07-30T21:30:00.000Z");
    expect(operationalLocalDate(instant, "Asia/Baghdad")).toBe("2026-07-31");
    expect(operationalDateBucket(instant, "Asia/Baghdad")).toBe("2026-07-31");
  });

  it("counts gross positive issuance without restoring allowance on reversal", () => {
    expect(
      grossPositiveDailyStampUnits(
        [
          {
            eventType: "STAMP_ISSUED",
            stampDelta: 4,
            operationalLocalDate: "2026-07-30",
          },
          {
            eventType: "STAMP_REVERSED",
            stampDelta: -4,
            operationalLocalDate: "2026-07-30",
          },
        ],
        "2026-07-30",
      ),
    ).toBe(4);
    expect(() =>
      evaluateStampPolicy(policy, {
        requestedStamps: 2,
        currentCycleStampCount: 3,
        rewardReady: false,
        grossPositiveStampsIssuedToday: 4,
        purchaseAmountMinor: 10_000,
        purchaseCurrency: "IQD",
      }),
    ).toThrow(/daily stamp limit/i);
  });

  it("requires integer minor units and exact currency unless an audited override is valid", () => {
    expect(() =>
      evaluateStampPolicy(policy, {
        requestedStamps: 1,
        currentCycleStampCount: 2,
        rewardReady: false,
        grossPositiveStampsIssuedToday: 0,
        purchaseAmountMinor: 9_999,
        purchaseCurrency: "USD",
      }),
    ).toThrow();
    expect(
      evaluateStampPolicy(policy, {
        requestedStamps: 1,
        currentCycleStampCount: 2,
        rewardReady: false,
        grossPositiveStampsIssuedToday: 0,
        purchaseAmountMinor: 9_999,
        purchaseCurrency: "USD",
        managerOverride: {
          dailyCap: false,
          purchasePolicy: true,
          reason: "Manager confirmed an approved exception.",
          permitted: true,
        },
      }),
    ).toMatchObject({ allowed: true, purchasePolicyOverridden: true });
  });

  it("blocks additional stamps while the final reward is pending", () => {
    expect(() =>
      evaluateStampPolicy(policy, {
        requestedStamps: 1,
        currentCycleStampCount: 8,
        rewardReady: true,
        grossPositiveStampsIssuedToday: 0,
      }),
    ).toThrow(/redeemed before more stamps/i);
  });
});

describe("W4 signed Staff device requests", () => {
  it("verifies the full canonical envelope and detects body substitution", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const body = JSON.stringify({ amount: 2 });
    const envelope = {
      method: "POST",
      canonicalPath: "/v1/staff/loyalty/stamps",
      requestId: "request-001",
      timestamp: "2026-07-30T12:00:00.000Z",
      nonce: "nonce-001",
      bodyDigest: bodySha256(body),
      deviceSessionId: "session-001",
      organizationId: "10000000-0000-4000-8000-000000000001",
    };
    const signature = sign(
      null,
      Buffer.from(canonicalDeviceRequestEnvelope(envelope), "utf8"),
      privateKey,
    ).toString("base64url");
    expect(() =>
      verifyDeviceRequestSignature({
        publicKey: publicKey.export({ format: "pem", type: "spki" }).toString(),
        envelope,
        signature,
      }),
    ).not.toThrow();
    expect(() =>
      verifyDeviceRequestSignature({
        publicKey: publicKey.export({ format: "pem", type: "spki" }).toString(),
        envelope: { ...envelope, bodyDigest: bodySha256('{"amount":3}') },
        signature,
      }),
    ).toThrow(/signature/i);
  });
});

describe("W4 operational analytics and exports", () => {
  it("reduces real events and escapes spreadsheet-formula-shaped values as data", () => {
    const aggregate = reduceOperationalAggregate(
      reduceOperationalAggregate(EMPTY_OPERATIONAL_AGGREGATE, {
        type: "STAMP_ISSUED",
        stampUnits: 3,
      }),
      { type: "REWARD_REDEEMED" },
    );
    expect(aggregate).toMatchObject({
      stampUnitsIssued: 3,
      stampOperations: 1,
      rewardsRedeemed: 1,
    });
    const csv = createCsv("RISK_SIGNALS", [
      {
        signal_public_id: "=1+1",
        rule_code: 'quote"value',
        severity: "HIGH",
        status: "OPEN",
        score: 80,
        created_at: new Date("2026-07-30T12:00:00Z"),
        resolved_at: null,
      },
    ]);
    expect(csv).toContain('"\'=1+1"');
    expect(csv).toContain('"quote""value"');
  });
});
