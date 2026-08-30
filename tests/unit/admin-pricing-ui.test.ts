import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  adminPricingCopy,
  adminPricingCustomerLink,
  adminPricingDate,
  adminPricingMoney,
  adminPricingStatusLabel,
  pricingMarketPath,
} from "../../apps/admin-dashboard/components/admin-pricing";

const overviewSource = readFileSync(
  resolve(process.cwd(), "apps/admin-dashboard/components/admin-pricing-dashboard.tsx"),
  "utf8",
);
const marketSource = readFileSync(
  resolve(process.cwd(), "apps/admin-dashboard/components/admin-pricing-market.tsx"),
  "utf8",
);
const styles = readFileSync(resolve(process.cwd(), "apps/admin-dashboard/app/globals.css"), "utf8");

describe("Admin Pricing management UI", () => {
  it("uses a protected catalog overview endpoint", () =>
    expect(overviewSource).toContain('"/v1/admin/pricing/overview"'));
  it("uses a protected market detail endpoint", () =>
    expect(marketSource).toContain("/v1/admin/pricing/markets/"));
  it("renders the Pricing overview heading", () => expect(overviewSource).toContain("text.title"));
  it("renders a dedicated GLOBAL pricing section", () =>
    expect(overviewSource).toContain("text.global"));
  it("renders a regional-market table", () => expect(overviewSource).toContain("RegionalMarkets"));
  it("offers safe client filters over the server-authorized catalog payload", () => {
    expect(overviewSource).toContain("function MarketFilters");
    expect(overviewSource).toContain("function filterMarkets");
    expect(overviewSource).toContain("grandfathered");
    expect(overviewSource).toContain("binding");
  });
  it("renders the market creation control only after server permission resolution", () => {
    expect(overviewSource).toContain('me.permissions.includes("admin.pricing.write")');
    expect(overviewSource).toContain("text.addMarket");
  });
  it("posts a market country and currency but no Stripe Price ID", () => {
    expect(overviewSource).toContain("countryCode: countryCode.toUpperCase()");
    expect(overviewSource).toContain("currency: currency.toUpperCase()");
    expect(overviewSource).not.toContain("stripePriceId:");
  });
  it("uses searchable canonical country and supported-currency selectors", () => {
    expect(overviewSource).toContain("countryOptions(locale)");
    expect(overviewSource).toContain("pricingCurrencyOptions(locale)");
    expect(overviewSource).toContain("SearchableSelect");
    expect(overviewSource).toContain("country.name");
    expect(overviewSource).toContain("country.code");
  });
  it("renders the immutable plan by cadence matrix", () =>
    expect(overviewSource).toContain("overview.plans.flatMap"));
  it("renders subscriber and binding operational facts", () => {
    expect(overviewSource).toContain("market.subscribers");
    expect(overviewSource).toContain("stripeBinding.status");
  });
  it("navigates to a market-specific detail route", () =>
    expect(pricingMarketPath("en", "market/a")).toBe("/en/pricing/market%2Fa"));
  it("uses a bounded customer filter link for a grandfathered version", () =>
    expect(adminPricingCustomerLink("en", "SA", "GROWTH", true)).toBe(
      "/en/customers?market=SA&plan=GROWTH&grandfathered=yes",
    ));
  it("does not add a customer filter to a non-grandfathered link", () =>
    expect(adminPricingCustomerLink("en", "GLOBAL", "STARTER")).toBe(
      "/en/customers?market=GLOBAL&plan=STARTER",
    ));
  it("formats server minor units in USD", () =>
    expect(adminPricingMoney("2900", "USD", "en")).toContain("29.00"));
  it("formats a zero-decimal currency correctly", () =>
    expect(adminPricingMoney("1200", "JPY", "en")).toMatch(/1,200/));
  it("formats Arabic money through the shared formatter", () =>
    expect(adminPricingMoney("9900", "SAR", "ar")).toContain("ر.س."));
  it("does not use hard-coded USD formatting", () =>
    expect(overviewSource + marketSource).not.toMatch(/\$\{.*amount|toFixed\(2\)/));
  it("shows draft state distinctly", () =>
    expect(adminPricingStatusLabel("DRAFT", "en")).toBe("Draft"));
  it("shows current state distinctly from historical retired state", () => {
    expect(adminPricingStatusLabel("CURRENT", "en")).toBe("Current");
    expect(adminPricingStatusLabel("RETIRED", "en")).toBe("Retired");
  });
  it("renders the Draft creation dialog", () =>
    expect(marketSource).toContain("function DraftDialog"));
  it("draft form sends only server-permitted commercial intent", () => {
    expect(marketSource).toContain("marketId: market.id");
    expect(marketSource).toContain("amount,");
    expect(marketSource).toContain("currency: currency.toUpperCase()");
    expect(marketSource).not.toContain("pricingVersionId:");
  });
  it("uses decimal keyboard input for the human-readable price field", () =>
    expect(marketSource).toContain('inputMode="decimal"'));
  it("renders validation action only for DRAFT versions", () =>
    expect(marketSource).toContain('version.status === "DRAFT"'));
  it("renders publication only for VALIDATED versions", () =>
    expect(marketSource).toContain('version.status === "VALIDATED"'));
  it("renders retirement only for current versions", () =>
    expect(marketSource).toContain('version.status === "CURRENT"'));
  it("uses a dialog for sensitive publish confirmation", () => {
    expect(marketSource).toContain("function SensitivePricingDialog");
    expect(marketSource).toContain("text.publishTitle");
  });
  it("requires password reauthentication before publish, retirement, or deactivation", () => {
    expect(marketSource).toContain('"/v1/admin/pricing/reauth"');
    expect(marketSource).toContain("currentPassword: password");
  });
  it("shows the existing-subscriber grandfathering warning in confirmation", () =>
    expect(marketSource).toContain("text.existingImpact"));
  it("shows the planned Stripe artifact action in confirmation", () =>
    expect(marketSource).toContain("text.stripeImpact"));
  it("keeps Stripe Price IDs diagnostic-only instead of a user input", () => {
    expect(marketSource).toContain("stripePriceReference");
    expect(marketSource).not.toMatch(/name=["']stripePriceId/);
  });
  it("renders loading, error, and empty states", () => {
    expect(overviewSource).toContain('aria-live="polite"');
    expect(overviewSource).toContain('aria-live="assertive"');
    expect(marketSource).toContain("text.empty");
  });
  it("renders Arabic pricing copy", () => expect(adminPricingCopy("ar").title).toBe("التسعير"));
  it("sets RTL direction at both pricing surfaces", () => {
    expect(overviewSource).toContain('dir={locale === "ar" ? "rtl" : "ltr"}');
    expect(marketSource).toContain('dir={locale === "ar" ? "rtl" : "ltr"}');
  });
  it("formats administrative dates in UTC", () =>
    expect(adminPricingDate("2026-08-27T23:30:00.000Z", "en")).toContain("Aug 27, 2026"));
  it("uses the accessible shared Modal primitive with focus management", () => {
    expect(overviewSource).toContain("<Modal");
    expect(marketSource).toContain("<Modal");
  });
  it("has responsive pricing table and form styling", () => {
    expect(styles).toContain(".admin-pricing-table td::before");
    expect(styles).toContain(".admin-pricing-form input:focus-visible");
  });
  it("does not create Checkout sessions or direct Stripe calls from pricing UI", () =>
    expect(overviewSource + marketSource).not.toMatch(/checkout|stripe\./i));
});
