import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  adminCustomerDetailPath,
  adminCustomersCopy,
  adminCustomersPath,
  canViewCustomerFinance,
  customerCadenceLabel,
  customerInvoiceStatusLabel,
  customerPageSizes,
  customerPlanLabel,
  customerQueryWith,
  customerStatuses,
  customerStatusLabel,
  formatCustomerDate,
  formatCustomerMoney,
} from "../../apps/admin-dashboard/components/admin-customers";

const directorySource = readFileSync(
  resolve(process.cwd(), "apps/admin-dashboard/components/admin-customers-directory.tsx"),
  "utf8",
);
const detailSource = readFileSync(
  resolve(process.cwd(), "apps/admin-dashboard/components/admin-customer-360.tsx"),
  "utf8",
);
const styles = readFileSync(resolve(process.cwd(), "apps/admin-dashboard/app/globals.css"), "utf8");

describe("Admin Customers directory and Customer 360 UI", () => {
  it("uses the read-only customer directory API path", () => {
    expect(adminCustomersPath(new URLSearchParams("page=2&pageSize=50"))).toBe(
      "/v1/admin/customers?page=2&pageSize=50",
    );
  });
  it("encodes an individual Customer 360 identifier", () => {
    expect(adminCustomerDetailPath("customer/unsafe")).toBe(
      "/v1/admin/customers/customer%2Funsafe",
    );
  });
  it("uses the required bounded page sizes", () =>
    expect(customerPageSizes).toEqual([25, 50, 100]));
  it("shows actual Waflo subscription statuses", () =>
    expect(customerStatuses).toContain("GRACE_PERIOD"));
  it("localizes Active status in English", () =>
    expect(customerStatusLabel("ACTIVE", "en")).toBe("Active"));
  it("localizes Past due status in Arabic", () =>
    expect(customerStatusLabel("PAST_DUE", "ar")).toBe("متأخر الدفع"));
  it("localizes actual plans in English", () =>
    expect(customerPlanLabel("SCALE", "en")).toBe("Scale"));
  it("localizes actual plans in Arabic", () =>
    expect(customerPlanLabel("GROWTH", "ar")).toBe("النمو"));
  it("localizes monthly cadence", () =>
    expect(customerCadenceLabel("MONTHLY", "en")).toBe("Monthly"));
  it("localizes annual cadence in Arabic", () =>
    expect(customerCadenceLabel("YEARLY", "ar")).toBe("سنوي"));
  it("formats current regional price from server minor units", () =>
    expect(formatCustomerMoney("9900", "SAR", "en")).toContain("99.00"));
  it("formats zero-decimal currency without a hard-coded fractional part", () =>
    expect(formatCustomerMoney("1200", "JPY", "en")).toMatch(/1,200/));
  it("formats Arabic money through the currency-aware formatter", () =>
    expect(formatCustomerMoney("9900", "SAR", "ar")).toContain("⃁"));
  it("does not fabricate a price when server terms are absent", () =>
    expect(formatCustomerMoney(null, null, "en")).toBeNull());
  it("formats dates consistently in UTC", () =>
    expect(formatCustomerDate("2026-08-27T23:30:00.000Z", "en")).toContain("Aug 27, 2026"));
  it("uses a safe placeholder for malformed dates", () =>
    expect(formatCustomerDate("not-a-date", "en")).toBe("—"));
  it("shows finance only from server granted finance capability", () =>
    expect(canViewCustomerFinance(["admin.finance.read"])).toBe(true));
  it("hides finance for SUPPORT capability set", () =>
    expect(canViewCustomerFinance(["admin.customers.read"])).toBe(false));
  it("does not infer finance from a client role string", () =>
    expect(canViewCustomerFinance(["FINANCE"])).toBe(false));
  it("keeps filters in URL parameters for reloadable directory state", () => {
    const result = customerQueryWith(new URLSearchParams("status=ACTIVE&page=3"), {
      market: "SA",
      page: "1",
    });
    expect(result.toString()).toBe("status=ACTIVE&market=SA");
  });
  it("clears no-op filter values from URL parameters", () => {
    expect(customerQueryWith(new URLSearchParams("plan=GROWTH"), { plan: "all" }).toString()).toBe(
      "",
    );
  });
  it("renders an accessible search label and server-backed table", () => {
    expect(directorySource).toContain('htmlFor="admin-customer-search"');
    expect(directorySource).toContain("adminApi<AdminCustomerDirectoryResponse>");
    expect(directorySource).toContain("<table");
  });
  it("renders loading, error, and empty directory states", () => {
    expect(directorySource).toContain('aria-live="polite"');
    expect(directorySource).toContain('aria-live="assertive"');
    expect(directorySource).toContain("text.empty");
  });
  it("renders explicit Customer 360 navigation instead of clickable table rows", () => {
    expect(directorySource).toContain("<Link");
    expect(directorySource).toContain("aria-label=");
    expect(directorySource).toContain("customers/");
    expect(directorySource).toContain("item.customerId");
  });
  it("renders the Customer 360 sections", () => {
    for (const section of [
      "#overview",
      "#subscription",
      "#billing",
      "#pricing",
      "#repricing",
      "#audit",
    ]) {
      expect(detailSource).toContain(section);
    }
  });
  it("retains pricing history, subscription-change history, repricing and audit panels", () => {
    expect(detailSource).toContain("data.pricingHistory");
    expect(detailSource).toContain("data.subscriptionChanges");
    expect(detailSource).toContain("data.repricingHistory");
    expect(detailSource).toContain("data.audit");
  });
  it("uses financial capability state rather than frontend role visibility for billing history", () => {
    expect(detailSource).toContain("financeAllowed");
    expect(detailSource).toContain("text.noFinance");
  });
  it("labels invoice evidence separately from subscription status", () =>
    expect(customerInvoiceStatusLabel("PAYMENT_FAILED", "en")).toBe("Payment failed"));
  it("renders Arabic invoice evidence status", () =>
    expect(customerInvoiceStatusLabel("PAID", "ar")).toBe("مدفوعة"));
  it("includes Arabic copy and RTL surface boundaries", () => {
    expect(adminCustomersCopy("ar").title).toBe("العملاء");
    expect(directorySource).toContain('dir={locale === "ar" ? "rtl" : "ltr"}');
    expect(detailSource).toContain('dir={locale === "ar" ? "rtl" : "ltr"}');
  });
  it("has responsive customer-table styling", () => {
    expect(styles).toContain(".admin-customer-table td::before");
    expect(styles).toContain(".admin-customer-detail-grid");
  });
  it("does not include live Stripe calls or mutations in either UI", () => {
    expect(directorySource + detailSource).not.toMatch(/stripe\.|checkout|refund\(/i);
  });
});
