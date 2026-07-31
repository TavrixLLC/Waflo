export const W2_STAMP_POLICY_DEFAULTS = {
  defaultStampsPerAction: 1,
  maximumStampsPerOperation: 5,
  maximumStampsPerCustomerPerDay: null,
  minimumPurchaseAmountMinor: null,
  minimumPurchaseCurrency: null,
  resetBehaviorAfterFinalReward: "RESET",
} as const;

export interface W4StampPolicyExecutionBacklog {
  readonly status: "IMPLEMENTED_IN_W4";
  readonly fields: readonly [
    "maximumStampsPerCustomerPerDay",
    "minimumPurchaseAmountMinor",
    "minimumPurchaseCurrency",
    "resetBehaviorAfterFinalReward",
  ];
  readonly prerequisiteForProductionStampIssuance: false;
  readonly unavailableDuringW3EnrollmentAndWalletPreview: false;
}

export const W4_STAMP_POLICY_EXECUTION_BACKLOG: W4StampPolicyExecutionBacklog = {
  status: "IMPLEMENTED_IN_W4",
  fields: [
    "maximumStampsPerCustomerPerDay",
    "minimumPurchaseAmountMinor",
    "minimumPurchaseCurrency",
    "resetBehaviorAfterFinalReward",
  ],
  prerequisiteForProductionStampIssuance: false,
  unavailableDuringW3EnrollmentAndWalletPreview: false,
};
