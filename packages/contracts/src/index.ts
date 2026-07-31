import { z } from "zod";
import { programOperationalStatuses } from "./program-publication-state.js";

export * from "./platform-capabilities.js";
export * from "./program-publication-state.js";
export * from "./program-template-catalog.js";
export * from "./w4-policy-backlog.js";
export * from "./w3.js";
export * from "./w4.js";

export const locales = ["en", "ar"] as const;
export type Locale = (typeof locales)[number];
export const localeSchema = z.enum(locales);

export const planCodes = ["starter", "growth", "scale"] as const;
export type PlanCode = (typeof planCodes)[number];
export const planCodeSchema = z.enum(planCodes);

export const memberRoles = ["OWNER", "MANAGER", "STAFF"] as const;
export type MemberRole = (typeof memberRoles)[number];
export const memberRoleSchema = z.enum(memberRoles);

export const billingStatuses = [
  "pending_activation",
  "trialing",
  "active",
  "past_due",
  "grace_period",
  "suspended",
  "canceled",
] as const;
export type BillingStatus = (typeof billingStatuses)[number];

export interface ApiSuccess<T> {
  data: T;
  requestId: string;
}

export interface ApiErrorDetails {
  readonly [key: string]: string | number | boolean | null | ApiErrorDetails | readonly unknown[];
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: ApiErrorDetails;
    requestId: string;
  };
}

export const emailSchema = z
  .email()
  .max(254)
  .transform((value) => value.normalize("NFKC").trim().toLocaleLowerCase("en-US"));

export const passwordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters.")
  .max(128, "Password must be at most 128 characters.")
  .refine((value) => value.trim().length > 0, "Password cannot be empty.");

export const displayNameSchema = z.string().trim().min(2).max(100);

export const registerSchema = z
  .object({
    displayName: displayNameSchema,
    email: emailSchema,
    password: passwordSchema,
    locale: localeSchema.default("en"),
    termsAccepted: z.literal(true),
    privacyAccepted: z.literal(true),
  })
  .strict();

export const loginSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1).max(128),
  })
  .strict();

export const tokenSchema = z.object({ token: z.string().min(32).max(512) }).strict();

export const forgotPasswordSchema = z.object({ email: emailSchema }).strict();

export const resetPasswordSchema = z
  .object({ token: z.string().min(32).max(512), password: passwordSchema })
  .strict();

export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema })
  .strict();

export const updateUserSchema = z
  .object({
    displayName: displayNameSchema.optional(),
    preferredLocale: localeSchema.optional(),
  })
  .strict();

export const timezoneSchema = z.string().refine(
  (value) => {
    try {
      Intl.DateTimeFormat("en-US", { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  },
  { message: "Invalid IANA timezone." },
);

export const organizationSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    merchantSlug: z.string().min(3).max(40),
    businessCategory: z.string().trim().max(80).optional(),
    defaultLocale: localeSchema,
    timezone: timezoneSchema,
    selectedPlan: planCodeSchema.default("starter"),
  })
  .strict();

export const organizationUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    businessCategory: z.string().trim().max(80).nullable().optional(),
    defaultLocale: localeSchema.optional(),
    timezone: timezoneSchema.optional(),
  })
  .strict();

export const locationSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    addressLine1: z.string().trim().max(160).optional(),
    addressLine2: z.string().trim().max(160).optional(),
    city: z.string().trim().max(100).optional(),
    region: z.string().trim().max(100).optional(),
    postalCode: z.string().trim().max(30).optional(),
    countryCode: z.string().trim().length(2).toUpperCase().optional(),
    phone: z.string().trim().min(5).max(30).optional(),
    timezone: timezoneSchema.optional(),
  })
  .strict();

export const locationUpdateSchema = locationSchema.partial().strict();

export const invitationSchema = z
  .object({ email: emailSchema, role: z.enum(["MANAGER", "STAFF"]) })
  .strict();

export const memberUpdateSchema = z
  .object({
    role: memberRoleSchema.optional(),
    status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
  })
  .strict();

export const selectedPlanSchema = z.object({ plan: planCodeSchema }).strict();

export const slugChangeSchema = z
  .object({ slug: z.string().min(3).max(40), password: z.string().min(1).max(128) })
  .strict();

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type OrganizationInput = z.infer<typeof organizationSchema>;
export type LocationInput = z.infer<typeof locationSchema>;

export const programEditingModeSchema = z.enum(["quick", "pro"]);
export const programStatusSchema = z.enum(programOperationalStatuses);
export const stampLayoutSchema = z.enum(["ROW", "GRID", "PATH", "RING"]);
export const rewardTypeSchema = z.enum([
  "TEXT_REWARD",
  "FREE_ITEM",
  "DISCOUNT_DESCRIPTION",
  "CUSTOM",
]);

const translationInputSchema = z.object({
  programName: z.string().trim().min(1).max(120),
  shortDescription: z.string().trim().min(1).max(240),
  fullDescription: z.string().trim().max(4000).optional(),
  rewardSummary: z.string().trim().min(1).max(240),
  joinInstructions: z.string().trim().max(4000).optional(),
  termsAndConditions: z.string().trim().min(1).max(8000),
  completionMessage: z.string().trim().min(1).max(240),
  rewardUnlockedMessage: z.string().trim().min(1).max(240),
  pausedMessage: z.string().trim().max(240).optional(),
});

const rewardInputSchema = z.object({
  thresholdStampCount: z.number().int().min(2).max(30),
  rewardType: rewardTypeSchema,
  internalName: z.string().trim().min(1).max(120),
  sortOrder: z.number().int().min(0).max(100).default(0),
  validityDurationDays: z.number().int().min(1).max(3650).nullable().optional(),
  requiresManagerApproval: z.boolean().default(false),
  maximumRedemptionsPerEarned: z.number().int().min(1).max(10).default(1),
  visualOverride: z
    .object({
      stampAssetId: z.uuid().nullable().optional(),
      accentOverride: z
        .string()
        .regex(/^#[0-9A-Fa-f]{6}$/)
        .nullable()
        .optional(),
    })
    .strict()
    .optional(),
  translations: z.object({
    en: z.object({
      name: z.string().trim().min(1).max(120),
      description: z.string().trim().min(1).max(240),
      redemptionInstructions: z.string().trim().max(4000).optional(),
    }),
    ar: z.object({
      name: z.string().trim().min(1).max(120),
      description: z.string().trim().min(1).max(240),
      redemptionInstructions: z.string().trim().max(4000).optional(),
    }),
  }),
});

const layoutConfigurationSchema = z
  .object({
    columns: z.number().int().min(2).max(6).optional(),
    maxPerRow: z.number().int().min(2).max(10).optional(),
    serpentine: z.boolean().optional(),
    startAngle: z.number().min(-180).max(180).optional(),
  })
  .strict()
  .default({});

const applePreviewConfigSchema = z
  .object({
    headerLabel: z.string().trim().max(24).default("REWARDS"),
    headerValue: z.string().trim().max(32).default("Waflo"),
    secondaryLabel: z.string().trim().max(24).default("NEXT REWARD"),
    barcodeLabel: z.string().trim().max(32).default("Preview barcode"),
    showBackContent: z.boolean().default(true),
  })
  .strict()
  .default({
    headerLabel: "REWARDS",
    headerValue: "Waflo",
    secondaryLabel: "NEXT REWARD",
    barcodeLabel: "Preview barcode",
    showBackContent: true,
  });

const googlePreviewConfigSchema = z
  .object({
    title: z.string().trim().max(48).default("Waflo Rewards"),
    subtitle: z.string().trim().max(64).default("Collect stamps and unlock rewards"),
    detailsLabel: z.string().trim().max(32).default("Reward progress"),
    barcodeLabel: z.string().trim().max(32).default("Preview barcode"),
  })
  .strict()
  .default({
    title: "Waflo Rewards",
    subtitle: "Collect stamps and unlock rewards",
    detailsLabel: "Reward progress",
    barcodeLabel: "Preview barcode",
  });

const visualThemeInputSchema = z
  .object({
    backgroundColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    foregroundColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    secondaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    mutedColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    filledStampAssetId: z.uuid().optional(),
    emptyStampAssetId: z.uuid().optional(),
    logoAssetId: z.uuid().nullable().optional(),
    heroAssetId: z.uuid().nullable().optional(),
    backgroundAssetId: z.uuid().nullable().optional(),
    defaultMilestoneAssetId: z.uuid().nullable().optional(),
    layoutType: stampLayoutSchema,
    layoutConfiguration: layoutConfigurationSchema,
    stampSize: z.number().int().min(24).max(96).default(48),
    stampSpacing: z.number().int().min(0).max(32).default(8),
    borderRadius: z.number().int().min(0).max(40).default(18),
    progressLabelVisible: z.boolean().default(true),
    rewardLabelVisible: z.boolean().default(true),
    customerWebVariant: z.enum(["CARD", "MINIMAL", "HERO"]).default("CARD"),
    applePreviewConfig: applePreviewConfigSchema,
    googlePreviewConfig: googlePreviewConfigSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const columns = value.layoutConfiguration.columns;
    if (value.layoutType === "GRID" && columns && columns > value.stampSize / 8) {
      context.addIssue({
        code: "custom",
        path: ["layoutConfiguration", "columns"],
        message: "Grid columns are too dense for the configured stamp size.",
      });
    }
    if (value.layoutType !== "RING" && value.layoutConfiguration.startAngle !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["layoutConfiguration", "startAngle"],
        message: "Start angle is only supported by the ring layout.",
      });
    }
  });

const programInputSchema = z
  .object({
    internalName: z.string().trim().min(2).max(120),
    editingMode: programEditingModeSchema.default("quick"),
    templateCode: z.string().trim().max(80).optional(),
    templateVersion: z.number().int().min(1).max(10_000).optional(),
    requiredStampCount: z.number().int().min(2).max(30).default(8),
    operationalTimezone: timezoneSchema.default("Asia/Baghdad"),
    maximumStampsPerOperation: z.number().int().min(1).max(30).default(5),
    maximumStampsPerCustomerPerDay: z.number().int().min(1).max(1000).nullable().default(null),
    minimumPurchaseAmountMinor: z.number().int().min(0).max(2_147_483_647).nullable().default(null),
    minimumPurchaseCurrency: z
      .string()
      .trim()
      .length(3)
      .transform((value) => value.toUpperCase())
      .nullable()
      .default(null),
    staffOwnReversalWindowSeconds: z.number().int().min(15).max(900).default(120),
    managerReversalWindowMinutes: z.number().int().min(1).max(10080).default(1440),
    managerOverrideAllowed: z.boolean().default(true),
    resetBehaviorAfterReward: z
      .literal("RESET_ON_FINAL_REWARD_REDEMPTION")
      .default("RESET_ON_FINAL_REWARD_REDEMPTION"),
    translations: z.object({ en: translationInputSchema, ar: translationInputSchema }),
    earningDescription: z
      .string()
      .trim()
      .min(1)
      .max(240)
      .default("One stamp per qualifying visit."),
    rewards: z.array(rewardInputSchema).min(1).max(10),
    locationIds: z.array(z.uuid()).min(1).max(100),
    visualTheme: visualThemeInputSchema,
  })
  .strict();

function validateProgramInput(value: z.infer<typeof programInputSchema>, context: z.RefinementCtx) {
  const thresholds = value.rewards.map((reward) => reward.thresholdStampCount);
  if (new Set(thresholds).size !== thresholds.length) {
    context.addIssue({
      code: "custom",
      path: ["rewards"],
      message: "Reward thresholds must be unique.",
    });
  }
  if (value.editingMode === "quick" && value.rewards.length !== 1) {
    context.addIssue({
      code: "custom",
      path: ["rewards"],
      message: "Quick Mode supports one final reward.",
    });
  }
  if ((value.minimumPurchaseAmountMinor === null) !== (value.minimumPurchaseCurrency === null)) {
    context.addIssue({
      code: "custom",
      path: ["minimumPurchaseCurrency"],
      message: "Minimum purchase amount and currency must be enabled together.",
    });
  }
  if (
    value.maximumStampsPerCustomerPerDay !== null &&
    value.operationalTimezone.trim().length === 0
  ) {
    context.addIssue({
      code: "custom",
      path: ["operationalTimezone"],
      message: "An operational timezone is required for daily limits.",
    });
  }
}

export const programCreateSchema = programInputSchema.superRefine(validateProgramInput);

export const programUpdateSchema = programInputSchema
  .partial()
  .extend({
    revision: z.number().int().min(1),
    changeSummary: z.string().trim().max(240).optional(),
  })
  .strict();

export const programTestStampSchema = z
  .object({
    amount: z.number().int().min(1).max(30).default(1),
    idempotencyKey: z.uuid(),
    purchaseAmountMinor: z.number().int().min(0).max(2_147_483_647).optional(),
    purchaseCurrency: z
      .string()
      .trim()
      .length(3)
      .transform((value) => value.toUpperCase())
      .optional(),
    managerApproved: z.boolean().default(false),
    managerReason: z.string().trim().min(3).max(240).optional(),
    simulatedOccurredAt: z.iso.datetime().optional(),
  })
  .strict();

export const programTestRedeemSchema = z
  .object({
    idempotencyKey: z.uuid(),
    managerApproved: z.boolean().default(false),
  })
  .strict();

export const programPublishSchema = z
  .object({
    idempotencyKey: z.uuid(),
  })
  .strict();

export const programTestResetSchema = z
  .object({
    idempotencyKey: z.uuid(),
  })
  .strict();

export const programTestReverseSchema = z
  .object({
    idempotencyKey: z.uuid(),
    managerActor: z.boolean().default(false),
    simulatedOccurredAt: z.iso.datetime().optional(),
  })
  .strict();

export type ProgramTestStampInput = z.infer<typeof programTestStampSchema>;
export type ProgramTestRedeemInput = z.infer<typeof programTestRedeemSchema>;
export type ProgramTestReverseInput = z.infer<typeof programTestReverseSchema>;

export type ProgramCreateInput = z.infer<typeof programCreateSchema>;
export type ProgramUpdateInput = z.infer<typeof programUpdateSchema>;

export const merchantAssetUploadMetadataSchema = z
  .object({
    category: z.enum([
      "LOGO",
      "HERO",
      "BACKGROUND",
      "STAMP_FILLED",
      "STAMP_EMPTY",
      "STAMP_MILESTONE",
      "GENERAL",
    ]),
    crop: z
      .object({
        x: z.number().min(0).max(1).default(0),
        y: z.number().min(0).max(1).default(0),
        width: z.number().gt(0).max(1).default(1),
        height: z.number().gt(0).max(1).default(1),
        zoom: z.number().min(1).max(4).default(1),
      })
      .strict()
      .default({ x: 0, y: 0, width: 1, height: 1, zoom: 1 }),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.crop.x + value.crop.width > 1.000001 || value.crop.y + value.crop.height > 1.000001) {
      context.addIssue({
        code: "custom",
        path: ["crop"],
        message: "Crop rectangle must remain inside the image.",
      });
    }
  });

export type MerchantAssetUploadMetadataInput = z.infer<typeof merchantAssetUploadMetadataSchema>;

export function createErrorEnvelope(
  code: string,
  message: string,
  requestId: string,
  details?: ApiErrorDetails,
): ApiError {
  return {
    error: {
      code,
      message,
      ...(details ? { details } : {}),
      requestId,
    },
  };
}
