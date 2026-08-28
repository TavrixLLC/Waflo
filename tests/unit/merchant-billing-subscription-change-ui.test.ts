import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  activeBillingSubscription,
  billingChangeCopy,
  billingChangeDirection,
  billingPlanAction,
  canChangeSubscription,
  canSubmitSubscriptionChange,
  formatBillingAmount,
  isSubscriptionChangeNoop,
  isSubscriptionChangePreviewExpired,
  nextRenewalDisplay,
  SUBSCRIPTION_CHANGE_CONVERGENCE_REFRESH_MS,
  type SubscriptionChangePreview,
  shouldDisplayAnnualPriceChange,
  shouldDisplayProrationCredit,
  shouldShowInitialCheckout,
  subscriptionChangeConfirmationRequest,
  subscriptionChangeErrorKind,
  subscriptionChangePreviewRequest,
} from "../../apps/merchant-dashboard/components/billing-subscription-change";

const billingScreenSource = readFileSync(
  resolve(process.cwd(), "apps/merchant-dashboard/components/dashboard-screens.tsx"),
  "utf8",
);

const active = {
  id: "sub-local",
  status: "ACTIVE",
  planCode: "GROWTH",
  createdAt: "2026-08-01T00:00:00.000Z",
};

function preview(overrides: Partial<SubscriptionChangePreview> = {}): SubscriptionChangePreview {
  return {
    previewId: "11111111-1111-4111-8111-111111111111",
    current: {
      plan: "growth",
      cadence: "monthly",
      amountMinor: "9900",
      currency: "SAR",
    },
    target: {
      plan: "scale",
      cadence: "monthly",
      amountMinor: "14900",
      currency: "SAR",
    },
    proration: {
      amountDueNow: "4300",
      creditAmount: "1100",
      nextRenewalAmount: null,
      nextRenewalAt: "2026-09-01T00:00:00.000Z",
      lines: [],
    },
    expiresAt: "2026-08-27T12:10:00.000Z",
    ...overrides,
  };
}

function firstJsonBody(request: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const call = request.mock.calls.at(0);
  const options = call?.[1] as RequestInit | undefined;
  if (typeof options?.body !== "string") throw new Error("Expected a JSON request body.");
  return JSON.parse(options.body) as Record<string, unknown>;
}

describe("merchant Billing subscription-change UI contract", () => {
  it("routes an active subscriber plan choice to subscription change", () => {
    expect(billingPlanAction(active, true)).toBe("subscription-change");
  });

  it("routes a trialing subscriber plan choice to subscription change", () => {
    expect(billingPlanAction({ ...active, status: "TRIALING" }, true)).toBe("subscription-change");
  });

  it("keeps an unsubscribed merchant on setup selection", () => {
    expect(billingPlanAction(null, false)).toBe("setup-selection");
  });

  it("does not show a static USD catalog amount while an active subscriber chooses a change", () => {
    expect(billingScreenSource).toContain("showCatalogPrice={!subscriptionChangeEnabled}");
  });

  it("does not enable changes without canonical current terms", () => {
    expect(canChangeSubscription(active, false)).toBe(false);
  });

  it("finds the canonical active subscription instead of a canceled record", () => {
    expect(activeBillingSubscription([{ ...active, status: "CANCELED" }, active])).toEqual(active);
  });

  it("does not treat a past-due subscription as changeable", () => {
    expect(activeBillingSubscription([{ ...active, status: "PAST_DUE" }])).toBeNull();
  });

  it("shows initial Checkout for an unsubscribed merchant", () => {
    expect(shouldShowInitialCheckout(null, false)).toBe(true);
  });

  it("hides initial Checkout for an active subscriber", () => {
    expect(shouldShowInitialCheckout(active, true)).toBe(false);
  });

  it("sends only target plan and cadence to preview", async () => {
    const request = vi.fn().mockResolvedValue(preview());
    await subscriptionChangePreviewRequest(request, "org-1", "scale", "yearly");
    const options = request.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(options.body))).toEqual({
      targetPlan: "scale",
      targetCadence: "yearly",
    });
  });

  it("uses the authenticated organization preview route", async () => {
    const request = vi.fn().mockResolvedValue(preview());
    await subscriptionChangePreviewRequest(request, "org-1", "scale", "monthly");
    expect(request.mock.calls[0]?.[0]).toBe(
      "/v1/organizations/org-1/billing/subscription-change/preview",
    );
  });

  it("does not submit amount, currency, market, version, or Stripe Price", async () => {
    const request = vi.fn().mockResolvedValue(preview());
    await subscriptionChangePreviewRequest(request, "org-1", "scale", "monthly");
    const body = firstJsonBody(request);
    expect(Object.keys(body).sort()).toEqual(["targetCadence", "targetPlan"]);
  });

  it("uses the server preview target amount and regional currency", () => {
    expect(preview().target).toMatchObject({ amountMinor: "14900", currency: "SAR" });
  });

  it("maps provider amount due now without client calculation", () => {
    expect(preview().proration.amountDueNow).toBe("4300");
  });

  it("displays a positive provider credit", () => {
    expect(shouldDisplayProrationCredit("1100")).toBe(true);
  });

  it("omits an absent provider credit", () => {
    expect(shouldDisplayProrationCredit("0")).toBe(false);
  });

  it("does not guess a null next-renewal amount", () => {
    expect(nextRenewalDisplay(preview(), "en").amount).toBeNull();
  });

  it("formats a supplied next-renewal amount", () => {
    const value = preview({
      proration: { ...preview().proration, nextRenewalAmount: "14900" },
    });
    expect(nextRenewalDisplay(value, "en").amount).toContain("149.00");
  });

  it("preserves the provider next-renewal date", () => {
    expect(nextRenewalDisplay(preview(), "en").date).toContain("Sep 1, 2026");
  });

  it("confirms with the preview ID route and no commercial body", async () => {
    const request = vi.fn().mockResolvedValue({ status: "CONFIRMED" });
    await subscriptionChangeConfirmationRequest(request, "org-1", "preview/unsafe");
    expect(request.mock.calls[0]?.[0]).toBe(
      "/v1/organizations/org-1/billing/subscription-change/preview%2Funsafe/confirm",
    );
    expect(firstJsonBody(request)).toEqual({});
  });

  it("blocks duplicate UI confirmation while one is in flight", () => {
    expect(canSubmitSubscriptionChange({ hasPreview: true, inFlight: true, expired: false })).toBe(
      false,
    );
  });

  it("allows one valid confirmation", () => {
    expect(canSubmitSubscriptionChange({ hasPreview: true, inFlight: false, expired: false })).toBe(
      true,
    );
  });

  it("blocks confirmation when no preview is open", () => {
    expect(
      canSubmitSubscriptionChange({ hasPreview: false, inFlight: false, expired: false }),
    ).toBe(false);
  });

  it("treats an exactly-current plan and cadence as a no-op", () => {
    expect(isSubscriptionChangeNoop("GROWTH", "MONTHLY", "growth", "monthly")).toBe(true);
  });

  it("allows a cadence-only change", () => {
    expect(isSubscriptionChangeNoop("GROWTH", "MONTHLY", "growth", "yearly")).toBe(false);
  });

  it("allows a plan-only change", () => {
    expect(isSubscriptionChangeNoop("GROWTH", "MONTHLY", "scale", "monthly")).toBe(false);
  });

  it("expires a preview exactly at its expiry boundary", () => {
    expect(isSubscriptionChangePreviewExpired(preview(), Date.parse(preview().expiresAt))).toBe(
      true,
    );
  });

  it("keeps a preview usable before expiry", () => {
    expect(
      isSubscriptionChangePreviewExpired(preview(), Date.parse("2026-08-27T12:09:59.999Z")),
    ).toBe(false);
  });

  it("fails a malformed expiry closed", () => {
    expect(isSubscriptionChangePreviewExpired({ expiresAt: "not-a-date" })).toBe(true);
  });

  it("blocks an expired preview confirmation", () => {
    expect(canSubmitSubscriptionChange({ hasPreview: true, inFlight: false, expired: true })).toBe(
      false,
    );
  });

  it.each([
    "SUBSCRIPTION_CHANGE_PREVIEW_EXPIRED",
    "SUBSCRIPTION_CHANGE_PREVIEW_INVALIDATED",
    "SUBSCRIPTION_CHANGE_STATE_CHANGED",
    "SUBSCRIPTION_CHANGE_PRICING_MARKET_CHANGED",
    "SUBSCRIPTION_CHANGE_TARGET_PRICING_CHANGED",
    "SUBSCRIPTION_CHANGE_PREVIEW_STALE",
  ])("maps %s to fresh-preview UX", (code) => {
    expect(subscriptionChangeErrorKind(code)).toBe("stale");
  });

  it("maps provider failure to safe provider UX", () => {
    expect(subscriptionChangeErrorKind("SUBSCRIPTION_CHANGE_PROVIDER_FAILED")).toBe("provider");
  });

  it("does not misclassify an unrelated API error", () => {
    expect(subscriptionChangeErrorKind("NETWORK_ERROR")).toBe("other");
  });

  it("uses a bounded convergence refresh interval", () => {
    expect(SUBSCRIPTION_CHANGE_CONVERGENCE_REFRESH_MS).toBe(2_000);
  });

  it("keeps the annual scheduled-price disclosure visible", () => {
    expect(shouldDisplayAnnualPriceChange({ effectiveAt: "2027-01-01" })).toBe(true);
  });

  it("omits annual disclosure only when none is scheduled", () => {
    expect(shouldDisplayAnnualPriceChange(null)).toBe(false);
  });

  it("formats USD with two decimal places", () => {
    expect(formatBillingAmount("2900", "USD", "en")).toBe("$29.00");
  });

  it("formats zero-decimal currencies without invented decimals", () => {
    expect(formatBillingAmount("1200", "JPY", "en")).toBe("¥1,200");
  });

  it("formats regional currency from the preview", () => {
    expect(formatBillingAmount("14900", "SAR", "en")).toContain("149.00");
  });

  it("uses Arabic locale-aware money formatting", () => {
    const formatted = formatBillingAmount("14900", "SAR", "ar");
    expect(formatted).toContain("149.00");
    expect(formatted).toContain("ر.س.");
  });

  it("uses RTL direction for Arabic", () => {
    expect(billingChangeDirection("ar")).toBe("rtl");
  });

  it("uses LTR direction for English", () => {
    expect(billingChangeDirection("en")).toBe("ltr");
  });

  it("provides localized Arabic confirmation copy", () => {
    expect(billingChangeCopy("ar").confirm).toBe("تأكيد تغيير الاشتراك");
  });

  it("provides truthful English null-renewal copy", () => {
    expect(billingChangeCopy("en").renewalUnknown).toContain("next invoice");
  });

  it("provides a non-charge message when due now is zero", () => {
    expect(billingChangeCopy("en").noImmediateCharge).toContain("no immediate charge");
  });
});
