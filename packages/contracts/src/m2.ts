import { z } from "zod";

export const m2ContractVersion = "waflo-m2-mobile-contract-v1" as const;

export const publicMembershipIdSchema = z.string().trim().min(8).max(80);
export const sha256DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const operationStatusSchema = z.enum(["PROCESSING", "COMPLETED", "FAILED"]);
export const staffDeviceContextResultSchema = z
  .object({
    organizationId: z.uuid(),
    role: z.enum(["OWNER", "MANAGER", "STAFF"]),
    locationId: z.uuid(),
    devicePublicId: z.uuid(),
    deviceSessionId: z.uuid(),
    platform: z.enum(["IOS", "ANDROID", "TEST_CLIENT"]),
    appVersion: z.string().min(1).max(40),
    minimumSupportedAppVersion: z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/),
    appVersionSupported: z.literal(true),
    requestId: z.string().min(1).max(160),
  })
  .strict();
export const operationTypeSchema = z.enum([
  "ISSUE_STAMP",
  "REDEEM_REWARD",
  "REVERSE_STAMP",
  "REVERSE_REDEMPTION",
  "MANUAL_ADJUSTMENT",
  "SUSPEND_MEMBERSHIP",
  "RESTORE_MEMBERSHIP",
  "REVOKE_MEMBERSHIP",
  "EXPIRE_REWARD",
]);

export const stampArtworkSchema = z
  .object({
    state: z.enum(["FILLED", "EMPTY"]),
    contentDigest: sha256DigestSchema.nullable(),
  })
  .strict();

export const mobileRewardSchema = z
  .object({
    publicId: z.uuid(),
    name: z.string().min(1).max(120),
    description: z.string().max(240),
    threshold: z.number().int().positive(),
    finalReward: z.boolean(),
    status: z.enum(["AVAILABLE", "PARTIALLY_REDEEMED"]),
    redemptionCount: z.number().int().nonnegative(),
    maximumRedemptionCount: z.number().int().positive(),
    expiresAt: z.iso.datetime().nullable(),
    requiresManagerApproval: z.boolean(),
  })
  .strict();

export const membershipResolveResultSchema = z
  .object({
    membershipPublicId: publicMembershipIdSchema,
    membershipStatus: z.enum(["ACTIVE", "SUSPENDED", "EXPIRED", "REVOKED"]),
    customerDisplayName: z.string().min(1).max(160),
    programName: z.string().min(1).max(120),
    locale: z.enum(["en", "ar"]),
    progress: z.number().int().nonnegative(),
    goal: z.number().int().positive(),
    rewardReady: z.boolean(),
    completedCycles: z.number().int().nonnegative(),
    projectionVersion: z.number().int().nonnegative(),
    locationEligibility: z
      .object({
        earning: z.boolean(),
        redemption: z.boolean(),
      })
      .strict(),
    operationLimits: z
      .object({
        maximumStampsPerOperation: z.number().int().positive(),
        maximumStampsPerCustomerPerDay: z.number().int().positive().nullable(),
        dailyRemainingStamps: z.number().int().nonnegative().nullable(),
      })
      .strict(),
    operationalTimezone: z.string().min(1).max(100),
    operationalDate: z.iso.date(),
    purchaseRequirement: z
      .object({
        required: z.boolean(),
        minimumAmountMinor: z.number().int().nonnegative().nullable(),
        currency: z
          .string()
          .regex(/^[A-Z]{3}$/)
          .nullable(),
      })
      .strict(),
    stampVisuals: z
      .object({
        filled: stampArtworkSchema.extend({ state: z.literal("FILLED") }),
        empty: stampArtworkSchema.extend({ state: z.literal("EMPTY") }),
      })
      .strict(),
    availableRewards: z.array(mobileRewardSchema),
  })
  .strict();

export const unlockedRewardSchema = z
  .object({
    publicId: z.uuid(),
    threshold: z.number().int().positive(),
    status: z.string().min(1).max(40),
    final: z.boolean(),
  })
  .strict();

export const stampOperationResultSchema = z
  .object({
    operationPublicId: z.uuid(),
    commandId: z.uuid(),
    replayed: z.boolean(),
    beforeProgress: z.number().int().nonnegative(),
    progress: z.number().int().nonnegative(),
    goal: z.number().int().positive(),
    rewardReady: z.boolean(),
    completedCycles: z.number().int().nonnegative(),
    projectionVersion: z.number().int().nonnegative(),
    unlockedRewards: z.array(unlockedRewardSchema),
    requestId: z.string().min(1).max(160).nullable(),
  })
  .strict();

export const redemptionOperationResultSchema = z
  .object({
    operationPublicId: z.uuid(),
    commandId: z.uuid(),
    replayed: z.boolean(),
    redemptionPublicId: z.uuid(),
    rewardStatus: z.enum(["REDEEMED", "PARTIALLY_REDEEMED"]),
    finalReward: z.boolean(),
    beforeProgress: z.number().int().nonnegative(),
    progress: z.number().int().nonnegative(),
    goal: z.number().int().positive(),
    rewardReady: z.boolean(),
    completedCycles: z.number().int().nonnegative(),
    projectionVersion: z.number().int().nonnegative(),
    requestId: z.string().min(1).max(160).nullable(),
  })
  .strict();

export const reverseOperationResultSchema = z
  .object({
    operationPublicId: z.uuid(),
    commandId: z.uuid(),
    reversedOperationPublicId: z.uuid(),
    replayed: z.boolean(),
    progress: z.number().int().nonnegative(),
    rewardReady: z.boolean(),
    completedCycles: z.number().int().nonnegative(),
    projectionVersion: z.number().int().nonnegative(),
    requestId: z.string().min(1).max(160).nullable(),
  })
  .strict();

export const mobileOperationResultSchema = z.union([
  stampOperationResultSchema,
  redemptionOperationResultSchema,
  reverseOperationResultSchema,
]);

export const operationCommandStatusResultSchema = z
  .object({
    commandId: z.uuid(),
    operationPublicId: z.uuid(),
    operationType: operationTypeSchema,
    status: operationStatusSchema,
    result: mobileOperationResultSchema.nullable(),
    safeFailureCode: z.string().min(1).max(120).nullable(),
    createdAt: z.iso.datetime(),
    completedAt: z.iso.datetime().nullable(),
  })
  .strict();

export const operationPublicStatusResultSchema = z
  .object({
    publicId: z.uuid(),
    operationPublicId: z.uuid(),
    commandId: z.uuid(),
    operationType: operationTypeSchema,
    status: operationStatusSchema,
    resultProjectionVersion: z.number().int().nonnegative().nullable(),
    resultPayload: mobileOperationResultSchema.nullable(),
    safeFailureCode: z.string().min(1).max(120).nullable(),
    createdAt: z.iso.datetime(),
    completedAt: z.iso.datetime().nullable(),
  })
  .strict();

export type MembershipResolveResult = z.infer<typeof membershipResolveResultSchema>;
export type StampOperationResult = z.infer<typeof stampOperationResultSchema>;
export type RedemptionOperationResult = z.infer<typeof redemptionOperationResultSchema>;
export type OperationCommandStatusResult = z.infer<typeof operationCommandStatusResultSchema>;
