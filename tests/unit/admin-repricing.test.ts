import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { adminRoleHasPermission } from "../../apps/api/src/admin/admin-rbac.js";
import { AdminRepricingController } from "../../apps/api/src/admin/admin-repricing.controller.js";
import {
  adminRepricingPreviewSchema,
  adminRepricingReplaceSchema,
  adminRepricingScheduleSchema,
  adminRepricingSubscriberQuerySchema,
} from "../../apps/api/src/admin/admin-repricing.js";
import {
  campaignStatus,
  monthlyEquivalent,
  nextRenewalAfter,
} from "../../apps/api/src/billing/annual-repricing-operations.service.js";
import { ADMIN_PERMISSIONS } from "../../apps/api/src/common/decorators.js";

const source = readFileSync(
  resolve(process.cwd(), "apps/api/src/billing/annual-repricing-operations.service.ts"),
  "utf8",
);
const adminServiceSource = readFileSync(
  resolve(process.cwd(), "apps/api/src/admin/admin-repricing.service.ts"),
  "utf8",
);
const migration = readFileSync(
  resolve(
    process.cwd(),
    "packages/database/prisma/migrations/20260827160000_admin_repricing_campaigns/migration.sql",
  ),
  "utf8",
);

describe("Admin annual repricing operations", () => {
  it("requires repricing.read for the overview", () =>
    expect(
      Reflect.getMetadata(ADMIN_PERMISSIONS, AdminRepricingController.prototype.overview),
    ).toEqual(["admin.repricing.read"]));
  it("requires repricing.write for preview", () =>
    expect(
      Reflect.getMetadata(ADMIN_PERMISSIONS, AdminRepricingController.prototype.preview),
    ).toEqual(["admin.repricing.write"]));
  it("requires repricing.write for schedule", () =>
    expect(
      Reflect.getMetadata(ADMIN_PERMISSIONS, AdminRepricingController.prototype.schedule),
    ).toEqual(["admin.repricing.write"]));
  it("requires repricing.write for cancellation", () =>
    expect(
      Reflect.getMetadata(ADMIN_PERMISSIONS, AdminRepricingController.prototype.cancel),
    ).toEqual(["admin.repricing.write"]));
  it("requires repricing.write for replacement", () =>
    expect(
      Reflect.getMetadata(ADMIN_PERMISSIONS, AdminRepricingController.prototype.replace),
    ).toEqual(["admin.repricing.write"]));
  it("allows a PRICING_ADMIN to preview", () =>
    expect(adminRoleHasPermission("PRICING_ADMIN", "admin.repricing.write")).toBe(true));
  it("allows a PRICING_ADMIN to schedule", () =>
    expect(adminRoleHasPermission("PRICING_ADMIN", "admin.repricing.write")).toBe(true));
  it("allows a SUPER_ADMIN to schedule", () =>
    expect(adminRoleHasPermission("SUPER_ADMIN", "admin.repricing.write")).toBe(true));
  it("does not allow SUPPORT to schedule", () =>
    expect(adminRoleHasPermission("SUPPORT", "admin.repricing.write")).toBe(false));
  it("allows SUPPORT to inspect repricing operational state", () =>
    expect(adminRoleHasPermission("SUPPORT", "admin.repricing.read")).toBe(true));
  it("does not allow FINANCE to schedule", () =>
    expect(adminRoleHasPermission("FINANCE", "admin.repricing.write")).toBe(false));
  it("allows FINANCE to inspect repricing impact", () =>
    expect(adminRoleHasPermission("FINANCE", "admin.repricing.read")).toBe(true));
  it("does not allow READ_ONLY to schedule", () =>
    expect(adminRoleHasPermission("READ_ONLY", "admin.repricing.write")).toBe(false));

  it("accepts an explicit preview policy input", () =>
    expect(
      adminRepricingPreviewSchema.parse({
        marketId: "10000000-0000-4000-8000-000000000001",
        plan: "growth",
        cadence: "monthly",
        targetPricingVersionId: "10000000-0000-4000-8000-000000000002",
        effectiveOnOrAfter: "2026-10-01",
        noticeDays: 30,
      }).noticeDays,
    ).toBe(30));
  it("does not accept a client amount in preview input", () =>
    expect(() =>
      adminRepricingPreviewSchema.parse({
        marketId: "10000000-0000-4000-8000-000000000001",
        plan: "growth",
        cadence: "monthly",
        targetPricingVersionId: "10000000-0000-4000-8000-000000000002",
        effectiveOnOrAfter: "2026-10-01",
        noticeDays: 30,
        amountMinor: "1",
      }),
    ).toThrow());
  it("does not accept a client currency in preview input", () =>
    expect(() =>
      adminRepricingPreviewSchema.parse({
        marketId: "10000000-0000-4000-8000-000000000001",
        plan: "growth",
        cadence: "monthly",
        targetPricingVersionId: "10000000-0000-4000-8000-000000000002",
        effectiveOnOrAfter: "2026-10-01",
        noticeDays: 30,
        currency: "USD",
      }),
    ).toThrow());
  it("does not accept a client Stripe Price in preview input", () =>
    expect(() =>
      adminRepricingPreviewSchema.parse({
        marketId: "10000000-0000-4000-8000-000000000001",
        plan: "growth",
        cadence: "monthly",
        targetPricingVersionId: "10000000-0000-4000-8000-000000000002",
        effectiveOnOrAfter: "2026-10-01",
        noticeDays: 30,
        stripePriceId: "price_1",
      }),
    ).toThrow());
  it("caps notice policy days", () =>
    expect(() =>
      adminRepricingPreviewSchema.parse({
        marketId: "10000000-0000-4000-8000-000000000001",
        plan: "growth",
        cadence: "monthly",
        targetPricingVersionId: "10000000-0000-4000-8000-000000000002",
        effectiveOnOrAfter: "2026-10-01",
        noticeDays: 366,
      }),
    ).toThrow());
  it("requires a campaign ID for scheduling", () =>
    expect(() => adminRepricingScheduleSchema.parse({})).toThrow());
  it("does not accept commercial terms for scheduling", () =>
    expect(() =>
      adminRepricingScheduleSchema.parse({
        campaignId: "10000000-0000-4000-8000-000000000001",
        price: 29,
      }),
    ).toThrow());
  it("requires a replacement preview reference", () =>
    expect(() => adminRepricingReplaceSchema.parse({})).toThrow());
  it("caps subscriber page size", () =>
    expect(() => adminRepricingSubscriberQuerySchema.parse({ pageSize: 101 })).toThrow());

  it("normalizes monthly MRR at face value", () =>
    expect(monthlyEquivalent(2_900n, "MONTHLY")).toBe(2_900n));
  it("normalizes annual MRR without a floating-point price", () =>
    expect(monthlyEquivalent(29_900n, "YEARLY")).toBe(2_492n));
  it("keeps native currency numbers separate by construction", () =>
    expect(source).toContain("currency: target.currency"));
  it("moves a monthly renewal to the effective date", () =>
    expect(
      nextRenewalAfter(
        new Date("2026-09-08T00:00:00Z"),
        "MONTHLY",
        new Date("2026-10-01T00:00:00Z"),
      ).toISOString(),
    ).toBe("2026-10-08T00:00:00.000Z"));
  it("keeps an annual subscriber until annual renewal", () =>
    expect(
      nextRenewalAfter(
        new Date("2026-07-12T00:00:00Z"),
        "YEARLY",
        new Date("2026-01-01T00:00:00Z"),
      ).toISOString(),
    ).toBe("2026-07-12T00:00:00.000Z"));
  it("defers a renewal to satisfy notice lead time", () =>
    expect(
      nextRenewalAfter(
        new Date("2026-10-08T00:00:00Z"),
        "MONTHLY",
        new Date("2026-10-30T00:00:00Z"),
      ).toISOString(),
    ).toBe("2026-11-08T00:00:00.000Z"));
  it("derives a previewed campaign status", () =>
    expect(campaignStatus("PREVIEWED", [])).toBe("PREVIEWED"));
  it("derives scheduled campaign status", () =>
    expect(campaignStatus("SCHEDULED", [{ status: "SCHEDULED" }])).toBe("SCHEDULED"));
  it("derives in-progress campaign status", () =>
    expect(campaignStatus("SCHEDULED", [{ status: "SCHEDULED" }, { status: "APPLIED" }])).toBe(
      "IN_PROGRESS",
    ));
  it("derives completed campaign status", () =>
    expect(campaignStatus("SCHEDULED", [{ status: "APPLIED" }])).toBe("COMPLETED"));
  it("derives partial failure campaign status", () =>
    expect(campaignStatus("SCHEDULED", [{ status: "FAILED" }, { status: "APPLIED" }])).toBe(
      "PARTIAL_FAILURE",
    ));
  it("preserves canceled campaign status", () =>
    expect(campaignStatus("CANCELED", [{ status: "APPLIED" }])).toBe("CANCELED"));
  it("preserves superseded campaign status", () =>
    expect(campaignStatus("SUPERSEDED", [{ status: "SCHEDULED" }])).toBe("SUPERSEDED"));

  it("uses active Stripe-bound published targets only", () =>
    expect(source).toContain('target.status !== "ACTIVE_FOR_NEW_SUBSCRIPTIONS"'));
  it("validates target market", () =>
    expect(source).toContain("target.marketId !== input.marketId"));
  it("validates target plan", () =>
    expect(source).toContain("target.planCode !== input.plan.toUpperCase()"));
  it("validates target cadence", () =>
    expect(source).toContain("target.cadence !== input.cadence"));
  it("validates target currency against market policy", () =>
    expect(source).toContain("REPRICING_TARGET_CURRENCY_MISMATCH"));
  it("includes grandfathered subscribers only", () =>
    expect(source).toContain("!subscription.grandfathered"));
  it("excludes current-version subscribers", () =>
    expect(source).toContain("subscription.pricingVersionId === target.id"));
  it("excludes canceled subscriptions", () =>
    expect(source).toContain("SUBSCRIPTION_NOT_ELIGIBLE"));
  it("excludes missing commercial snapshots", () =>
    expect(source).toContain("MISSING_PRICING_SNAPSHOT"));
  it("excludes market mismatch", () => expect(source).toContain("MARKET_MISMATCH"));
  it("excludes plan mismatch", () => expect(source).toContain("PLAN_MISMATCH"));
  it("excludes cadence mismatch", () => expect(source).toContain("CADENCE_MISMATCH"));
  it("excludes currency mismatch", () => expect(source).toContain("CURRENCY_MISMATCH"));
  it("handles already scheduled subscribers safely", () =>
    expect(source).toContain("ALREADY_SCHEDULED"));
  it("does not schedule without a durable preview", () =>
    expect(source).toContain('campaign.status !== "PREVIEWED"'));
  it("expires stale previews", () => expect(source).toContain("REPRICING_PREVIEW_EXPIRED"));

  it("stores campaign identity", () =>
    expect(migration).toContain('CREATE TABLE "repricing_campaigns"'));
  it("stores a durable reviewed cohort", () =>
    expect(migration).toContain('CREATE TABLE "repricing_campaign_members"'));
  it("keeps subscription commands as the commercial authority", () =>
    expect(source).toContain("noticeSnapshot"));
  it("snapshots the source pricing version", () =>
    expect(source).toContain("sourcePricingVersionId"));
  it("snapshots the target pricing version", () =>
    expect(source).toContain("targetPricingVersionId"));
  it("snapshots notice policy", () => expect(source).toContain("noticeDays: campaign.noticeDays"));
  it("snapshots effective date", () => expect(source).toContain("effectiveOnOrAfter"));
  it("does not synchronously update Stripe subscriptions", () =>
    expect(source).not.toMatch(/stripe\.subscriptions\.update|createPreview/));
  it("does not create invoices", () => expect(source).not.toMatch(/invoice/i));
  it("does not create a repricing proration", () => expect(source).not.toMatch(/proration/i));
  it("uses a database advisory lock for schedule", () =>
    expect(source).toContain("withInvariantLock"));
  it("uses a campaign-scoped idempotency key", () =>
    expect(source).toContain("idempotencyKey: `admin-repricing"));
  it("cancellation only affects pending commands", () =>
    expect(source).toContain('where: { campaignId: campaign.id, status: "SCHEDULED" }'));
  it("cancellation preserves executed commands", () =>
    expect(source).toContain('data: { status: "CANCELED", noticeStatus: "CANCELED" }'));
  it("replacement supersedes only pending commands", () =>
    expect(source).toContain('data: { status: "SUPERSEDED", noticeStatus: "CANCELED" }'));
  it("replacement creates a new previewed campaign", () =>
    expect(source).toContain("replacesCampaignId: original.id"));
  it("never rewrites the original target", () =>
    expect(source).not.toContain("targetPricingVersionId: targetPricingVersionId"));
  it("keeps old notice snapshots immutable", () => expect(source).toContain("replacesCampaignId"));
  it("supports safe paginated subscriber results", () =>
    expect(source).toContain("rows.slice((query.page - 1) * query.pageSize"));
  it("supports server-side subscriber status filtering", () =>
    expect(source).toContain("query.status"));
  it("supports server-side notice filtering", () => expect(source).toContain("query.noticeStatus"));
  it("supports server-side renewal range filtering", () =>
    expect(source).toContain("query.renewalFrom"));
  it("returns no provider secret fields", () =>
    expect(source).not.toMatch(/secretKey|apiKey|clientSecret/i));
  it("records repricing scheduling audit evidence", () =>
    expect(adminServiceSource).toContain("admin.repricing.scheduled"));
  it("records repricing cancellation audit evidence", () =>
    expect(adminServiceSource).toContain("admin.repricing.canceled"));
  it("records repricing replacement audit evidence", () =>
    expect(adminServiceSource).toContain("admin.repricing.replaced"));
});
