import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Stripe invoice retrieval", () => {
  it("keeps invoice expansions within Stripe's maximum property depth", () => {
    const source = readFileSync(
      resolve(process.cwd(), "apps/api/src/billing/billing.service.ts"),
      "utf8",
    );

    expect(source).toContain('"payments.data.payment.payment_intent"');
    expect(source).not.toContain('"payments.data.payment.payment_intent.payment_method"');
  });
});
