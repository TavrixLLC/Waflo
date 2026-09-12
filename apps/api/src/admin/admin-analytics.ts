export const ADMIN_ANALYTICS_RANGE_KEYS = ["7D", "30D", "90D", "YTD", "1Y"] as const;
export type AdminAnalyticsRangeKey = (typeof ADMIN_ANALYTICS_RANGE_KEYS)[number];
export type AdminAnalyticsBucket = "DAY" | "MONTH";

export type AnalyticsBillingStatus =
  | "PENDING_ACTIVATION"
  | "TRIALING"
  | "ACTIVE"
  | "PAST_DUE"
  | "GRACE_PERIOD"
  | "SUSPENDED"
  | "CANCELED";
export type AnalyticsPlan = "STARTER" | "GROWTH" | "SCALE";
export type AnalyticsCadence = "MONTHLY" | "QUARTERLY" | "YEARLY";

export interface AdminAnalyticsWindow {
  key: AdminAnalyticsRangeKey;
  start: Date;
  end: Date;
  bucket: AdminAnalyticsBucket;
  timezone: "UTC";
}

export interface AnalyticsSubscriptionRow {
  id: string;
  organizationId: string;
  planCode: AnalyticsPlan;
  status: AnalyticsBillingStatus;
  pricingMarketCode: string | null;
  pricingCurrency: string | null;
  pricingAmountMinor: bigint | null;
  cadence: AnalyticsCadence;
  grandfathered: boolean;
  createdAt: Date;
  pricingVersion: {
    id: string;
    version: number;
    status:
      | "DRAFT"
      | "VALIDATED"
      | "ACTIVE_FOR_NEW_SUBSCRIPTIONS"
      | "RETIRED_FOR_NEW_SUBSCRIPTIONS";
  } | null;
}

export interface AnalyticsOrganizationRow {
  id: string;
  createdAt: Date;
}

export interface AnalyticsTrialRow {
  organizationId: string;
  trialStart: Date | null;
  trialEnd: Date | null;
}

export interface AnalyticsMarketRow {
  code: string;
  countryCode: string | null;
}

export interface AnalyticsFinancialEventRow {
  subscriptionId: string;
  organizationId: string;
  type: "BILLED" | "COLLECTED" | "PAYMENT_FAILED";
  planCode: AnalyticsPlan | null;
  pricingMarketCode: string | null;
  pricingVersionId: string | null;
  currency: string;
  amountMinor: bigint;
  providerOccurredAt: Date;
  createdAt: Date;
}

export interface CurrencyAmount {
  currency: string;
  amountMinor: string;
}

const currentSubscriberStatuses = new Set<AnalyticsBillingStatus>([
  "ACTIVE",
  "TRIALING",
  "PAST_DUE",
  "GRACE_PERIOD",
]);

function startOfUtcDay(input: Date): Date {
  return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
}

function addUtcDays(input: Date, days: number): Date {
  const result = new Date(input);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export function isAdminAnalyticsRange(value: string): value is AdminAnalyticsRangeKey {
  return ADMIN_ANALYTICS_RANGE_KEYS.includes(value as AdminAnalyticsRangeKey);
}

export function adminAnalyticsWindow(
  key: AdminAnalyticsRangeKey,
  now = new Date(),
): AdminAnalyticsWindow {
  const today = startOfUtcDay(now);
  if (key === "YTD") {
    return {
      key,
      start: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)),
      end: now,
      bucket: "MONTH",
      timezone: "UTC",
    };
  }
  if (key === "1Y") {
    return {
      key,
      start: addUtcDays(today, -364),
      end: now,
      bucket: "MONTH",
      timezone: "UTC",
    };
  }
  const days = key === "7D" ? 7 : key === "30D" ? 30 : 90;
  return {
    key,
    start: addUtcDays(today, -(days - 1)),
    end: now,
    bucket: "DAY",
    timezone: "UTC",
  };
}

function inWindow(date: Date, window: AdminAnalyticsWindow): boolean {
  return date >= window.start && date <= window.end;
}

function bucketKey(date: Date, bucket: AdminAnalyticsBucket): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  if (bucket === "MONTH") return `${year}-${month}`;
  return `${year}-${month}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function analyticsBucketKeys(window: AdminAnalyticsWindow): string[] {
  const keys: string[] = [];
  const cursor = new Date(window.start);
  if (window.bucket === "MONTH") cursor.setUTCDate(1);
  while (cursor <= window.end) {
    keys.push(bucketKey(cursor, window.bucket));
    if (window.bucket === "MONTH") cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    else cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
}

function addCurrencyAmount(target: Map<string, bigint>, currency: string, amount: bigint): void {
  const normalized = currency.toUpperCase();
  target.set(normalized, (target.get(normalized) ?? 0n) + amount);
}

function serializeCurrencyAmounts(amounts: ReadonlyMap<string, bigint>): CurrencyAmount[] {
  return [...amounts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, amountMinor]) => ({ currency, amountMinor: amountMinor.toString() }));
}

function countBy<T>(rows: readonly T[], key: (row: T) => string) {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(key(row), (counts.get(key(row)) ?? 0) + 1);
  return counts;
}

function sortedCounts(counts: ReadonlyMap<string, number>) {
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => ({ key, count }));
}

export function normalizedMonthlyAmountMinor(
  amountMinor: bigint,
  cadence: AnalyticsCadence,
): bigint {
  if (cadence === "MONTHLY") return amountMinor;
  return (amountMinor + 6n) / 12n;
}

function firstCollectedByOrganization(events: readonly AnalyticsFinancialEventRow[]) {
  const first = new Map<string, Date>();
  for (const event of events) {
    if (event.type !== "COLLECTED") continue;
    const current = first.get(event.organizationId);
    if (!current || event.providerOccurredAt < current) {
      first.set(event.organizationId, event.providerOccurredAt);
    }
  }
  return first;
}

function firstCollectedBySubscription(events: readonly AnalyticsFinancialEventRow[]) {
  const first = new Map<string, Date>();
  for (const event of events) {
    if (event.type !== "COLLECTED") continue;
    const current = first.get(event.subscriptionId);
    if (!current || event.providerOccurredAt < current) {
      first.set(event.subscriptionId, event.providerOccurredAt);
    }
  }
  return first;
}

export function buildAdminOperationalAnalytics(input: {
  subscriptions: readonly AnalyticsSubscriptionRow[];
  organizations: readonly AnalyticsOrganizationRow[];
  trials: readonly AnalyticsTrialRow[];
  markets: readonly AnalyticsMarketRow[];
  scheduledSubscriptionIds: ReadonlySet<string>;
  financialEvents: readonly AnalyticsFinancialEventRow[];
  range: AdminAnalyticsWindow;
  now: Date;
}) {
  const currentSubscriptions = input.subscriptions.filter((subscription) =>
    currentSubscriberStatuses.has(subscription.status),
  );
  const statusCounts = countBy(input.subscriptions, (subscription) => subscription.status);
  const marketCountry = new Map(input.markets.map((market) => [market.code, market.countryCode]));
  const planCounts = new Map<string, { subscriberCount: number; trialCount: number }>();
  const marketCounts = new Map<
    string,
    { subscriberCount: number; trialCount: number; grandfatheredCount: number }
  >();
  for (const subscription of currentSubscriptions) {
    const plan = planCounts.get(subscription.planCode) ?? { subscriberCount: 0, trialCount: 0 };
    plan.subscriberCount += 1;
    if (subscription.status === "TRIALING") plan.trialCount += 1;
    planCounts.set(subscription.planCode, plan);

    const marketCode = subscription.pricingMarketCode ?? "UNMAPPED";
    const market = marketCounts.get(marketCode) ?? {
      subscriberCount: 0,
      trialCount: 0,
      grandfatheredCount: 0,
    };
    market.subscriberCount += 1;
    if (subscription.status === "TRIALING") market.trialCount += 1;
    if (subscription.grandfathered) market.grandfatheredCount += 1;
    marketCounts.set(marketCode, market);
  }

  const grandfathered = currentSubscriptions.filter((subscription) => subscription.grandfathered);
  const grandfatherByMarket = sortedCounts(
    countBy(grandfathered, (subscription) => subscription.pricingMarketCode ?? "UNMAPPED"),
  ).map(({ key, count }) => ({ marketCode: key, subscriberCount: count }));
  const grandfatherByPlan = sortedCounts(
    countBy(grandfathered, (subscription) => subscription.planCode),
  ).map(({ key, count }) => ({ plan: key as AnalyticsPlan, subscriberCount: count }));
  const versionGroups = new Map<
    string,
    {
      marketCode: string;
      plan: AnalyticsPlan;
      pricingVersionId: string | null;
      version: number | null;
      subscriberCount: number;
    }
  >();
  for (const subscription of grandfathered) {
    const key = [
      subscription.pricingMarketCode ?? "UNMAPPED",
      subscription.planCode,
      subscription.pricingVersion?.id ?? "UNMAPPED",
    ].join(":");
    const group = versionGroups.get(key) ?? {
      marketCode: subscription.pricingMarketCode ?? "UNMAPPED",
      plan: subscription.planCode,
      pricingVersionId: subscription.pricingVersion?.id ?? null,
      version: subscription.pricingVersion?.version ?? null,
      subscriberCount: 0,
    };
    group.subscriberCount += 1;
    versionGroups.set(key, group);
  }

  const evidenceCoverageStart = input.financialEvents.reduce<Date | null>(
    (earliest, event) => (!earliest || event.createdAt < earliest ? event.createdAt : earliest),
    null,
  );
  const collectedByOrganization = firstCollectedByOrganization(input.financialEvents);
  const eligibleTrials = evidenceCoverageStart
    ? input.trials.filter(
        (trial) =>
          trial.trialStart !== null &&
          trial.trialEnd !== null &&
          trial.trialEnd <= input.now &&
          trial.trialEnd >= evidenceCoverageStart,
      )
    : [];
  const convertedTrials = eligibleTrials.filter((trial) => {
    const collectedAt = collectedByOrganization.get(trial.organizationId);
    return collectedAt !== undefined && trial.trialEnd !== null && collectedAt >= trial.trialEnd;
  });
  const conversionBuckets = new Map<string, number>();
  for (const trial of convertedTrials) {
    const collectedAt = collectedByOrganization.get(trial.organizationId);
    if (collectedAt && inWindow(collectedAt, input.range)) {
      const key = bucketKey(collectedAt, input.range.bucket);
      conversionBuckets.set(key, (conversionBuckets.get(key) ?? 0) + 1);
    }
  }

  const organizationBuckets = countBy(
    input.organizations.filter((organization) => inWindow(organization.createdAt, input.range)),
    (organization) => bucketKey(organization.createdAt, input.range.bucket),
  );
  const firstCollected = firstCollectedBySubscription(input.financialEvents);
  const paidBuckets = new Map<string, number>();
  for (const paidAt of firstCollected.values()) {
    if (!inWindow(paidAt, input.range)) continue;
    const key = bucketKey(paidAt, input.range.bucket);
    paidBuckets.set(key, (paidBuckets.get(key) ?? 0) + 1);
  }
  const buckets = analyticsBucketKeys(input.range);
  const scheduledCurrentCount = new Set(
    [...input.scheduledSubscriptionIds].filter((id) =>
      currentSubscriptions.some((subscription) => subscription.id === id),
    ),
  ).size;

  return {
    generatedAt: input.now.toISOString(),
    range: {
      key: input.range.key,
      start: input.range.start.toISOString(),
      end: input.range.end.toISOString(),
      bucket: input.range.bucket,
      timezone: input.range.timezone,
    },
    counts: {
      totalOrganizations: input.organizations.length,
      activeSubscribers: statusCounts.get("ACTIVE") ?? 0,
      trialingSubscribers: statusCounts.get("TRIALING") ?? 0,
      pastDueSubscribers: statusCounts.get("PAST_DUE") ?? 0,
      canceledSubscriptions: statusCounts.get("CANCELED") ?? 0,
      grandfatheredSubscribers: grandfathered.length,
      scheduledRepricingSubscribers: scheduledCurrentCount,
    },
    statusBreakdown: sortedCounts(statusCounts).map(({ key, count }) => ({
      status: key as AnalyticsBillingStatus,
      count,
    })),
    planBreakdown: [...planCounts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([plan, counts]) => ({ plan: plan as AnalyticsPlan, ...counts })),
    marketBreakdown: [...marketCounts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([marketCode, counts]) => ({
        marketCode,
        countryCode: marketCountry.get(marketCode) ?? null,
        ...counts,
      })),
    trials: {
      active: statusCounts.get("TRIALING") ?? 0,
      startedInRange: input.trials.filter(
        (trial) => trial.trialStart && inWindow(trial.trialStart, input.range),
      ).length,
      conversionSupported: evidenceCoverageStart !== null,
      evidenceCoverageStart: evidenceCoverageStart?.toISOString() ?? null,
      eligibleCompleted: evidenceCoverageStart ? eligibleTrials.length : null,
      converted: evidenceCoverageStart ? convertedTrials.length : null,
      unconverted: evidenceCoverageStart ? eligibleTrials.length - convertedTrials.length : null,
      conversionRate:
        evidenceCoverageStart && eligibleTrials.length > 0
          ? convertedTrials.length / eligibleTrials.length
          : null,
    },
    grandfathering: {
      total: grandfathered.length,
      currentPriceSubscribers: currentSubscriptions.length - grandfathered.length,
      historicalVersionSubscribers: grandfathered.length,
      scheduledRepricingSubscribers: scheduledCurrentCount,
      byMarket: grandfatherByMarket,
      byPlan: grandfatherByPlan,
      byPricingVersion: [...versionGroups.values()].sort((left, right) =>
        `${left.marketCode}:${left.plan}:${left.version ?? 0}`.localeCompare(
          `${right.marketCode}:${right.plan}:${right.version ?? 0}`,
        ),
      ),
    },
    trends: {
      newOrganizations: buckets.map((bucket) => ({
        bucket,
        count: organizationBuckets.get(bucket) ?? 0,
      })),
      newPaidSubscriptions: buckets.map((bucket) => ({
        bucket,
        count: paidBuckets.get(bucket) ?? 0,
      })),
      trialConversions: evidenceCoverageStart
        ? buckets.map((bucket) => ({ bucket, count: conversionBuckets.get(bucket) ?? 0 }))
        : null,
    },
  };
}

function sumEventsByCurrency(
  events: readonly AnalyticsFinancialEventRow[],
  type: AnalyticsFinancialEventRow["type"],
  predicate: (event: AnalyticsFinancialEventRow) => boolean,
) {
  const totals = new Map<string, bigint>();
  for (const event of events) {
    if (event.type === type && predicate(event)) {
      addCurrencyAmount(totals, event.currency, event.amountMinor);
    }
  }
  return totals;
}

export function buildAdminFinanceAnalytics(input: {
  subscriptions: readonly AnalyticsSubscriptionRow[];
  financialEvents: readonly AnalyticsFinancialEventRow[];
  range: AdminAnalyticsWindow;
  now: Date;
}) {
  const active = input.subscriptions.filter((subscription) => subscription.status === "ACTIVE");
  const mrr = new Map<string, bigint>();
  let unpricedActiveSubscriberCount = 0;
  for (const subscription of active) {
    if (!subscription.pricingCurrency || subscription.pricingAmountMinor === null) {
      unpricedActiveSubscriberCount += 1;
      continue;
    }
    addCurrencyAmount(
      mrr,
      subscription.pricingCurrency,
      normalizedMonthlyAmountMinor(subscription.pricingAmountMinor, subscription.cadence),
    );
  }
  const arr = new Map([...mrr.entries()].map(([currency, amount]) => [currency, amount * 12n]));
  const monthStart = new Date(Date.UTC(input.now.getUTCFullYear(), input.now.getUTCMonth(), 1));
  const yearStart = new Date(Date.UTC(input.now.getUTCFullYear(), 0, 1));
  const selected = (event: AnalyticsFinancialEventRow) =>
    inWindow(event.providerOccurredAt, input.range);
  const currentMonth = (event: AnalyticsFinancialEventRow) =>
    event.providerOccurredAt >= monthStart && event.providerOccurredAt <= input.now;
  const currentYear = (event: AnalyticsFinancialEventRow) =>
    event.providerOccurredAt >= yearStart && event.providerOccurredAt <= input.now;
  const selectedCollected = sumEventsByCurrency(input.financialEvents, "COLLECTED", selected);
  const selectedBilled = sumEventsByCurrency(input.financialEvents, "BILLED", selected);
  const collectedMonth = sumEventsByCurrency(input.financialEvents, "COLLECTED", currentMonth);
  const collectedYear = sumEventsByCurrency(input.financialEvents, "COLLECTED", currentYear);
  const evidenceCoverageStart = input.financialEvents.reduce<Date | null>(
    (earliest, event) => (!earliest || event.createdAt < earliest ? event.createdAt : earliest),
    null,
  );

  const currencies = new Set<string>([
    ...mrr.keys(),
    ...selectedCollected.keys(),
    ...selectedBilled.keys(),
  ]);
  const currencyBreakdown = [...currencies]
    .sort((left, right) => left.localeCompare(right))
    .map((currency) => ({
      currency,
      activeSubscribers: active.filter(
        (subscription) => subscription.pricingCurrency?.toUpperCase() === currency,
      ).length,
      mrrAmountMinor: (mrr.get(currency) ?? 0n).toString(),
      collectedAmountMinor: (selectedCollected.get(currency) ?? 0n).toString(),
      refundsAmountMinor: null,
    }));

  const planKeys = new Set<AnalyticsPlan>([
    ...active.map((subscription) => subscription.planCode),
    ...input.financialEvents
      .filter((event): event is AnalyticsFinancialEventRow & { planCode: AnalyticsPlan } =>
        Boolean(event.planCode),
      )
      .map((event) => event.planCode),
  ]);
  const planBreakdown = [...planKeys]
    .sort((left, right) => left.localeCompare(right))
    .map((plan) => {
      const planMrr = new Map<string, bigint>();
      for (const subscription of active.filter((row) => row.planCode === plan)) {
        if (subscription.pricingCurrency && subscription.pricingAmountMinor !== null) {
          addCurrencyAmount(
            planMrr,
            subscription.pricingCurrency,
            normalizedMonthlyAmountMinor(subscription.pricingAmountMinor, subscription.cadence),
          );
        }
      }
      return {
        plan,
        activeSubscribers: active.filter((subscription) => subscription.planCode === plan).length,
        mrr: serializeCurrencyAmounts(planMrr),
        collected: serializeCurrencyAmounts(
          sumEventsByCurrency(
            input.financialEvents,
            "COLLECTED",
            (event) => selected(event) && event.planCode === plan,
          ),
        ),
      };
    });

  const marketKeys = new Set(
    [
      ...active.map((subscription) => subscription.pricingMarketCode),
      ...input.financialEvents.map((event) => event.pricingMarketCode),
    ].filter((market): market is string => market !== null),
  );
  const marketBreakdown = [...marketKeys]
    .sort((left, right) => left.localeCompare(right))
    .map((marketCode) => {
      const marketMrr = new Map<string, bigint>();
      for (const subscription of active.filter((row) => row.pricingMarketCode === marketCode)) {
        if (subscription.pricingCurrency && subscription.pricingAmountMinor !== null) {
          addCurrencyAmount(
            marketMrr,
            subscription.pricingCurrency,
            normalizedMonthlyAmountMinor(subscription.pricingAmountMinor, subscription.cadence),
          );
        }
      }
      return {
        marketCode,
        activeSubscribers: active.filter(
          (subscription) => subscription.pricingMarketCode === marketCode,
        ).length,
        mrr: serializeCurrencyAmounts(marketMrr),
        collected: serializeCurrencyAmounts(
          sumEventsByCurrency(
            input.financialEvents,
            "COLLECTED",
            (event) => selected(event) && event.pricingMarketCode === marketCode,
          ),
        ),
      };
    });

  const trendBuckets = new Map<string, Map<string, bigint>>();
  for (const event of input.financialEvents) {
    if (event.type !== "COLLECTED" || !selected(event)) continue;
    const key = bucketKey(event.providerOccurredAt, input.range.bucket);
    const totals = trendBuckets.get(key) ?? new Map<string, bigint>();
    addCurrencyAmount(totals, event.currency, event.amountMinor);
    trendBuckets.set(key, totals);
  }
  const unattributedCollected = sumEventsByCurrency(
    input.financialEvents,
    "COLLECTED",
    (event) => selected(event) && (!event.planCode || !event.pricingMarketCode),
  );

  return {
    generatedAt: input.now.toISOString(),
    range: {
      key: input.range.key,
      start: input.range.start.toISOString(),
      end: input.range.end.toISOString(),
      bucket: input.range.bucket,
      timezone: input.range.timezone,
    },
    evidence: {
      available: evidenceCoverageStart !== null,
      coverageStart: evidenceCoverageStart?.toISOString() ?? null,
      selectedRangeComplete:
        evidenceCoverageStart !== null && evidenceCoverageStart <= input.range.start,
    },
    recurringRevenue: {
      mrr: serializeCurrencyAmounts(mrr),
      arr: serializeCurrencyAmounts(arr),
      complete: unpricedActiveSubscriberCount === 0,
      unpricedActiveSubscriberCount,
      mrrDefinition:
        "ACTIVE subscriptions only; monthly terms at face value and annual terms divided by 12, rounded to the nearest minor unit.",
      arrDefinition: "MRR multiplied by 12 in each native currency.",
      reportingCurrencyTotal: null,
    },
    billed: {
      selectedRange: serializeCurrencyAmounts(selectedBilled),
      definition: "Gross amount due on provider-finalized invoices recorded by Waflo.",
    },
    collected: {
      selectedRange: serializeCurrencyAmounts(selectedCollected),
      currentMonth: serializeCurrencyAmounts(collectedMonth),
      currentYear: serializeCurrencyAmounts(collectedYear),
      definition: "Amount paid on verified Stripe invoice.paid events recorded by Waflo.",
    },
    refunds: {
      supported: false,
      selectedRange: null,
      reason: "Attributable refund evidence is not stored in the canonical billing database.",
    },
    netCollected: {
      supported: false,
      selectedRange: null,
      reason: "Provider fee and attributable refund evidence are not available.",
    },
    failedPaymentCount: input.financialEvents.filter(
      (event) => event.type === "PAYMENT_FAILED" && selected(event),
    ).length,
    planBreakdown,
    marketBreakdown,
    currencyBreakdown,
    unattributedCollected: serializeCurrencyAmounts(unattributedCollected),
    trends: {
      collectedRevenue: analyticsBucketKeys(input.range).map((bucket) => ({
        bucket,
        totals: serializeCurrencyAmounts(trendBuckets.get(bucket) ?? new Map()),
      })),
    },
  };
}
