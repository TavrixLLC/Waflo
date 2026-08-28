import type { AdminSession, AdminUser } from "@waflo/database";
import { describe, expect, it } from "vitest";
import {
  AdminPermissionGuard,
  AdminSessionGuard,
  isAdminSessionActive,
} from "../../apps/api/src/admin/admin.guard.js";
import { AdminCustomersController } from "../../apps/api/src/admin/admin-customers.controller.js";
import {
  adminCustomerOrderBy,
  adminCustomerWhere,
  currentCustomerSubscription,
  entitlementStateForBillingStatus,
  parseAdminCustomerDirectoryQuery,
  safeAuditMetadata,
} from "../../apps/api/src/admin/admin-customers.js";
import { AdminCustomersService } from "../../apps/api/src/admin/admin-customers.service.js";
import {
  adminRoleHasPermission,
  permissionsForAdminRole,
} from "../../apps/api/src/admin/admin-rbac.js";
import { ADMIN_PERMISSIONS } from "../../apps/api/src/common/decorators.js";

const NOW = new Date("2026-08-27T12:00:00.000Z");

function query(input: Record<string, unknown> = {}) {
  return parseAdminCustomerDirectoryQuery(input);
}

function directoryOrganization(overrides: Record<string, unknown> = {}) {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    name: "Atlas Coffee",
    merchantSlug: "atlas-coffee",
    status: "ACTIVE",
    onboardingState: "COMPLETE",
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    selectedPlan: "GROWTH",
    billingProfile: {
      billingCountryCode: "SA",
      stripeCustomerId: "cus_atlas",
      subscriptionStatus: "ACTIVE",
      trialStart: null,
      trialEnd: null,
    },
    members: [
      { user: { displayName: "Amina Owner", email: "amina@example.com", status: "ACTIVE" } },
    ],
    subscriptions: [
      {
        id: "sub-local-1",
        stripeSubscriptionId: "sub_atlas",
        stripePriceId: "price_sa_growth_3",
        pricingVersionId: "pv-sa-growth-3",
        pricingMarketCode: "SA",
        pricingCurrency: "SAR",
        pricingAmountMinor: 9900n,
        cadence: "MONTHLY",
        grandfathered: true,
        planCode: "GROWTH",
        status: "ACTIVE",
        currentPeriodStart: new Date("2026-08-01T00:00:00.000Z"),
        currentPeriodEnd: new Date("2026-09-01T00:00:00.000Z"),
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
        updatedAt: new Date("2026-08-02T00:00:00.000Z"),
        repricingTransitions: [{ id: "repricing-1" }],
      },
    ],
    ...overrides,
  };
}

function detailOrganization(overrides: Record<string, unknown> = {}) {
  const directory = directoryOrganization();
  return {
    ...directory,
    businessCategory: "Coffee",
    defaultLocale: "EN",
    timezone: "Asia/Riyadh",
    onboardingCompletedAt: new Date("2026-08-02T00:00:00.000Z"),
    members: [
      {
        joinedAt: new Date("2026-08-01T00:00:00.000Z"),
        user: {
          displayName: "Amina Owner",
          email: "amina@example.com",
          status: "ACTIVE",
          lastLoginAt: new Date("2026-08-25T00:00:00.000Z"),
        },
      },
    ],
    loyaltyPrograms: [
      { id: "program-1", status: "PUBLISHED", publishedAt: new Date("2026-08-03T00:00:00.000Z") },
    ],
    subscriptions: [
      {
        ...directory.subscriptions[0],
        cancelAtPeriodEnd: false,
        canceledAt: null,
        pricingVersion: {
          id: "pv-sa-growth-3",
          version: 3,
          planCode: "GROWTH",
          cadence: "MONTHLY",
          currency: "SAR",
          amountMinor: 9900n,
          stripePriceId: "price_sa_growth_3",
          market: { code: "SA" },
        },
        changePreviews: [
          {
            publicId: "20000000-0000-4000-8000-000000000001",
            sourcePlan: "STARTER",
            sourceCadence: "MONTHLY",
            sourcePricingVersionId: "pv-sa-starter-1",
            sourceStripePriceId: "price_sa_starter_1",
            sourceAmountMinor: 4900n,
            sourceCurrency: "SAR",
            targetPlan: "GROWTH",
            targetCadence: "MONTHLY",
            targetPricingVersionId: "pv-sa-growth-3",
            targetStripePriceId: "price_sa_growth_3",
            targetAmountMinor: 9900n,
            targetCurrency: "SAR",
            amountDueNowMinor: 1200n,
            creditAmountMinor: 100n,
            status: "CONFIRMED",
            createdAt: new Date("2026-08-10T00:00:00.000Z"),
            expiresAt: new Date("2026-08-10T00:10:00.000Z"),
            confirmedAt: new Date("2026-08-10T00:03:00.000Z"),
            invalidatedAt: null,
          },
        ],
        repricingTransitions: [
          {
            id: "repricing-new",
            status: "SCHEDULED",
            effectiveAt: new Date("2027-01-01T00:00:00.000Z"),
            noticeSentAt: new Date("2026-12-01T00:00:00.000Z"),
            noticeStatus: "CREATED",
            noticeSnapshot: {
              marketCode: "SA",
              oldPricingVersionId: "pv-sa-growth-3",
              oldCurrency: "SAR",
              oldAmountMinor: "9900",
              targetPricingVersionId: "pv-sa-growth-4",
              newCurrency: "SAR",
              newAmountMinor: "11900",
              noticeDays: 30,
              effectiveRenewalAt: "2027-01-01T00:00:00.000Z",
            },
            replacesRepricingId: "repricing-old",
            replacedByRepricingId: null,
            failureCode: null,
            createdAt: new Date("2026-12-01T00:00:00.000Z"),
            updatedAt: new Date("2026-12-01T00:00:00.000Z"),
            targetPricingVersion: {
              id: "pv-sa-growth-4",
              version: 4,
              planCode: "GROWTH",
              cadence: "MONTHLY",
              currency: "SAR",
              amountMinor: 11900n,
              stripePriceId: "price_sa_growth_4",
              market: { code: "SA" },
            },
          },
        ],
        financialEvents: [
          {
            providerObjectId: "in_atlas",
            type: "BILLED",
            currency: "SAR",
            amountMinor: 9900n,
            providerOccurredAt: new Date("2026-08-05T00:00:00.000Z"),
            planCode: "GROWTH",
            pricingMarketCode: "SA",
          },
          {
            providerObjectId: "in_atlas",
            type: "COLLECTED",
            currency: "SAR",
            amountMinor: 9900n,
            providerOccurredAt: new Date("2026-08-05T00:00:02.000Z"),
            planCode: "GROWTH",
            pricingMarketCode: "SA",
          },
          {
            providerObjectId: "in_failed",
            type: "PAYMENT_FAILED",
            currency: "SAR",
            amountMinor: 9900n,
            providerOccurredAt: new Date("2026-08-06T00:00:00.000Z"),
            planCode: "GROWTH",
            pricingMarketCode: "SA",
          },
        ],
      },
    ],
    auditLogs: [
      {
        id: "audit-1",
        action: "billing.subscription_change_confirmed",
        targetType: "subscription",
        targetId: "sub_atlas",
        metadata: {
          targetPlan: "GROWTH",
          sessionToken: "hidden",
          merchantEmail: "hidden@example.com",
        },
        createdAt: new Date("2026-08-10T00:03:00.000Z"),
        actor: { displayName: "Amina Owner" },
        adminActor: null,
      },
    ],
    ...overrides,
  };
}

function customerService(organization: unknown) {
  return new AdminCustomersService({
    client: {
      organization: {
        count: async () => 1,
        findMany: async () => [organization],
        findUnique: async () => organization,
      },
    },
  } as never);
}

function guardHarness(cookie: Record<string, string> = {}) {
  const request = { cookies: cookie, headers: {}, requestId: "customer-test", id: "customer-test" };
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
    guard,
    request,
    context: {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => undefined,
      getClass: () => undefined,
    } as never,
  };
}

describe("Admin customer directory and Customer 360", () => {
  it("rejects an unauthenticated customer-directory request", async () => {
    const harness = guardHarness();
    await expect(harness.guard.canActivate(harness.context)).rejects.toMatchObject({
      code: "ADMIN_AUTH_REQUIRED",
    });
  });
  it("rejects a merchant session as customer-directory authority", async () => {
    const harness = guardHarness({ waflo_session: "merchant" });
    await expect(harness.guard.canActivate(harness.context)).rejects.toMatchObject({
      code: "ADMIN_AUTH_REQUIRED",
    });
  });
  it("rejects a customer session as customer-directory authority", async () => {
    const harness = guardHarness({ waflo_customer: "customer" });
    await expect(harness.guard.canActivate(harness.context)).rejects.toMatchObject({
      code: "ADMIN_AUTH_REQUIRED",
    });
  });
  it("allows SUPPORT customer visibility from server RBAC", () =>
    expect(adminRoleHasPermission("SUPPORT", "admin.customers.read")).toBe(true));
  it("allows PRICING_ADMIN commercial customer visibility", () =>
    expect(adminRoleHasPermission("PRICING_ADMIN", "admin.customers.read")).toBe(true));
  it("allows SUPER_ADMIN customer visibility", () =>
    expect(adminRoleHasPermission("SUPER_ADMIN", "admin.customers.read")).toBe(true));
  it("keeps finance evidence behind the distinct finance capability", () =>
    expect(adminRoleHasPermission("SUPPORT", "admin.finance.read")).toBe(false));
  it("requires customers.read on both customer controller routes", () => {
    expect(Reflect.getMetadata(ADMIN_PERMISSIONS, AdminCustomersController.prototype.list)).toEqual(
      ["admin.customers.read"],
    );
    expect(
      Reflect.getMetadata(ADMIN_PERMISSIONS, AdminCustomersController.prototype.detail),
    ).toEqual(["admin.customers.read"]);
  });
  it("does not accept client permission arrays as authority", () =>
    expect(permissionsForAdminRole("SUPPORT")).not.toContain("admin.finance.read"));
  it("rejects a missing current admin in permission middleware", () => {
    const guard = new AdminPermissionGuard({
      getAllAndOverride: () => ["admin.customers.read"],
    } as never);
    expect(() =>
      guard.canActivate({
        switchToHttp: () => ({ getRequest: () => ({}) }),
        getHandler: () => undefined,
        getClass: () => undefined,
      } as never),
    ).toThrowError(expect.objectContaining({ code: "ADMIN_AUTH_REQUIRED" }));
  });

  it("uses the first page and default bounded page size", () =>
    expect(query()).toMatchObject({ page: 1, pageSize: 25 }));
  it("accepts the requested 50-row page size", () =>
    expect(query({ pageSize: "50" }).pageSize).toBe(50));
  it("caps page size at 100", () => expect(query({ pageSize: "999" }).pageSize).toBe(100));
  it("rejects malformed pagination", () =>
    expect(() => query({ page: "-1" })).toThrowError(
      expect.objectContaining({ code: "ADMIN_CUSTOMER_PAGINATION_INVALID" }),
    ));
  it("normalizes organization-name search safely", () =>
    expect(query({ search: "  Atlas Coffee  " }).search).toBe("Atlas Coffee"));
  it("searches organization IDs only by exact UUID predicate", () =>
    expect(
      adminCustomerWhere(query({ search: "10000000-0000-4000-8000-000000000001" })).OR,
    ).toContainEqual({ id: "10000000-0000-4000-8000-000000000001" }));
  it("includes owner email in the Prisma search boundary", () =>
    expect(JSON.stringify(adminCustomerWhere(query({ search: "owner@example.com" })))).toContain(
      "normalizedEmail",
    ));
  it("includes Stripe customer reference in the search boundary", () =>
    expect(JSON.stringify(adminCustomerWhere(query({ search: "cus_atlas" })))).toContain(
      "stripeCustomerId",
    ));
  it("includes Stripe subscription reference in the search boundary", () =>
    expect(JSON.stringify(adminCustomerWhere(query({ search: "sub_atlas" })))).toContain(
      "stripeSubscriptionId",
    ));
  it("does not create raw SQL from search input", () =>
    expect(
      JSON.stringify(adminCustomerWhere(query({ search: "'; DROP TABLE organizations; --" }))),
    ).toContain("DROP TABLE"));
  it("filters by actual subscription status", () =>
    expect(adminCustomerWhere(query({ status: "active" })).billingProfile).toEqual({
      is: { subscriptionStatus: "ACTIVE" },
    }));
  it("filters by the locked subscription plan rather than setup selection", () =>
    expect(JSON.stringify(adminCustomerWhere(query({ plan: "growth" })))).toContain(
      '"planCode":"GROWTH"',
    ));
  it("filters by locked pricing market", () =>
    expect(JSON.stringify(adminCustomerWhere(query({ market: "sa" })))).toContain(
      '"pricingMarketCode":"SA"',
    ));
  it("filters by billing country", () =>
    expect(adminCustomerWhere(query({ country: "sa" })).billingProfile).toEqual({
      is: { billingCountryCode: "SA" },
    }));
  it("filters by locked subscription currency", () =>
    expect(JSON.stringify(adminCustomerWhere(query({ currency: "sar" })))).toContain(
      '"pricingCurrency":"SAR"',
    ));
  it("filters grandfathered subscriptions", () =>
    expect(JSON.stringify(adminCustomerWhere(query({ grandfathered: "yes" })))).toContain(
      '"grandfathered":true',
    ));
  it("filters scheduled repricing commands", () =>
    expect(JSON.stringify(adminCustomerWhere(query({ scheduledRepricing: "yes" })))).toContain(
      '"SCHEDULED"',
    ));
  it("filters creation date from a UTC boundary", () =>
    expect(adminCustomerWhere(query({ createdFrom: "2026-08-01" })).createdAt).toMatchObject({
      gte: new Date("2026-08-01T00:00:00.000Z"),
    }));
  it("rejects invalid dates", () =>
    expect(() => query({ createdFrom: "2026/08/01" })).toThrowError(
      expect.objectContaining({ code: "ADMIN_CUSTOMER_DATE_INVALID" }),
    ));
  it("rejects impossible calendar dates instead of accepting JavaScript date rollover", () =>
    expect(() => query({ createdFrom: "2026-02-31" })).toThrowError(
      expect.objectContaining({ code: "ADMIN_CUSTOMER_DATE_INVALID" }),
    ));
  it("rejects invalid sort fields", () =>
    expect(() => query({ sort: "rawSql" })).toThrowError(
      expect.objectContaining({ code: "ADMIN_CUSTOMER_SORT_INVALID" }),
    ));
  it("uses only whitelisted name sorting", () =>
    expect(adminCustomerOrderBy(query({ sort: "name", direction: "asc" }))).toEqual([
      { normalizedName: "asc" },
      { id: "asc" },
    ]));
  it("uses only whitelisted creation sorting", () =>
    expect(adminCustomerOrderBy(query()).at(0)).toEqual({ createdAt: "desc" }));
  it("uses billing-profile status sorting without client column names", () =>
    expect(adminCustomerOrderBy(query({ sort: "status" })).at(0)).toEqual({
      billingProfile: { subscriptionStatus: "desc" },
    }));

  it("selects the newest canonical stored subscription", () => {
    const old = {
      id: "old",
      status: "CANCELED",
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
    };
    const latest = {
      id: "new",
      status: "ACTIVE",
      createdAt: new Date("2026-02-01"),
      updatedAt: new Date("2026-02-01"),
    };
    expect(currentCustomerSubscription([old, latest])).toBe(latest);
  });
  it("derives entitlement state from the canonical billing status", () =>
    expect(entitlementStateForBillingStatus("GRACE_PERIOD")).toMatchObject({
      code: "ALLOWED",
      enrollmentAllowed: true,
    }));
  it("shows past due as restricted from enrollment without fabricating an entitlement", () =>
    expect(entitlementStateForBillingStatus("PAST_DUE")).toMatchObject({
      enrollmentAllowed: false,
      existingCardsViewable: true,
    }));
  it("maps directory current amount from the locked subscription snapshot", async () => {
    const result = await customerService(directoryOrganization()).list(query());
    expect(result.items[0]?.subscription).toMatchObject({ amountMinor: "9900", currency: "SAR" });
  });
  it("does not substitute the latest catalog amount for a grandfathered directory row", async () => {
    const result = await customerService(directoryOrganization()).list(query());
    expect(result.items[0]?.subscription).toMatchObject({
      pricingVersionId: "pv-sa-growth-3",
      grandfathered: true,
    });
  });
  it("uses the locked subscription market in the directory", async () =>
    expect(
      (await customerService(directoryOrganization()).list(query())).items[0]?.subscription?.market,
    ).toBe("SA"));
  it("maps directory owner contact from active owner membership", async () =>
    expect(
      (await customerService(directoryOrganization()).list(query())).items[0]?.organization.owner
        ?.email,
    ).toBe("amina@example.com"));
  it("maps scheduled repricing as an operational indicator", async () =>
    expect(
      (await customerService(directoryOrganization()).list(query())).items[0]?.subscription
        ?.scheduledRepricing,
    ).toBe(true));
  it("returns bounded server pagination metadata", async () =>
    expect(
      (await customerService(directoryOrganization()).list(query({ page: "2", pageSize: "50" })))
        .pageSize,
    ).toBe(50));

  it("returns Customer 360 organization, owner and billing country", async () => {
    const detail = await customerService(detailOrganization()).detail(
      "10000000-0000-4000-8000-000000000001",
      { canViewFinance: false },
      NOW,
    );
    expect(detail.organization).toMatchObject({
      name: "Atlas Coffee",
      billingCountry: "SA",
      owner: { email: "amina@example.com" },
    });
  });
  it("returns canonical subscription terms and provider references", async () => {
    const detail = await customerService(detailOrganization()).detail(
      "10000000-0000-4000-8000-000000000001",
      { canViewFinance: false },
      NOW,
    );
    expect(detail.subscription).toMatchObject({
      stripeCustomerReference: "cus_atlas",
      stripeSubscriptionReference: "sub_atlas",
      stripePriceReference: "price_sa_growth_3",
      commercialTerms: { amountMinor: "9900", currency: "SAR" },
    });
  });
  it("returns the actual 15-day trial contract without invented conversion", async () => {
    const detail = await customerService(detailOrganization()).detail(
      "10000000-0000-4000-8000-000000000001",
      { canViewFinance: false },
      NOW,
    );
    expect(detail.trial).toMatchObject({ contractDays: 15, converted: null });
  });
  it("returns immutable pricing-version history", async () =>
    expect(
      (
        await customerService(detailOrganization()).detail(
          "10000000-0000-4000-8000-000000000001",
          { canViewFinance: false },
          NOW,
        )
      ).pricingHistory[0],
    ).toMatchObject({ pricingVersionId: "pv-sa-growth-3", amountMinor: "9900" }));
  it("returns confirmed subscription-change evidence without provider fingerprints", async () => {
    const changes = (
      await customerService(detailOrganization()).detail(
        "10000000-0000-4000-8000-000000000001",
        { canViewFinance: false },
        NOW,
      )
    ).subscriptionChanges;
    expect(changes[0]).toMatchObject({ status: "CONFIRMED", target: { amountMinor: "9900" } });
    expect(JSON.stringify(changes)).not.toContain("providerFingerprint");
  });
  it("returns immutable annual-repricing notice and replacement evidence", async () => {
    const history = (
      await customerService(detailOrganization()).detail(
        "10000000-0000-4000-8000-000000000001",
        { canViewFinance: false },
        NOW,
      )
    ).repricingHistory;
    expect(history[0]).toMatchObject({
      status: "SCHEDULED",
      replacesCommandId: "repricing-old",
      notice: { snapshot: { sourceAmountMinor: "9900", targetAmountMinor: "11900" } },
    });
  });
  it("omits finance fields for an administrator without finance capability", async () =>
    expect(
      await customerService(detailOrganization()).detail(
        "10000000-0000-4000-8000-000000000001",
        { canViewFinance: false },
        NOW,
      ),
    ).not.toHaveProperty("financial"));
  it("returns verified invoice evidence only to finance-capable administrators", async () => {
    const detail = await customerService(detailOrganization()).detail(
      "10000000-0000-4000-8000-000000000001",
      { canViewFinance: true },
      NOW,
    );
    expect(detail.financial).toMatchObject({
      paidInvoiceCount: 1,
      failedPaymentCount: 1,
      collected: [{ currency: "SAR", amountMinor: "9900" }],
    });
  });
  it("keeps a customer financial history in separate native currencies", async () => {
    const fixture = detailOrganization();
    (fixture.subscriptions[0].financialEvents as Array<Record<string, unknown>>).push({
      providerObjectId: "in-usd",
      type: "COLLECTED",
      currency: "USD",
      amountMinor: 2900n,
      providerOccurredAt: NOW,
      planCode: "GROWTH",
      pricingMarketCode: "SA",
    });
    const detail = await customerService(fixture).detail(
      "10000000-0000-4000-8000-000000000001",
      { canViewFinance: true },
      NOW,
    );
    expect(detail.financial?.collected).toEqual([
      { currency: "SAR", amountMinor: "9900" },
      { currency: "USD", amountMinor: "2900" },
    ]);
  });
  it("does not fabricate historical invoice absence", async () => {
    const fixture = detailOrganization();
    fixture.subscriptions[0].financialEvents = [];
    const detail = await customerService(fixture).detail(
      "10000000-0000-4000-8000-000000000001",
      { canViewFinance: true },
      NOW,
    );
    expect(detail.financial).toMatchObject({ historicalDataMayBePartial: true, invoices: [] });
  });
  it("returns failed payment evidence distinctly from paid invoice evidence", async () => {
    const detail = await customerService(detailOrganization()).detail(
      "10000000-0000-4000-8000-000000000001",
      { canViewFinance: true },
      NOW,
    );
    expect(detail.financial?.invoices).toContainEqual(
      expect.objectContaining({ stripeInvoiceReference: "in_failed", status: "PAYMENT_FAILED" }),
    );
  });
  it("sanitizes sensitive audit metadata before response serialization", () => {
    expect(
      safeAuditMetadata({ targetPlan: "GROWTH", sessionToken: "x", email: "a@b.com" }),
    ).toEqual({ targetPlan: "GROWTH" });
  });
  it("returns audit actor references without password or session fields", async () => {
    const detail = await customerService(detailOrganization()).detail(
      "10000000-0000-4000-8000-000000000001",
      { canViewFinance: false },
      NOW,
    );
    expect(JSON.stringify(detail.audit)).not.toMatch(/password|sessionToken|merchantEmail/i);
  });
  it("returns safe empty history arrays for a zero-data customer", async () => {
    const fixture = detailOrganization({ subscriptions: [], loyaltyPrograms: [], auditLogs: [] });
    const detail = await customerService(fixture).detail(
      "10000000-0000-4000-8000-000000000001",
      { canViewFinance: false },
      NOW,
    );
    expect(detail).toMatchObject({
      subscription: null,
      pricingHistory: [],
      subscriptionChanges: [],
      repricingHistory: [],
      audit: [],
    });
  });
  it("does not need Stripe to render Customer 360", () => {
    const source = String(AdminCustomersService);
    expect(source).not.toMatch(/stripe\.|Stripe\(/);
  });
  it("rejects inactive server sessions", () =>
    expect(
      isAdminSessionActive(
        {
          expiresAt: new Date("2026-08-27T11:00:00.000Z"),
          revokedAt: null,
          lastActiveAt: NOW,
          adminUser: { status: "ACTIVE" },
        } as Pick<AdminSession, "expiresAt" | "revokedAt" | "lastActiveAt"> & {
          adminUser: Pick<AdminUser, "status">;
        },
        60,
        NOW,
      ),
    ).toBe(false));
});
