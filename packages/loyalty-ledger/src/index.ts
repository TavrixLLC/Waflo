import { createHmac, timingSafeEqual } from "node:crypto";

export const LEDGER_HASH_VERSION = 1 as const;
export const LEDGER_GENESIS_HASH = "0".repeat(64);

export const loyaltyLedgerEventTypes = [
  "STAMP_ISSUED",
  "STAMP_REVERSED",
  "MILESTONE_REWARD_UNLOCKED",
  "FINAL_REWARD_UNLOCKED",
  "REWARD_REDEEMED",
  "REWARD_REDEMPTION_REVERSED",
  "REWARD_EXPIRED",
  "CYCLE_RESET",
  "CYCLE_RESET_REVERSED",
  "MANUAL_STAMP_ADJUSTMENT",
  "MEMBERSHIP_SUSPENDED",
  "MEMBERSHIP_RESTORED",
  "MEMBERSHIP_REVOKED",
  "PROJECTION_REBUILT",
] as const;

export type LoyaltyLedgerEventType = (typeof loyaltyLedgerEventTypes)[number];

export interface LedgerHashPayloadV1 {
  readonly id: string;
  readonly organizationId: string;
  readonly membershipId: string;
  readonly customerId: string;
  readonly programId: string;
  readonly programVersionId: string;
  readonly locationId: string | null;
  readonly staffOrganizationMemberId: string | null;
  readonly staffDeviceId: string | null;
  readonly eventType: LoyaltyLedgerEventType;
  readonly membershipSequence: number;
  readonly cycleNumber: number;
  readonly stampDelta: number;
  readonly rewardEntitlementId: string | null;
  readonly rewardRedemptionId: string | null;
  readonly reversalOfEntryId: string | null;
  readonly operationCommandId: string;
  readonly purchaseAmountMinor: number | null;
  readonly purchaseCurrency: string | null;
  readonly merchantTransactionReference: string | null;
  readonly merchantTransactionReferenceKeyVersion?: number | null;
  readonly merchantTransactionReferenceNormalizationVersion?: number | null;
  readonly operationalTimezone: string;
  readonly operationalLocalDate: string;
  readonly occurredAt: string;
  readonly safeMetadata: unknown;
  readonly previousEntryHash: string;
}

export interface LedgerHashableEntry extends LedgerHashPayloadV1 {
  readonly ledgerHashVersion: typeof LEDGER_HASH_VERSION;
  readonly entryHash: string;
}

export interface ProjectionState {
  readonly currentCycleStampCount: number;
  readonly completedCycleCount: number;
  readonly rewardReady: boolean;
  readonly projectionVersion: number;
  readonly lastSourceEventId: string | null;
}

export interface ProjectionEvent {
  readonly id: string;
  readonly eventType: LoyaltyLedgerEventType;
  readonly membershipSequence: number;
  readonly cycleNumber: number;
  readonly stampDelta: number;
}

export interface ProjectionPolicy {
  readonly requiredStampCount: number;
}

export class LedgerInvariantError extends Error {
  readonly code:
    | "LEDGER_SEQUENCE_INVALID"
    | "LEDGER_CYCLE_INVALID"
    | "LEDGER_STAMP_RANGE_INVALID"
    | "LEDGER_REWARD_STATE_INVALID"
    | "LEDGER_HASH_INVALID"
    | "LEDGER_EVENT_INVALID";

  constructor(
    code:
      | "LEDGER_SEQUENCE_INVALID"
      | "LEDGER_CYCLE_INVALID"
      | "LEDGER_STAMP_RANGE_INVALID"
      | "LEDGER_REWARD_STATE_INVALID"
      | "LEDGER_EVENT_INVALID"
      | "LEDGER_HASH_INVALID",
    message: string,
  ) {
    super(message);
    this.code = code;
    this.name = "LedgerInvariantError";
  }
}

export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right, "en"));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new LedgerInvariantError("LEDGER_EVENT_INVALID", "Non-finite numbers are not canonical.");
  }
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  const encoded = JSON.stringify(value);
  if (encoded === undefined) {
    throw new LedgerInvariantError("LEDGER_EVENT_INVALID", "Unsupported canonical value.");
  }
  return encoded;
}

function assertHash(value: string, label: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new LedgerInvariantError("LEDGER_HASH_INVALID", `${label} is not a SHA-256 hash.`);
  }
}

export function calculateLedgerEntryHash(
  payload: LedgerHashPayloadV1,
  secret: string,
  hashVersion: typeof LEDGER_HASH_VERSION = LEDGER_HASH_VERSION,
): string {
  if (secret.length < 32) {
    throw new LedgerInvariantError(
      "LEDGER_HASH_INVALID",
      "The ledger hash secret must contain at least 32 characters.",
    );
  }
  assertHash(payload.previousEntryHash, "Previous entry hash");
  // Hash version 1 predates the transaction-reference key metadata. Keep
  // those additive database fields outside the v1 canonical payload so
  // existing append-only chains remain verifiable after the W4R1 migration.
  const {
    merchantTransactionReferenceKeyVersion: _merchantTransactionReferenceKeyVersion,
    merchantTransactionReferenceNormalizationVersion:
      _merchantTransactionReferenceNormalizationVersion,
    ...versionedPayload
  } = payload;
  return createHmac("sha256", secret)
    .update(
      canonicalJson({
        ledgerHashVersion: hashVersion,
        payload: versionedPayload,
      }),
      "utf8",
    )
    .digest("hex");
}

function hashesEqual(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export function verifyLedgerHashChain(
  entries: readonly LedgerHashableEntry[],
  secretForVersion: (version: number) => string | undefined,
  options: { readonly expectedPreviousHash?: string; readonly expectedStartSequence?: number } = {},
): { readonly valid: true; readonly finalHash: string; readonly finalSequence: number } {
  let previousHash = options.expectedPreviousHash ?? LEDGER_GENESIS_HASH;
  let expectedSequence = options.expectedStartSequence ?? 1;
  assertHash(previousHash, "Expected previous hash");

  for (const entry of entries) {
    if (entry.membershipSequence !== expectedSequence) {
      throw new LedgerInvariantError(
        "LEDGER_SEQUENCE_INVALID",
        `Expected membership sequence ${expectedSequence}.`,
      );
    }
    if (!hashesEqual(entry.previousEntryHash, previousHash)) {
      throw new LedgerInvariantError(
        "LEDGER_HASH_INVALID",
        `Previous hash mismatch at sequence ${entry.membershipSequence}.`,
      );
    }
    const secret = secretForVersion(entry.ledgerHashVersion);
    if (!secret) {
      throw new LedgerInvariantError(
        "LEDGER_HASH_INVALID",
        `No secret is available for hash version ${entry.ledgerHashVersion}.`,
      );
    }
    const { entryHash: _entryHash, ledgerHashVersion: _ledgerHashVersion, ...payload } = entry;
    const expected = calculateLedgerEntryHash(payload, secret, entry.ledgerHashVersion);
    if (!hashesEqual(expected, entry.entryHash)) {
      throw new LedgerInvariantError(
        "LEDGER_HASH_INVALID",
        `Entry hash mismatch at sequence ${entry.membershipSequence}.`,
      );
    }
    previousHash = entry.entryHash;
    expectedSequence += 1;
  }

  return {
    valid: true,
    finalHash: previousHash,
    finalSequence: expectedSequence - 1,
  };
}

export const EMPTY_PROJECTION: ProjectionState = {
  currentCycleStampCount: 0,
  completedCycleCount: 0,
  rewardReady: false,
  projectionVersion: 0,
  lastSourceEventId: null,
};

export function reduceProjectionEvent(
  prior: ProjectionState,
  event: ProjectionEvent,
  policy: ProjectionPolicy,
): ProjectionState {
  if (
    !Number.isInteger(policy.requiredStampCount) ||
    policy.requiredStampCount < 2 ||
    policy.requiredStampCount > 30
  ) {
    throw new LedgerInvariantError("LEDGER_EVENT_INVALID", "Invalid required stamp count.");
  }
  if (event.membershipSequence !== prior.projectionVersion + 1) {
    throw new LedgerInvariantError(
      "LEDGER_SEQUENCE_INVALID",
      `Projection expected sequence ${prior.projectionVersion + 1}.`,
    );
  }
  if (event.cycleNumber !== prior.completedCycleCount + 1) {
    throw new LedgerInvariantError(
      "LEDGER_CYCLE_INVALID",
      "Event cycle does not match the active membership cycle.",
    );
  }

  let stamps = prior.currentCycleStampCount;
  let completedCycles = prior.completedCycleCount;
  let rewardReady = prior.rewardReady;

  switch (event.eventType) {
    case "STAMP_ISSUED":
    case "MANUAL_STAMP_ADJUSTMENT": {
      if (event.eventType === "STAMP_ISSUED" && event.stampDelta <= 0) {
        throw new LedgerInvariantError("LEDGER_EVENT_INVALID", "Stamp issuance must be positive.");
      }
      if (rewardReady && event.stampDelta > 0) {
        throw new LedgerInvariantError(
          "LEDGER_REWARD_STATE_INVALID",
          "Stamps cannot be added while the final reward is ready.",
        );
      }
      stamps += event.stampDelta;
      if (stamps < 0 || stamps > policy.requiredStampCount) {
        throw new LedgerInvariantError(
          "LEDGER_STAMP_RANGE_INVALID",
          "Stamp count would leave the permitted range.",
        );
      }
      rewardReady = stamps === policy.requiredStampCount;
      break;
    }
    case "STAMP_REVERSED": {
      if (event.stampDelta >= 0) {
        throw new LedgerInvariantError("LEDGER_EVENT_INVALID", "Stamp reversal must be negative.");
      }
      stamps += event.stampDelta;
      if (stamps < 0) {
        throw new LedgerInvariantError(
          "LEDGER_STAMP_RANGE_INVALID",
          "Stamp reversal would make progress negative.",
        );
      }
      rewardReady = stamps === policy.requiredStampCount;
      break;
    }
    case "FINAL_REWARD_UNLOCKED": {
      if (stamps !== policy.requiredStampCount) {
        throw new LedgerInvariantError(
          "LEDGER_REWARD_STATE_INVALID",
          "The final reward can unlock only at the goal.",
        );
      }
      rewardReady = true;
      break;
    }
    case "CYCLE_RESET": {
      if (!rewardReady || stamps !== policy.requiredStampCount) {
        throw new LedgerInvariantError(
          "LEDGER_REWARD_STATE_INVALID",
          "A cycle can reset only after a ready final reward is redeemed.",
        );
      }
      stamps = 0;
      rewardReady = false;
      completedCycles += 1;
      break;
    }
    case "CYCLE_RESET_REVERSED": {
      if (stamps !== 0 || rewardReady || completedCycles < 1) {
        throw new LedgerInvariantError(
          "LEDGER_REWARD_STATE_INVALID",
          "Only an untouched empty cycle can be restored.",
        );
      }
      stamps = policy.requiredStampCount;
      rewardReady = true;
      completedCycles -= 1;
      break;
    }
    case "MEMBERSHIP_REVOKED":
    case "MEMBERSHIP_RESTORED":
    case "MEMBERSHIP_SUSPENDED":
    case "MILESTONE_REWARD_UNLOCKED":
    case "PROJECTION_REBUILT":
    case "REWARD_REDEEMED":
    case "REWARD_EXPIRED":
    case "REWARD_REDEMPTION_REVERSED": {
      if (event.stampDelta !== 0) {
        throw new LedgerInvariantError(
          "LEDGER_EVENT_INVALID",
          `${event.eventType} cannot carry a stamp delta.`,
        );
      }
      break;
    }
  }

  return {
    currentCycleStampCount: stamps,
    completedCycleCount: completedCycles,
    rewardReady,
    projectionVersion: event.membershipSequence,
    lastSourceEventId: event.id,
  };
}

export function rebuildProjection(
  events: readonly ProjectionEvent[],
  policy: ProjectionPolicy,
  initial: ProjectionState = EMPTY_PROJECTION,
): ProjectionState {
  return events.reduce(
    (projection, event) => reduceProjectionEvent(projection, event, policy),
    initial,
  );
}

export interface RewardThreshold {
  readonly rewardDefinitionId: string;
  readonly threshold: number;
  readonly final: boolean;
}

export function crossedRewardThresholds(
  priorProgress: number,
  nextProgress: number,
  rewards: readonly RewardThreshold[],
): readonly RewardThreshold[] {
  if (
    !Number.isInteger(priorProgress) ||
    !Number.isInteger(nextProgress) ||
    priorProgress < 0 ||
    nextProgress < priorProgress
  ) {
    throw new LedgerInvariantError("LEDGER_EVENT_INVALID", "Invalid reward threshold range.");
  }
  return [...rewards]
    .filter((reward) => reward.threshold > priorProgress && reward.threshold <= nextProgress)
    .sort((left, right) => left.threshold - right.threshold);
}

export interface ReversalCandidate {
  readonly eventType: LoyaltyLedgerEventType;
  readonly occurredAt: Date;
  readonly staffOrganizationMemberId: string | null;
  readonly staffDeviceId: string | null;
  readonly alreadyReversed: boolean;
  readonly hasDependentEvents: boolean;
  readonly unlockedRewardRedeemed: boolean;
}

export function validateReversal(
  candidate: ReversalCandidate,
  context: {
    readonly now: Date;
    readonly actorKind: "STAFF_OWN" | "MANAGER";
    readonly actorStaffOrganizationMemberId?: string;
    readonly actorStaffDeviceId?: string;
    readonly staffWindowSeconds: number;
    readonly managerWindowMinutes: number;
    readonly reason?: string;
  },
): { readonly allowed: true } | { readonly allowed: false; readonly code: string } {
  if (candidate.alreadyReversed) return { allowed: false, code: "OPERATION_NOT_REVERSIBLE" };
  if (candidate.hasDependentEvents || candidate.unlockedRewardRedeemed) {
    return { allowed: false, code: "REVERSAL_DEPENDENCY_EXISTS" };
  }
  if (!["STAMP_ISSUED", "REWARD_REDEEMED"].includes(candidate.eventType)) {
    return { allowed: false, code: "OPERATION_NOT_REVERSIBLE" };
  }
  const ageMilliseconds = context.now.getTime() - candidate.occurredAt.getTime();
  if (ageMilliseconds < 0) return { allowed: false, code: "OPERATION_NOT_REVERSIBLE" };
  if (context.actorKind === "STAFF_OWN") {
    if (
      candidate.staffOrganizationMemberId !== context.actorStaffOrganizationMemberId ||
      candidate.staffDeviceId !== context.actorStaffDeviceId
    ) {
      return { allowed: false, code: "OPERATION_NOT_REVERSIBLE" };
    }
    if (ageMilliseconds > context.staffWindowSeconds * 1_000) {
      return { allowed: false, code: "REVERSAL_WINDOW_EXPIRED" };
    }
  } else {
    if (!context.reason?.trim()) return { allowed: false, code: "REVERSAL_REASON_REQUIRED" };
    if (ageMilliseconds > context.managerWindowMinutes * 60_000) {
      return { allowed: false, code: "REVERSAL_WINDOW_EXPIRED" };
    }
  }
  return { allowed: true };
}
