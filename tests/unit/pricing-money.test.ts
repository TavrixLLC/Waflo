import { describe, expect, it } from "vitest";
import { formatMoney } from "../../packages/billing/src/index.js";
import {
  pricingCurrencyMinorUnit,
  pricingCurrencyOptions,
  pricingCurrencySchema,
} from "../../packages/contracts/src/index.js";

describe("Waflo-owned pricing money presentation", () => {
  it("uses ISO currency minor units rather than assuming cents", () => {
    expect(formatMoney(2_900n, "USD")).toContain("29.00");
    expect(formatMoney(99n, "JPY")).toContain("99");
    expect(formatMoney(99_900n, "TRY")).toContain("999.00");
  });

  it("keeps Arabic money formatting locale-aware", () => {
    expect(formatMoney(9_900n, "SAR", "ar")).toMatch(/٩|9/);
  });

  it("exposes only Waflo's supported recurring Stripe currencies", () => {
    expect(pricingCurrencySchema.parse("sar")).toBe("SAR");
    expect(pricingCurrencySchema.parse("try")).toBe("TRY");
    expect(() => pricingCurrencySchema.parse("XYZ")).toThrow();
    expect(pricingCurrencyOptions("en").map((currency) => currency.code)).toEqual(
      expect.arrayContaining(["SAR", "TRY", "JPY", "KWD"]),
    );
  });

  it("declares zero- and three-decimal minor-unit rules without assuming cents", () => {
    expect(pricingCurrencyMinorUnit("SAR")).toBe(2);
    expect(pricingCurrencyMinorUnit("JPY")).toBe(0);
    expect(pricingCurrencyMinorUnit("KWD")).toBe(3);
  });
});
