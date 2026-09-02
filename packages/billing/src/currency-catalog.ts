/**
 * Waflo's authoritative card-presentment currency catalog.
 *
 * Baseline: Stripe's supported card presentment currencies. This is deliberately
 * independent of local payment-method availability: Waflo's standard subscription
 * flow is card-based, and a regional price must not disappear merely because an
 * unrelated local payment method has narrower currency support.
 */
export const STRIPE_CARD_PRESENTMENT_CURRENCIES = [
  "USD",
  "AED",
  "AFN",
  "ALL",
  "AMD",
  "ANG",
  "AOA",
  "ARS",
  "AUD",
  "AWG",
  "AZN",
  "BAM",
  "BBD",
  "BDT",
  "BGN",
  "BIF",
  "BMD",
  "BND",
  "BOB",
  "BRL",
  "BSD",
  "BWP",
  "BYN",
  "BZD",
  "CAD",
  "CDF",
  "CHF",
  "CLP",
  "CNY",
  "COP",
  "CRC",
  "CVE",
  "CZK",
  "DJF",
  "DKK",
  "DOP",
  "DZD",
  "EGP",
  "ETB",
  "EUR",
  "FJD",
  "FKP",
  "GBP",
  "GEL",
  "GIP",
  "GMD",
  "GNF",
  "GTQ",
  "GYD",
  "HKD",
  "HNL",
  "HTG",
  "HUF",
  "IDR",
  "ILS",
  "INR",
  "ISK",
  "JMD",
  "JPY",
  "KES",
  "KGS",
  "KHR",
  "KMF",
  "KRW",
  "KYD",
  "KZT",
  "LAK",
  "LBP",
  "LKR",
  "LRD",
  "LSL",
  "MAD",
  "MDL",
  "MGA",
  "MKD",
  "MMK",
  "MNT",
  "MOP",
  "MUR",
  "MVR",
  "MWK",
  "MXN",
  "MYR",
  "MZN",
  "NAD",
  "NGN",
  "NIO",
  "NOK",
  "NPR",
  "NZD",
  "PAB",
  "PEN",
  "PGK",
  "PHP",
  "PKR",
  "PLN",
  "PYG",
  "QAR",
  "RON",
  "RSD",
  "RUB",
  "RWF",
  "SAR",
  "SBD",
  "SCR",
  "SEK",
  "SGD",
  "SHP",
  "SLE",
  "SOS",
  "SRD",
  "STD",
  "SZL",
  "THB",
  "TJS",
  "TOP",
  "TRY",
  "TTD",
  "TWD",
  "TZS",
  "UAH",
  "UGX",
  "UYU",
  "UZS",
  "VND",
  "VUV",
  "WST",
  "XAF",
  "XCD",
  "XCG",
  "XOF",
  "XPF",
  "YER",
  "ZAR",
  "ZMW",
] as const;

export type SupportedPricingCurrency = (typeof STRIPE_CARD_PRESENTMENT_CURRENCIES)[number];

export type StripeAmountRule = "standard" | "isk_two_decimal";

export interface PricingCurrency {
  /** Lowercase code for Stripe API payloads. */
  readonly stripeCode: Lowercase<SupportedPricingCurrency>;
  /** Uppercase ISO code for persisted Waflo catalog terms and display. */
  readonly isoCode: SupportedPricingCurrency;
  readonly name: string;
  /** Exponent used for Waflo/Stripe integer amounts. */
  readonly minorUnitExponent: number;
  /** ISO display has no fractional unit, even where Stripe has a legacy exception. */
  readonly zeroDecimal: boolean;
  readonly symbol: string;
  readonly narrowSymbolOverride?: string;
  readonly stripeAmountRule: StripeAmountRule;
}

const zeroDecimalCurrencies = new Set<SupportedPricingCurrency>([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "ISK",
  "JPY",
  "KMF",
  "KRW",
  "MGA",
  "PYG",
  "RWF",
  "UGX",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);

/*
 * Intl exposes codes for some currencies in English even though their normal
 * local mark is well established. Replace only those marks Waflo can represent
 * reliably as text. SAR uses Waflo's approved Saudi Riyal sign so its meaning
 * remains identical in English, Arabic, SSR, and client rendering.
 */
const narrowSymbolOverrides: Readonly<Partial<Record<SupportedPricingCurrency, string>>> = {
  // Keep the product's primary symbols stable across locales. In particular,
  // some RTL Intl implementations expand USD to "US$", which is useful for
  // disambiguation but not the customer-facing Waflo price token.
  USD: "$",
  AED: "د.إ.",
  DZD: "د.ج.",
  EGP: "ج.م.",
  LBP: "ل.ل.",
  MAD: "د.م.",
  QAR: "ر.ق.",
  SAR: "⃁",
  TRY: "₺",
  YER: "﷼",
};

const displayNames = new Intl.DisplayNames(["en"], { type: "currency" });

function intlCurrencySymbol(currency: string, locale = "en-US"): string {
  const part = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
  })
    .formatToParts(0)
    .find((candidate) => candidate.type === "currency");
  return part?.value ?? currency;
}

function createCurrency(isoCode: SupportedPricingCurrency): PricingCurrency {
  const zeroDecimal = zeroDecimalCurrencies.has(isoCode);
  const stripeAmountRule: StripeAmountRule = isoCode === "ISK" ? "isk_two_decimal" : "standard";
  const minorUnitExponent = stripeAmountRule === "isk_two_decimal" ? 2 : zeroDecimal ? 0 : 2;
  const narrowSymbolOverride = narrowSymbolOverrides[isoCode];
  return {
    stripeCode: isoCode.toLowerCase() as Lowercase<SupportedPricingCurrency>,
    isoCode,
    name: displayNames.of(isoCode) ?? isoCode,
    minorUnitExponent,
    zeroDecimal,
    symbol: narrowSymbolOverride ?? intlCurrencySymbol(isoCode),
    ...(narrowSymbolOverride ? { narrowSymbolOverride } : {}),
    stripeAmountRule,
  };
}

export const pricingCurrencyCatalog: readonly PricingCurrency[] =
  STRIPE_CARD_PRESENTMENT_CURRENCIES.map(createCurrency);

const pricingCurrencyByCode = new Map(
  pricingCurrencyCatalog.map((currency) => [currency.isoCode, currency]),
);

export function normalizePricingCurrency(value: string): SupportedPricingCurrency | null {
  const normalized = value.trim().toUpperCase();
  return pricingCurrencyByCode.has(normalized as SupportedPricingCurrency)
    ? (normalized as SupportedPricingCurrency)
    : null;
}

export function getPricingCurrency(value: string): PricingCurrency | null {
  const code = normalizePricingCurrency(value);
  return code ? (pricingCurrencyByCode.get(code) ?? null) : null;
}

export function requirePricingCurrency(value: string): PricingCurrency {
  const currency = getPricingCurrency(value);
  if (!currency) throw new RangeError("Unsupported Waflo card presentment currency.");
  return currency;
}

export function currencyMinorUnitExponent(value: string): number {
  return requirePricingCurrency(value).minorUnitExponent;
}

export function currencyDisplaySymbol(value: string, locale = "en-US"): string {
  const currency = requirePricingCurrency(value);
  if (currency.narrowSymbolOverride) return currency.narrowSymbolOverride;
  return intlCurrencySymbol(
    currency.isoCode,
    locale.toLowerCase().startsWith("ar") ? "ar-IQ" : locale,
  );
}

export function pricingCurrencyOptions() {
  return pricingCurrencyCatalog.map((currency) => ({
    value: currency.isoCode,
    label: `${currency.symbol} · ${currency.isoCode} — ${currency.name}`,
    searchText: `${currency.isoCode} ${currency.stripeCode} ${currency.name} ${currency.symbol}`,
  }));
}

/** Formats persisted Stripe/Waflo integer minor units without assuming cents. */
export function formatCurrencyMinor(
  amountMinor: bigint | number | string,
  currencyCode: string,
  locale = "en-US",
): string {
  const currency = requirePricingCurrency(currencyCode);
  const minor = typeof amountMinor === "bigint" ? amountMinor : BigInt(amountMinor);
  return formatCurrencyValue(Number(minor) / 10 ** currency.minorUnitExponent, currency, locale);
}

/** Formats a display-only fraction of a persisted minor-unit amount. */
export function formatCurrencyMinorRatio(
  amountMinor: bigint | number | string,
  divisor: number,
  currencyCode: string,
  locale = "en-US",
): string {
  if (!Number.isSafeInteger(divisor) || divisor <= 0)
    throw new RangeError("Invalid currency divisor.");
  const currency = requirePricingCurrency(currencyCode);
  const minor = typeof amountMinor === "bigint" ? amountMinor : BigInt(amountMinor);
  return formatCurrencyValue(
    Number(minor) / (10 ** currency.minorUnitExponent * divisor),
    currency,
    locale,
  );
}

/** Produces an ASCII decimal suitable for a native monetary amount input. */
export function currencyMinorInputValue(
  amountMinor: bigint | number | string,
  currencyCode: string,
): string {
  const currency = requirePricingCurrency(currencyCode);
  const minor = typeof amountMinor === "bigint" ? amountMinor : BigInt(amountMinor);
  if (minor < 0n) throw new RangeError("Currency input amount cannot be negative.");
  const divisor = 10n ** BigInt(currency.minorUnitExponent);
  const whole = minor / divisor;
  const fraction = minor % divisor;
  if (currency.minorUnitExponent === 0) return whole.toString();
  return `${whole}.${fraction.toString().padStart(currency.minorUnitExponent, "0")}`;
}

/** Parses a decimal input into provider-compatible integer minor units. */
export function parseCurrencyMajorToMinor(value: string, currencyCode: string): number | null {
  const currency = requirePricingCurrency(currencyCode);
  const match = /^(\d+)(?:\.(\d+))?$/u.exec(value.trim());
  if (!match) return null;
  const fraction = match[2] ?? "";
  if (fraction.length > currency.minorUnitExponent) return null;
  const divisor = 10n ** BigInt(currency.minorUnitExponent);
  const minor =
    BigInt(match[1] ?? "0") * divisor +
    BigInt(fraction.padEnd(currency.minorUnitExponent, "0") || "0");
  return minor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minor) : null;
}

function formatCurrencyValue(value: number, currency: PricingCurrency, locale: string): string {
  const asNumber = value;
  if (!Number.isFinite(asNumber)) throw new RangeError("Currency amount is outside display range.");
  const formatter = new Intl.NumberFormat(
    // Preserve an explicitly supplied numbering-system extension (for example
    // ar-IQ-u-nu-latn) instead of replacing it with the Arabic default.
    locale === "ar" ? "ar-IQ" : locale,
    {
      style: "currency",
      currency: currency.isoCode,
      currencyDisplay: "narrowSymbol",
    },
  );
  const override = currency.narrowSymbolOverride;
  return formatter
    .formatToParts(asNumber)
    .map((part) => (part.type === "currency" && override ? override : part.value))
    .join("");
}

/** Cloudflare only supplies ISO alpha-2 codes plus XX and T1 special values. */
export function normalizeCloudflareCountry(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase() ?? "";
  if (!/^[A-Z]{2}$/u.test(normalized) || normalized === "XX" || normalized === "T1") return null;
  try {
    const display = new Intl.DisplayNames(["en"], { type: "region" }).of(normalized);
    return display && display !== normalized && display !== "Unknown Region" ? normalized : null;
  } catch {
    return null;
  }
}
