import { z } from "zod";

export const programPublicSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(50)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const emailCollectionModeSchema = z.enum(["HIDDEN", "OPTIONAL", "REQUIRED"]);

export const programEnrollmentPolicySchema = z
  .object({
    emailCollectionMode: emailCollectionModeSchema,
    primaryCustomerLocale: z.enum(["en", "ar"]),
    allowLocaleSelection: z.boolean(),
    marketingConsentVisible: z.boolean(),
    marketingConsentDefault: z.literal(false).default(false),
    customerTermsRequired: z.literal(true).default(true),
    transferWithoutEmailAllowed: z.boolean(),
    enrollmentOpen: z.boolean(),
  })
  .strict();

export const enrollmentInputSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120),
    email: z.union([z.literal(""), z.email().max(254)]).optional(),
    preferredLocale: z.enum(["en", "ar"]),
    programTermsAccepted: z.literal(true),
    wafloPrivacyAccepted: z.literal(true),
    marketingEmailConsent: z.boolean().default(false),
    formStartedAt: z.number().int().positive(),
    website: z.string().max(0).default(""),
  })
  .strict();

export const customerSessionRotateSchema = z
  .object({
    reason: z.enum(["CUSTOMER_REQUEST", "SECURITY_REFRESH"]).default("CUSTOMER_REQUEST"),
  })
  .strict();

export const transferInspectSchema = z
  .object({
    qrPayload: z.string().min(40).max(220),
  })
  .strict();

export const transferRequestSchema = z
  .object({
    qrPayload: z.string().min(40).max(220),
    preferredLocale: z.enum(["en", "ar"]).default("en"),
  })
  .strict();

export const transferResendSchema = z
  .object({
    transferPublicId: z.string().min(20).max(80),
  })
  .strict();

export const transferEmailConfirmSchema = z
  .object({
    transferPublicId: z.string().min(20).max(80),
    token: z.string().min(32).max(256),
  })
  .strict();

export const transferWithoutEmailConfirmSchema = z
  .object({
    transferPublicId: z.string().min(20).max(80),
    challenge: z.string().min(32).max(256),
    explicitRiskAccepted: z.literal(true),
  })
  .strict();

export const appleRegistrationSchema = z
  .object({
    pushToken: z.string().min(16).max(512),
  })
  .strict();

export const appleLogsSchema = z
  .object({
    logs: z.array(z.string().max(500)).max(20),
  })
  .strict();

export type ProgramEnrollmentPolicyInput = z.infer<typeof programEnrollmentPolicySchema>;
export type EnrollmentInput = z.infer<typeof enrollmentInputSchema>;
export type TransferRequestInput = z.infer<typeof transferRequestSchema>;
