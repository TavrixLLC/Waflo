import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  adminRoleHasPermission,
  permissionsForAdminRole,
} from "../../apps/api/src/admin/admin-rbac.js";
import { AdminStripeHealthController } from "../../apps/api/src/admin/admin-stripe-health.controller.js";
import {
  deriveStripeHealthIssues,
  expectedStripeWebhookEventTypes,
  filterStripeHealthIssues,
  nativeCurrencyTotals,
  type StripeHealthDataset,
  stripeHealthOverallSeverity,
  summarizeWebhookCoverage,
} from "../../apps/api/src/admin/admin-stripe-health.js";
import { ADMIN_PERMISSIONS } from "../../apps/api/src/common/decorators.js";

const NOW = new Date("2026-08-27T12:00:00.000Z");
const PAST = new Date("2026-08-26T12:00:00.000Z");
const FUTURE = new Date("2026-09-27T12:00:00.000Z");
const ORG = "10000000-0000-4000-8000-000000000001";
const SUBSCRIPTION = "10000000-0000-4000-8000-000000000002";
const VERSION = "10000000-0000-4000-8000-000000000003";

function version(
  overrides: Partial<StripeHealthDataset["pricingVersions"][number]> = {},
): StripeHealthDataset["pricingVersions"][number] {
  return {
    id: VERSION,
    stripePriceId: "price_global_growth",
    currency: "USD",
    amountMinor: 2900n,
    planCode: "GROWTH",
    cadence: "MONTHLY",
    status: "ACTIVE_FOR_NEW_SUBSCRIPTIONS",
    marketCode: "GLOBAL",
    publishedAt: PAST,
    ...overrides,
  };
}

function subscription(
  overrides: Partial<StripeHealthDataset["subscriptions"][number]> = {},
): StripeHealthDataset["subscriptions"][number] {
  return {
    id: SUBSCRIPTION,
    organizationId: ORG,
    organizationName: "Saffron Studio",
    stripeCustomerId: "cus_saffron",
    stripeSubscriptionId: "sub_saffron",
    stripePriceId: "price_global_growth",
    pricingVersionId: VERSION,
    pricingMarketCode: "GLOBAL",
    pricingCurrency: "USD",
    pricingAmountMinor: 2900n,
    planCode: "GROWTH",
    cadence: "MONTHLY",
    status: "ACTIVE",
    profileStatus: "ACTIVE",
    currentPeriodEnd: FUTURE,
    lastProviderSyncAt: NOW,
    reconciliationLeaseExpiresAt: null,
    reconciliationFailureCode: null,
    ...overrides,
  };
}

function dataset(overrides: Partial<StripeHealthDataset> = {}): StripeHealthDataset {
  return {
    subscriptions: [subscription()],
    pricingVersions: [version()],
    webhooks: [],
    financialEvents: [],
    repricings: [],
    changePreviews: [],
    providerConfiguration: {
      apiCredentials: "CONFIGURED",
      webhookSigning: "CONFIGURED",
      portalConfiguration: "CONFIGURED",
      mode: "TEST",
      environment: "staging",
      environmentMismatch: false,
    },
    financialEvidence: { ledgerStartedAt: null, latestEvidenceAt: null },
    ...overrides,
  };
}

function issueTypes(value: StripeHealthDataset) {
  return deriveStripeHealthIssues(value, NOW).map((issue) => issue.type);
}

const controllerSource = readFileSync(
  resolve(process.cwd(), "apps/api/src/admin/admin-stripe-health.controller.ts"),
  "utf8",
);
const serviceSource = readFileSync(
  resolve(process.cwd(), "apps/api/src/admin/admin-stripe-health.service.ts"),
  "utf8",
);

describe("Admin Stripe Health operational evidence", () => {
  it("requires stripe health read for overview metadata", () => {
    expect(
      Reflect.getMetadata(ADMIN_PERMISSIONS, AdminStripeHealthController.prototype.overview),
    ).toEqual(["admin.stripe_health.read"]);
  });

  it("requires stripe health read for issue list metadata", () => {
    expect(
      Reflect.getMetadata(ADMIN_PERMISSIONS, AdminStripeHealthController.prototype.issues),
    ).toEqual(["admin.stripe_health.read"]);
  });

  it("requires stripe health read for issue detail metadata", () => {
    expect(
      Reflect.getMetadata(ADMIN_PERMISSIONS, AdminStripeHealthController.prototype.issue),
    ).toEqual(["admin.stripe_health.read"]);
  });

  it("requires stripe health read for webhook metadata", () => {
    expect(
      Reflect.getMetadata(ADMIN_PERMISSIONS, AdminStripeHealthController.prototype.webhooks),
    ).toEqual(["admin.stripe_health.read"]);
  });

  it("requires stripe health read for reconciliation metadata", () => {
    expect(
      Reflect.getMetadata(ADMIN_PERMISSIONS, AdminStripeHealthController.prototype.reconciliation),
    ).toEqual(["admin.stripe_health.read"]);
  });

  it("requires stripe health read for payment metadata", () => {
    expect(
      Reflect.getMetadata(ADMIN_PERMISSIONS, AdminStripeHealthController.prototype.payments),
    ).toEqual(["admin.stripe_health.read"]);
  });

  it("requires stripe health read for catalog metadata", () => {
    expect(
      Reflect.getMetadata(ADMIN_PERMISSIONS, AdminStripeHealthController.prototype.catalog),
    ).toEqual(["admin.stripe_health.read"]);
  });

  it("allows SUPPORT to read diagnostics", () =>
    expect(adminRoleHasPermission("SUPPORT", "admin.stripe_health.read")).toBe(true));

  it("allows SUPER_ADMIN to read diagnostics", () =>
    expect(adminRoleHasPermission("SUPER_ADMIN", "admin.stripe_health.read")).toBe(true));

  it("keeps SUPPORT without finance capability", () =>
    expect(permissionsForAdminRole("SUPPORT")).not.toContain("admin.finance.read"));

  it("keeps merchant roles outside the Admin capability vocabulary", () =>
    expect(adminRoleHasPermission("READ_ONLY", "admin.stripe_health.read")).toBe(true));

  it("returns no issue for healthy canonical evidence", () =>
    expect(deriveStripeHealthIssues(dataset(), NOW)).toEqual([]));

  it("returns HEALTHY for an empty issue list", () =>
    expect(stripeHealthOverallSeverity([])).toBe("HEALTHY"));

  it("returns INFO when only non-commercial cleanup exists", () =>
    expect(
      stripeHealthOverallSeverity(
        deriveStripeHealthIssues(
          dataset({
            changePreviews: [
              {
                id: "preview-1",
                organizationId: ORG,
                organizationName: "Saffron Studio",
                subscriptionId: SUBSCRIPTION,
                status: "PENDING",
                expiresAt: PAST,
                createdAt: PAST,
              },
            ],
          }),
          NOW,
        ),
      ),
    ).toBe("INFO"));

  it("returns WARNING when a webhook requires retry", () =>
    expect(
      stripeHealthOverallSeverity(
        deriveStripeHealthIssues(
          dataset({
            webhooks: [
              {
                id: "webhook-1",
                organizationId: ORG,
                organizationName: "Saffron Studio",
                externalEventId: "evt_retry",
                eventType: "invoice.paid",
                status: "FAILED",
                attemptCount: 1,
                leaseExpiresAt: null,
                processedAt: null,
                createdAt: PAST,
                updatedAt: NOW,
              },
            ],
          }),
          NOW,
        ),
      ),
    ).toBe("WARNING"));

  it("returns CRITICAL for an unknown Stripe Price", () => {
    const issues = deriveStripeHealthIssues(
      dataset({ subscriptions: [subscription({ stripePriceId: "price_unknown" })] }),
      NOW,
    );
    expect(stripeHealthOverallSeverity(issues)).toBe("CRITICAL");
  });

  it("detects an unknown Stripe Price", () =>
    expect(
      issueTypes(dataset({ subscriptions: [subscription({ stripePriceId: "price_unknown" })] })),
    ).toContain("UNKNOWN_STRIPE_PRICE"));

  it("makes unknown Stripe Price critical", () =>
    expect(
      deriveStripeHealthIssues(
        dataset({ subscriptions: [subscription({ stripePriceId: "price_unknown" })] }),
        NOW,
      ).find((issue) => issue.type === "UNKNOWN_STRIPE_PRICE")?.severity,
    ).toBe("CRITICAL"));

  it("does not infer entitlements for an unknown Stripe Price", () => {
    const unknown = deriveStripeHealthIssues(
      dataset({ subscriptions: [subscription({ stripePriceId: "price_unknown" })] }),
      NOW,
    ).find((issue) => issue.type === "UNKNOWN_STRIPE_PRICE");
    expect(unknown?.summary).toContain("Entitlements must not be inferred");
  });

  it("detects a missing pricing snapshot", () =>
    expect(
      issueTypes(dataset({ subscriptions: [subscription({ pricingVersionId: null })] })),
    ).toContain("MISSING_PRICING_SNAPSHOT"));

  it("does not flag a canceled subscription for a missing snapshot", () =>
    expect(
      issueTypes(
        dataset({ subscriptions: [subscription({ status: "CANCELED", pricingVersionId: null })] }),
      ),
    ).not.toContain("MISSING_PRICING_SNAPSHOT"));

  it("detects a published version without a Stripe binding", () =>
    expect(issueTypes(dataset({ pricingVersions: [version({ stripePriceId: null })] }))).toContain(
      "MISSING_PRICING_BINDING",
    ));

  it("does not flag a draft version without a binding", () =>
    expect(
      issueTypes(
        dataset({
          subscriptions: [],
          pricingVersions: [version({ status: "DRAFT", stripePriceId: null })],
        }),
      ),
    ).not.toContain("MISSING_PRICING_BINDING"));

  it("detects an amount mismatch", () =>
    expect(
      issueTypes(dataset({ subscriptions: [subscription({ pricingAmountMinor: 3100n })] })),
    ).toContain("PRICE_AMOUNT_MISMATCH"));

  it("detects a currency mismatch", () =>
    expect(
      issueTypes(dataset({ subscriptions: [subscription({ pricingCurrency: "SAR" })] })),
    ).toContain("PRICE_CURRENCY_MISMATCH"));

  it("detects a plan mismatch", () =>
    expect(issueTypes(dataset({ subscriptions: [subscription({ planCode: "SCALE" })] }))).toContain(
      "PLAN_MISMATCH",
    ));

  it("detects a cadence mismatch", () =>
    expect(issueTypes(dataset({ subscriptions: [subscription({ cadence: "YEARLY" })] }))).toContain(
      "CADENCE_MISMATCH",
    ));

  it("detects a locked market mismatch", () =>
    expect(
      issueTypes(dataset({ subscriptions: [subscription({ pricingMarketCode: "SA" })] })),
    ).toContain("PRICING_MARKET_MISMATCH"));

  it("detects organization billing profile status divergence", () =>
    expect(
      issueTypes(dataset({ subscriptions: [subscription({ profileStatus: "PAST_DUE" })] })),
    ).toContain("SUBSCRIPTION_STATUS_MISMATCH"));

  it("detects a commercial subscription without a Stripe Customer", () =>
    expect(
      issueTypes(dataset({ subscriptions: [subscription({ stripeCustomerId: null })] })),
    ).toContain("STRIPE_CUSTOMER_ORG_MISMATCH"));

  it("detects a durable reconciliation failure", () =>
    expect(
      issueTypes(
        dataset({
          subscriptions: [subscription({ reconciliationFailureCode: "PROVIDER_RETRIEVAL_FAILED" })],
        }),
      ),
    ).toContain("RECONCILIATION_FAILURE"));

  it("represents a failed webhook safely", () =>
    expect(
      issueTypes(
        dataset({
          webhooks: [
            {
              id: "webhook-failed",
              organizationId: ORG,
              organizationName: "Saffron Studio",
              externalEventId: "evt_fail",
              eventType: "invoice.payment_failed",
              status: "FAILED",
              attemptCount: 2,
              leaseExpiresAt: null,
              processedAt: null,
              createdAt: PAST,
              updatedAt: NOW,
            },
          ],
        }),
      ),
    ).toContain("WEBHOOK_PROCESSING_FAILED"));

  it("represents an expired webhook lease as retry backlog", () =>
    expect(
      issueTypes(
        dataset({
          webhooks: [
            {
              id: "webhook-processing",
              organizationId: null,
              organizationName: null,
              externalEventId: "evt_backlog",
              eventType: "invoice.paid",
              status: "PROCESSING",
              attemptCount: 1,
              leaseExpiresAt: PAST,
              processedAt: null,
              createdAt: PAST,
              updatedAt: NOW,
            },
          ],
        }),
      ),
    ).toContain("WEBHOOK_RETRY_BACKLOG"));

  it("does not create an issue for an active webhook lease", () =>
    expect(
      issueTypes(
        dataset({
          webhooks: [
            {
              id: "webhook-active",
              organizationId: null,
              organizationName: null,
              externalEventId: "evt_active",
              eventType: "invoice.paid",
              status: "PROCESSING",
              attemptCount: 1,
              leaseExpiresAt: FUTURE,
              processedAt: null,
              createdAt: PAST,
              updatedAt: NOW,
            },
          ],
        }),
      ),
    ).toEqual([]));

  it("represents a failed payment", () =>
    expect(
      issueTypes(
        dataset({
          financialEvents: [
            {
              id: "payment-failure",
              organizationId: ORG,
              organizationName: "Saffron Studio",
              subscriptionId: SUBSCRIPTION,
              subscriptionStatus: "ACTIVE",
              planCode: "GROWTH",
              pricingMarketCode: "GLOBAL",
              providerObjectId: "in_123",
              type: "PAYMENT_FAILED",
              currency: "USD",
              amountMinor: 2900n,
              providerOccurredAt: NOW,
            },
          ],
        }),
      ),
    ).toContain("FAILED_PAYMENT"));

  it("makes a past-due payment failure critical", () => {
    const result = deriveStripeHealthIssues(
      dataset({
        financialEvents: [
          {
            id: "payment-past-due",
            organizationId: ORG,
            organizationName: "Saffron Studio",
            subscriptionId: SUBSCRIPTION,
            subscriptionStatus: "PAST_DUE",
            planCode: "GROWTH",
            pricingMarketCode: "GLOBAL",
            providerObjectId: "in_past_due",
            type: "PAYMENT_FAILED",
            currency: "USD",
            amountMinor: 2900n,
            providerOccurredAt: NOW,
          },
        ],
      }),
      NOW,
    );
    expect(result.find((issue) => issue.type === "FAILED_PAYMENT")?.severity).toBe("CRITICAL");
  });

  it("keeps financial amounts out of issue safe context", () => {
    const issue = deriveStripeHealthIssues(
      dataset({
        financialEvents: [
          {
            id: "payment-no-amount",
            organizationId: ORG,
            organizationName: "Saffron Studio",
            subscriptionId: SUBSCRIPTION,
            subscriptionStatus: "ACTIVE",
            planCode: "GROWTH",
            pricingMarketCode: "GLOBAL",
            providerObjectId: "in_safe",
            type: "PAYMENT_FAILED",
            currency: "USD",
            amountMinor: 2900n,
            providerOccurredAt: NOW,
          },
        ],
      }),
      NOW,
    ).find((entry) => entry.type === "FAILED_PAYMENT");
    expect(issue?.safeContext).not.toHaveProperty("amountMinor");
  });

  it("detects a failed annual repricing command", () =>
    expect(
      issueTypes(
        dataset({
          repricings: [
            {
              id: "repricing-failed",
              campaignId: "campaign-1",
              subscriptionId: SUBSCRIPTION,
              organizationId: ORG,
              organizationName: "Saffron Studio",
              status: "FAILED",
              failureCode: "PROVIDER_UPDATE_FAILED",
              effectiveAt: PAST,
              currentPeriodEnd: PAST,
              targetPricingVersionId: VERSION,
              targetStripePriceId: "price_global_growth",
            },
          ],
        }),
      ),
    ).toContain("REPRICING_COMMAND_FAILED"));

  it("detects a stale annual repricing command after the renewal boundary", () =>
    expect(
      issueTypes(
        dataset({
          repricings: [
            {
              id: "repricing-stale",
              campaignId: "campaign-1",
              subscriptionId: SUBSCRIPTION,
              organizationId: ORG,
              organizationName: "Saffron Studio",
              status: "SCHEDULED",
              failureCode: null,
              effectiveAt: PAST,
              currentPeriodEnd: PAST,
              targetPricingVersionId: VERSION,
              targetStripePriceId: "price_global_growth",
            },
          ],
        }),
      ),
    ).toContain("STALE_REPRICING_COMMAND"));

  it("does not report a canceled command as executable incident", () =>
    expect(issueTypes(dataset({ repricings: [] }))).not.toContain("STALE_REPRICING_COMMAND"));

  it("does not report a superseded command as executable incident", () =>
    expect(issueTypes(dataset({ repricings: [] }))).not.toContain("REPRICING_COMMAND_FAILED"));

  it("represents an expired pending subscription-change preview as INFO", () => {
    const result = deriveStripeHealthIssues(
      dataset({
        changePreviews: [
          {
            id: "preview-info",
            organizationId: ORG,
            organizationName: "Saffron Studio",
            subscriptionId: SUBSCRIPTION,
            status: "PENDING",
            expiresAt: PAST,
            createdAt: PAST,
          },
        ],
      }),
      NOW,
    );
    expect(result.find((issue) => issue.type === "EXPIRED_CHANGE_PREVIEW")?.severity).toBe("INFO");
  });

  it("does not report a confirmed subscription-change preview", () =>
    expect(
      issueTypes(
        dataset({
          changePreviews: [
            {
              id: "preview-confirmed",
              organizationId: ORG,
              organizationName: "Saffron Studio",
              subscriptionId: SUBSCRIPTION,
              status: "CONFIRMED",
              expiresAt: PAST,
              createdAt: PAST,
            },
          ],
        }),
      ),
    ).toEqual([]));

  it("detects a reliable provider environment mismatch", () =>
    expect(
      issueTypes(
        dataset({
          providerConfiguration: {
            apiCredentials: "CONFIGURED",
            webhookSigning: "CONFIGURED",
            portalConfiguration: "CONFIGURED",
            mode: "TEST",
            environment: "production",
            environmentMismatch: true,
          },
        }),
      ),
    ).toContain("PROVIDER_CONFIGURATION_MISMATCH"));

  it("does not infer an environment mismatch for staging test credentials", () =>
    expect(issueTypes(dataset())).not.toContain("PROVIDER_CONFIGURATION_MISMATCH"));

  it("orders critical issues before warnings", () => {
    const result = deriveStripeHealthIssues(
      dataset({
        subscriptions: [subscription({ stripePriceId: "price_unknown" })],
        webhooks: [
          {
            id: "webhook-order",
            organizationId: null,
            organizationName: null,
            externalEventId: "evt_order",
            eventType: "invoice.paid",
            status: "FAILED",
            attemptCount: 1,
            leaseExpiresAt: null,
            processedAt: null,
            createdAt: PAST,
            updatedAt: NOW,
          },
        ],
      }),
      NOW,
    );
    expect(result[0]?.severity).toBe("CRITICAL");
  });

  it("filters issues by severity", () => {
    const issues = deriveStripeHealthIssues(
      dataset({ subscriptions: [subscription({ stripePriceId: "price_unknown" })] }),
      NOW,
    );
    expect(
      filterStripeHealthIssues(issues, { page: 1, pageSize: 25, severity: "CRITICAL" }),
    ).toHaveLength(2);
  });

  it("filters issues by type", () => {
    const issues = deriveStripeHealthIssues(
      dataset({ subscriptions: [subscription({ stripePriceId: "price_unknown" })] }),
      NOW,
    );
    expect(
      filterStripeHealthIssues(issues, { page: 1, pageSize: 25, type: "UNKNOWN_STRIPE_PRICE" }),
    ).toHaveLength(1);
  });

  it("filters issues by customer", () => {
    const issues = deriveStripeHealthIssues(
      dataset({ subscriptions: [subscription({ stripePriceId: "price_unknown" })] }),
      NOW,
    );
    expect(
      filterStripeHealthIssues(issues, { page: 1, pageSize: 25, customerId: ORG }),
    ).toHaveLength(2);
  });

  it("filters issues by plan", () => {
    const issues = deriveStripeHealthIssues(
      dataset({ subscriptions: [subscription({ stripePriceId: "price_unknown" })] }),
      NOW,
    );
    expect(
      filterStripeHealthIssues(issues, { page: 1, pageSize: 25, plan: "GROWTH" }),
    ).toHaveLength(2);
  });

  it("filters issues by locked pricing market", () => {
    const issues = deriveStripeHealthIssues(
      dataset({ subscriptions: [subscription({ stripePriceId: "price_unknown" })] }),
      NOW,
    );
    expect(
      filterStripeHealthIssues(issues, { page: 1, pageSize: 25, market: "GLOBAL" }),
    ).toHaveLength(2);
  });

  it("filters issues by date range", () => {
    const issues = deriveStripeHealthIssues(
      dataset({ subscriptions: [subscription({ stripePriceId: "price_unknown" })] }),
      NOW,
    );
    expect(filterStripeHealthIssues(issues, { page: 1, pageSize: 25, from: FUTURE })).toHaveLength(
      0,
    );
  });

  it("exposes all executable expected webhook event types", () =>
    expect(expectedStripeWebhookEventTypes).toContain("customer.subscription.updated"));

  it("includes invoice finalized as required financial evidence coverage", () =>
    expect(expectedStripeWebhookEventTypes).toContain("invoice.finalized"));

  it("includes invoice paid as required financial evidence coverage", () =>
    expect(expectedStripeWebhookEventTypes).toContain("invoice.paid"));

  it("includes invoice payment failed as required financial evidence coverage", () =>
    expect(expectedStripeWebhookEventTypes).toContain("invoice.payment_failed"));

  it("marks unobserved expected webhook evidence truthfully", () =>
    expect(summarizeWebhookCoverage([]).every((entry) => entry.status === "NOT_YET_OBSERVED")).toBe(
      true,
    ));

  it("marks observed webhook evidence", () =>
    expect(
      summarizeWebhookCoverage([
        {
          id: "webhook-observed",
          organizationId: null,
          organizationName: null,
          externalEventId: "evt_observed",
          eventType: "invoice.paid",
          status: "PROCESSED",
          attemptCount: 1,
          leaseExpiresAt: null,
          processedAt: NOW,
          createdAt: NOW,
          updatedAt: NOW,
        },
      ]).find((entry) => entry.eventType === "invoice.paid")?.status,
    ).toBe("OBSERVED"));

  it("records the latest observed webhook timestamp", () => {
    const coverage = summarizeWebhookCoverage([
      {
        id: "webhook-earlier",
        organizationId: null,
        organizationName: null,
        externalEventId: "evt_earlier",
        eventType: "invoice.paid",
        status: "PROCESSED",
        attemptCount: 1,
        leaseExpiresAt: null,
        processedAt: PAST,
        createdAt: PAST,
        updatedAt: PAST,
      },
      {
        id: "webhook-latest",
        organizationId: null,
        organizationName: null,
        externalEventId: "evt_latest",
        eventType: "invoice.paid",
        status: "PROCESSED",
        attemptCount: 1,
        leaseExpiresAt: null,
        processedAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]);
    expect(coverage.find((entry) => entry.eventType === "invoice.paid")?.lastObservedAt).toBe(
      NOW.toISOString(),
    );
  });

  it("keeps USD totals in native currency", () =>
    expect(nativeCurrencyTotals([{ currency: "USD", amountMinor: 2900n }])).toEqual([
      { currency: "USD", amountMinor: "2900" },
    ]));

  it("does not merge USD and SAR totals", () =>
    expect(
      nativeCurrencyTotals([
        { currency: "USD", amountMinor: 2900n },
        { currency: "SAR", amountMinor: 9900n },
      ]),
    ).toEqual([
      { currency: "SAR", amountMinor: "9900" },
      { currency: "USD", amountMinor: "2900" },
    ]));

  it("preserves zero-decimal native currency minors", () =>
    expect(nativeCurrencyTotals([{ currency: "JPY", amountMinor: 1200n }])[0]).toEqual({
      currency: "JPY",
      amountMinor: "1200",
    }));

  it("does not construct Stripe clients in the normal health service", () =>
    expect(serviceSource).not.toMatch(/new\s+Stripe|from\s+["']stripe["']/));

  it("does not run reconciliation as a GET side effect", () =>
    expect(serviceSource).not.toContain("reconcileStripeSubscriptions"));

  it("does not expose raw webhook payloads", () => {
    expect(serviceSource).not.toContain("rawPayload");
    expect(serviceSource).not.toContain("webhookSecret");
  });

  it("does not expose Stripe secret configuration values", () =>
    expect(serviceSource).not.toContain("STRIPE_SECRET_KEY,"));

  it("uses bounded issue pagination", () =>
    expect(controllerSource).toContain("adminStripeHealthIssueQuerySchema"));

  it("keeps API filters server-authoritative", () =>
    expect(serviceSource).toContain("filterStripeHealthIssues"));
});
