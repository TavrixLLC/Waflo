import { describe, expect, it } from "vitest";
import { catalogSavingsPercentage } from "../../packages/billing/src/index.js";

const monthly = {
  plan: "starter" as const,
  cadence: "monthly" as const,
  amountMinor: "100",
  currency: "USD",
  marketCode: "GLOBAL",
};

describe("catalog discount presentation", () => {
  it("derives quarterly and yearly savings from exact published minor units", () => {
    expect(
      catalogSavingsPercentage(monthly, { ...monthly, cadence: "quarterly", amountMinor: "270" }),
    ).toBe("10%");
    expect(
      catalogSavingsPercentage(monthly, { ...monthly, cadence: "quarterly", amountMinor: "250" }),
    ).toBe("16.67%");
    expect(
      catalogSavingsPercentage(monthly, { ...monthly, cadence: "yearly", amountMinor: "1000" }),
    ).toBe("16.67%");
  });

  it("does not claim a saving for equal, higher, missing, or incomparable prices", () => {
    expect(
      catalogSavingsPercentage(monthly, { ...monthly, cadence: "quarterly", amountMinor: "300" }),
    ).toBeNull();
    expect(
      catalogSavingsPercentage(monthly, { ...monthly, cadence: "quarterly", amountMinor: "301" }),
    ).toBeNull();
    expect(catalogSavingsPercentage(null, { ...monthly, cadence: "quarterly" })).toBeNull();
    expect(
      catalogSavingsPercentage(monthly, {
        ...monthly,
        cadence: "quarterly",
        currency: "SAR",
      }),
    ).toBeNull();
  });

  it("keeps regional and zero-decimal currency calculations exact", () => {
    const sarMonthly = { ...monthly, currency: "SAR", marketCode: "SA", amountMinor: "10000" };
    expect(
      catalogSavingsPercentage(sarMonthly, {
        ...sarMonthly,
        cadence: "quarterly",
        amountMinor: "25000",
      }),
    ).toBe("16.67%");
    const yenMonthly = { ...monthly, currency: "JPY", marketCode: "JP", amountMinor: "100" };
    expect(
      catalogSavingsPercentage(yenMonthly, {
        ...yenMonthly,
        cadence: "yearly",
        amountMinor: "1000",
      }),
    ).toBe("16.67%");
  });
});
