import { z } from "zod";

export const operationCommandIdSchema = z.uuid();
export const safeReasonSchema = z.string().trim().min(3).max(500);
export const purchaseCurrencySchema = z
  .string()
  .trim()
  .length(3)
  .regex(/^[A-Za-z]{3}$/)
  .transform((value) => value.toUpperCase());

export const staffPairingLocationSchema = z
  .object({
    locationId: z.uuid(),
    earningAllowed: z.boolean(),
    redemptionAllowed: z.boolean(),
  })
  .strict();

export const staffLocationAssignmentUpsertSchema = z
  .object({
    earningAllowed: z.boolean(),
    redemptionAllowed: z.boolean(),
  })
  .strict()
  .refine((value) => value.earningAllowed || value.redemptionAllowed, {
    message: "At least one Staff operation permission must be enabled.",
  });

export const createDevicePairingSessionSchema = z
  .object({
    staffMemberId: z.uuid(),
    locations: z.array(staffPairingLocationSchema).min(1).max(50),
    deviceLabelSuggestion: z.string().trim().min(1).max(120).optional(),
    expiresInMinutes: z.number().int().min(2).max(30).default(10),
  })
  .strict();

export const devicePairingClaimSchema = z
  .object({
    pairingToken: z.string().min(80).max(512),
    installationId: z.string().trim().min(16).max(160),
    publicKey: z.string().min(40).max(1024),
    platform: z.enum(["IOS", "ANDROID", "TEST_CLIENT"]),
    appVersion: z.string().trim().min(1).max(40),
    osVersion: z.string().trim().max(80).optional(),
    model: z.string().trim().max(120).optional(),
  })
  .strict();

const reviewAccessCodeSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/));

export const reviewAccessAuthorizeSchema = devicePairingClaimSchema
  .omit({ pairingToken: true })
  .extend({ reviewAccessCode: reviewAccessCodeSchema })
  .strict();

export const reviewScenarioIdSchema = z.enum([
  "CUSTOMER_NEW",
  "CUSTOMER_ACTIVE_5_OF_8",
  "CUSTOMER_REWARD_READY_8_OF_8",
  "MANAGER_APPROVAL_REQUIRED",
  "PURCHASE_THRESHOLD_FAILURE",
  "BILLING_BLOCKED",
  "INVALID_QR",
]);

export const reviewScenarioSelectSchema = z
  .object({
    commandId: operationCommandIdSchema,
    scenarioId: reviewScenarioIdSchema,
  })
  .strict();

export const reviewResetSchema = z.object({ commandId: operationCommandIdSchema }).strict();

export const devicePairingChallengeSchema = z
  .object({
    pairingPublicId: z.uuid(),
  })
  .strict();

export const devicePairingCompleteSchema = z
  .object({
    pairingPublicId: z.uuid(),
    challenge: z.string().min(32).max(256),
    signature: z.string().min(40).max(256),
    displayName: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export const staffDeviceSessionRefreshSchema = z
  .object({
    refreshToken: z.string().min(40).max(512),
  })
  .strict();

export const membershipResolveSchema = z
  .object({
    qrPayload: z.string().min(40).max(220),
  })
  .strict();

export const managerOverrideSchema = z
  .object({
    approvalPublicId: z.uuid(),
    dailyCap: z.boolean().default(false),
    purchasePolicy: z.boolean().default(false),
    reason: safeReasonSchema,
  })
  .strict();

export const issueStampSchema = z
  .object({
    qrPayload: z.string().min(40).max(220),
    amount: z.number().int().min(1).max(30),
    purchaseAmountMinor: z.number().int().min(0).max(2_147_483_647).optional(),
    purchaseCurrency: purchaseCurrencySchema.optional(),
    merchantTransactionReference: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[\p{L}\p{N}._:/ -]+$/u)
      .optional(),
    managerOverride: managerOverrideSchema.optional(),
    clientObservedAt: z.iso.datetime().optional(),
  })
  .strict();

export const redeemRewardSchema = z
  .object({
    qrPayload: z.string().min(40).max(220),
    rewardEntitlementPublicId: z.uuid(),
    managerApprovalPublicId: z.uuid().optional(),
    note: z.string().trim().max(240).optional(),
  })
  .strict();

export const reverseOperationSchema = z
  .object({
    operationPublicId: z.uuid(),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

export const membershipStatusOperationSchema = z
  .object({
    commandId: operationCommandIdSchema,
    reason: safeReasonSchema,
    locationId: z.uuid(),
  })
  .strict();

export const manualAdjustmentSchema = z
  .object({
    commandId: operationCommandIdSchema,
    stampDelta: z
      .number()
      .int()
      .min(-30)
      .max(30)
      .refine((value) => value !== 0),
    reason: safeReasonSchema,
    locationId: z.uuid(),
  })
  .strict();

export const projectionCommandSchema = z
  .object({
    commandId: operationCommandIdSchema,
    expectedProjectionVersion: z.number().int().min(0),
  })
  .strict();

export const managerApprovalDecisionSchema = z
  .object({
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

export const riskSignalDecisionSchema = z
  .object({
    note: safeReasonSchema,
  })
  .strict();

export const createExportSchema = z
  .object({
    exportType: z.enum([
      "MEMBERSHIP_SUMMARY",
      "LEDGER_OPERATIONS",
      "REWARD_REDEMPTIONS",
      "LOCATION_PERFORMANCE",
      "STAFF_PERFORMANCE",
      "RISK_SIGNALS",
      "AGGREGATE_ANALYTICS",
    ]),
    filters: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
      .default({}),
  })
  .strict();

export const privacyRequestSchema = z
  .object({
    commandId: operationCommandIdSchema,
    confirmation: z.literal("CONFIRM"),
    reasonOrLegalBasis: safeReasonSchema,
  })
  .strict();

export const analyticsQuerySchema = z
  .object({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    cursor: z.string().trim().min(1).max(160).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .strict();

export const analyticsRebuildSchema = z
  .object({
    commandId: operationCommandIdSchema,
    from: z.iso.date(),
    to: z.iso.date(),
    sourceKinds: z
      .array(z.enum(["ENROLLMENT", "LEDGER", "RISK"]))
      .min(1)
      .max(3)
      .default(["ENROLLMENT", "LEDGER", "RISK"]),
  })
  .strict();

const analyticsRateSchema = z.number().min(0);

export const programAnalyticsItemSchema = z.object({
  cursor: z.string(),
  programId: z.uuid(),
  programVersionId: z.uuid().nullable(),
  programName: z.string(),
  versionNumber: z.number().int().nullable(),
  timezone: z.string(),
  enrollments: z.number().int().nonnegative(),
  activeMembers: z.number().int().nonnegative(),
  stampOperations: z.number().int().nonnegative(),
  stampUnits: z.number().int().nonnegative(),
  rewardsUnlocked: z.number().int().nonnegative(),
  rewardsRedeemed: z.number().int().nonnegative(),
  completedCycles: z.number().int().nonnegative(),
  completionRate: analyticsRateSchema,
  redemptionRate: analyticsRateSchema,
  reversalRate: analyticsRateSchema,
  walletAdoptionRate: analyticsRateSchema,
  riskRate: analyticsRateSchema,
  firstActivityCount: z.number().int().nonnegative(),
  firstActivityConversionRate: analyticsRateSchema,
  repeatVisitors: z.number().int().nonnegative(),
  repeatVisitRate: analyticsRateSchema,
});

export const locationAnalyticsItemSchema = z.object({
  cursor: z.string(),
  locationId: z.uuid().nullable(),
  locationName: z.string(),
  timezone: z.string(),
  activity: z.number().int().nonnegative(),
  uniqueMembers: z.number().int().nonnegative(),
  redemptions: z.number().int().nonnegative(),
  reversals: z.number().int().nonnegative(),
  riskRate: analyticsRateSchema,
  conversionRate: analyticsRateSchema,
  firstActivityConversions: z.number().int().nonnegative(),
  repeatVisitors: z.number().int().nonnegative(),
  repeatVisitRate: analyticsRateSchema,
});

export const staffAnalyticsItemSchema = z.object({
  cursor: z.string(),
  staffMemberId: z.uuid().nullable(),
  staffName: z.string(),
  timezone: z.string(),
  operations: z.number().int().nonnegative(),
  stampUnits: z.number().int().nonnegative(),
  redemptions: z.number().int().nonnegative(),
  reversals: z.number().int().nonnegative(),
  overrides: z.number().int().nonnegative(),
  riskRate: analyticsRateSchema,
});

export const cohortAnalyticsItemSchema = z.object({
  cursor: z.string(),
  cohort: z.string(),
  timezone: z.string(),
  cohortSize: z.number().int().nonnegative(),
  firstActivityCount: z.number().int().nonnegative(),
  retainedCount: z.number().int().nonnegative(),
  retainedRate: analyticsRateSchema,
  averageHoursToFirstStamp: z.number().nullable(),
  averageHoursToReward: z.number().nullable(),
  averageHoursUnlockToRedemption: z.number().nullable(),
  completionDistribution: z.record(z.string(), z.number().int().nonnegative()),
});

export type CreateDevicePairingSessionInput = z.infer<typeof createDevicePairingSessionSchema>;
export type DevicePairingClaimInput = z.infer<typeof devicePairingClaimSchema>;
export type DevicePairingCompleteInput = z.infer<typeof devicePairingCompleteSchema>;
export type ReviewAccessAuthorizeInput = z.infer<typeof reviewAccessAuthorizeSchema>;
export type ReviewScenarioId = z.infer<typeof reviewScenarioIdSchema>;
export type ReviewScenarioSelectInput = z.infer<typeof reviewScenarioSelectSchema>;
export type ReviewResetInput = z.infer<typeof reviewResetSchema>;
export type StaffLocationAssignmentUpsertInput = z.infer<
  typeof staffLocationAssignmentUpsertSchema
>;
export type IssueStampInput = z.infer<typeof issueStampSchema>;
export type RedeemRewardInput = z.infer<typeof redeemRewardSchema>;
export type ReverseOperationInput = z.infer<typeof reverseOperationSchema>;
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;
export type AnalyticsRebuildInput = z.infer<typeof analyticsRebuildSchema>;
