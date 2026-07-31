import {
  canPublishForBillingStatus,
  canPublishWithinProgramLimit,
  programPublicationFeatureViolations,
} from "../../packages/billing/src/index.js";
import {
  W2_STAMP_POLICY_DEFAULTS,
  W4_STAMP_POLICY_EXECUTION_BACKLOG,
} from "../../packages/contracts/src/index.js";
import { describe, expect, it } from "vitest";

describe("W2 Round 4 publication and policy decisions", () => {
  it.each(["pending_activation", "trialing", "active", "grace_period"] as const)(
    "allows publication in billing status %s",
    (status) => expect(canPublishForBillingStatus(status)).toBe(true),
  );

  it.each(["past_due", "suspended", "canceled"] as const)(
    "blocks publication in billing status %s",
    (status) => expect(canPublishForBillingStatus(status)).toBe(false),
  );

  it("allows an existing program at the limit but blocks over-limit publication", () => {
    expect(canPublishWithinProgramLimit("starter", 1)).toMatchObject({
      allowed: true,
      limit: 1,
    });
    expect(canPublishWithinProgramLimit("starter", 2)).toMatchObject({
      allowed: false,
      limit: 1,
      recommendedPlan: "growth",
    });
  });

  it("returns stable publication feature violations after a downgrade", () => {
    expect(
      programPublicationFeatureViolations("starter", {
        editingMode: "PRO",
        rewardThresholds: [3, 8],
        requiredStampCount: 8,
        layoutType: "PATH",
      }),
    ).toEqual(["PRO_MODE", "MULTIPLE_REWARDS", "MILESTONE_REWARDS", "ADVANCED_LAYOUT"]);
  });

  it("preserves W2 defaults while confirming W4 operational execution is implemented", () => {
    expect(W2_STAMP_POLICY_DEFAULTS).toEqual({
      defaultStampsPerAction: 1,
      maximumStampsPerOperation: 5,
      maximumStampsPerCustomerPerDay: null,
      minimumPurchaseAmountMinor: null,
      minimumPurchaseCurrency: null,
      resetBehaviorAfterFinalReward: "RESET",
    });
    expect(W4_STAMP_POLICY_EXECUTION_BACKLOG.status).toBe("IMPLEMENTED_IN_W4");
    expect(W4_STAMP_POLICY_EXECUTION_BACKLOG.unavailableDuringW3EnrollmentAndWalletPreview).toBe(
      false,
    );
  });
});
