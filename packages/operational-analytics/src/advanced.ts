export interface TimedMembershipFact {
  readonly membershipId: string;
  readonly enrolledAt: Date;
  readonly firstActivityAt: Date | null;
  readonly firstRewardAt: Date | null;
  readonly firstRedemptionAt: Date | null;
  readonly active: boolean;
  readonly completedCycles: number;
}

export function safeRate(numerator: number, denominator: number): number {
  return denominator <= 0 ? 0 : numerator / denominator;
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function cohortMetrics(facts: readonly TimedMembershipFact[]) {
  const millisecondsPerHour = 3_600_000;
  const firstActivityHours = facts.flatMap((item) =>
    item.firstActivityAt
      ? [(item.firstActivityAt.getTime() - item.enrolledAt.getTime()) / millisecondsPerHour]
      : [],
  );
  const rewardHours = facts.flatMap((item) =>
    item.firstRewardAt
      ? [(item.firstRewardAt.getTime() - item.enrolledAt.getTime()) / millisecondsPerHour]
      : [],
  );
  const redemptionHours = facts.flatMap((item) =>
    item.firstRewardAt && item.firstRedemptionAt
      ? [(item.firstRedemptionAt.getTime() - item.firstRewardAt.getTime()) / millisecondsPerHour]
      : [],
  );
  const retainedCount = facts.filter((item) => item.active).length;
  return {
    cohortSize: facts.length,
    firstActivityCount: firstActivityHours.length,
    retainedCount,
    retainedRate: safeRate(retainedCount, facts.length),
    averageHoursToFirstStamp: average(firstActivityHours),
    averageHoursToReward: average(rewardHours),
    averageHoursUnlockToRedemption: average(redemptionHours),
    completionDistribution: Object.fromEntries(
      [...new Set(facts.map((item) => item.completedCycles))]
        .sort((left, right) => left - right)
        .map((cycles) => [
          String(cycles),
          facts.filter((item) => item.completedCycles === cycles).length,
        ]),
    ),
  };
}
