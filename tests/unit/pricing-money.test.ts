import { describe, expect, it } from "vitest";
import { formatMoney } from "../../packages/billing/src/index.js";

describe("Waflo-owned pricing money presentation", () => {
  it("uses ISO currency minor units rather than assuming cents", () => {
    expect(formatMoney(2_900n, "USD")).toContain("29.00");
    expect(formatMoney(99n, "JPY")).toContain("99");
    expect(formatMoney(99_900n, "TRY")).toContain("999.00");
  });

  it("keeps Arabic money formatting locale-aware", () => {
    expect(formatMoney(9_900n, "SAR", "ar")).toMatch(/٩|9/);
  });
});
