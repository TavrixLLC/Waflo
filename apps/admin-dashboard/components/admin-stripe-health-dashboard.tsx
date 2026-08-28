"use client";

import type { Locale } from "@waflo/contracts";
import { Alert, Button, Modal, Skeleton } from "@waflo/ui";
import {
  Activity,
  AlertOctagon,
  BadgeCheck,
  Cable,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  CreditCard,
  Database,
  ExternalLink,
  FileWarning,
  HeartPulse,
  ReceiptText,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { adminApi } from "../lib/admin-api";
import { RequireAdminCapability, useAdminSession } from "./admin-session";
import {
  type HealthSeverity,
  type StripeHealthIssue,
  type StripeHealthIssuePage,
  type StripeHealthOverview,
  stripeHealthCopy,
  stripeHealthDate,
  stripeHealthIssueLabel,
  stripeHealthMoney,
  stripeHealthSeverityLabel,
} from "./admin-stripe-health";

function severityTone(severity: HealthSeverity) {
  if (severity === "CRITICAL") return "critical";
  if (severity === "WARNING") return "warning";
  if (severity === "INFO") return "info";
  return "healthy";
}

function healthPath(params: URLSearchParams) {
  const encoded = params.toString();
  return `/v1/admin/stripe-health/issues${encoded ? `?${encoded}` : ""}`;
}

export function AdminStripeHealthDashboard({ locale }: { locale: Locale }) {
  const text = stripeHealthCopy(locale);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const queryKey = params.toString();
  const { me } = useAdminSession();
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<StripeHealthIssue | null>(null);
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "ready"; overview: StripeHealthOverview; issues: StripeHealthIssuePage }
  >({ kind: "loading" });

  // biome-ignore lint/correctness/useExhaustiveDependencies: revision intentionally revalidates the same server-authoritative query.
  useEffect(() => {
    let active = true;
    setState({ kind: "loading" });
    const issueQuery = new URLSearchParams(queryKey);
    if (!issueQuery.has("page")) issueQuery.set("page", "1");
    if (!issueQuery.has("pageSize")) issueQuery.set("pageSize", "25");
    void Promise.all([
      adminApi<StripeHealthOverview>("/v1/admin/stripe-health/overview"),
      adminApi<StripeHealthIssuePage>(healthPath(issueQuery)),
    ])
      .then(([overview, issues]) => active && setState({ kind: "ready", overview, issues }))
      .catch(
        (error: unknown) =>
          active &&
          setState({
            kind: "error",
            message: error instanceof Error ? error.message : text.error,
          }),
      );
    return () => {
      active = false;
    };
  }, [queryKey, revision, text.error]);

  function updateQuery(patch: Record<string, string | null>) {
    const next = new URLSearchParams(queryKey);
    for (const [key, value] of Object.entries(patch)) {
      if (!value) next.delete(key);
      else next.set(key, value);
    }
    if (!Object.hasOwn(patch, "page")) next.set("page", "1");
    router.replace(`${pathname}${next.toString() ? `?${next}` : ""}`);
  }

  async function openIssue(issue: StripeHealthIssue) {
    try {
      setSelected(await adminApi<StripeHealthIssue>(`/v1/admin/stripe-health/issues/${issue.id}`));
    } catch {
      // The item in the current list remains useful if a retry normalized the dynamic issue first.
      setSelected(issue);
    }
  }

  return (
    <RequireAdminCapability permission="admin.stripe_health.read" locale={locale}>
      <main className="admin-stripe-health" dir={locale === "ar" ? "rtl" : "ltr"}>
        <header className="admin-stripe-health__header">
          <div>
            <span>{text.eyebrow}</span>
            <h1>{text.title}</h1>
            <p>{text.subtitle}</p>
          </div>
          <div className="admin-stripe-health__header-note">
            <Database size={17} aria-hidden="true" />
            <span>{text.noLive}</span>
          </div>
        </header>
        {state.kind === "loading" ? <Loading text={text.loading} /> : null}
        {state.kind === "error" ? (
          <section className="admin-stripe-health__error" aria-live="assertive">
            <Alert tone="danger" title={state.message} />
            <Button onClick={() => setRevision((value) => value + 1)}>{text.retry}</Button>
          </section>
        ) : null}
        {state.kind === "ready" ? (
          <>
            <HealthBanner overview={state.overview} locale={locale} />
            <Summary overview={state.overview} locale={locale} />
            <section className="admin-stripe-health__callouts" aria-label={text.title}>
              <p>
                <ShieldCheck size={17} aria-hidden="true" />
                {text.noDangerousActions}
              </p>
              <p>
                <Database size={17} aria-hidden="true" />
                {text.noLive}
              </p>
            </section>
            <Issues
              locale={locale}
              page={state.issues}
              query={params}
              onQuery={updateQuery}
              onOpen={openIssue}
            />
            <div className="admin-stripe-health__grid">
              <WebhookEvidence overview={state.overview} locale={locale} />
              <Reconciliation overview={state.overview} locale={locale} />
              <Payments
                overview={state.overview}
                locale={locale}
                canViewFinance={me.permissions.includes("admin.finance.read")}
              />
              <Catalog overview={state.overview} locale={locale} />
              <Evidence overview={state.overview} locale={locale} />
              <Configuration overview={state.overview} locale={locale} />
            </div>
            <IssueDetail issue={selected} locale={locale} onClose={() => setSelected(null)} />
          </>
        ) : null}
      </main>
    </RequireAdminCapability>
  );
}

function Loading({ text }: { text: string }) {
  return (
    <section className="admin-stripe-health__loading" aria-busy="true" aria-live="polite">
      <Skeleton height="8rem" />
      <Skeleton height="11rem" />
      <Skeleton height="23rem" />
      <span>{text}</span>
    </section>
  );
}

function HealthBanner({ overview, locale }: { overview: StripeHealthOverview; locale: Locale }) {
  const text = stripeHealthCopy(locale);
  const Icon = overview.overall.severity === "HEALTHY" ? BadgeCheck : AlertOctagon;
  return (
    <section
      className="admin-stripe-health-banner"
      data-severity={severityTone(overview.overall.severity)}
    >
      <Icon size={28} aria-hidden="true" />
      <div>
        <strong>{overview.overall.severity === "HEALTHY" ? text.healthy : text.attention}</strong>
        <p>{overview.overall.message}</p>
      </div>
      <div className="admin-stripe-health-banner__counts">
        <StatusPill severity="CRITICAL" value={overview.overall.criticalCount} locale={locale} />
        <StatusPill severity="WARNING" value={overview.overall.warningCount} locale={locale} />
        <StatusPill severity="INFO" value={overview.overall.infoCount} locale={locale} />
      </div>
    </section>
  );
}

function StatusPill({
  severity,
  value,
  locale,
}: {
  severity: Exclude<HealthSeverity, "HEALTHY">;
  value: number;
  locale: Locale;
}) {
  return (
    <span className="admin-stripe-health-status" data-severity={severityTone(severity)}>
      {stripeHealthSeverityLabel(severity, locale)}{" "}
      <strong>{new Intl.NumberFormat(locale).format(value)}</strong>
    </span>
  );
}

function Summary({ overview, locale }: { overview: StripeHealthOverview; locale: Locale }) {
  const text = stripeHealthCopy(locale);
  const cards = [
    { label: text.unknownPrice, value: overview.summary.unknownStripePrices, tone: "critical" },
    { label: text.bindingIssues, value: overview.summary.pricingBindingIssues, tone: "warning" },
    {
      label: text.missingSnapshot,
      value: overview.summary.missingPricingSnapshots,
      tone: "critical",
    },
    { label: text.payments, value: overview.summary.failedPayments, tone: "warning" },
    { label: text.pastDue, value: overview.summary.pastDueSubscriptions, tone: "warning" },
    { label: text.repricing, value: overview.summary.repricingFailures, tone: "warning" },
    { label: text.retryable, value: overview.summary.retryableWebhookEvents, tone: "info" },
    { label: text.dueForSync, value: overview.summary.reconciliationDueForSync, tone: "info" },
  ] as const;
  return (
    <section className="admin-stripe-health-summary" aria-label={text.title}>
      {cards.map((card) => (
        <article key={card.label} data-tone={card.tone}>
          <span>{card.label}</span>
          <strong>{new Intl.NumberFormat(locale).format(card.value)}</strong>
        </article>
      ))}
    </section>
  );
}

function Issues({
  locale,
  page,
  query,
  onQuery,
  onOpen,
}: {
  locale: Locale;
  page: StripeHealthIssuePage;
  query: URLSearchParams;
  onQuery: (patch: Record<string, string | null>) => void;
  onOpen: (issue: StripeHealthIssue) => void;
}) {
  const text = stripeHealthCopy(locale);
  return (
    <section
      className="admin-stripe-health-panel admin-stripe-health-issues"
      aria-labelledby="stripe-health-issues"
    >
      <header>
        <div>
          <FileWarning size={18} aria-hidden="true" />
          <h2 id="stripe-health-issues">{text.issues}</h2>
        </div>
        <fieldset className="admin-stripe-health-filters">
          <legend className="sr-only">{text.filters}</legend>
          <label>
            <span>{text.severity}</span>
            <select
              value={query.get("severity") ?? ""}
              onChange={(event) => onQuery({ severity: event.target.value || null })}
            >
              <option value="">{text.all}</option>
              <option value="CRITICAL">{text.critical}</option>
              <option value="WARNING">{text.warning}</option>
              <option value="INFO">{text.info}</option>
            </select>
          </label>
          <label>
            <span>{text.type}</span>
            <select
              value={query.get("type") ?? ""}
              onChange={(event) => onQuery({ type: event.target.value || null })}
            >
              <option value="">{text.all}</option>
              <option value="UNKNOWN_STRIPE_PRICE">
                {stripeHealthIssueLabel("UNKNOWN_STRIPE_PRICE", locale)}
              </option>
              <option value="MISSING_PRICING_BINDING">
                {stripeHealthIssueLabel("MISSING_PRICING_BINDING", locale)}
              </option>
              <option value="FAILED_PAYMENT">
                {stripeHealthIssueLabel("FAILED_PAYMENT", locale)}
              </option>
              <option value="RECONCILIATION_FAILURE">
                {stripeHealthIssueLabel("RECONCILIATION_FAILURE", locale)}
              </option>
              <option value="STALE_REPRICING_COMMAND">
                {stripeHealthIssueLabel("STALE_REPRICING_COMMAND", locale)}
              </option>
            </select>
          </label>
          <label>
            <span>{text.market}</span>
            <input
              maxLength={32}
              value={query.get("market") ?? ""}
              onChange={(event) => onQuery({ market: event.target.value.toUpperCase() || null })}
              placeholder="GLOBAL"
            />
          </label>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onQuery({ severity: null, type: null, market: null, page: null })}
          >
            {text.clear}
          </Button>
        </fieldset>
      </header>
      {page.items.length === 0 ? (
        <p className="admin-stripe-health-empty">{text.noIssues}</p>
      ) : (
        <>
          <div className="admin-stripe-health-table-scroll">
            <table className="admin-stripe-health-table">
              <thead>
                <tr>
                  <th>{text.severity}</th>
                  <th>{text.type}</th>
                  <th>{text.customer}</th>
                  <th>{text.status}</th>
                  <th>{text.detected}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {page.items.map((item) => (
                  <tr key={item.id}>
                    <td data-label={text.severity}>
                      <StatusPill severity={item.severity} value={1} locale={locale} />
                    </td>
                    <th data-label={text.type}>
                      <button type="button" onClick={() => void onOpen(item)}>
                        {stripeHealthIssueLabel(item.type, locale)}
                        <small>{item.summary}</small>
                      </button>
                    </th>
                    <td data-label={text.customer}>{item.customer?.name ?? "—"}</td>
                    <td data-label={text.status}>{item.subscription?.status ?? "—"}</td>
                    <td data-label={text.detected}>{stripeHealthDate(item.lastSeenAt, locale)}</td>
                    <td>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => void onOpen(item)}
                        aria-label={text.issueDetail}
                      >
                        <ChevronRight size={17} aria-hidden="true" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav className="admin-stripe-health-pagination" aria-label={text.issues}>
            <span>
              {text.page} {page.page} / {page.totalPages} · {page.totalCount}
            </span>
            <Button
              type="button"
              variant="secondary"
              disabled={page.page <= 1}
              onClick={() => onQuery({ page: String(page.page - 1) })}
            >
              <ChevronLeft size={15} aria-hidden="true" />
              {text.previous}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={page.page >= page.totalPages}
              onClick={() => onQuery({ page: String(page.page + 1) })}
            >
              {text.next}
              <ChevronRight size={15} aria-hidden="true" />
            </Button>
          </nav>
        </>
      )}
    </section>
  );
}

function WebhookEvidence({ overview, locale }: { overview: StripeHealthOverview; locale: Locale }) {
  const text = stripeHealthCopy(locale);
  return (
    <section className="admin-stripe-health-panel admin-stripe-health-panel--wide">
      <header>
        <div>
          <Cable size={18} aria-hidden="true" />
          <h2>{text.webhook}</h2>
        </div>
        <StatusPill
          severity={overview.webhooks.failedCount ? "WARNING" : "INFO"}
          value={overview.webhooks.failedCount}
          locale={locale}
        />
      </header>
      <dl className="admin-stripe-health-facts">
        <div>
          <dt>{text.lastReceived}</dt>
          <dd>{stripeHealthDate(overview.webhooks.lastReceivedAt, locale)}</dd>
        </div>
        <div>
          <dt>{text.lastProcessed}</dt>
          <dd>{stripeHealthDate(overview.webhooks.lastProcessedAt, locale)}</dd>
        </div>
        <div>
          <dt>{text.retryable}</dt>
          <dd>{overview.webhooks.retryableCount}</dd>
        </div>
        <div>
          <dt>{text.attempts}</dt>
          <dd>{overview.webhooks.replayedCount}</dd>
        </div>
      </dl>
      <h3>{text.expectedEvents}</h3>
      <div className="admin-stripe-health-coverage">
        {overview.webhooks.coverage.map((event) => (
          <article key={event.eventType} data-observed={event.status === "OBSERVED"}>
            <code>{event.eventType}</code>
            <span>{event.status === "OBSERVED" ? text.observed : text.notObserved}</span>
            <small>
              {event.observedCount} · {stripeHealthDate(event.lastObservedAt, locale)}
            </small>
          </article>
        ))}
      </div>
      <h3>{text.recentEvents}</h3>
      <div className="admin-stripe-health-mini-list">
        {overview.webhooks.recent.slice(0, 5).map((event) => (
          <article key={event.eventReference}>
            <code dir="ltr">{event.eventType}</code>
            <span>{event.status}</span>
            <time>{stripeHealthDate(event.receivedAt, locale)}</time>
          </article>
        ))}
      </div>
    </section>
  );
}

function Reconciliation({ overview, locale }: { overview: StripeHealthOverview; locale: Locale }) {
  const text = stripeHealthCopy(locale);
  return (
    <section className="admin-stripe-health-panel">
      <header>
        <div>
          <Activity size={18} aria-hidden="true" />
          <h2>{text.reconciliation}</h2>
        </div>
      </header>
      <dl className="admin-stripe-health-facts">
        <div>
          <dt>{text.lastSync}</dt>
          <dd>{stripeHealthDate(overview.reconciliation.lastSuccessfulProviderSyncAt, locale)}</dd>
        </div>
        <div>
          <dt>{text.dueForSync}</dt>
          <dd>{overview.reconciliation.dueForSyncCount}</dd>
        </div>
        <div>
          <dt>{text.warning}</dt>
          <dd>{overview.reconciliation.failureCount}</dd>
        </div>
        <div>
          <dt>{text.activeLeases}</dt>
          <dd>{overview.reconciliation.activeLeases}</dd>
        </div>
      </dl>
      <p className="admin-stripe-health-disclosure">
        <Clock3 size={15} aria-hidden="true" />
        {text.noRunRecord}
      </p>
    </section>
  );
}

function Payments({
  overview,
  locale,
  canViewFinance,
}: {
  overview: StripeHealthOverview;
  locale: Locale;
  canViewFinance: boolean;
}) {
  const text = stripeHealthCopy(locale);
  return (
    <section className="admin-stripe-health-panel admin-stripe-health-panel--wide">
      <header>
        <div>
          <ReceiptText size={18} aria-hidden="true" />
          <h2>{text.payments}</h2>
        </div>
      </header>
      {!overview.payments.failures.length ? (
        <p className="admin-stripe-health-empty">{text.noIssues}</p>
      ) : (
        <div className="admin-stripe-health-table-scroll">
          <table className="admin-stripe-health-table admin-stripe-health-table--compact">
            <thead>
              <tr>
                <th>{text.customer}</th>
                <th>{text.invoice}</th>
                <th>{text.plan}</th>
                {canViewFinance ? <th>{text.amount}</th> : null}
                <th>{text.failedAt}</th>
                <th>{text.status}</th>
              </tr>
            </thead>
            <tbody>
              {overview.payments.failures.map((failure) => (
                <tr key={`${failure.invoiceReference}:${failure.failureAt}`}>
                  <th>
                    <Link href={`/${locale}/customers/${failure.customer.id}`}>
                      {failure.customer.name}
                    </Link>
                  </th>
                  <td>
                    <code dir="ltr">{failure.invoiceReference}</code>
                  </td>
                  <td>{failure.plan ?? "—"}</td>
                  {canViewFinance ? (
                    <td dir="auto">
                      {stripeHealthMoney(failure.amountMinor, failure.currency, locale) ?? "—"}
                    </td>
                  ) : null}
                  <td>{stripeHealthDate(failure.failureAt, locale)}</td>
                  <td>{failure.subscriptionStatus}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Catalog({ overview, locale }: { overview: StripeHealthOverview; locale: Locale }) {
  const text = stripeHealthCopy(locale);
  return (
    <section className="admin-stripe-health-panel">
      <header>
        <div>
          <CreditCard size={18} aria-hidden="true" />
          <h2>{text.catalog}</h2>
        </div>
      </header>
      <dl className="admin-stripe-health-facts">
        <div>
          <dt>{text.unknownPrice}</dt>
          <dd>{overview.catalog.unknownStripePriceCount}</dd>
        </div>
        <div>
          <dt>{text.bindingIssues}</dt>
          <dd>{overview.catalog.bindingMismatchCount}</dd>
        </div>
        <div>
          <dt>{text.missing}</dt>
          <dd>{overview.catalog.publishedWithoutBinding}</dd>
        </div>
      </dl>
      <Link className="admin-stripe-health-link" href={`/${locale}/pricing`}>
        <ExternalLink size={15} aria-hidden="true" />
        {text.viewPricing}
      </Link>
    </section>
  );
}

function Evidence({ overview, locale }: { overview: StripeHealthOverview; locale: Locale }) {
  const text = stripeHealthCopy(locale);
  return (
    <section className="admin-stripe-health-panel">
      <header>
        <div>
          <Database size={18} aria-hidden="true" />
          <h2>{text.evidence}</h2>
        </div>
      </header>
      <dl className="admin-stripe-health-facts">
        <div>
          <dt>{text.status}</dt>
          <dd>{overview.financialEvidence.coverage}</dd>
        </div>
        <div>
          <dt>{text.lastReceived}</dt>
          <dd>{stripeHealthDate(overview.financialEvidence.latestEvidenceAt, locale)}</dd>
        </div>
        <div>
          <dt>{text.refunds}</dt>
          <dd>{text.notAvailable}</dd>
        </div>
        <div>
          <dt>{text.fees}</dt>
          <dd>{text.notAvailable}</dd>
        </div>
      </dl>
      <p className="admin-stripe-health-disclosure">
        <CircleAlert size={15} aria-hidden="true" />
        {text.partial}
      </p>
    </section>
  );
}

function Configuration({ overview, locale }: { overview: StripeHealthOverview; locale: Locale }) {
  const text = stripeHealthCopy(locale);
  const config = overview.providerConfiguration;
  const label = (value: "CONFIGURED" | "MISSING") =>
    value === "CONFIGURED" ? text.configured : text.missing;
  const mode =
    config.mode === "TEST" ? text.test : config.mode === "LIVE" ? text.live : text.unknown;
  return (
    <section className="admin-stripe-health-panel">
      <header>
        <div>
          <HeartPulse size={18} aria-hidden="true" />
          <h2>{text.configuration}</h2>
        </div>
      </header>
      <dl className="admin-stripe-health-facts">
        <div>
          <dt>{text.credentials}</dt>
          <dd>{label(config.apiCredentials)}</dd>
        </div>
        <div>
          <dt>{text.signing}</dt>
          <dd>{label(config.webhookSigning)}</dd>
        </div>
        <div>
          <dt>{text.portal}</dt>
          <dd>{label(config.portalConfiguration)}</dd>
        </div>
        <div>
          <dt>{text.mode}</dt>
          <dd>{mode}</dd>
        </div>
        <div>
          <dt>{text.environment}</dt>
          <dd>{config.environment}</dd>
        </div>
      </dl>
      {config.environmentMismatch ? (
        <Alert
          tone="danger"
          title={stripeHealthIssueLabel("PROVIDER_CONFIGURATION_MISMATCH", locale)}
        />
      ) : null}
    </section>
  );
}

function IssueDetail({
  issue,
  locale,
  onClose,
}: {
  issue: StripeHealthIssue | null;
  locale: Locale;
  onClose: () => void;
}) {
  const text = stripeHealthCopy(locale);
  return (
    <Modal
      open={Boolean(issue)}
      title={text.issueDetail}
      description={issue?.summary ?? ""}
      descriptionVisible
      onClose={onClose}
    >
      {issue ? (
        <div className="admin-stripe-health-detail">
          <StatusPill severity={issue.severity} value={1} locale={locale} />
          <h3>{stripeHealthIssueLabel(issue.type, locale)}</h3>
          <dl className="admin-stripe-health-facts">
            <div>
              <dt>{text.detected}</dt>
              <dd>{stripeHealthDate(issue.lastSeenAt, locale)}</dd>
            </div>
            <div>
              <dt>{text.customer}</dt>
              <dd>{issue.customer?.name ?? "—"}</dd>
            </div>
            <div>
              <dt>{text.status}</dt>
              <dd>{issue.subscription?.status ?? "—"}</dd>
            </div>
            <div>
              <dt>{text.market}</dt>
              <dd>{issue.pricing?.market ?? "—"}</dd>
            </div>
          </dl>
          <section>
            <h4>{text.safeEvidence}</h4>
            <dl className="admin-stripe-health-context">
              {Object.entries(issue.safeContext).map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd dir="auto">{value === null ? "—" : String(value)}</dd>
                </div>
              ))}
            </dl>
          </section>
          <div className="admin-stripe-health-detail__links">
            {issue.customer ? (
              <Link href={`/${locale}/customers/${issue.customer.id}`}>
                <ExternalLink size={15} aria-hidden="true" />
                {text.viewCustomer}
              </Link>
            ) : null}
            {issue.pricing?.pricingVersionId ? (
              <Link href={`/${locale}/pricing`}>
                <ExternalLink size={15} aria-hidden="true" />
                {text.viewPricing}
              </Link>
            ) : null}
            {issue.repricingCampaignId ? (
              <Link href={`/${locale}/repricing/${issue.repricingCampaignId}`}>
                <ExternalLink size={15} aria-hidden="true" />
                {text.viewRepricing}
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
