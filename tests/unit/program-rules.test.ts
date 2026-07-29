import { describe, expect, it } from "vitest";
import {
  absoluteTestPosition,
  applyTestStamps,
  canPublish,
  canRedeemEarnedReward,
  crossedRewardThresholds,
  idempotencyMatches,
  preserveOperationalStatus,
  projectTestStampAddition,
  projectAbsoluteTestPosition,
} from "../../apps/api/src/programs/program-rules.js";

describe("W2 program invariants", () => {
  it.each(["PUBLISHED", "PAUSED", "ARCHIVED", "SUSPENDED"] as const)(
    "preserves live state %s while editing",
    (status) => {
      expect(preserveOperationalStatus(status)).toBe(status);
    },
  );

  it("clamps the visible grid at reward-ready until final redemption", () => {
    expect(applyTestStamps(7, 5, 8)).toEqual({ remainder: 8, completedCycles: 1 });
    expect(applyTestStamps(1, 17, 8)).toEqual({ remainder: 8, completedCycles: 1 });
    expect(projectTestStampAddition(3, 2, 8)).toEqual({
      currentStampCount: 5,
      appliedAmount: 2,
      rewardReady: false,
    });
    expect(projectTestStampAddition(7, 5, 8)).toEqual({
      currentStampCount: 8,
      appliedAmount: 1,
      rewardReady: true,
    });
    expect(() => projectTestStampAddition(9, 1, 8)).toThrow("Invalid stamp state");
  });

  it("requires Test Mode completion and binds replay keys to a program", () => {
    expect(canPublish("VALIDATED", new Date(), true)).toBe(false);
    expect(canPublish("TEST_READY", new Date(), true)).toBe(true);
    expect(idempotencyMatches("program-a", "program-b")).toBe(false);
  });

  it("unlocks every crossed milestone across multiple cycles", () => {
    const crossed = crossedRewardThresholds(3, 15, 8, [
      { id: "milestone", thresholdStampCount: 4 },
      { id: "final", thresholdStampCount: 8 },
    ]);
    expect(crossed).toEqual([
      { rewardId: "milestone", thresholdStampCount: 4, cycle: 1, absolutePosition: 4 },
      { rewardId: "final", thresholdStampCount: 8, cycle: 1, absolutePosition: 8 },
      { rewardId: "milestone", thresholdStampCount: 4, cycle: 2, absolutePosition: 12 },
      { rewardId: "final", thresholdStampCount: 8, cycle: 2, absolutePosition: 16 },
    ]);
    expect(absoluteTestPosition(2, 2, 8)).toBe(18);
    expect(projectAbsoluteTestPosition(17, 8)).toEqual({
      currentStampCount: 1,
      cycleCount: 2,
    });
    expect(projectAbsoluteTestPosition(8, 8)).toEqual({
      currentStampCount: 8,
      cycleCount: 0,
    });
  });

  it("accounts for reverse-stamp relocks and per-earned redemption allowances", () => {
    expect(canRedeemEarnedReward(2, 0, 1, 1)).toBe(true);
    expect(canRedeemEarnedReward(2, 1, 1, 1)).toBe(false);
    expect(canRedeemEarnedReward(1, 0, 2, 3)).toBe(true);
    expect(canRedeemEarnedReward(1, 0, 3, 3)).toBe(false);
  });
});
