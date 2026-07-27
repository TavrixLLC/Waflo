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
