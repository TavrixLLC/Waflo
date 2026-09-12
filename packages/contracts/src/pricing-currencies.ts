import { z } from "zod";

/**
 * Waflo's supported Stripe presentment currencies for recurring catalog prices.
 *
 * This is intentionally a product allow-list, not the complete ISO 4217 list:
 * a valid ISO code is not necessarily enabled or suitable for Waflo's current
 * Stripe recurring-billing route. Amounts are always stored in integer minor
 * units using the declared exponent; no pricing path performs FX conversion.
 */
export const pricingCurrencies = [
  {
    code: "USD",
    name: "US Dollar",
    arabicName: "دولار أمريكي",
    symbol: "$",
    minorUnit: 2,
  },
  {
    code: "EUR",
    name: "Euro",
    arabicName: "يورو",
    symbol: "€",
    minorUnit: 2,
  },
  {
    code: "GBP",
    name: "British Pound",
    arabicName: "جنيه إسترليني",
    symbol: "£",
    minorUnit: 2,
  },
  {
    code: "TRY",
    name: "Turkish Lira",
    arabicName: "ليرة تركية",
    symbol: "₺",
    minorUnit: 2,
  },
  {
    code: "SAR",
    name: "Saudi Riyal",
    arabicName: "ريال سعودي",
    // Textual product fallback. The Admin UI may replace this with the owned
    // Saudi mark without depending on an operating-system currency glyph.
    symbol: "ر.س.",
    minorUnit: 2,
  },
  {
    code: "AED",
    name: "UAE Dirham",
    arabicName: "درهم إماراتي",
    symbol: "د.إ",
    minorUnit: 2,
  },
  {
    code: "JPY",
    name: "Japanese Yen",
    arabicName: "ين ياباني",
    symbol: "¥",
    minorUnit: 0,
  },
  {
    code: "KWD",
    name: "Kuwaiti Dinar",
    arabicName: "دينار كويتي",
    symbol: "د.ك",
    minorUnit: 3,
  },
] as const;

export type PricingCurrencyCode = (typeof pricingCurrencies)[number]["code"];
export type PricingCurrencyMetadata = (typeof pricingCurrencies)[number];

const currenciesByCode = new Map<string, PricingCurrencyMetadata>(
  pricingCurrencies.map((currency) => [currency.code, currency]),
);

export function normalizePricingCurrency(value: string): string {
  return value.trim().toLocaleUpperCase("en-US");
}

export function isSupportedPricingCurrency(value: string): value is PricingCurrencyCode {
  return currenciesByCode.has(normalizePricingCurrency(value));
}

export function pricingCurrencyMetadata(value: string): PricingCurrencyMetadata | null {
  return currenciesByCode.get(normalizePricingCurrency(value)) ?? null;
}

export function pricingCurrencyMinorUnit(value: string): number | null {
  return pricingCurrencyMetadata(value)?.minorUnit ?? null;
}

export function pricingCurrencyOptions(locale: "en" | "ar") {
  return pricingCurrencies.map((currency) => ({
    ...currency,
    displayName: locale === "ar" ? currency.arabicName : currency.name,
    label:
      locale === "ar"
        ? `${currency.symbol} ${currency.arabicName} — ${currency.code}`
        : `${currency.symbol} ${currency.name} — ${currency.code}`,
  }));
}

export const pricingCurrencySchema = z
  .string()
  .trim()
  .transform(normalizePricingCurrency)
  .refine(isSupportedPricingCurrency, {
    message: "Unsupported Waflo recurring-billing currency.",
  })
  .transform((value) => value as PricingCurrencyCode);
