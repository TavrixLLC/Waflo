import { describe, expect, it } from "vitest";
import type { PublishedPricingMarket } from "../../packages/billing/src/index.js";
import {
  currencyMinorUnitExponent,
  currencyMinorInputValue,
  formatCurrencyMinor,
  formatCurrencyMinorRatio,
  normalizeCloudflareCountry,
  normalizePricingCurrency,
  parseCurrencyMajorToMinor,
  pricingCurrencyOptions,
  resolvePublishedPricingMarket,
  STRIPE_CARD_PRESENTMENT_CURRENCIES,
} from "../../packages/billing/src/index.js";

// Stripe's current card-presentment baseline, reviewed against
// https://docs.stripe.com/currencies. Keep this test list independent of the
// production catalog so an accidental production truncation is visible.
const expectedStripeCardCurrencies = [
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

const plans = ["starter", "growth", "scale"] as const;
const cadences = ["monthly", "quarterly", "yearly"] as const;

function market(
  code: string,
  countryCode: string | null,
  currency: string,
  active = true,
): PublishedPricingMarket {
  return {
    code,
    countryCode,
    currency,
    active,
    terms: plans.flatMap((plan, planIndex) =>
      cadences.map((cadence, cadenceIndex) => ({
        plan,
        cadence,
        amountMinor:
          currency === "TRY" && cadence === "monthly"
            ? (["109900", "179900", "369900"][planIndex] ?? "0")
            : String((planIndex + 1) * (cadenceIndex + 1) * 1000),
        currency,
      })),
    ),
  };
}

describe("Stripe card presentment currency catalog", () => {
  it("keeps the complete reviewed 135-currency card baseline", () => {
    expect(STRIPE_CARD_PRESENTMENT_CURRENCIES).toEqual(expectedStripeCardCurrencies);
    expect(STRIPE_CARD_PRESENTMENT_CURRENCIES).toHaveLength(135);
  });

  it("accepts only the centralized provider catalog at validation boundaries", () => {
    expect(normalizePricingCurrency("try")).toBe("TRY");
    expect(normalizePricingCurrency("ZZZ")).toBeNull();
  });

  it("is searchable by code, name, and a practical symbol", () => {
    const options = pricingCurrencyOptions();
    const turkishLira = options.find((option) => option.value === "TRY");
    const saudiRiyal = options.find((option) => option.value === "SAR");
    expect(turkishLira?.searchText).toMatch(/TRY.*Turkish Lira.*₺/u);
    expect(saudiRiyal?.searchText).toMatch(/SAR.*Saudi Riyal/u);
  });
});

describe("currency formatting preserves integer minor units", () => {
  it.each([
    ["USD", 109900n, 2, /\$1,099\.00/u],
    ["TRY", 109900n, 2, /₺1,099\.00/u],
    ["SAR", 109900n, 2, /⃁/u],
    ["JPY", 1099n, 0, /¥1,099/u],
    ["KRW", 1099n, 0, /₩1,099/u],
    ["VND", 1099n, 0, /₫1,099/u],
  ] as const)("formats %s without assuming cents", (currency, amount, exponent, expected) => {
    expect(currencyMinorUnitExponent(currency)).toBe(exponent);
    expect(formatCurrencyMinor(amount, currency, "en-US")).toMatch(expected);
  });

  it("keeps RTL formatting locale-aware", () => {
    expect(formatCurrencyMinor(109900n, "TRY", "ar-IQ")).toContain("₺");
  });

  it("formats a cadence ratio with the same currency exponent rules", () => {
    expect(formatCurrencyMinorRatio(299700n, 3, "TRY", "en-US")).toContain("₺999.00");
  });

  it("round-trips decimal refund inputs with the selected currency exponent", () => {
    expect(currencyMinorInputValue(14900n, "SAR")).toBe("149.00");
    expect(parseCurrencyMajorToMinor("149.00", "SAR")).toBe(14900);
    expect(currencyMinorInputValue(149n, "JPY")).toBe("149");
    expect(parseCurrencyMajorToMinor("149", "JPY")).toBe(149);
    expect(parseCurrencyMajorToMinor("149.00", "JPY")).toBeNull();
  });

  it("uses Waflo's approved Saudi Riyal symbol in English and Arabic", () => {
    for (const locale of ["en-US", "ar-IQ"]) {
      const value = formatCurrencyMinor(109900n, "SAR", locale);
      expect(value).toContain("⃁");
      expect(value).not.toContain("SAR");
      expect(value).not.toContain("ر.س.");
    }
  });

  it.each([
    ["EUR", "€"],
    ["GBP", "£"],
    ["CNY", "¥"],
    ["INR", "₹"],
    ["THB", "฿"],
    ["PHP", "₱"],
    ["ILS", "₪"],
    ["PLN", "zł"],
    ["UAH", "₴"],
    ["NGN", "₦"],
    ["CRC", "₡"],
    ["PYG", "₲"],
  ] as const)("uses the recognized %s symbol", (currency, symbol) => {
    const value = formatCurrencyMinor(109900n, currency, "en-US");
    expect(value).toContain(symbol);
    expect(value).not.toMatch(new RegExp(`\\b${currency}\\b`, "u"));
  });
});

describe("trusted country market resolution", () => {
  const global = market("GLOBAL", null, "USD");
  const turkey = market("TR", "TR", "TRY");

  it("normalizes only valid Cloudflare ISO country values", () => {
    expect(normalizeCloudflareCountry("tr")).toBe("TR");
    expect(normalizeCloudflareCountry("TR")).toBe("TR");
    expect(normalizeCloudflareCountry("XX")).toBeNull();
    expect(normalizeCloudflareCountry("T1")).toBeNull();
    expect(normalizeCloudflareCountry("Turkey")).toBeNull();
  });

  it("returns published Turkey terms for a trusted TR request", () => {
    const result = resolvePublishedPricingMarket({
      country: "TR",
      global,
      regionalMarkets: [turkey],
    });
    expect(result.market).toMatchObject({ code: "TR", countryCode: "TR", currency: "TRY" });
    expect(
      result.market.terms
        .filter((term) => term.cadence === "monthly")
        .map((term) => term.amountMinor),
    ).toEqual(["109900", "179900", "369900"]);
  });

  it("falls back to GLOBAL for US, missing, invalid, inactive, or incomplete overrides", () => {
    expect(
      resolvePublishedPricingMarket({ country: "US", global, regionalMarkets: [turkey] }).market
        .code,
    ).toBe("GLOBAL");
    expect(
      resolvePublishedPricingMarket({ country: null, global, regionalMarkets: [turkey] }).market
        .code,
    ).toBe("GLOBAL");
    expect(
      resolvePublishedPricingMarket({
        country: "TR",
        global,
        regionalMarkets: [market("TR", "TR", "TRY", false)],
      }).market.code,
    ).toBe("GLOBAL");
    expect(
      resolvePublishedPricingMarket({
        country: "TR",
        global,
        regionalMarkets: [{ ...turkey, terms: turkey.terms.slice(1) }],
      }).market.code,
    ).toBe("GLOBAL");
  });

  it("does not contaminate sequential country reads", () => {
    const resolve = (country: string | null) =>
      resolvePublishedPricingMarket({ country, global, regionalMarkets: [turkey] }).market.currency;
    expect([resolve("TR"), resolve("US"), resolve("TR")]).toEqual(["TRY", "USD", "TRY"]);
    expect([resolve("US"), resolve("TR")]).toEqual(["USD", "TRY"]);
  });
});
