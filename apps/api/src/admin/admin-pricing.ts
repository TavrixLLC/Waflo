import { HttpStatus } from "@nestjs/common";
import { billingCadenceSchema, planCodeSchema } from "@waflo/contracts";
import { z } from "zod";
import { currencyMinorDigits } from "../billing/pricing-catalog.service.js";
import { AppError } from "../common/app-error.js";

const currencySchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{3}$/u)
  .transform((value) => value.toUpperCase());
const countrySchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2}$/u)
  .transform((value) => value.toUpperCase());

export const adminPricingMarketCreateSchema = z
  .object({ countryCode: countrySchema, currency: currencySchema })
  .strict();

export const adminPricingMarketUpdateSchema = z
  .object({ active: z.boolean().optional(), currency: currencySchema.optional() })
  .strict()
  .refine((value) => value.active !== undefined || value.currency !== undefined, {
    message: "Provide a market field to update.",
  });

export const adminPricingDraftSchema = z
  .object({
    marketId: z.uuid(),
    plan: planCodeSchema,
    cadence: billingCadenceSchema,
    amount: z.string().trim().min(1).max(32),
    currency: currencySchema,
    reason: z.string().trim().min(3).max(240).optional(),
  })
  .strict();

export const adminPricingReauthenticationSchema = z
  .object({ currentPassword: z.string().min(1).max(128) })
  .strict();

/** Converts an administrator-entered decimal string using server-owned ISO digits. */
export function pricingDecimalToMinor(amount: string, currency: string): bigint {
  const normalized = amount.normalize("NFKC").trim();
  if (!/^\d+(?:\.\d+)?$/u.test(normalized)) {
    throw new AppError(
      "PRICING_AMOUNT_INVALID",
      "Enter a positive decimal amount using digits and an optional decimal point.",
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  const digits = currencyMinorDigits(currency);
  const [whole = "", fraction = ""] = normalized.split(".");
  if (fraction.length > digits) {
    throw new AppError(
      "PRICING_AMOUNT_PRECISION_INVALID",
      `The selected currency supports at most ${digits} decimal places.`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  const result =
    BigInt(whole) * 10n ** BigInt(digits) +
    BigInt((fraction + "0".repeat(digits)).slice(0, digits) || "0");
  if (result <= 0n || result > 9_999_999_999_999n) {
    throw new AppError(
      "PRICING_AMOUNT_INVALID",
      "Enter a positive amount within the supported pricing range.",
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  return result;
}

export function pricingVersionStatusLabel(
  status: string,
): "DRAFT" | "VALIDATED" | "CURRENT" | "RETIRED" {
  if (status === "ACTIVE_FOR_NEW_SUBSCRIPTIONS") return "CURRENT";
  if (status === "RETIRED_FOR_NEW_SUBSCRIPTIONS") return "RETIRED";
  if (status === "VALIDATED") return "VALIDATED";
  return "DRAFT";
}
