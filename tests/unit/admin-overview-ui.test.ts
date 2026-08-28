import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AdminFinanceAnalytics,
  adminAnalyticsCopy,
  adminAnalyticsPath,
  adminAnalyticsRanges,
  canViewAdminFinance,
  formatAdminAnalyticsCount,
  formatAdminAnalyticsMoney,
  moneyListState,
  planLabel,
  rangeLabel,
  revenueSeriesByCurrency,
  safeBarPercent,
  statusLabel,
} from "../../apps/admin-dashboard/components/admin-overview-analytics";

const componentSource = readFileSync(
  resolve(process.cwd(), "apps/admin-dashboard/components/admin-overview-dashboard.tsx"),
  "utf8",
);

function finance(): AdminFinanceAnalytics {
  return {
    evidence: {
      available: true,
      coverageStart: "2026-01-01T00:00:00.000Z",
      selectedRangeComplete: true,
    },
    recurringRevenue: {
      mrr: [
        { currency: "SAR", amountMinor: "981000" },
        { currency: "USD", amountMinor: "1842000" },
      ],
      arr: [
        { currency: "SAR", amountMinor: "11772000" },
        { currency: "USD", amountMinor: "22104000" },
      ],
      complete: true,
      unpricedActiveSubscriberCount: 0,
      mrrDefinition: "ACTIVE subscriptions only.",
      arrDefinition: "MRR multiplied by 12.",
      reportingCurrencyTotal: null,
    },
    billed: { selectedRange: [], definition: "Billed" },
    collected: {
      selectedRange: [],
      currentMonth: [],
      currentYear: [],
      definition: "Collected",
    },
    refunds: { supported: false, selectedRange: null, reason: "Unavailable" },
    netCollected: { supported: false, selectedRange: null, reason: "Unavailable" },
    failedPaymentCount: 0,
    planBreakdown: [],
    marketBreakdown: [],
    currencyBreakdown: [],
    unattributedCollected: [],
    trends: {
      collectedRevenue: [
        {
          bucket: "2026-08-26",
          totals: [
            { currency: "USD", amountMinor: "2900" },
            { currency: "SAR", amountMinor: "9900" },
          ],
        },
        {
          bucket: "2026-08-27",
          totals: [{ currency: "USD", amountMinor: "5800" }],
        },
      ],
    },
  };
}

describe("Admin Overview analytics UI", () => {
  it("offers exactly the server-supported range controls", () => {
    expect(adminAnalyticsRanges).toEqual(["7D", "30D", "90D", "YTD", "1Y"]);
  });

  it("switches range by changing the overview API query only", () => {
    expect(adminAnalyticsPath("overview", "90D")).toBe("/v1/admin/analytics/overview?range=90D");
  });

  it("uses a distinct finance endpoint protected by finance capability", () => {
    expect(adminAnalyticsPath("finance", "YTD")).toBe("/v1/admin/analytics/finance?range=YTD");
  });

  it("shows finance only from server-granted permission", () => {
    expect(canViewAdminFinance(["admin.dashboard.read", "admin.finance.read"])).toBe(true);
  });

  it("hides finance when server permission is absent", () => {
    expect(canViewAdminFinance(["admin.dashboard.read"])).toBe(false);
  });

  it("does not infer finance visibility from a client role name", () => {
    expect(canViewAdminFinance(["SUPER_ADMIN"])).toBe(false);
  });

  it("presents multiple currencies as separate money rows", () => {
    expect(moneyListState(finance().recurringRevenue.mrr)).toBe("multiple");
  });

  it("never creates a reporting-currency total in the UI model", () => {
    expect(finance().recurringRevenue.reportingCurrencyTotal).toBeNull();
  });

  it("keeps USD and SAR as separate chart series", () => {
    expect(revenueSeriesByCurrency(finance()).map((series) => series.currency)).toEqual([
      "SAR",
      "USD",
    ]);
  });

  it("fills a missing native-currency bucket with zero rather than another currency", () => {
    expect(revenueSeriesByCurrency(finance())[0]?.points).toEqual([
      { bucket: "2026-08-26", amountMinor: "9900" },
      { bucket: "2026-08-27", amountMinor: "0" },
    ]);
  });

  it("formats USD from integer minor units", () => {
    expect(formatAdminAnalyticsMoney("2900", "USD", "en")).toBe("$29.00");
  });

  it("formats a zero-decimal currency without invented decimals", () => {
    expect(formatAdminAnalyticsMoney("1200", "JPY", "en")).toMatch(/1,200/);
  });

  it("formats money with Arabic locale semantics", () => {
    const formatted = formatAdminAnalyticsMoney("9900", "SAR", "ar");
    expect(formatted).toContain("99.00");
    expect(formatted).toContain("ر.س.");
  });

  it("formats count metrics with Arabic locale semantics", () => {
    expect(formatAdminAnalyticsCount(1234, "ar")).toBe(new Intl.NumberFormat("ar").format(1234));
  });

  it("provides Arabic dashboard copy", () => {
    expect(adminAnalyticsCopy("ar").title).toBe("نظرة عامة");
  });

  it("provides localized Arabic ranges", () => {
    expect(rangeLabel("YTD", "ar")).toContain("السنة");
  });

  it("localizes subscription statuses in Arabic", () => {
    expect(statusLabel("PAST_DUE", "ar")).toBe("متأخر الدفع");
  });

  it("localizes known plan names in Arabic", () => {
    expect(planLabel("GROWTH", "ar")).toBe("النمو");
  });

  it("retains safe fallback labels for future provider statuses", () => {
    expect(statusLabel("NEW_PROVIDER_STATE", "en")).toBe("NEW PROVIDER STATE");
  });

  it("maps empty financial data to an explicit empty state", () => {
    expect(moneyListState([])).toBe("empty");
  });

  it("renders zero-height bars safely when a series has no revenue", () => {
    expect(safeBarPercent(0n, 0n)).toBe(0);
  });

  it("keeps small nonzero chart values visible", () => {
    expect(safeBarPercent(1n, 1000n)).toBe(2);
  });

  it("caps chart values at one hundred percent", () => {
    expect(safeBarPercent(200n, 100n)).toBe(100);
  });

  it("renders an accessible loading state", () => {
    expect(componentSource).toContain('aria-live="polite"');
    expect(componentSource).toContain('aria-busy="true"');
  });

  it("renders an assertive safe error state with retry", () => {
    expect(componentSource).toContain('aria-live="assertive"');
    expect(componentSource).toContain("setRevision((value) => value + 1)");
  });

  it("renders a truthful system empty state", () => {
    expect(componentSource).toContain("state.operational.counts.totalOrganizations === 0");
    expect(componentSource).toContain("text.noData");
  });

  it("uses an explicit RTL application boundary for Arabic", () => {
    expect(componentSource).toContain('dir={locale === "ar" ? "rtl" : "ltr"}');
  });

  it("does not call the finance API when the capability is absent", () => {
    expect(componentSource).toContain("financeAllowed");
    expect(componentSource).toContain("Promise.resolve(null)");
  });

  it("maps server-returned status data into the status chart", () => {
    expect(componentSource).toContain("analytics.statusBreakdown.map");
    expect(componentSource).toContain("statusLabel(item.status, locale)");
  });

  it("maps server-returned plan and market breakdowns without customer PII", () => {
    expect(componentSource).toContain("state.operational.planBreakdown.map");
    expect(componentSource).toContain("state.operational.marketBreakdown.map");
    expect(componentSource).not.toMatch(/customerEmail|customerName|phoneNumber/);
  });

  it("tells operators that native currencies are not FX-converted", () => {
    expect(adminAnalyticsCopy("en").nativeCurrencies).toContain("no FX conversion");
  });
});
