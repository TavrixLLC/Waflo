export type OperationalProgramStatus =
  | "DRAFT"
  | "VALIDATED"
  | "TEST"
  | "PUBLISHED"
  | "PAUSED"
  | "ARCHIVED"
  | "SUSPENDED";

export function preserveOperationalStatus(
  status: OperationalProgramStatus,
): OperationalProgramStatus {
  return ["PUBLISHED", "PAUSED", "ARCHIVED", "SUSPENDED"].includes(status) ? status : "VALIDATED";
}

export function applyTestStamps(current: number, amount: number, goal: number) {
  const projection = projectTestStampAddition(current, amount, goal);
  return {
    remainder: projection.currentStampCount,
    completedCycles: projection.rewardReady ? 1 : 0,
  };
}

export function projectTestStampAddition(current: number, amount: number, goal: number) {
  if (
    !Number.isInteger(current) ||
    !Number.isInteger(amount) ||
    !Number.isInteger(goal) ||
    current < 0 ||
    amount < 1 ||
    goal < 2 ||
    current > goal
  )
    throw new Error("Invalid stamp state.");
  const appliedAmount = Math.min(amount, Math.max(0, goal - current));
  const currentStampCount = current + appliedAmount;
  return {
    currentStampCount,
    appliedAmount,
    rewardReady: currentStampCount >= goal,
  };
}

export interface RewardThreshold {
  id: string;
  thresholdStampCount: number;
}

export interface CrossedRewardThreshold {
  rewardId: string;
  thresholdStampCount: number;
  cycle: number;
  absolutePosition: number;
}

export function absoluteTestPosition(
  cycleCount: number,
  currentStampCount: number,
  goal: number,
): number {
  if (
    !Number.isInteger(cycleCount) ||
    !Number.isInteger(currentStampCount) ||
    !Number.isInteger(goal) ||
    cycleCount < 0 ||
    currentStampCount < 0 ||
    currentStampCount > goal ||
    goal < 2
  )
    throw new Error("Invalid synthetic test projection.");
  return cycleCount * goal + currentStampCount;
}

export function projectAbsoluteTestPosition(absolutePosition: number, goal: number) {
  if (
    !Number.isInteger(absolutePosition) ||
    !Number.isInteger(goal) ||
    absolutePosition < 0 ||
    goal < 2
  )
    throw new Error("Invalid absolute synthetic stamp position.");
  if (absolutePosition === 0) return { currentStampCount: 0, cycleCount: 0 };
  const cycleCount = Math.floor((absolutePosition - 1) / goal);
  return {
    currentStampCount: absolutePosition - cycleCount * goal,
    cycleCount,
  };
}

export function crossedRewardThresholds(
  previousAbsolutePosition: number,
  amount: number,
  goal: number,
  rewards: readonly RewardThreshold[],
): CrossedRewardThreshold[] {
  if (
    !Number.isInteger(previousAbsolutePosition) ||
    !Number.isInteger(amount) ||
    !Number.isInteger(goal) ||
    previousAbsolutePosition < 0 ||
    amount < 1 ||
    goal < 2
  )
    throw new Error("Invalid synthetic stamp command.");
  const crossed: CrossedRewardThreshold[] = [];
  for (
    let absolutePosition = previousAbsolutePosition + 1;
    absolutePosition <= previousAbsolutePosition + amount;
    absolutePosition += 1
  ) {
    const cycle = Math.floor((absolutePosition - 1) / goal) + 1;
    const positionInCycle = ((absolutePosition - 1) % goal) + 1;
    for (const reward of rewards) {
      if (reward.thresholdStampCount === positionInCycle)
        crossed.push({
          rewardId: reward.id,
          thresholdStampCount: reward.thresholdStampCount,
          cycle,
          absolutePosition,
        });
    }
  }
  return crossed;
}

export function canRedeemEarnedReward(
  unlockedCount: number,
  relockedCount: number,
  redeemedCount: number,
  maximumRedemptionsPerEarned: number,
): boolean {
  const earned = Math.max(0, unlockedCount - relockedCount);
  return redeemedCount < earned * maximumRedemptionsPerEarned;
}

export function canPublish(
  versionStatus: string,
  testReadyAt: Date | null,
  completedSession: boolean,
) {
  return versionStatus === "TEST_READY" && testReadyAt !== null && completedSession;
}

export function idempotencyMatches(existingProgramId: string, requestedProgramId: string) {
  return existingProgramId === requestedProgramId;
}
