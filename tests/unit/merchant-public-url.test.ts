import { describe, expect, it } from "vitest";
import { merchantPublicUrlForBase } from "../../apps/merchant-dashboard/lib/merchant-public-url.js";

describe("merchant public URL deployment contract", () => {
  it("uses the canonical merchant subdomain in production", () => {
    expect(merchantPublicUrlForBase("Coffee-House", "https://card.waflo.app")).toBe(
      "https://coffee-house.waflo.app/",
    );
  });

  it("uses the shared tenant route in staging", () => {
    expect(merchantPublicUrlForBase("coffee-house", "https://card-staging.waflo.app")).toBe(
      "https://card-staging.waflo.app/?tenant=coffee-house",
    );
  });

  it("uses the local customer app without inventing a local subdomain", () => {
    expect(merchantPublicUrlForBase("coffee-house", "http://localhost:3002")).toBe(
      "http://localhost:3002/?tenant=coffee-house",
    );
  });
});
