import { HttpStatus, Injectable } from "@nestjs/common";
import { AppError } from "../common/app-error.js";
import { EnvironmentService } from "../config/environment.service.js";
import { PrismaService } from "../database/prisma.service.js";
import {
  type AdminStripeHealthIssueQuery,
  deriveStripeHealthIssues,
  filterStripeHealthIssues,
  nativeCurrencyTotals,
  type StripeHealthDataset,
  stripeHealthOverallSeverity,
  summarizeWebhookCoverage,
} from "./admin-stripe-health.js";

type FinancePolicy = { canViewFinance: boolean };

function date(value: Date | null | undefined): string | null {
  return value?.toISOString() ?? null;
}

function latest(values: readonly (Date | null)[]): Date | null {
  return values.reduce<Date | null>(
    (current, value) => (!value || (current && value <= current) ? current : value),
    null,
  );
}

function providerMode(secret: string | undefined): "TEST" | "LIVE" | "UNKNOWN" {
  if (secret?.startsWith("sk_test_")) return "TEST";
  if (secret?.startsWith("sk_live_")) return "LIVE";
  return "UNKNOWN";
}

function configuration(
  values: EnvironmentService["values"],
): StripeHealthDataset["providerConfiguration"] {
  const mode = providerMode(values.STRIPE_SECRET_KEY);
  return {
    apiCredentials:
      values.STRIPE_SECRET_KEY && values.STRIPE_PUBLISHABLE_KEY ? "CONFIGURED" : "MISSING",
    webhookSigning: values.STRIPE_WEBHOOK_SECRET ? "CONFIGURED" : "MISSING",
    portalConfiguration: values.STRIPE_CUSTOMER_PORTAL_CONFIGURATION_ID ? "CONFIGURED" : "MISSING",
    mode,
    environment: values.DEPLOYMENT_ENVIRONMENT,
    environmentMismatch:
      (values.DEPLOYMENT_ENVIRONMENT === "production" && mode !== "LIVE") ||
      (values.DEPLOYMENT_ENVIRONMENT === "staging" && mode === "LIVE"),
  };
}

function isIssueId(value: string): boolean {
  const [type, source, extra] = value.split(":");
  return Boolean(
    type &&
      source &&
      !extra &&
      /^[A-Z_]{3,80}$/u.test(type) &&
      /^[A-Za-z0-9_-]{1,128}$/u.test(source),
  );
}

@Injectable()
export class AdminStripeHealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly environment: EnvironmentService,
  ) {}

  async overview(policy: FinancePolicy, now = new Date()) {
    const [snapshot, latestReconciliationRun] = await Promise.all([
      this.snapshot(now),
      this.prisma.client.stripeReconciliationRun.findFirst({
        orderBy: { startedAt: "desc" },
        select: {
          id: true,
          status: true,
          startedAt: true,
          completedAt: true,
          subscriptionsScanned: true,
          subscriptionsConverged: true,
          subscriptionsFailed: true,
          safeFailureCode: true,
        },
      }),
    ]);
    const issues = deriveStripeHealthIssues(snapshot, now);
    const paymentFailures = snapshot.financialEvents
      .filter((event) => event.type === "PAYMENT_FAILED")
      .sort(
        (left, right) => right.providerOccurredAt.getTime() - left.providerOccurredAt.getTime(),
      );
    const failedWebhookCount = snapshot.webhooks.filter(
      (event) => event.status === "FAILED",
    ).length;
    const retryableWebhookCount = snapshot.webhooks.filter(
      (event) =>
        event.status === "PROCESSING" && (!event.leaseExpiresAt || event.leaseExpiresAt <= now),
    ).length;
    const reconciliationFailures = snapshot.subscriptions.filter(
      (subscription) => subscription.reconciliationFailureCode !== null,
    ).length;
    const reconciliationIntervalMs =
      this.environment.values.STRIPE_RECONCILIATION_INTERVAL_MINUTES * 60 * 1000;
    const dueForSync = snapshot.subscriptions.filter(
      (subscription) =>
        subscription.lastProviderSyncAt === null ||
        subscription.lastProviderSyncAt.getTime() <= now.getTime() - reconciliationIntervalMs,
    ).length;
    const activeUnboundVersions = snapshot.pricingVersions.filter(
      (version) =>
        version.status === "ACTIVE_FOR_NEW_SUBSCRIPTIONS" && version.stripePriceId === null,
    ).length;
    const critical = issues.filter((entry) => entry.severity === "CRITICAL");
    const warning = issues.filter((entry) => entry.severity === "WARNING");

    return {
      generatedAt: now.toISOString(),
      overall: {
        severity: stripeHealthOverallSeverity(issues),
        criticalCount: critical.length,
        warningCount: warning.length,
        infoCount: issues.filter((entry) => entry.severity === "INFO").length,
        message:
          critical.length > 0
            ? `${critical.length} critical billing issue${critical.length === 1 ? "" : "s"} require attention.`
            : warning.length > 0
              ? `${warning.length} billing warning${warning.length === 1 ? "" : "s"} need review.`
              : "Stored Waflo billing evidence is healthy.",
      },
      summary: {
        lastWebhookReceivedAt:
          latest(snapshot.webhooks.map((event) => event.createdAt))?.toISOString() ?? null,
        lastWebhookProcessedAt:
          latest(snapshot.webhooks.map((event) => event.processedAt))?.toISOString() ?? null,
        webhookFailures: failedWebhookCount,
        retryableWebhookEvents: retryableWebhookCount,
        lastSuccessfulProviderSyncAt:
          latest(
            snapshot.subscriptions.map((subscription) => subscription.lastProviderSyncAt),
          )?.toISOString() ?? null,
        reconciliationFailures,
        reconciliationDueForSync: dueForSync,
        unknownStripePrices: issues.filter((entry) => entry.type === "UNKNOWN_STRIPE_PRICE").length,
        pricingBindingIssues: issues.filter((entry) =>
          ["MISSING_PRICING_BINDING", "STRIPE_PRICE_BINDING_MISMATCH"].includes(entry.type),
        ).length,
        activeUnboundVersions,
        subscriptionStateMismatches: issues.filter((entry) =>
          [
            "MISSING_PRICING_SNAPSHOT",
            "SUBSCRIPTION_STATUS_MISMATCH",
            "PRICE_AMOUNT_MISMATCH",
            "PRICE_CURRENCY_MISMATCH",
            "PLAN_MISMATCH",
            "CADENCE_MISMATCH",
            "PRICING_MARKET_MISMATCH",
            "STRIPE_CUSTOMER_ORG_MISMATCH",
          ].includes(entry.type),
        ).length,
        missingPricingSnapshots: issues.filter((entry) => entry.type === "MISSING_PRICING_SNAPSHOT")
          .length,
        failedPayments: paymentFailures.length,
        pastDueSubscriptions: snapshot.subscriptions.filter((entry) => entry.status === "PAST_DUE")
          .length,
        repricingFailures: issues.filter((entry) =>
          ["REPRICING_COMMAND_FAILED", "STALE_REPRICING_COMMAND"].includes(entry.type),
        ).length,
        expiredChangePreviews: issues.filter((entry) => entry.type === "EXPIRED_CHANGE_PREVIEW")
          .length,
      },
      webhooks: {
        lastReceivedAt:
          latest(snapshot.webhooks.map((event) => event.createdAt))?.toISOString() ?? null,
        lastProcessedAt:
          latest(snapshot.webhooks.map((event) => event.processedAt))?.toISOString() ?? null,
        failedCount: failedWebhookCount,
        retryableCount: retryableWebhookCount,
        replayedCount: snapshot.webhooks.filter((event) => event.attemptCount > 1).length,
        ignoredStaleCount: snapshot.webhooks.filter((event) => event.status === "IGNORED_STALE")
          .length,
        coverage: summarizeWebhookCoverage(snapshot.webhooks),
        recent: snapshot.webhooks
          .slice()
          .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
          .slice(0, 12)
          .map((event) => ({
            eventReference: event.externalEventId,
            eventType: event.eventType,
            status: event.status,
            attempts: event.attemptCount,
            receivedAt: event.createdAt.toISOString(),
            processedAt: date(event.processedAt),
            organization: event.organizationId
              ? { id: event.organizationId, name: event.organizationName ?? "Organization" }
              : null,
          })),
      },
      reconciliation: {
        lastRunAt: latestReconciliationRun?.completedAt?.toISOString() ?? null,
        lastSuccessfulProviderSyncAt:
          latest(snapshot.subscriptions.map((entry) => entry.lastProviderSyncAt))?.toISOString() ??
          null,
        failureCount: reconciliationFailures,
        dueForSyncCount: dueForSync,
        activeLeases: snapshot.subscriptions.filter(
          (entry) => entry.reconciliationLeaseExpiresAt && entry.reconciliationLeaseExpiresAt > now,
        ).length,
        lastRunCoverage: latestReconciliationRun ? "DURABLY_RECORDED" : "NOT_YET_RECORDED",
        latestRun: latestReconciliationRun
          ? {
              id: latestReconciliationRun.id,
              status: latestReconciliationRun.status,
              startedAt: latestReconciliationRun.startedAt.toISOString(),
              completedAt: latestReconciliationRun.completedAt?.toISOString() ?? null,
              subscriptionsScanned: latestReconciliationRun.subscriptionsScanned,
              subscriptionsConverged: latestReconciliationRun.subscriptionsConverged,
              subscriptionsFailed: latestReconciliationRun.subscriptionsFailed,
              safeFailureCode: latestReconciliationRun.safeFailureCode,
            }
          : null,
      },
      catalog: {
        publishedWithoutBinding: activeUnboundVersions,
        unknownStripePriceCount: issues.filter((entry) => entry.type === "UNKNOWN_STRIPE_PRICE")
          .length,
        bindingMismatchCount: issues.filter((entry) =>
          [
            "MISSING_PRICING_BINDING",
            "STRIPE_PRICE_BINDING_MISMATCH",
            "PRICE_AMOUNT_MISMATCH",
            "PRICE_CURRENCY_MISMATCH",
            "PLAN_MISMATCH",
            "CADENCE_MISMATCH",
            "PRICING_MARKET_MISMATCH",
          ].includes(entry.type),
        ).length,
      },
      payments: {
        failedCount: paymentFailures.length,
        pastDueCount: snapshot.subscriptions.filter((entry) => entry.status === "PAST_DUE").length,
        failures: paymentFailures.slice(0, 25).map((event) => ({
          customer: { id: event.organizationId, name: event.organizationName },
          subscriptionId: event.subscriptionId,
          plan: event.planCode,
          invoiceReference: event.providerObjectId,
          currency: event.currency,
          ...(policy.canViewFinance ? { amountMinor: event.amountMinor.toString() } : {}),
          failureAt: event.providerOccurredAt.toISOString(),
          subscriptionStatus: event.subscriptionStatus,
          market: event.pricingMarketCode,
        })),
      },
      financialEvidence: {
        coverage: snapshot.financialEvidence.ledgerStartedAt ? "PARTIAL_COVERAGE" : "NO_EVIDENCE",
        ledgerStartedAt: date(snapshot.financialEvidence.ledgerStartedAt),
        latestEvidenceAt: date(snapshot.financialEvidence.latestEvidenceAt),
        refunds: "NOT_AVAILABLE",
        providerFees: "NOT_AVAILABLE",
        failedPaymentTotals: policy.canViewFinance ? nativeCurrencyTotals(paymentFailures) : [],
      },
      repricing: {
        failedCount: snapshot.repricings.filter((entry) => entry.status === "FAILED").length,
        retryingCount: snapshot.repricings.filter(
          (entry) => entry.status === "SCHEDULED" && entry.failureCode !== null,
        ).length,
        staleCount: issues.filter((entry) => entry.type === "STALE_REPRICING_COMMAND").length,
      },
      providerConfiguration: snapshot.providerConfiguration,
      criticalIssues: critical.slice(0, 8),
    };
  }

  async issues(query: AdminStripeHealthIssueQuery, now = new Date()) {
    const issues = deriveStripeHealthIssues(await this.snapshot(now), now);
    const filtered = filterStripeHealthIssues(issues, query);
    const start = (query.page - 1) * query.pageSize;
    return {
      page: query.page,
      pageSize: query.pageSize,
      totalCount: filtered.length,
      totalPages: Math.max(1, Math.ceil(filtered.length / query.pageSize)),
      items: filtered.slice(start, start + query.pageSize),
    };
  }

  async issue(issueId: string, now = new Date()) {
    if (!isIssueId(issueId)) {
      throw new AppError(
        "ADMIN_STRIPE_HEALTH_ISSUE_NOT_FOUND",
        "The billing health issue was not found.",
        HttpStatus.NOT_FOUND,
      );
    }
    const result = deriveStripeHealthIssues(await this.snapshot(now), now).find(
      (entry) => entry.id === issueId,
    );
    if (!result) {
      throw new AppError(
        "ADMIN_STRIPE_HEALTH_ISSUE_NOT_FOUND",
        "The billing health issue was not found.",
        HttpStatus.NOT_FOUND,
      );
    }
    return result;
  }

  async webhooks() {
    return (await this.overview({ canViewFinance: false })).webhooks;
  }

  async reconciliation() {
    return (await this.overview({ canViewFinance: false })).reconciliation;
  }

  async payments(policy: FinancePolicy) {
    return (await this.overview(policy)).payments;
  }

  async catalog() {
    return (await this.overview({ canViewFinance: false })).catalog;
  }

  private async snapshot(now: Date): Promise<StripeHealthDataset> {
    const [
      subscriptions,
      pricingVersions,
      webhooks,
      financialEvents,
      repricings,
      changePreviews,
      financialEvidenceBounds,
    ] = await Promise.all([
      this.prisma.client.subscription.findMany({
        select: {
          id: true,
          organizationId: true,
          stripeSubscriptionId: true,
          stripePriceId: true,
          pricingVersionId: true,
          pricingMarketCode: true,
          pricingCurrency: true,
          pricingAmountMinor: true,
          planCode: true,
          cadence: true,
          status: true,
          currentPeriodEnd: true,
          lastProviderSyncAt: true,
          reconciliationLeaseExpiresAt: true,
          reconciliationFailureCode: true,
          organization: {
            select: {
              name: true,
              billingProfile: { select: { stripeCustomerId: true, subscriptionStatus: true } },
            },
          },
        },
      }),
      this.prisma.client.pricingVersion.findMany({
        select: {
          id: true,
          stripePriceId: true,
          currency: true,
          amountMinor: true,
          planCode: true,
          cadence: true,
          status: true,
          publishedAt: true,
          market: { select: { code: true } },
        },
      }),
      this.prisma.client.processedWebhookEvent.findMany({
        select: {
          id: true,
          organizationId: true,
          externalEventId: true,
          eventType: true,
          status: true,
          attemptCount: true,
          leaseExpiresAt: true,
          processedAt: true,
          createdAt: true,
          updatedAt: true,
          organization: { select: { name: true } },
        },
      }),
      this.prisma.client.billingFinancialEvent.findMany({
        where: { type: "PAYMENT_FAILED" },
        select: {
          id: true,
          organizationId: true,
          subscriptionId: true,
          providerObjectId: true,
          type: true,
          currency: true,
          amountMinor: true,
          providerOccurredAt: true,
          planCode: true,
          pricingMarketCode: true,
          organization: { select: { name: true } },
          subscription: { select: { status: true } },
        },
      }),
      this.prisma.client.subscriptionRepricing.findMany({
        where: { status: { in: ["SCHEDULED", "FAILED"] } },
        select: {
          id: true,
          campaignId: true,
          subscriptionId: true,
          status: true,
          failureCode: true,
          effectiveAt: true,
          targetPricingVersionId: true,
          targetPricingVersion: { select: { stripePriceId: true } },
          subscription: {
            select: {
              organizationId: true,
              currentPeriodEnd: true,
              organization: { select: { name: true } },
            },
          },
        },
      }),
      this.prisma.client.billingSubscriptionChangePreview.findMany({
        where: { status: "PENDING", expiresAt: { lte: now } },
        select: {
          id: true,
          organizationId: true,
          subscriptionId: true,
          status: true,
          expiresAt: true,
          createdAt: true,
          organization: { select: { name: true } },
        },
      }),
      this.prisma.client.billingFinancialEvent.aggregate({
        _min: { providerOccurredAt: true },
        _max: { providerOccurredAt: true },
      }),
    ]);
    return {
      subscriptions: subscriptions.map((subscription) => ({
        id: subscription.id,
        organizationId: subscription.organizationId,
        organizationName: subscription.organization.name,
        stripeCustomerId: subscription.organization.billingProfile?.stripeCustomerId ?? null,
        stripeSubscriptionId: subscription.stripeSubscriptionId,
        stripePriceId: subscription.stripePriceId,
        pricingVersionId: subscription.pricingVersionId,
        pricingMarketCode: subscription.pricingMarketCode,
        pricingCurrency: subscription.pricingCurrency,
        pricingAmountMinor: subscription.pricingAmountMinor,
        planCode: subscription.planCode,
        cadence: subscription.cadence,
        status: subscription.status,
        profileStatus: subscription.organization.billingProfile?.subscriptionStatus ?? null,
        currentPeriodEnd: subscription.currentPeriodEnd,
        lastProviderSyncAt: subscription.lastProviderSyncAt,
        reconciliationFailureCode: subscription.reconciliationFailureCode,
        reconciliationLeaseExpiresAt: subscription.reconciliationLeaseExpiresAt,
      })),
      pricingVersions: pricingVersions.map((version) => ({
        id: version.id,
        stripePriceId: version.stripePriceId,
        currency: version.currency,
        amountMinor: version.amountMinor,
        planCode: version.planCode,
        cadence: version.cadence,
        status: version.status,
        marketCode: version.market.code,
        publishedAt: version.publishedAt,
      })),
      webhooks: webhooks.map((event) => ({
        id: event.id,
        organizationId: event.organizationId,
        organizationName: event.organization?.name ?? null,
        externalEventId: event.externalEventId,
        eventType: event.eventType,
        status: event.status,
        attemptCount: event.attemptCount,
        leaseExpiresAt: event.leaseExpiresAt,
        processedAt: event.processedAt,
        createdAt: event.createdAt,
        updatedAt: event.updatedAt,
      })),
      financialEvents: financialEvents.map((event) => ({
        id: event.id,
        organizationId: event.organizationId,
        organizationName: event.organization.name,
        subscriptionId: event.subscriptionId,
        subscriptionStatus: event.subscription.status,
        planCode: event.planCode,
        pricingMarketCode: event.pricingMarketCode,
        providerObjectId: event.providerObjectId,
        type: event.type,
        currency: event.currency,
        amountMinor: event.amountMinor,
        providerOccurredAt: event.providerOccurredAt,
      })),
      repricings: repricings.map((command) => ({
        id: command.id,
        campaignId: command.campaignId,
        subscriptionId: command.subscriptionId,
        organizationId: command.subscription.organizationId,
        organizationName: command.subscription.organization.name,
        status: command.status,
        failureCode: command.failureCode,
        effectiveAt: command.effectiveAt,
        currentPeriodEnd: command.subscription.currentPeriodEnd,
        targetPricingVersionId: command.targetPricingVersionId,
        targetStripePriceId: command.targetPricingVersion.stripePriceId,
      })),
      changePreviews: changePreviews.map((preview) => ({
        id: preview.id,
        organizationId: preview.organizationId,
        organizationName: preview.organization.name,
        subscriptionId: preview.subscriptionId,
        status: preview.status,
        expiresAt: preview.expiresAt,
        createdAt: preview.createdAt,
      })),
      providerConfiguration: configuration(this.environment.values),
      financialEvidence: {
        ledgerStartedAt: financialEvidenceBounds._min.providerOccurredAt,
        latestEvidenceAt: financialEvidenceBounds._max.providerOccurredAt,
      },
    };
  }
}
