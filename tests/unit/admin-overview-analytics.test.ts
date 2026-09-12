import type { AdminSession, AdminUser } from "@waflo/database";
import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { AdminSessionGuard, isAdminSessionActive } from "../../apps/api/src/admin/admin.guard.js";
import { AdminAnalyticsController } from "../../apps/api/src/admin/admin-analytics.controller.js";
import {
  type AnalyticsFinancialEventRow,
  type AnalyticsSubscriptionRow,
  adminAnalyticsWindow,
  analyticsBucketKeys,
  buildAdminFinanceAnalytics,
  buildAdminOperationalAnalytics,
  isAdminAnalyticsRange,
  normalizedMonthlyAmountMinor,
} from "../../apps/api/src/admin/admin-analytics.js";
import {
  adminRoleHasPermission,
  permissionsForAdminRole,
  requireAdminPermission,
} from "../../apps/api/src/admin/admin-rbac.js";
import {
  stripeInvoiceFinancialSnapshot,
  stripeInvoicePriceCandidates,
  stripeInvoiceSubscriptionId,
} from "../../apps/api/src/billing/billing-financial-evidence.js";
import { ADMIN_PERMISSIONS } from "../../apps/api/src/common/decorators.js";

const NOW = new Date("2026-08-27T12:00:00.000Z");
const RANGE = adminAnalyticsWindow("30D", NOW);

function subscription(overrides: Partial<AnalyticsSubscriptionRow> = {}): AnalyticsSubscriptionRow {
  return {
    id: "sub-1",
    organizationId: "org-1",
    planCode: "GROWTH",
    status: "ACTIVE",
    pricingMarketCode: "GLOBAL",
    pricingCurrency: "USD",
    pricingAmountMinor: 2900n,
    cadence: "MONTHLY",
    grandfathered: false,
    createdAt: new Date("2026-08-02T00:00:00.000Z"),
    pricingVersion: {
      id: "pv-global-growth-3",
      version: 3,
      status: "ACTIVE_FOR_NEW_SUBSCRIPTIONS",
    },
    ...overrides,
  };
}

function financialEvent(
  overrides: Partial<AnalyticsFinancialEventRow> = {},
): AnalyticsFinancialEventRow {
  return {
    subscriptionId: "sub-1",
    organizationId: "org-1",
    type: "COLLECTED",
    planCode: "GROWTH",
    pricingMarketCode: "GLOBAL",
    pricingVersionId: "pv-global-growth-3",
    currency: "USD",
    amountMinor: 2900n,
    providerOccurredAt: new Date("2026-08-10T10:00:00.000Z"),
    createdAt: new Date("2026-06-30T00:00:00.000Z"),
    ...overrides,
  };
}

function fixture() {
  const subscriptions = [
    subscription(),
    subscription({
      id: "sub-2",
      organizationId: "org-2",
      planCode: "SCALE",
      pricingMarketCode: "SA",
      pricingCurrency: "SAR",
      pricingAmountMinor: 120000n,
      cadence: "YEARLY",
      grandfathered: true,
      pricingVersion: {
        id: "pv-sa-scale-1",
        version: 1,
        status: "RETIRED_FOR_NEW_SUBSCRIPTIONS",
      },
    }),
    subscription({
      id: "sub-3",
      organizationId: "org-3",
      planCode: "STARTER",
      status: "TRIALING",
      pricingMarketCode: "TR",
      pricingCurrency: "TRY",
      pricingAmountMinor: 5000n,
      grandfathered: true,
    }),
    subscription({ id: "sub-4", organizationId: "org-4", status: "PAST_DUE" }),
    subscription({ id: "sub-5", organizationId: "org-5", status: "CANCELED" }),
    subscription({ id: "sub-6", organizationId: "org-6", status: "GRACE_PERIOD" }),
  ];
  const financialEvents = [
    financialEvent(),
    financialEvent({
      subscriptionId: "sub-2",
      organizationId: "org-2",
      planCode: "SCALE",
      pricingMarketCode: "SA",
      pricingVersionId: "pv-sa-scale-1",
      currency: "SAR",
      amountMinor: 120000n,
      providerOccurredAt: new Date("2026-07-17T10:00:00.000Z"),
    }),
    financialEvent({
      type: "BILLED",
      amountMinor: 3400n,
      providerOccurredAt: new Date("2026-08-09T10:00:00.000Z"),
    }),
    financialEvent({
      type: "PAYMENT_FAILED",
      amountMinor: 3400n,
      providerOccurredAt: new Date("2026-08-09T11:00:00.000Z"),
    }),
  ];
  const organizations = subscriptions.map((row, index) => ({
    id: row.organizationId,
    createdAt: new Date(`2026-08-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`),
  }));
  const trials = [
    {
      organizationId: "org-2",
      trialStart: new Date("2026-07-01T00:00:00.000Z"),
      trialEnd: new Date("2026-07-16T00:00:00.000Z"),
    },
    {
      organizationId: "org-3",
      trialStart: new Date("2026-08-20T00:00:00.000Z"),
      trialEnd: new Date("2026-09-04T00:00:00.000Z"),
    },
    {
      organizationId: "org-4",
      trialStart: new Date("2026-07-02T00:00:00.000Z"),
      trialEnd: new Date("2026-07-17T00:00:00.000Z"),
    },
  ];
  return { subscriptions, financialEvents, organizations, trials };
}

function operational(overrides: Partial<ReturnType<typeof fixture>> = {}) {
  const base = fixture();
  return buildAdminOperationalAnalytics({
    subscriptions: overrides.subscriptions ?? base.subscriptions,
    financialEvents: overrides.financialEvents ?? base.financialEvents,
    organizations: overrides.organizations ?? base.organizations,
    trials: overrides.trials ?? base.trials,
    markets: [
      { code: "GLOBAL", countryCode: null },
      { code: "SA", countryCode: "SA" },
      { code: "TR", countryCode: "TR" },
    ],
    scheduledSubscriptionIds: new Set(["sub-2"]),
    range: RANGE,
    now: NOW,
  });
}

function finance(overrides: Partial<ReturnType<typeof fixture>> = {}) {
  const base = fixture();
  return buildAdminFinanceAnalytics({
    subscriptions: overrides.subscriptions ?? base.subscriptions,
    financialEvents: overrides.financialEvents ?? base.financialEvents,
    range: RANGE,
    now: NOW,
  });
}

function guardHarness(cookie: Record<string, string> = {}) {
  const request = {
    cookies: cookie,
    headers: {},
    requestId: "analytics-test",
    id: "analytics-test",
  };
  const guard = new AdminSessionGuard(
    { getAllAndOverride: (key: string) => key === "waflo:is-admin-route" } as never,
    {
      values: { ADMIN_COOKIE_NAME: "waflo_admin_session", ADMIN_SESSION_IDLE_TTL_MINUTES: 60 },
    } as never,
    {
      client: { adminSession: { findUnique: async () => null, update: async () => undefined } },
    } as never,
    { captureException: async () => undefined } as never,
  );
  return {
    request,
    guard,
    context: {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => undefined,
      getClass: () => undefined,
    } as never,
  };
}

function invoiceEvent(type: "invoice.finalized" | "invoice.paid" | "invoice.payment_failed") {
  const invoice = {
    id: "in_1",
    object: "invoice",
    customer: "cus_1",
    currency: "usd",
    amount_due: 2900,
    amount_paid: type === "invoice.paid" ? 2900 : 0,
    parent: {
      type: "subscription_details",
      quote_details: null,
      subscription_details: { subscription: "sub_stripe_1", metadata: null },
    },
    lines: {
      data: [
        {
          amount: 2900,
          subscription: "sub_stripe_1",
          pricing: {
            type: "price_details",
            unit_amount_decimal: "2900",
            price_details: { price: "price_growth", product: "prod_growth" },
          },
        },
      ],
    },
  } as unknown as Stripe.Invoice;
  return {
    id: `evt_${type}`,
    type,
    created: 1_777_000_000,
    livemode: false,
    data: { object: invoice },
  } as unknown as Stripe.Event;
}

describe("Admin Overview analytics authority and calculations", () => {
  it("rejects an unauthenticated analytics request", async () => {
    const harness = guardHarness();
    await expect(harness.guard.canActivate(harness.context)).rejects.toMatchObject({ status: 401 });
  });

  it("rejects a merchant session as admin analytics authority", async () => {
    const harness = guardHarness({ waflo_session: "merchant" });
    await expect(harness.guard.canActivate(harness.context)).rejects.toMatchObject({
      code: "ADMIN_AUTH_REQUIRED",
    });
  });

  it("rejects a customer session as admin analytics authority", async () => {
    const harness = guardHarness({ waflo_customer: "customer" });
    await expect(harness.guard.canActivate(harness.context)).rejects.toMatchObject({
      code: "ADMIN_AUTH_REQUIRED",
    });
  });

  it("allows dashboard read from server RBAC", () => {
    expect(adminRoleHasPermission("SUPPORT", "admin.dashboard.read")).toBe(true);
  });

  it("denies finance data without finance capability", () => {
    expect(() => requireAdminPermission("SUPPORT", "admin.finance.read")).toThrowError(
      expect.objectContaining({ code: "ADMIN_FORBIDDEN" }),
    );
  });

  it("allows SUPER_ADMIN finance analytics", () => {
    expect(adminRoleHasPermission("SUPER_ADMIN", "admin.finance.read")).toBe(true);
  });

  it("declares finance capability on the finance controller method", () => {
    expect(
      Reflect.getMetadata(ADMIN_PERMISSIONS, AdminAnalyticsController.prototype.finance),
    ).toEqual(["admin.finance.read"]);
  });

  it("does not accept a spoofed role when the active session is disabled", () => {
    expect(
      isAdminSessionActive(
        {
          expiresAt: new Date("2027-01-01T00:00:00Z"),
          revokedAt: null,
          lastActiveAt: NOW,
          adminUser: { status: "DISABLED" },
        } as Pick<AdminSession, "expiresAt" | "revokedAt" | "lastActiveAt"> & {
          adminUser: Pick<AdminUser, "status">;
        },
        60,
        NOW,
      ),
    ).toBe(false);
  });

  it("counts active subscribers", () => {
    expect(operational().counts.activeSubscribers).toBe(2);
  });

  it("counts active trials separately", () => {
    expect(operational().counts.trialingSubscribers).toBe(1);
  });

  it("counts past-due subscriptions", () => {
    expect(operational().counts.pastDueSubscribers).toBe(1);
  });

  it("counts canceled subscriptions", () => {
    expect(operational().counts.canceledSubscriptions).toBe(1);
  });

  it("counts current grandfathered subscribers", () => {
    expect(operational().counts.grandfatheredSubscribers).toBe(2);
  });

  it("counts scheduled repricing subscriptions", () => {
    expect(operational().counts.scheduledRepricingSubscribers).toBe(1);
  });

  it("counts all organizations without exposing them", () => {
    expect(operational().counts.totalOrganizations).toBe(6);
  });

  it("calculates monthly MRR from active subscriptions only", () => {
    expect(finance().recurringRevenue.mrr).toContainEqual({ currency: "USD", amountMinor: "2900" });
  });

  it("normalizes annual cadence to a monthly minor-unit amount", () => {
    expect(finance().recurringRevenue.mrr).toContainEqual({
      currency: "SAR",
      amountMinor: "10000",
    });
  });

  it("rounds annual monthly normalization to the nearest minor unit", () => {
    expect(normalizedMonthlyAmountMinor(101n, "YEARLY")).toBe(8n);
    expect(normalizedMonthlyAmountMinor(102n, "YEARLY")).toBe(9n);
  });

  it("excludes canceled subscriptions from MRR", () => {
    const canceledOnly = [subscription({ status: "CANCELED" })];
    expect(finance({ subscriptions: canceledOnly }).recurringRevenue.mrr).toEqual([]);
  });

  it("excludes trials and past-due subscriptions from MRR", () => {
    const rows = [subscription({ status: "TRIALING" }), subscription({ status: "PAST_DUE" })];
    expect(finance({ subscriptions: rows }).recurringRevenue.mrr).toEqual([]);
  });

  it("derives ARR only as MRR times twelve", () => {
    expect(finance().recurringRevenue.arr).toContainEqual({
      currency: "USD",
      amountMinor: "34800",
    });
  });

  it("reports incomplete MRR when an active commercial snapshot is missing", () => {
    const result = finance({ subscriptions: [subscription({ pricingAmountMinor: null })] });
    expect(result.recurringRevenue).toMatchObject({
      complete: false,
      unpricedActiveSubscriberCount: 1,
    });
  });

  it("keeps USD and SAR MRR separate", () => {
    expect(finance().recurringRevenue.mrr.map((row) => row.currency)).toEqual(["SAR", "USD"]);
  });

  it("never emits a merged reporting-currency total", () => {
    expect(finance().recurringRevenue.reportingCurrencyTotal).toBeNull();
  });

  it("uses successful payment evidence for collected revenue", () => {
    expect(finance().collected.selectedRange).toEqual([{ currency: "USD", amountMinor: "2900" }]);
  });

  it("excludes failed payments from collected revenue", () => {
    expect(finance().failedPaymentCount).toBe(1);
    expect(finance().collected.selectedRange).not.toContainEqual({
      currency: "USD",
      amountMinor: "3400",
    });
  });

  it("uses finalized invoice evidence for billed revenue", () => {
    expect(finance().billed.selectedRange).toEqual([{ currency: "USD", amountMinor: "3400" }]);
  });

  it("marks refunds unavailable instead of fabricating them", () => {
    expect(finance().refunds).toMatchObject({ supported: false, selectedRange: null });
  });

  it("does not label incomplete fee/refund evidence as net collected", () => {
    expect(finance().netCollected).toMatchObject({ supported: false, selectedRange: null });
  });

  it("groups active subscriber MRR by plan", () => {
    const scale = finance().planBreakdown.find((row) => row.plan === "SCALE");
    expect(scale).toMatchObject({
      activeSubscribers: 1,
      mrr: [{ currency: "SAR", amountMinor: "10000" }],
    });
  });

  it("groups collected evidence by provider-attributed plan", () => {
    const growth = finance().planBreakdown.find((row) => row.plan === "GROWTH");
    expect(growth?.collected).toEqual([{ currency: "USD", amountMinor: "2900" }]);
  });

  it("groups active subscriptions by locked pricing market", () => {
    const sa = finance().marketBreakdown.find((row) => row.marketCode === "SA");
    expect(sa).toMatchObject({ activeSubscribers: 1 });
  });

  it("does not recompute market from organization country", () => {
    expect(operational().marketBreakdown.map((row) => row.marketCode)).toContain("SA");
  });

  it("groups native currency analytics dynamically", () => {
    expect(finance().currencyBreakdown.map((row) => row.currency)).toEqual(["SAR", "USD"]);
  });

  it("breaks grandfathering down by market", () => {
    expect(operational().grandfathering.byMarket).toContainEqual({
      marketCode: "SA",
      subscriberCount: 1,
    });
  });

  it("breaks grandfathering down by plan", () => {
    expect(operational().grandfathering.byPlan).toContainEqual({
      plan: "SCALE",
      subscriberCount: 1,
    });
  });

  it("preserves pricing-version grandfathering evidence", () => {
    expect(operational().grandfathering.byPricingVersion).toContainEqual(
      expect.objectContaining({ pricingVersionId: "pv-sa-scale-1", version: 1 }),
    );
  });

  it("excludes a running trial from the failed-conversion denominator", () => {
    expect(operational().trials.eligibleCompleted).toBe(2);
  });

  it("proves a completed trial conversion from collected evidence", () => {
    expect(operational().trials.converted).toBe(1);
  });

  it("counts a completed evidence-covered trial without payment as unconverted", () => {
    expect(operational().trials.unconverted).toBe(1);
  });

  it("does not count a payment recorded before trial completion as a conversion", () => {
    const base = fixture();
    const result = operational({
      subscriptions: base.subscriptions.filter((row) => row.organizationId === "org-2"),
      organizations: base.organizations.filter((row) => row.id === "org-2"),
      trials: base.trials.filter((row) => row.organizationId === "org-2"),
      financialEvents: [
        financialEvent({
          organizationId: "org-2",
          subscriptionId: "sub-2",
          providerOccurredAt: new Date("2026-07-10T00:00:00.000Z"),
        }),
      ],
    });
    expect(result.trials).toMatchObject({ eligibleCompleted: 1, converted: 0, unconverted: 1 });
  });

  it("returns trial conversion unavailable when no evidence exists", () => {
    expect(operational({ financialEvents: [] }).trials).toMatchObject({
      conversionSupported: false,
      conversionRate: null,
    });
  });

  it("uses exact UTC boundaries for 7D", () => {
    expect(adminAnalyticsWindow("7D", NOW).start.toISOString()).toBe("2026-08-21T00:00:00.000Z");
  });

  it("uses exact UTC boundaries for 30D", () => {
    expect(RANGE.start.toISOString()).toBe("2026-07-29T00:00:00.000Z");
  });

  it("uses UTC January first for YTD", () => {
    expect(adminAnalyticsWindow("YTD", NOW).start.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("uses monthly buckets for long ranges", () => {
    expect(adminAnalyticsWindow("1Y", NOW).bucket).toBe("MONTH");
  });

  it("validates only server-supported ranges", () => {
    expect(isAdminAnalyticsRange("90D")).toBe(true);
    expect(isAdminAnalyticsRange("DROP TABLE")).toBe(false);
  });

  it("creates seven daily buckets for 7D", () => {
    expect(analyticsBucketKeys(adminAnalyticsWindow("7D", NOW))).toHaveLength(7);
  });

  it("buckets new organizations for chart rendering", () => {
    expect(operational().trends.newOrganizations.reduce((sum, row) => sum + row.count, 0)).toBe(6);
  });

  it("buckets first paid subscription evidence only once", () => {
    const events = [...fixture().financialEvents, financialEvent({ amountMinor: 100n })];
    expect(
      operational({ financialEvents: events }).trends.newPaidSubscriptions.reduce(
        (sum, row) => sum + row.count,
        0,
      ),
    ).toBe(1);
  });

  it("produces currency-aware collected revenue trend buckets", () => {
    const populated = finance().trends.collectedRevenue.find((row) => row.totals.length > 0);
    expect(populated?.totals).toEqual([{ currency: "USD", amountMinor: "2900" }]);
  });

  it("returns valid zero totals for an empty system", () => {
    const result = operational({
      subscriptions: [],
      organizations: [],
      trials: [],
      financialEvents: [],
    });
    expect(result.counts).toMatchObject({ totalOrganizations: 0, activeSubscribers: 0 });
  });

  it("returns no customer PII in the aggregate payload", () => {
    expect(JSON.stringify(operational())).not.toMatch(/email|customerName|phone/i);
  });

  it("returns no secrets or provider credentials", () => {
    expect(JSON.stringify(finance())).not.toMatch(/secret|apiKey|password|stripePriceId/i);
  });

  it("ignores client-supplied totals because controller accepts only range", () => {
    expect(AdminAnalyticsController.prototype.overview.length).toBe(1);
  });

  it("uses tenant-global aggregation only behind admin capabilities", () => {
    expect(permissionsForAdminRole("SUPER_ADMIN")).toContain("admin.dashboard.read");
    expect(adminRoleHasPermission("SUPPORT", "admin.customers.read")).toBe(true);
  });

  it("maps invoice.finalized to immutable billed evidence", () => {
    expect(stripeInvoiceFinancialSnapshot(invoiceEvent("invoice.finalized"))).toMatchObject({
      type: "BILLED",
      amountMinor: 2900n,
    });
  });

  it("maps invoice.paid to collected amount_paid evidence", () => {
    expect(stripeInvoiceFinancialSnapshot(invoiceEvent("invoice.paid"))).toMatchObject({
      type: "COLLECTED",
      amountMinor: 2900n,
    });
  });

  it("maps invoice.payment_failed without treating it as collected", () => {
    expect(stripeInvoiceFinancialSnapshot(invoiceEvent("invoice.payment_failed"))).toMatchObject({
      type: "PAYMENT_FAILED",
      amountMinor: 2900n,
    });
  });

  it("resolves subscription identity from immutable invoice parent state", () => {
    const event = invoiceEvent("invoice.paid") as Stripe.Event & {
      data: { object: Stripe.Invoice };
    };
    expect(stripeInvoiceSubscriptionId(event.data.object)).toBe("sub_stripe_1");
  });

  it("extracts provider Price candidates without trusting metadata", () => {
    const event = invoiceEvent("invoice.paid") as Stripe.Event & {
      data: { object: Stripe.Invoice };
    };
    expect(stripeInvoicePriceCandidates(event.data.object)).toEqual([
      { stripePriceId: "price_growth", amountMinor: 2900n },
    ]);
  });
});
