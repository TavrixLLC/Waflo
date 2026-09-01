import { describe, expect, it, vi } from "vitest";
import type { WafloRequest } from "../../apps/api/src/common/request-context.js";
import { PublicController } from "../../apps/api/src/public/public.controller.js";

function request(country?: string): WafloRequest {
  return {
    headers: country ? { "cf-ipcountry": country } : {},
  } as unknown as WafloRequest;
}

describe("public pricing country boundary", () => {
  it("normalizes only the trusted server CF-IPCountry value before catalog resolution", async () => {
    const publicCatalogTermsForCountry = vi.fn(async (country: string | null) => ({
      market: {
        code: country === "TR" ? "TR" : "GLOBAL",
        currency: country === "TR" ? "TRY" : "USD",
      },
      terms: [],
    }));
    const controller = new PublicController(
      {} as never,
      {} as never,
      { publicCatalogTermsForCountry } as never,
    );

    await expect(controller.pricingForVisitor(request("tr"))).resolves.toMatchObject({
      market: { code: "TR", currency: "TRY" },
    });
    await expect(controller.pricingForVisitor(request("Turkey"))).resolves.toMatchObject({
      market: { code: "GLOBAL", currency: "USD" },
    });
    await expect(controller.pricingForVisitor(request())).resolves.toMatchObject({
      market: { code: "GLOBAL", currency: "USD" },
    });
    expect(publicCatalogTermsForCountry).toHaveBeenNthCalledWith(1, "TR");
    expect(publicCatalogTermsForCountry).toHaveBeenNthCalledWith(2, null);
    expect(publicCatalogTermsForCountry).toHaveBeenNthCalledWith(3, null);
  });
});
