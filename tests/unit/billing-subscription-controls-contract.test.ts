import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  billingSubscriptionCancellationSchema,
  billingSubscriptionChangeSchema,
} from "../../packages/contracts/src/index.js";

describe("active subscription control contract", () => {
  it("keeps plan changes and cancellation inputs narrow", () => {
    expect(
      billingSubscriptionChangeSchema.safeParse({ plan: "growth", cadence: "yearly" }).success,
    ).toBe(true);
    expect(
      billingSubscriptionChangeSchema.safeParse({
        plan: "growth",
        cadence: "yearly",
        priceId: "price_untrusted",
      }).success,
    ).toBe(false);
    expect(
      billingSubscriptionCancellationSchema.safeParse({ reason: "Too expensive" }).success,
    ).toBe(true);
    expect(
      billingSubscriptionCancellationSchema.safeParse({ reason: "x".repeat(501) }).success,
    ).toBe(false);
  });

  it("requires Stripe to collect immediate changes atomically", () => {
    const service = readFileSync("apps/api/src/billing/billing.service.ts", "utf8");
    expect(service).toContain('payment_behavior: "error_if_incomplete"');
    expect(service).toContain('proration_behavior: "always_invoice"');
    expect(service).toContain("await this.assertSubscriptionChangeAllowed");
    expect(service).toContain("await this.requireBillingOwner");
  });

  it("schedules cancellation at period end and supports reversal", () => {
    const service = readFileSync("apps/api/src/billing/billing.service.ts", "utf8");
    expect(service).toContain("cancel_at_period_end: true");
    expect(service).toContain("cancel_at_period_end: false");
    expect(service).toContain('action: "billing.subscription_cancellation_scheduled"');
    expect(service).toContain('action: "billing.subscription_cancellation_reversed"');
  });
});
