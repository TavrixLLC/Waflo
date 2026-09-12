import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  stripeHealthCopy,
  stripeHealthDate,
  stripeHealthIssueLabel,
  stripeHealthMoney,
  stripeHealthSeverityLabel,
} from "../../apps/admin-dashboard/components/admin-stripe-health";

const dashboard = readFileSync(
  resolve(process.cwd(), "apps/admin-dashboard/components/admin-stripe-health-dashboard.tsx"),
  "utf8",
);
const customer360 = readFileSync(
  resolve(process.cwd(), "apps/admin-dashboard/components/admin-customer-360.tsx"),
  "utf8",
);
const pricing = readFileSync(
  resolve(process.cwd(), "apps/admin-dashboard/components/admin-pricing-market.tsx"),
  "utf8",
);
const styles = readFileSync(resolve(process.cwd(), "apps/admin-dashboard/app/globals.css"), "utf8");

describe("Admin Stripe Health UI", () => {
  it("renders the Stripe Health page title", () => expect(dashboard).toContain("text.title"));
  it("loads the protected health overview endpoint", () =>
    expect(dashboard).toContain('"/v1/admin/stripe-health/overview"'));
  it("loads a server-paginated issue list", () =>
    expect(dashboard).toContain("function healthPath"));
  it("loads individual issue detail safely", () =>
    expect(dashboard).toContain(`/v1/admin/stripe-health/issues/\${issue.id}`));
  it("requires the stripe health capability in the page", () =>
    expect(dashboard).toContain('permission="admin.stripe_health.read"'));
  it("renders a healthy status banner", () => expect(dashboard).toContain("text.healthy"));
  it("renders an attention status banner", () => expect(dashboard).toContain("text.attention"));
  it("renders critical summary cards", () => expect(dashboard).toContain("text.unknownPrice"));
  it("renders missing pricing snapshot summary", () =>
    expect(dashboard).toContain("text.missingSnapshot"));
  it("renders payment failure summary", () => expect(dashboard).toContain("text.payments"));
  it("renders webhook evidence", () => expect(dashboard).toContain("function WebhookEvidence"));
  it("renders reconciliation evidence", () =>
    expect(dashboard).toContain("function Reconciliation"));
  it("renders failed payment evidence", () => expect(dashboard).toContain("function Payments"));
  it("renders catalog binding evidence", () => expect(dashboard).toContain("function Catalog"));
  it("renders financial evidence coverage", () => expect(dashboard).toContain("function Evidence"));
  it("renders provider configuration status", () =>
    expect(dashboard).toContain("function Configuration"));
  it("renders expected webhook coverage", () => expect(dashboard).toContain("text.expectedEvents"));
  it("renders recent webhook evidence", () => expect(dashboard).toContain("text.recentEvents"));
  it("renders the critical issue list", () => expect(dashboard).toContain("function Issues"));
  it("provides a severity filter", () =>
    expect(dashboard).toContain('value={query.get("severity")'));
  it("provides an issue-type filter", () =>
    expect(dashboard).toContain('value={query.get("type")'));
  it("provides a market filter", () => expect(dashboard).toContain('value={query.get("market")'));
  it("has clear filters behavior", () => expect(dashboard).toContain("text.clear"));
  it("has accessible server pagination", () =>
    expect(dashboard).toContain("admin-stripe-health-pagination"));
  it("opens an accessible shared issue detail Modal", () => expect(dashboard).toContain("<Modal"));
  it("links issues to Customer 360", () => expect(dashboard).toContain("text.viewCustomer"));
  it("links catalog issues to Pricing", () => expect(dashboard).toContain("text.viewPricing"));
  it("links repricing issues to their campaign", () =>
    expect(dashboard).toContain("text.viewRepricing"));
  it("has an explicit no-live-provider disclosure", () =>
    expect(dashboard).toContain("text.noLive"));
  it("has an explicit no-dangerous-actions disclosure", () =>
    expect(dashboard).toContain("text.noDangerousActions"));
  it("does not add a force-charge control", () =>
    expect(dashboard).not.toMatch(/force charge|charge customer/i));
  it("does not add a manual Stripe Price ID repair input", () =>
    expect(dashboard).not.toMatch(/name=["']stripePriceId|setStripePriceId/));
  it("does not call Stripe directly from the browser", () =>
    expect(dashboard).not.toMatch(/stripe\.|loadStripe|Stripe\(/));
  it("formats USD from minor units with the shared formatter", () =>
    expect(stripeHealthMoney("2900", "USD", "en")).toContain("29.00"));
  it("formats a zero-decimal currency correctly", () =>
    expect(stripeHealthMoney("1200", "JPY", "en")).toMatch(/1,200/));
  it("formats Arabic money through the shared formatter", () =>
    expect(stripeHealthMoney("9900", "SAR", "ar")).toContain("⃁"));
  it("does not hard-code USD decimals", () =>
    expect(dashboard).not.toMatch(/toFixed\(2\)|\$\{.*amount/));
  it("renders English copy", () => expect(stripeHealthCopy("en").title).toBe("Stripe health"));
  it("renders Arabic copy", () => expect(stripeHealthCopy("ar").title).toBe("حالة Stripe"));
  it("sets RTL direction", () =>
    expect(dashboard).toContain('dir={locale === "ar" ? "rtl" : "ltr"}'));
  it("uses localized severity labels", () =>
    expect(stripeHealthSeverityLabel("CRITICAL", "ar")).toBe("حرج"));
  it("uses localized issue labels", () =>
    expect(stripeHealthIssueLabel("UNKNOWN_STRIPE_PRICE", "en")).toBe("Unknown Stripe Price"));
  it("renders dates in a locale-aware UTC formatter", () =>
    expect(stripeHealthDate("2026-08-27T12:00:00.000Z", "en")).toContain("Aug 27, 2026"));
  it("has loading feedback", () => expect(dashboard).toContain('aria-live="polite"'));
  it("has safe error feedback", () => expect(dashboard).toContain('aria-live="assertive"'));
  it("has an empty issue state", () => expect(dashboard).toContain("text.noIssues"));
  it("renders finance amounts only after server permissions resolve", () =>
    expect(dashboard).toContain('me.permissions.includes("admin.finance.read")'));
  it("keeps Customer 360 billing health behind the same read capability", () => {
    expect(customer360).toContain('me.permissions.includes("admin.stripe_health.read")');
    expect(customer360).toContain("admin-customer-health-link");
  });
  it("links unbound pricing versions to Stripe Health", () => {
    expect(pricing).toContain("MISSING_PRICING_BINDING");
    expect(pricing).toContain("text.viewStripeHealth");
  });
  it("uses accessible status text in addition to color", () =>
    expect(dashboard).toContain("stripeHealthSeverityLabel"));
  it("has responsive operational table styling", () =>
    expect(styles).toContain(".admin-stripe-health-table td::before"));
  it("has visible focus styling through existing buttons and links", () =>
    expect(styles).toContain(".admin-stripe-health-table th button:focus-visible"));
  it("keeps technical event references LTR", () => expect(dashboard).toContain('dir="ltr"'));
  it("does not expose provider secrets in UI copy", () =>
    expect(dashboard + customer360 + pricing).not.toMatch(/STRIPE_SECRET_KEY|WEBHOOK_SECRET/));
});
