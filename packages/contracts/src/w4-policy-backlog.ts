export const W2_STAMP_POLICY_DEFAULTS = {
  defaultStampsPerAction: 1,
  maximumStampsPerOperation: 5,
  maximumStampsPerCustomerPerDay: null,
  minimumPurchaseAmountMinor: null,
  minimumPurchaseCurrency: null,
  resetBehaviorAfterFinalReward: "RESET",
} as const;

export interface W4StampPolicyExecutionBacklog {
  readonly status: "DEFERRED_TO_W4";
  readonly fields: readonly [
    "maximumStampsPerCustomerPerDay",
    "minimumPurchaseAmountMinor",
    "minimumPurchaseCurrency",
    "resetBehaviorAfterFinalReward",
  ];
  readonly prerequisiteForProductionStampIssuance: true;
  readonly unavailableDuringW3EnrollmentAndWalletPreview: true;
}

export const W4_STAMP_POLICY_EXECUTION_BACKLOG: W4StampPolicyExecutionBacklog = {
  status: "DEFERRED_TO_W4",
  fields: [
    "maximumStampsPerCustomerPerDay",
    "minimumPurchaseAmountMinor",
    "minimumPurchaseCurrency",
    "resetBehaviorAfterFinalReward",
  ],
  prerequisiteForProductionStampIssuance: true,
  unavailableDuringW3EnrollmentAndWalletPreview: true,
};
