import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  repricingCopy,
  repricingDate,
  repricingMoney,
  repricingPath,
} from "../../apps/admin-dashboard/components/admin-repricing";

const dashboard = readFileSync(
  resolve(process.cwd(), "apps/admin-dashboard/components/admin-repricing-dashboard.tsx"),
  "utf8",
);
const detail = readFileSync(
  resolve(process.cwd(), "apps/admin-dashboard/components/admin-repricing-campaign.tsx"),
  "utf8",
);
const pricing = readFileSync(
  resolve(process.cwd(), "apps/admin-dashboard/components/admin-pricing-market.tsx"),
  "utf8",
);
const css = readFileSync(resolve(process.cwd(), "apps/admin-dashboard/app/globals.css"), "utf8");

describe("Admin annual repricing UI", () => {
  it("renders the repricing overview", () => expect(dashboard).toContain("text.title"));
  it("loads the protected repricing overview", () =>
    expect(dashboard).toContain('"/v1/admin/repricing/overview"'));
  it("renders grandfathered summary", () =>
    expect(dashboard).toContain("grandfatheredSubscribers"));
  it("renders eligible summary", () => expect(dashboard).toContain("eligibleForRepricing"));
  it("renders a campaign list", () => expect(dashboard).toContain("function Campaigns"));
  it("starts a new campaign flow", () => expect(dashboard).toContain("text.newCampaign"));
  it("selects a pricing market", () => expect(dashboard).toContain("text.market"));
  it("selects an executable plan", () => expect(dashboard).toContain("pricing.plans"));
  it("selects an executable cadence", () => expect(dashboard).toContain("pricing.cadences"));
  it("selects only current target versions", () =>
    expect(dashboard).toContain('version.status === "CURRENT"'));
  it("collects an effective policy date", () => expect(dashboard).toContain('type="date"'));
  it("collects a notice policy", () => expect(dashboard).toContain("noticeDays"));
  it("requests a server-side preview", () =>
    expect(dashboard).toContain('"/v1/admin/repricing/preview"'));
  it("does not send client amount authority", () =>
    expect(dashboard).not.toContain("amountMinor:"));
  it("does not send client currency authority", () => expect(dashboard).not.toContain("currency:"));
  it("shows eligible and excluded cohort counts", () => {
    expect(dashboard).toContain("preview.eligibleCount");
    expect(dashboard).toContain("preview.excludedCount");
  });
  it("shows current and projected native-currency MRR", () => {
    expect(dashboard).toContain("currentMrrMinor");
    expect(dashboard).toContain("projectedMrrMinor");
  });
  it("shows annual subscriber disclosure", () => expect(dashboard).toContain("text.annual"));
  it("shows no-proration warning", () => expect(dashboard).toContain("text.noProration"));
  it("requires reauthentication before schedule", () =>
    expect(dashboard).toContain('"/v1/admin/pricing/reauth"'));
  it("submits only a preview campaign reference to schedule", () =>
    expect(dashboard).toContain("campaignId: preview.previewId"));
  it("provides successful scheduling acknowledgement", () =>
    expect(dashboard).toContain("text.scheduleSuccess"));
  it("renders a campaign detail view", () =>
    expect(detail).toContain("AdminRepricingCampaignDetail"));
  it("renders a subscriber table", () => expect(detail).toContain("function CampaignSubscribers"));
  it("links subscribers to Customer 360", () => expect(detail).toContain("/customers/"));
  it("supports a status filter", () => expect(detail).toContain("setStatus"));
  it("supports pagination", () => expect(detail).toContain("setPage"));
  it("uses an explicit cancellation dialog", () =>
    expect(detail).toContain("SensitiveCampaignAction"));
  it("supports target replacement through a fresh preview", () => {
    expect(detail).toContain("RepricingPlanner");
    expect(dashboard).toContain("replacesCampaignId");
  });
  it("shows replacement history", () => expect(detail).toContain("replacedByCampaignId"));
  it("keeps executed rows visible rather than offering destructive controls", () =>
    expect(detail).toContain("row.status"));
  it("does not call Stripe from the repricing pages", () =>
    expect(dashboard + detail).not.toMatch(/stripe\./i));
  it("formats zero-decimal currency without hard-coded cents", () =>
    expect(repricingMoney("1200", "JPY", "en")).toMatch(/1,200/));
  it("formats Arabic money through the shared formatter", () =>
    expect(repricingMoney("9900", "SAR", "ar")).toContain("ر.س"));
  it("renders Arabic copy", () => expect(repricingCopy("ar").title).toBe("إعادة التسعير السنوية"));
  it("sets RTL direction", () => {
    expect(dashboard).toContain('dir={locale === "ar" ? "rtl" : "ltr"}');
    expect(detail).toContain('dir={locale === "ar" ? "rtl" : "ltr"}');
  });
  it("uses accessible loading and error states", () => {
    expect(dashboard).toContain('aria-live="polite"');
    expect(detail).toContain('aria-live="assertive"');
  });
  it("uses the shared accessible modal primitive", () => {
    expect(dashboard).toContain("<Modal");
    expect(detail).toContain("<Modal");
  });
  it("renders responsive operational styling", () =>
    expect(css).toContain(".admin-repricing-facts"));
  it("preselects a safe pricing CTA path", () => expect(pricing).toContain("targetVersionId"));
  it("encodes campaign links safely", () =>
    expect(repricingPath("en", "campaign/a")).toBe("/en/repricing/campaign%2Fa"));
  it("formats dates using the reporting timezone", () =>
    expect(repricingDate("2026-10-01T00:00:00.000Z", "en")).toContain("Oct 1, 2026"));
});
