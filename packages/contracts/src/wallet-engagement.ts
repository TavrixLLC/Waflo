import { z } from "zod";

export const walletCampaignTitleMaxLength = 60;
export const walletCampaignBodyMaxLength = 240;
export const walletNearbyTextMaxLength = 120;
export const walletNearbyLocationLimit = 10;
export const walletPromotionNoticeVersion = "wallet-promotions-v1-LEGAL_REVIEW_REQUIRED";

const unsafeControlOrMarkup = /[\p{Cc}\p{Cs}\u202a-\u202e\u2066-\u2069<>]/u;
const unsupportedTemplate = /\{\{|\}\}|\$\{|<\/?[a-z]/iu;
const credentialLikeContent =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk_(?:live|test)_[0-9a-z_-]{12,}|\bAIza[0-9a-z_-]{20,}|\bgh[pousr]_[0-9a-z]{20,}|\bAKIA[0-9A-Z]{16}\b/iu;
const unsupportedNearbyOfferClaim =
  /\b(?:guaranteed?|discount|free)\b|\u062e\u0635\u0645|\u0645\u0636\u0645\u0648\u0646|\u0645\u062c\u0627\u0646(?:\u0627|\u064a|\u064a\u0629)?/iu;
const codePointLength = (value: string) => Array.from(value).length;

export const walletPlainTextSchema = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .refine((value) => codePointLength(value.normalize("NFKC")) <= max, {
      message: `Must contain at most ${max} Unicode characters.`,
    })
    .refine((value) => !unsafeControlOrMarkup.test(value), {
      message: "Control characters and HTML markup are not supported.",
    })
    .refine((value) => !unsupportedTemplate.test(value), {
      message: "Customer variables and template code are not supported.",
    })
    .refine((value) => !credentialLikeContent.test(value), {
      message: "Credentials and secrets are not supported in Wallet messages.",
    })
    .transform((value) =>
      value
        .normalize("NFKC")
        .replace(/[\t\n\r ]+/gu, " ")
        .trim(),
    );

const walletNearbyCustomTextSchema = walletPlainTextSchema(walletNearbyTextMaxLength)
  .refine(
    (value) => !/[{}]/u.test(value.replaceAll("{merchant}", "").replaceAll("{location}", "")),
    { message: "Only {merchant} and {location} may be used in nearby wording." },
  )
  .refine((value) => !unsupportedNearbyOfferClaim.test(value), {
    message: "Nearby wording cannot make unverified offer or discount claims.",
  });

export const walletNearbyUpdateSchema = z
  .object({
    enabled: z.boolean(),
    locationIds: z.array(z.string().uuid()).max(walletNearbyLocationLimit),
    appleCustomTextEn: walletNearbyCustomTextSchema.nullable().optional(),
    appleCustomTextAr: walletNearbyCustomTextSchema.nullable().optional(),
    revision: z.number().int().positive(),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.locationIds).size !== value.locationIds.length) {
      context.addIssue({
        code: "custom",
        path: ["locationIds"],
        message: "Each nearby location may be selected once.",
      });
    }
    if (value.enabled && value.locationIds.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["locationIds"],
        message: "Select at least one location before enabling nearby relevance.",
      });
    }
  });

export const walletCampaignCreateSchema = z
  .object({
    idempotencyKey: z.string().uuid(),
    locale: z.enum(["EN", "AR"]),
    title: walletPlainTextSchema(walletCampaignTitleMaxLength),
    body: walletPlainTextSchema(walletCampaignBodyMaxLength),
    destinationUrl: z.string().url().max(2048).nullable().optional(),
    providers: z.array(z.literal("GOOGLE")).min(1).max(1),
    audienceRule: z.literal("ALL_ELIGIBLE_WALLET_HOLDERS"),
  })
  .strict()
  .superRefine((value, context) => {
    for (const field of ["title", "body"] as const) {
      if (/[{}]/u.test(value[field])) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: "Wallet campaigns do not support message variables.",
        });
      }
    }
  });

export const walletPromotionConsentSchema = z
  .object({
    granted: z.boolean(),
    locale: z.enum(["EN", "AR"]),
    noticeVersion: z.literal(walletPromotionNoticeVersion),
  })
  .strict();

export type WalletNearbyUpdateInput = z.infer<typeof walletNearbyUpdateSchema>;
export type WalletCampaignCreateInput = z.infer<typeof walletCampaignCreateSchema>;
export type WalletPromotionConsentInput = z.infer<typeof walletPromotionConsentSchema>;
