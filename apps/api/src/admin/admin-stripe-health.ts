import { z } from "zod";

export const stripeHealthSeverities = ["HEALTHY", "INFO", "WARNING", "CRITICAL"] as const;
export type StripeHealthSeverity = (typeof stripeHealthSeverities)[number];

export const stripeHealthIssueTypes = [
  "UNKNOWN_STRIPE_PRICE",
  "STRIPE_PRICE_BINDING_MISMATCH",
  "MISSING_PRICING_BINDING",
  "PRICE_AMOUNT_MISMATCH",
  "PRICE_CURRENCY_MISMATCH",
  "PLAN_MISMATCH",
  "CADENCE_MISMATCH",
  "PRICING_MARKET_MISMATCH",
  "MISSING_PRICING_SNAPSHOT",
  "STRIPE_CUSTOMER_ORG_MISMATCH",
  "SUBSCRIPTION_STATUS_MISMATCH",
  "RECONCILIATION_FAILURE",
  "WEBHOOK_PROCESSING_FAILED",
  "WEBHOOK_RETRY_BACKLOG",
  "FAILED_PAYMENT",
  "STALE_REPRICING_COMMAND",
  "REPRICING_COMMAND_FAILED",
  "EXPIRED_CHANGE_PREVIEW",
  "PROVIDER_CONFIGURATION_MISMATCH",
] as const;
export type StripeHealthIssueType = (typeof stripeHealthIssueTypes)[number];

export const expectedStripeWebhookEventTypes = [
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.finalized",
  "invoice.paid",
  "invoice.payment_failed",
] as const;

export const adminStripeHealthIssueQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    severity: z.enum(stripeHealthSeverities).optional(),
    type: z.enum(stripeHealthIssueTypes).optional(),
    customerId: z.uuid().optional(),
    plan: z.enum(["STARTER", "GROWTH", "SCALE"]).optional(),
    market: z.string().trim().min(1).max(32).toUpperCase().optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .strict()
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: "The issue date range is invalid.",
    path: ["to"],
  });

export type AdminStripeHealthIssueQuery = z.output<typeof adminStripeHealthIssueQuerySchema>;

type HealthSubscription = {
  id: string;
  organizationId: string;
  organizationName: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string;
  stripePriceId: string;
  pricingVersionId: string | null;
  pricingMarketCode: string | null;
  pricingCurrency: string | null;
  pricingAmountMinor: bigint | null;
  planCode: string;
  cadence: string;
  status: string;
  profileStatus: string | null;
  currentPeriodEnd: Date | null;
  lastProviderSyncAt: Date | null;
  reconciliationLeaseExpiresAt: Date | null;
  reconciliationFailureCode: string | null;
};

type HealthPricingVersion = {
  id: string;
  stripePriceId: string | null;
  currency: string;
  amountMinor: bigint;
  planCode: string;
  cadence: string;
  status: string;
  marketCode: string;
  publishedAt: Date | null;
};

type HealthWebhook = {
  id: string;
  organizationId: string | null;
  organizationName: string | null;
  externalEventId: string;
  eventType: string;
  status: "PROCESSING" | "PROCESSED" | "FAILED" | "IGNORED_STALE";
  attemptCount: number;
  leaseExpiresAt: Date | null;
  processedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type HealthFinancialEvent = {
  id: string;
  organizationId: string;
  organizationName: string;
  subscriptionId: string;
  subscriptionStatus: string;
  planCode: string | null;
  pricingMarketCode: string | null;
  providerObjectId: string;
  type: "BILLED" | "COLLECTED" | "PAYMENT_FAILED";
  currency: string;
  amountMinor: bigint;
  providerOccurredAt: Date;
};

type HealthRepricing = {
  id: string;
  campaignId: string | null;
  subscriptionId: string;
  organizationId: string;
  organizationName: string;
  status: "SCHEDULED" | "APPLIED" | "CANCELED" | "SUPERSEDED" | "FAILED";
  failureCode: string | null;
  effectiveAt: Date;
  currentPeriodEnd: Date | null;
  targetPricingVersionId: string;
  targetStripePriceId: string | null;
};

type HealthPreview = {
  id: string;
  organizationId: string;
  organizationName: string;
  subscriptionId: string;
  status: "PENDING" | "CONFIRMED" | "EXPIRED" | "INVALIDATED";
  expiresAt: Date;
  createdAt: Date;
};

export interface StripeHealthIssue {
  id: string;
  type: StripeHealthIssueType;
  severity: Exclude<StripeHealthSeverity, "HEALTHY">;
  title: string;
  summary: string;
  firstSeenAt: string;
  lastSeenAt: string;
  customer: { id: string; name: string } | null;
  subscription: {
    id: string;
    stripeSubscriptionReference: string;
    plan: string;
    status: string;
  } | null;
  pricing: {
    pricingVersionId: string | null;
    market: string | null;
    stripePriceReference: string | null;
  } | null;
  repricingCampaignId: string | null;
  safeContext: Readonly<Record<string, string | number | boolean | null>>;
}

export interface StripeHealthDataset {
  subscriptions: readonly HealthSubscription[];
  pricingVersions: readonly HealthPricingVersion[];
  webhooks: readonly HealthWebhook[];
  financialEvents: readonly HealthFinancialEvent[];
  repricings: readonly HealthRepricing[];
  changePreviews: readonly HealthPreview[];
  providerConfiguration: {
    apiCredentials: "CONFIGURED" | "MISSING";
    webhookSigning: "CONFIGURED" | "MISSING";
    portalConfiguration: "CONFIGURED" | "MISSING";
    mode: "TEST" | "LIVE" | "UNKNOWN";
    environment: "development" | "test" | "staging" | "production";
    environmentMismatch: boolean;
  };
  financialEvidence: {
    ledgerStartedAt: Date | null;
    latestEvidenceAt: Date | null;
  };
}

const commercialStatuses = new Set(["ACTIVE", "TRIALING", "PAST_DUE", "GRACE_PERIOD"]);

function occurrence(value: Date): string {
  return value.toISOString();
}

function issueId(type: StripeHealthIssueType, sourceId: string): string {
  return `${type}:${sourceId}`;
}

function issue(
  type: StripeHealthIssueType,
  severity: Exclude<StripeHealthSeverity, "HEALTHY">,
  title: string,
  summary: string,
  seenAt: Date,
  related: Pick<StripeHealthIssue, "customer" | "subscription" | "pricing">,
  context: Readonly<Record<string, string | number | boolean | null>>,
  sourceId: string,
  repricingCampaignId: string | null = null,
): StripeHealthIssue {
  return {
    id: issueId(type, sourceId),
    type,
    severity,
    title,
    summary,
    firstSeenAt: occurrence(seenAt),
    lastSeenAt: occurrence(seenAt),
    ...related,
    repricingCampaignId,
    safeContext: context,
  };
}

function relatedSubscription(subscription: HealthSubscription) {
  return {
    customer: { id: subscription.organizationId, name: subscription.organizationName },
    subscription: {
      id: subscription.id,
      stripeSubscriptionReference: subscription.stripeSubscriptionId,
      plan: subscription.planCode,
      status: subscription.status,
    },
    pricing: {
      pricingVersionId: subscription.pricingVersionId,
      market: subscription.pricingMarketCode,
      stripePriceReference: subscription.stripePriceId,
    },
  };
}

function subscriptionIssueTime(subscription: HealthSubscription, now: Date): Date {
  return subscription.lastProviderSyncAt ?? now;
}

function subscriptionHasSnapshot(subscription: HealthSubscription): boolean {
  return Boolean(
    subscription.pricingVersionId &&
      subscription.pricingMarketCode &&
      subscription.pricingCurrency &&
      subscription.pricingAmountMinor !== null,
  );
}

export function deriveStripeHealthIssues(dataset: StripeHealthDataset, now = new Date()) {
  const byVersion = new Map(dataset.pricingVersions.map((version) => [version.id, version]));
  const byStripePrice = new Map(
    dataset.pricingVersions
      .filter((version): version is HealthPricingVersion & { stripePriceId: string } =>
        Boolean(version.stripePriceId),
      )
      .map((version) => [version.stripePriceId, version]),
  );
  const issues: StripeHealthIssue[] = [];

  for (const version of dataset.pricingVersions) {
    if (version.status !== "ACTIVE_FOR_NEW_SUBSCRIPTIONS" || version.stripePriceId) continue;
    issues.push(
      issue(
        "MISSING_PRICING_BINDING",
        "CRITICAL",
        "Published price has no Stripe binding",
        "This active Waflo pricing version cannot safely be used for new Checkout sessions.",
        version.publishedAt ?? now,
        {
          customer: null,
          subscription: null,
          pricing: {
            pricingVersionId: version.id,
            market: version.marketCode,
            stripePriceReference: null,
          },
        },
        { market: version.marketCode, plan: version.planCode, cadence: version.cadence },
        version.id,
      ),
    );
  }

  for (const subscription of dataset.subscriptions) {
    const related = relatedSubscription(subscription);
    const seenAt = subscriptionIssueTime(subscription, now);
    const canonical = subscription.pricingVersionId
      ? (byVersion.get(subscription.pricingVersionId) ?? null)
      : null;
    const boundByPrice = byStripePrice.get(subscription.stripePriceId) ?? null;
    if (commercialStatuses.has(subscription.status) && !subscriptionHasSnapshot(subscription)) {
      issues.push(
        issue(
          "MISSING_PRICING_SNAPSHOT",
          "CRITICAL",
          "Subscription has no complete pricing snapshot",
          "The canonical subscription lacks the locked commercial terms needed for safe billing explanations.",
          seenAt,
          related,
          {
            status: subscription.status,
            hasPricingVersion: Boolean(subscription.pricingVersionId),
          },
          subscription.id,
        ),
      );
    }
    if (!boundByPrice) {
      issues.push(
        issue(
          "UNKNOWN_STRIPE_PRICE",
          "CRITICAL",
          "Stripe Price is not bound to Waflo pricing",
          "The subscription references a Stripe Price with no Waflo PricingVersion binding. Entitlements must not be inferred from it.",
          seenAt,
          related,
          {
            stripePriceReference: subscription.stripePriceId,
            subscriptionStatus: subscription.status,
          },
          subscription.id,
        ),
      );
    }
    if (canonical && !canonical.stripePriceId) {
      issues.push(
        issue(
          "MISSING_PRICING_BINDING",
          "CRITICAL",
          "Subscription snapshot points to an unbound pricing version",
          "The subscription's PricingVersion does not have a durable Stripe Price binding.",
          seenAt,
          related,
          { pricingVersionId: canonical.id, market: canonical.marketCode },
          subscription.id,
        ),
      );
    }
    if (canonical?.stripePriceId && canonical.stripePriceId !== subscription.stripePriceId) {
      issues.push(
        issue(
          "STRIPE_PRICE_BINDING_MISMATCH",
          "CRITICAL",
          "Subscription Price differs from its pricing snapshot",
          "The stored Stripe Price does not match the immutable PricingVersion binding.",
          seenAt,
          related,
          {
            expectedStripePriceReference: canonical.stripePriceId,
            observedStripePriceReference: subscription.stripePriceId,
          },
          subscription.id,
        ),
      );
    }
    if (canonical && subscription.pricingCurrency !== canonical.currency) {
      issues.push(
        issue(
          "PRICE_CURRENCY_MISMATCH",
          "CRITICAL",
          "Subscription currency differs from its pricing version",
          "The canonical snapshot currency conflicts with the immutable Waflo pricing contract.",
          seenAt,
          related,
          { expectedCurrency: canonical.currency, observedCurrency: subscription.pricingCurrency },
          subscription.id,
        ),
      );
    }
    if (canonical && subscription.pricingAmountMinor !== canonical.amountMinor) {
      issues.push(
        issue(
          "PRICE_AMOUNT_MISMATCH",
          "CRITICAL",
          "Subscription amount differs from its pricing version",
          "The canonical snapshot amount conflicts with the immutable Waflo pricing contract.",
          seenAt,
          related,
          {
            expectedAmountMinor: canonical.amountMinor.toString(),
            observedAmountMinor: subscription.pricingAmountMinor?.toString() ?? null,
          },
          subscription.id,
        ),
      );
    }
    if (canonical && subscription.planCode !== canonical.planCode) {
      issues.push(
        issue(
          "PLAN_MISMATCH",
          "CRITICAL",
          "Subscription plan differs from its pricing version",
          "The plan recorded on the subscription conflicts with the bound Waflo price.",
          seenAt,
          related,
          { expectedPlan: canonical.planCode, observedPlan: subscription.planCode },
          subscription.id,
        ),
      );
    }
    if (canonical && subscription.cadence !== canonical.cadence) {
      issues.push(
        issue(
          "CADENCE_MISMATCH",
          "CRITICAL",
          "Subscription cadence differs from its pricing version",
          "The cadence recorded on the subscription conflicts with the bound Waflo price.",
          seenAt,
          related,
          { expectedCadence: canonical.cadence, observedCadence: subscription.cadence },
          subscription.id,
        ),
      );
    }
    if (canonical && subscription.pricingMarketCode !== canonical.marketCode) {
      issues.push(
        issue(
          "PRICING_MARKET_MISMATCH",
          "CRITICAL",
          "Subscription market differs from its pricing version",
          "The subscription's locked pricing market conflicts with the immutable price binding.",
          seenAt,
          related,
          { expectedMarket: canonical.marketCode, observedMarket: subscription.pricingMarketCode },
          subscription.id,
        ),
      );
    }
    if (subscription.profileStatus && subscription.profileStatus !== subscription.status) {
      issues.push(
        issue(
          "SUBSCRIPTION_STATUS_MISMATCH",
          "WARNING",
          "Billing profile and subscription status differ",
          "Canonical billing status has not converged across the organization profile and subscription snapshot.",
          seenAt,
          related,
          { profileStatus: subscription.profileStatus, subscriptionStatus: subscription.status },
          subscription.id,
        ),
      );
    }
    if (commercialStatuses.has(subscription.status) && !subscription.stripeCustomerId) {
      issues.push(
        issue(
          "STRIPE_CUSTOMER_ORG_MISMATCH",
          "CRITICAL",
          "Subscription has no canonical Stripe Customer",
          "A commercial subscription cannot be safely associated with its organization without the stored Stripe Customer reference.",
          seenAt,
          related,
          { subscriptionStatus: subscription.status },
          subscription.id,
        ),
      );
    }
    if (subscription.reconciliationFailureCode) {
      issues.push(
        issue(
          "RECONCILIATION_FAILURE",
          "WARNING",
          "Subscription reconciliation is retrying",
          "The most recent reconciliation attempt did not converge and remains eligible for retry.",
          seenAt,
          related,
          { failureCode: subscription.reconciliationFailureCode },
          subscription.id,
        ),
      );
    }
  }

  for (const webhook of dataset.webhooks) {
    const related = {
      customer: webhook.organizationId
        ? { id: webhook.organizationId, name: webhook.organizationName ?? "Organization" }
        : null,
      subscription: null,
      pricing: null,
    };
    if (webhook.status === "FAILED") {
      issues.push(
        issue(
          "WEBHOOK_PROCESSING_FAILED",
          "WARNING",
          "Webhook event failed processing",
          "The event is retained for retry; the diagnostic does not expose the provider payload.",
          webhook.updatedAt,
          related,
          { eventType: webhook.eventType, attempts: webhook.attemptCount },
          webhook.id,
        ),
      );
    }
    if (
      webhook.status === "PROCESSING" &&
      (!webhook.leaseExpiresAt || webhook.leaseExpiresAt <= now)
    ) {
      issues.push(
        issue(
          "WEBHOOK_RETRY_BACKLOG",
          "WARNING",
          "Webhook event is awaiting a retry claim",
          "Its processing lease is no longer active, so the event requires normal retry processing.",
          webhook.updatedAt,
          related,
          { eventType: webhook.eventType, attempts: webhook.attemptCount },
          webhook.id,
        ),
      );
    }
  }

  for (const event of dataset.financialEvents) {
    if (event.type !== "PAYMENT_FAILED") continue;
    issues.push(
      issue(
        "FAILED_PAYMENT",
        event.subscriptionStatus === "PAST_DUE" ? "CRITICAL" : "WARNING",
        "Payment failed",
        "Verified invoice evidence recorded a failed payment. Use Customer 360 to review the canonical billing state.",
        event.providerOccurredAt,
        {
          customer: { id: event.organizationId, name: event.organizationName },
          subscription: {
            id: event.subscriptionId,
            stripeSubscriptionReference: "Stored subscription reference",
            plan: event.planCode ?? "UNKNOWN",
            status: event.subscriptionStatus,
          },
          pricing: {
            pricingVersionId: null,
            market: event.pricingMarketCode,
            stripePriceReference: null,
          },
        },
        { invoiceReference: event.providerObjectId, currency: event.currency },
        event.id,
      ),
    );
  }

  for (const command of dataset.repricings) {
    const related = {
      customer: { id: command.organizationId, name: command.organizationName },
      subscription: {
        id: command.subscriptionId,
        stripeSubscriptionReference: "Stored subscription reference",
        plan: "UNKNOWN",
        status: "UNKNOWN",
      },
      pricing: {
        pricingVersionId: command.targetPricingVersionId,
        market: null,
        stripePriceReference: command.targetStripePriceId,
      },
    };
    if (command.status === "FAILED") {
      issues.push(
        issue(
          "REPRICING_COMMAND_FAILED",
          "WARNING",
          "Annual repricing command failed",
          "The command remains durable for operational review; this health surface does not force a commercial transition.",
          command.effectiveAt,
          related,
          { failureCode: command.failureCode, commandStatus: command.status },
          command.id,
          command.campaignId,
        ),
      );
    }
    if (
      command.status === "SCHEDULED" &&
      command.effectiveAt <= now &&
      command.currentPeriodEnd !== null &&
      command.currentPeriodEnd <= now
    ) {
      issues.push(
        issue(
          "STALE_REPRICING_COMMAND",
          "WARNING",
          "Scheduled annual repricing is past its expected renewal window",
          "The command has not executed after its effective date and known renewal boundary.",
          command.currentPeriodEnd,
          related,
          {
            effectiveAt: occurrence(command.effectiveAt),
            expectedRenewalAt: occurrence(command.currentPeriodEnd),
          },
          command.id,
          command.campaignId,
        ),
      );
    }
  }

  for (const preview of dataset.changePreviews) {
    if (preview.status !== "PENDING" || preview.expiresAt > now) continue;
    issues.push(
      issue(
        "EXPIRED_CHANGE_PREVIEW",
        "INFO",
        "Expired subscription-change preview remains pending",
        "This is a non-commercial cleanup signal. It does not indicate that a subscription was changed.",
        preview.expiresAt,
        {
          customer: { id: preview.organizationId, name: preview.organizationName },
          subscription: {
            id: preview.subscriptionId,
            stripeSubscriptionReference: "Stored subscription reference",
            plan: "UNKNOWN",
            status: "UNKNOWN",
          },
          pricing: null,
        },
        { previewStatus: preview.status },
        preview.id,
      ),
    );
  }

  if (dataset.providerConfiguration.environmentMismatch) {
    issues.push(
      issue(
        "PROVIDER_CONFIGURATION_MISMATCH",
        "CRITICAL",
        "Stripe provider mode does not match the deployment environment",
        "The configured provider mode is inconsistent with this Waflo deployment and must be corrected before billing operations continue.",
        now,
        { customer: null, subscription: null, pricing: null },
        {
          providerMode: dataset.providerConfiguration.mode,
          deploymentEnvironment: dataset.providerConfiguration.environment,
        },
        "configuration",
      ),
    );
  }

  return issues.sort((left, right) => {
    const severity = { CRITICAL: 0, WARNING: 1, INFO: 2 } as const;
    const severityDifference = severity[left.severity] - severity[right.severity];
    if (severityDifference !== 0) return severityDifference;
    return right.lastSeenAt.localeCompare(left.lastSeenAt);
  });
}

export function stripeHealthOverallSeverity(
  issues: readonly Pick<StripeHealthIssue, "severity">[],
): StripeHealthSeverity {
  if (issues.some((entry) => entry.severity === "CRITICAL")) return "CRITICAL";
  if (issues.some((entry) => entry.severity === "WARNING")) return "WARNING";
  if (issues.some((entry) => entry.severity === "INFO")) return "INFO";
  return "HEALTHY";
}

export function filterStripeHealthIssues(
  issues: readonly StripeHealthIssue[],
  query: AdminStripeHealthIssueQuery,
) {
  return issues.filter((entry) => {
    if (query.severity && entry.severity !== query.severity) return false;
    if (query.type && entry.type !== query.type) return false;
    if (query.customerId && entry.customer?.id !== query.customerId) return false;
    if (query.plan && entry.subscription?.plan !== query.plan) return false;
    if (query.market && entry.pricing?.market !== query.market) return false;
    const lastSeen = new Date(entry.lastSeenAt);
    if (query.from && lastSeen < query.from) return false;
    if (query.to && lastSeen > query.to) return false;
    return true;
  });
}

export function summarizeWebhookCoverage(webhooks: readonly HealthWebhook[]) {
  return expectedStripeWebhookEventTypes.map((eventType) => {
    const matching = webhooks.filter((event) => event.eventType === eventType);
    const latest = matching.reduce<Date | null>(
      (current, event) => (!current || event.createdAt > current ? event.createdAt : current),
      null,
    );
    return {
      eventType,
      observedCount: matching.length,
      lastObservedAt: latest?.toISOString() ?? null,
      status: matching.length ? "OBSERVED" : "NOT_YET_OBSERVED",
    };
  });
}

export function nativeCurrencyTotals(
  events: readonly Pick<HealthFinancialEvent, "currency" | "amountMinor">[],
) {
  const grouped = new Map<string, bigint>();
  for (const event of events) {
    grouped.set(event.currency, (grouped.get(event.currency) ?? 0n) + event.amountMinor);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, amountMinor]) => ({ currency, amountMinor: amountMinor.toString() }));
}
