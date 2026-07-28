import { z } from "zod";

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
export const programStatusSchema = z.enum([
  "DRAFT",
  "VALIDATED",
  "TEST",
  "SCHEDULED",
  "PUBLISHED",
  "PAUSED",
  "ARCHIVED",
  "SUSPENDED",
]);
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
  maximumRedemptionsPerEarned: z.number().int().min(1).max(1).default(1),
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

const visualThemeInputSchema = z.object({
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
  layoutConfiguration: z.record(z.string(), z.unknown()).default({}),
  stampSize: z.number().int().min(24).max(96).default(48),
  stampSpacing: z.number().int().min(0).max(32).default(8),
  borderRadius: z.number().int().min(0).max(40).default(18),
  progressLabelVisible: z.boolean().default(true),
  rewardLabelVisible: z.boolean().default(true),
  customerWebVariant: z.enum(["CARD", "MINIMAL", "HERO"]).default("CARD"),
  applePreviewConfig: z.record(z.string(), z.unknown()).default({}),
  googlePreviewConfig: z.record(z.string(), z.unknown()).default({}),
});

export const programCreateSchema = z
  .object({
    internalName: z.string().trim().min(2).max(120),
    editingMode: programEditingModeSchema.default("quick"),
    templateCode: z.string().trim().max(80).optional(),
    requiredStampCount: z.number().int().min(2).max(30).default(8),
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

export const programUpdateSchema = programCreateSchema
  .partial()
  .extend({
    revision: z.number().int().min(1),
    changeSummary: z.string().trim().max(240).optional(),
  })
  .strict();

export const programTestStampSchema = z
  .object({
    amount: z.number().int().min(1).max(5).default(1),
    idempotencyKey: z.uuid(),
  })
  .strict();

export const programPublishSchema = z
  .object({
    idempotencyKey: z.uuid(),
  })
  .strict();

export const programTestResetSchema = z
  .object({
    idempotencyKey: z.uuid().optional(),
  })
  .strict();

export type ProgramCreateInput = z.infer<typeof programCreateSchema>;
export type ProgramUpdateInput = z.infer<typeof programUpdateSchema>;

export const merchantAssetUploadSchema = z
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
    filename: z.string().trim().min(1).max(255),
    mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
    contentBase64: z.string().min(16).max(3_000_000),
  })
  .strict();

export type MerchantAssetUploadInput = z.infer<typeof merchantAssetUploadSchema>;

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
