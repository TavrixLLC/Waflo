"use client";

import type { Locale } from "@waflo/contracts";
import { Alert, Button, Skeleton } from "@waflo/ui";
import { Activity, Building2, CalendarClock, CircleDollarSign, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { adminApi } from "../lib/admin-api";
import {
  type AdminAnalyticsRange,
  type AdminCurrencyAmount,
  type AdminFinanceAnalytics,
  type AdminOperationalAnalytics,
  adminAnalyticsCopy,
  adminAnalyticsPath,
  adminAnalyticsRanges,
  canViewAdminFinance,
  formatAdminAnalyticsCount,
  formatAdminAnalyticsMoney,
  moneyListState,
  planLabel,
  rangeLabel,
  revenueSeriesByCurrency,
  safeBarPercent,
  statusLabel,
} from "./admin-overview-analytics";
import { useAdminSession } from "./admin-session";

function MoneyList({
  values,
  locale,
  unavailable,
}: {
  values: readonly AdminCurrencyAmount[];
  locale: Locale;
  unavailable: string;
}) {
  if (moneyListState(values) === "empty")
    return <span className="admin-kpi__empty">{unavailable}</span>;
  return (
    <span className="admin-money-list">
      {values.map((value) => (
        <strong key={value.currency} dir="auto">
          <small>{value.currency}</small>
          {formatAdminAnalyticsMoney(value.amountMinor, value.currency, locale)}
        </strong>
      ))}
    </span>
  );
}

function CountCard({
  label,
  value,
  locale,
  tone = "neutral",
}: {
  label: string;
  value: number;
  locale: Locale;
  tone?: string;
}) {
  return (
    <article className="admin-kpi" data-tone={tone}>
      <span>{label}</span>
      <strong>{formatAdminAnalyticsCount(value, locale)}</strong>
    </article>
  );
}

function MoneyCard({
  label,
  values,
  locale,
  unavailable,
}: {
  label: string;
  values: readonly AdminCurrencyAmount[];
  locale: Locale;
  unavailable: string;
}) {
  return (
    <article className="admin-kpi admin-kpi--money">
      <span>{label}</span>
      <MoneyList values={values} locale={locale} unavailable={unavailable} />
    </article>
  );
}

function RevenueTrend({ finance, locale }: { finance: AdminFinanceAnalytics; locale: Locale }) {
  const text = adminAnalyticsCopy(locale);
  const series = revenueSeriesByCurrency(finance);
  return (
    <section className="admin-analytics-panel admin-revenue-trend">
      <header>
        <div>
          <CircleDollarSign size={18} aria-hidden="true" />
          <h2>{text.revenueTrend}</h2>
        </div>
        <p>{text.nativeCurrencies}</p>
      </header>
      {series.length === 0 ? (
        <p className="admin-empty-copy">{text.evidenceUnavailable}</p>
      ) : (
        series.map((currencySeries) => {
          const maximum = currencySeries.points.reduce(
            (current, point) =>
              BigInt(point.amountMinor) > current ? BigInt(point.amountMinor) : current,
            0n,
          );
          return (
            <div className="admin-trend-series" key={currencySeries.currency}>
              <strong>{currencySeries.currency}</strong>
              <div
                className="admin-trend-bars"
                role="img"
                aria-label={`${text.revenueTrend}: ${currencySeries.currency}`}
              >
                {currencySeries.points.map((point) => (
                  <span className="admin-trend-point" key={point.bucket}>
                    <span
                      className="admin-trend-point__bar"
                      style={{ height: `${safeBarPercent(BigInt(point.amountMinor), maximum)}%` }}
                      title={`${point.bucket}: ${formatAdminAnalyticsMoney(
                        point.amountMinor,
                        currencySeries.currency,
                        locale,
                      )}`}
                    />
                    <small>{point.bucket.slice(5)}</small>
                  </span>
                ))}
              </div>
            </div>
          );
        })
      )}
    </section>
  );
}

function StatusDistribution({
  analytics,
  locale,
}: {
  analytics: AdminOperationalAnalytics;
  locale: Locale;
}) {
  const text = adminAnalyticsCopy(locale);
  const maximum = Math.max(1, ...analytics.statusBreakdown.map((item) => item.count));
  return (
    <section className="admin-analytics-panel admin-status-chart">
      <header>
        <div>
          <Activity size={18} aria-hidden="true" />
          <h2>{text.status}</h2>
        </div>
      </header>
      <div className="admin-status-rows">
        {analytics.statusBreakdown.map((item) => (
          <div key={item.status}>
            <span>{statusLabel(item.status, locale)}</span>
            <div aria-hidden="true">
              <span style={{ width: `${Math.max(2, (item.count / maximum) * 100)}%` }} />
            </div>
            <strong>{item.count}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

export function AdminOverviewDashboard({ locale }: { locale: Locale }) {
  const { me } = useAdminSession();
  const text = adminAnalyticsCopy(locale);
  const financeAllowed = canViewAdminFinance(me.permissions);
  const [range, setRange] = useState<AdminAnalyticsRange>("30D");
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | {
        kind: "ready";
        operational: AdminOperationalAnalytics;
        finance: AdminFinanceAnalytics | null;
      }
  >({ kind: "loading" });

  // Retry increments revision specifically to repeat both authoritative requests.
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision is an intentional retry trigger.
  useEffect(() => {
    let active = true;
    setState({ kind: "loading" });
    const operational = adminApi<AdminOperationalAnalytics>(adminAnalyticsPath("overview", range));
    const finance = financeAllowed
      ? adminApi<AdminFinanceAnalytics>(adminAnalyticsPath("finance", range))
      : Promise.resolve(null);
    void Promise.all([operational, finance])
      .then(([nextOperational, nextFinance]) => {
        if (active) setState({ kind: "ready", operational: nextOperational, finance: nextFinance });
      })
      .catch((error: unknown) => {
        if (active)
          setState({
            kind: "error",
            message: error instanceof Error ? error.message : "Analytics could not be loaded.",
          });
      });
    return () => {
      active = false;
    };
  }, [financeAllowed, range, revision]);

  const financeByPlan = useMemo(
    () =>
      new Map(
        state.kind === "ready" ? state.finance?.planBreakdown.map((row) => [row.plan, row]) : [],
      ),
    [state],
  );
  const financeByMarket = useMemo(
    () =>
      new Map(
        state.kind === "ready"
          ? state.finance?.marketBreakdown.map((row) => [row.marketCode, row])
          : [],
      ),
    [state],
  );

  return (
    <div className="admin-analytics" dir={locale === "ar" ? "rtl" : "ltr"}>
      <header className="admin-analytics-header">
        <div>
          <span>{text.eyebrow}</span>
          <h1>{text.title}</h1>
          <p>{text.subtitle}</p>
        </div>
        <fieldset className="admin-range-selector">
          <legend>{text.range}</legend>
          {adminAnalyticsRanges.map((option) => (
            <button
              type="button"
              key={option}
              aria-pressed={range === option}
              onClick={() => setRange(option)}
            >
              {rangeLabel(option, locale)}
            </button>
          ))}
        </fieldset>
      </header>

      {state.kind === "loading" ? (
        <section className="admin-analytics-loading" aria-live="polite" aria-busy="true">
          <Skeleton height="7rem" />
          <Skeleton height="18rem" />
          <span>{text.loading}</span>
        </section>
      ) : null}

      {state.kind === "error" ? (
        <section className="admin-analytics-error" aria-live="assertive">
          <Alert tone="danger" title={state.message} />
          <Button onClick={() => setRevision((value) => value + 1)}>
            <RefreshCw size={16} aria-hidden="true" />
            {text.retry}
          </Button>
        </section>
      ) : null}

      {state.kind === "ready" ? (
        <>
          <section className="admin-kpi-grid" aria-label={text.title}>
            <CountCard
              label={text.active}
              value={state.operational.counts.activeSubscribers}
              locale={locale}
              tone="good"
            />
            <CountCard
              label={text.trials}
              value={state.operational.counts.trialingSubscribers}
              locale={locale}
              tone="trial"
            />
            <CountCard
              label={text.pastDue}
              value={state.operational.counts.pastDueSubscribers}
              locale={locale}
              tone="risk"
            />
            <CountCard
              label={text.grandfathered}
              value={state.operational.counts.grandfatheredSubscribers}
              locale={locale}
            />
            {state.finance ? (
              <>
                <MoneyCard
                  label={text.mrr}
                  values={state.finance.recurringRevenue.mrr}
                  locale={locale}
                  unavailable={text.unavailable}
                />
                <MoneyCard
                  label={text.arr}
                  values={state.finance.recurringRevenue.arr}
                  locale={locale}
                  unavailable={text.unavailable}
                />
                <MoneyCard
                  label={text.revenueMonth}
                  values={state.finance.collected.currentMonth}
                  locale={locale}
                  unavailable={text.unavailable}
                />
                <CountCard
                  label={text.failedPayments}
                  value={state.finance.failedPaymentCount}
                  locale={locale}
                  tone="risk"
                />
              </>
            ) : null}
          </section>

          <div className="admin-analytics-facts">
            <span>
              <Building2 size={15} aria-hidden="true" /> {text.organizations}:{" "}
              <strong>
                {formatAdminAnalyticsCount(state.operational.counts.totalOrganizations, locale)}
              </strong>
            </span>
            <span>
              <CalendarClock size={15} aria-hidden="true" /> {text.scheduled}:{" "}
              <strong>
                {formatAdminAnalyticsCount(
                  state.operational.counts.scheduledRepricingSubscribers,
                  locale,
                )}
              </strong>
            </span>
            {!financeAllowed ? <span>{text.financeRestricted}</span> : null}
            {state.finance && !state.finance.evidence.available ? (
              <span>{text.evidenceUnavailable}</span>
            ) : null}
            {state.finance?.evidence.available && !state.finance.evidence.selectedRangeComplete ? (
              <span>{text.evidencePartial}</span>
            ) : null}
          </div>

          {state.operational.counts.totalOrganizations === 0 ? (
            <p className="admin-empty-copy">{text.noData}</p>
          ) : (
            <div className="admin-analytics-charts">
              {state.finance ? <RevenueTrend finance={state.finance} locale={locale} /> : null}
              <StatusDistribution analytics={state.operational} locale={locale} />
            </div>
          )}

          <section className="admin-analytics-panel admin-breakdown">
            <header>
              <div>
                <h2>{text.plans}</h2>
              </div>
            </header>
            <div className="admin-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{text.plan}</th>
                    <th>{text.subscribers}</th>
                    <th>{text.mrr}</th>
                    <th>{text.collected}</th>
                  </tr>
                </thead>
                <tbody>
                  {state.operational.planBreakdown.map((row) => {
                    const financial = financeByPlan.get(row.plan);
                    return (
                      <tr key={row.plan}>
                        <th>{planLabel(row.plan, locale)}</th>
                        <td>{formatAdminAnalyticsCount(row.subscriberCount, locale)}</td>
                        <td>
                          <MoneyList
                            values={financial?.mrr ?? []}
                            locale={locale}
                            unavailable={text.unavailable}
                          />
                        </td>
                        <td>
                          <MoneyList
                            values={financial?.collected ?? []}
                            locale={locale}
                            unavailable={text.unavailable}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="admin-analytics-panel admin-breakdown">
            <header>
              <div>
                <h2>{text.markets}</h2>
              </div>
            </header>
            <div className="admin-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{text.market}</th>
                    <th>{text.subscribers}</th>
                    <th>{text.trials}</th>
                    <th>{text.grandfathered}</th>
                    <th>{text.mrr}</th>
                    <th>{text.collected}</th>
                  </tr>
                </thead>
                <tbody>
                  {state.operational.marketBreakdown.map((row) => {
                    const financial = financeByMarket.get(row.marketCode);
                    return (
                      <tr key={row.marketCode}>
                        <th>
                          {row.marketCode}
                          {row.countryCode ? <small>{row.countryCode}</small> : null}
                        </th>
                        <td>{formatAdminAnalyticsCount(row.subscriberCount, locale)}</td>
                        <td>{formatAdminAnalyticsCount(row.trialCount, locale)}</td>
                        <td>{formatAdminAnalyticsCount(row.grandfatheredCount, locale)}</td>
                        <td>
                          <MoneyList
                            values={financial?.mrr ?? []}
                            locale={locale}
                            unavailable={text.unavailable}
                          />
                        </td>
                        <td>
                          <MoneyList
                            values={financial?.collected ?? []}
                            locale={locale}
                            unavailable={text.unavailable}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
