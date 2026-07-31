export interface OperationalAggregate {
  readonly enrollments: number;
  readonly activeMemberships: number;
  readonly stampUnitsIssued: number;
  readonly stampOperations: number;
  readonly reversals: number;
  readonly rewardsUnlocked: number;
  readonly rewardsRedeemed: number;
  readonly redemptionReversals: number;
  readonly uniqueActiveMembers: number;
  readonly completedCycles: number;
  readonly riskSignals: number;
}

export const EMPTY_OPERATIONAL_AGGREGATE: OperationalAggregate = {
  enrollments: 0,
  activeMemberships: 0,
  stampUnitsIssued: 0,
  stampOperations: 0,
  reversals: 0,
  rewardsUnlocked: 0,
  rewardsRedeemed: 0,
  redemptionReversals: 0,
  uniqueActiveMembers: 0,
  completedCycles: 0,
  riskSignals: 0,
};

export type OperationalAggregateEvent =
  | { readonly type: "MEMBERSHIP_ENROLLED" }
  | { readonly type: "MEMBERSHIP_ACTIVATED" }
  | { readonly type: "STAMP_ISSUED"; readonly stampUnits: number }
  | { readonly type: "STAMP_REVERSED" }
  | { readonly type: "REWARD_UNLOCKED" }
  | { readonly type: "REWARD_REDEEMED" }
  | { readonly type: "REWARD_REDEMPTION_REVERSED" }
  | { readonly type: "CYCLE_COMPLETED" }
  | { readonly type: "RISK_SIGNAL_CREATED" };

export function reduceOperationalAggregate(
  prior: OperationalAggregate,
  event: OperationalAggregateEvent,
): OperationalAggregate {
  switch (event.type) {
    case "MEMBERSHIP_ENROLLED":
      return {
        ...prior,
        enrollments: prior.enrollments + 1,
        activeMemberships: prior.activeMemberships + 1,
      };
    case "MEMBERSHIP_ACTIVATED":
      return { ...prior, uniqueActiveMembers: prior.uniqueActiveMembers + 1 };
    case "STAMP_ISSUED":
      if (!Number.isInteger(event.stampUnits) || event.stampUnits <= 0) {
        throw new Error("Stamp units must be a positive integer.");
      }
      return {
        ...prior,
        stampUnitsIssued: prior.stampUnitsIssued + event.stampUnits,
        stampOperations: prior.stampOperations + 1,
      };
    case "STAMP_REVERSED":
      return { ...prior, reversals: prior.reversals + 1 };
    case "REWARD_UNLOCKED":
      return { ...prior, rewardsUnlocked: prior.rewardsUnlocked + 1 };
    case "REWARD_REDEEMED":
      return { ...prior, rewardsRedeemed: prior.rewardsRedeemed + 1 };
    case "REWARD_REDEMPTION_REVERSED":
      return { ...prior, redemptionReversals: prior.redemptionReversals + 1 };
    case "CYCLE_COMPLETED":
      return { ...prior, completedCycles: prior.completedCycles + 1 };
    case "RISK_SIGNAL_CREATED":
      return { ...prior, riskSignals: prior.riskSignals + 1 };
  }
}

export function mergeOperationalAggregates(
  aggregates: readonly OperationalAggregate[],
): OperationalAggregate {
  return aggregates.reduce(
    (total, aggregate) => ({
      enrollments: total.enrollments + aggregate.enrollments,
      activeMemberships: total.activeMemberships + aggregate.activeMemberships,
      stampUnitsIssued: total.stampUnitsIssued + aggregate.stampUnitsIssued,
      stampOperations: total.stampOperations + aggregate.stampOperations,
      reversals: total.reversals + aggregate.reversals,
      rewardsUnlocked: total.rewardsUnlocked + aggregate.rewardsUnlocked,
      rewardsRedeemed: total.rewardsRedeemed + aggregate.rewardsRedeemed,
      redemptionReversals: total.redemptionReversals + aggregate.redemptionReversals,
      uniqueActiveMembers: total.uniqueActiveMembers + aggregate.uniqueActiveMembers,
      completedCycles: total.completedCycles + aggregate.completedCycles,
      riskSignals: total.riskSignals + aggregate.riskSignals,
    }),
    EMPTY_OPERATIONAL_AGGREGATE,
  );
}

export function redemptionRate(aggregate: OperationalAggregate): number {
  if (aggregate.rewardsUnlocked === 0) return 0;
  return aggregate.rewardsRedeemed / aggregate.rewardsUnlocked;
}

export function operationalDateBucket(timestamp: Date, timezone: string): string {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    throw new Error("Invalid operational timezone.");
  }
  const parts = Object.fromEntries(
    formatter.formatToParts(timestamp).map((part) => [part.type, part.value]),
  );
  if (!parts.year || !parts.month || !parts.day) throw new Error("Date bucket failed.");
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function cohortRetention(input: {
  readonly cohortMembershipIds: ReadonlySet<string>;
  readonly activeMembershipIds: ReadonlySet<string>;
}): { readonly cohortSize: number; readonly retained: number; readonly rate: number } {
  let retained = 0;
  for (const id of input.cohortMembershipIds) {
    if (input.activeMembershipIds.has(id)) retained += 1;
  }
  const cohortSize = input.cohortMembershipIds.size;
  return {
    cohortSize,
    retained,
    rate: cohortSize === 0 ? 0 : retained / cohortSize,
  };
}

export const exportSchemas = {
  MEMBERSHIP_SUMMARY: [
    "membership_public_id",
    "customer_display_name",
    "masked_contact",
    "program_name",
    "program_version",
    "membership_status",
    "current_stamps",
    "goal",
    "completed_cycles",
  ],
  LEDGER_OPERATIONS: [
    "operation_public_id",
    "membership_public_id",
    "event_type",
    "stamp_delta",
    "cycle_number",
    "sequence",
    "location_name",
    "staff_display_name",
    "occurred_at",
  ],
  REWARD_REDEMPTIONS: [
    "redemption_public_id",
    "membership_public_id",
    "reward_name",
    "cycle_number",
    "status",
    "location_name",
    "redeemed_at",
  ],
  LOCATION_PERFORMANCE: [
    "location_name",
    "local_date",
    "stamp_units",
    "stamp_operations",
    "rewards_redeemed",
    "completed_cycles",
    "risk_signals",
  ],
  STAFF_PERFORMANCE: [
    "staff_display_name",
    "local_date",
    "stamp_units",
    "stamp_operations",
    "rewards_redeemed",
    "reversals",
    "risk_signals",
  ],
  RISK_SIGNALS: [
    "signal_public_id",
    "rule_code",
    "severity",
    "status",
    "score",
    "created_at",
    "resolved_at",
  ],
  AGGREGATE_ANALYTICS: [
    "local_date",
    "program_name",
    "location_name",
    "enrollments",
    "active_memberships",
    "stamp_units",
    "rewards_unlocked",
    "rewards_redeemed",
    "completed_cycles",
  ],
} as const;

export type OperationalExportType = keyof typeof exportSchemas;

function csvCell(value: unknown): string {
  const rawValue =
    value === null || value === undefined
      ? ""
      : value instanceof Date
        ? value.toISOString()
        : String(value);
  const stringValue = /^[=+\-@\t\r]/.test(rawValue) ? `'${rawValue}` : rawValue;
  return `"${stringValue.replaceAll('"', '""')}"`;
}

export function createCsv(
  exportType: OperationalExportType,
  rows: readonly Readonly<Record<string, unknown>>[],
): string {
  const columns = exportSchemas[exportType];
  const lines = [
    columns.map(csvCell).join(","),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
  ];
  return `${lines.join("\r\n")}\r\n`;
}

export * from "./advanced.js";
export * from "./risk.js";
