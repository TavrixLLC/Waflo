"use client";

import type { Locale } from "@waflo/contracts";
import { Alert, Button, Skeleton } from "@waflo/ui";
import {
  Activity,
  ArrowLeft,
  BookOpen,
  Building2,
  CreditCard,
  FileClock,
  Landmark,
  ReceiptText,
  ShieldCheck,
  Tag,
} from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";
import { adminApi } from "../lib/admin-api";
import {
  type AdminCustomerDetail,
  adminCustomerDetailPath,
  adminCustomersCopy,
  canViewCustomerFinance,
  customerCadenceLabel,
  customerInvoiceStatusLabel,
  customerPlanLabel,
  customerStatusLabel,
  formatCustomerDate,
  formatCustomerMoney,
} from "./admin-customers";
import { RequireAdminCapability, useAdminSession } from "./admin-session";
import type { StripeHealthIssuePage } from "./admin-stripe-health";

function DetailValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="admin-customer-detail-value">
      <span>{label}</span>
      <strong>{children}</strong>
    </div>
  );
}

function Money({
  amountMinor,
  currency,
  locale,
}: {
  amountMinor: string | null;
  currency: string | null;
  locale: Locale;
}) {
  const value = formatCustomerMoney(amountMinor, currency, locale);
  return value ? <span dir="auto">{value}</span> : <>—</>;
}

function EmptyHistory({ children }: { children: React.ReactNode }) {
  return <p className="admin-customer-history-empty">{children}</p>;
}

export function AdminCustomer360({ customerId, locale }: { customerId: string; locale: Locale }) {
  const text = adminCustomersCopy(locale);
  const { me } = useAdminSession();
  const financeAllowed = canViewCustomerFinance(me.permissions);
  const canViewStripeHealth = me.permissions.includes("admin.stripe_health.read");
  const [billingHealth, setBillingHealth] = useState<StripeHealthIssuePage | null>(null);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "ready"; data: AdminCustomerDetail }
  >({ kind: "loading" });

  // Revision intentionally repeats the one server-authoritative customer request.
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision is an intentional retry trigger.
  useEffect(() => {
    let active = true;
    setState({ kind: "loading" });
    void adminApi<AdminCustomerDetail>(adminCustomerDetailPath(customerId))
      .then((data) => active && setState({ kind: "ready", data }))
      .catch(
        (error: unknown) =>
          active &&
          setState({
            kind: "error",
            message: error instanceof Error ? error.message : text.failed,
          }),
      );
    return () => {
      active = false;
    };
  }, [customerId, revision, text.failed]);

  useEffect(() => {
    let active = true;
    if (!canViewStripeHealth) {
      setBillingHealth(null);
      return () => {
        active = false;
      };
    }
    void adminApi<StripeHealthIssuePage>(
      `/v1/admin/stripe-health/issues?customerId=${encodeURIComponent(customerId)}&page=1&pageSize=5`,
    )
      .then((issues) => active && setBillingHealth(issues))
      .catch(() => active && setBillingHealth(null));
    return () => {
      active = false;
    };
  }, [canViewStripeHealth, customerId]);

  return (
    <RequireAdminCapability permission="admin.customers.read" locale={locale}>
      <div className="admin-customer-360" dir={locale === "ar" ? "rtl" : "ltr"}>
        <Link className="admin-customer-back" href={`/${locale}/customers`}>
          <ArrowLeft size={16} aria-hidden="true" />
          {text.back}
        </Link>
        {state.kind === "loading" ? (
          <section className="admin-customer-loading" aria-live="polite" aria-busy="true">
            <Skeleton height="5rem" />
            <Skeleton height="24rem" />
            <span>{text.loading}</span>
          </section>
        ) : null}
        {state.kind === "error" ? (
          <section className="admin-customer-error" aria-live="assertive">
            <Alert tone="danger" title={state.message} />
            <Button onClick={() => setRevision((value) => value + 1)}>{text.retry}</Button>
          </section>
        ) : null}
        {state.kind === "ready" ? (
          <CustomerDetail
            data={state.data}
            locale={locale}
            financeAllowed={financeAllowed}
            billingHealth={billingHealth}
          />
        ) : null}
      </div>
    </RequireAdminCapability>
  );
}

function CustomerDetail({
  data,
  locale,
  financeAllowed,
  billingHealth,
}: {
  data: AdminCustomerDetail;
  locale: Locale;
  financeAllowed: boolean;
  billingHealth: StripeHealthIssuePage | null;
}) {
  const text = adminCustomersCopy(locale);
  const current = data.subscription;
  return (
    <>
      <header className="admin-customer-360__header">
        <div>
          <span>{text.eyebrow}</span>
          <h1>{data.organization.name}</h1>
          <p>{data.customerId}</p>
        </div>
        <div
          className="admin-customer-status"
          data-tone={current?.status === "ACTIVE" ? "good" : "neutral"}
        >
          {customerStatusLabel(current?.status ?? null, locale)}
        </div>
      </header>
      <nav className="admin-customer-sections" aria-label={text.title}>
        <a href="#overview">{text.overview}</a>
        <a href="#subscription">{text.subscription}</a>
        <a href="#billing">{text.billingHistory}</a>
        <a href="#pricing">{text.pricingHistory}</a>
        <a href="#repricing">{text.repricing}</a>
        <a href="#audit">{text.audit}</a>
      </nav>

      <section id="overview" className="admin-customer-detail-grid">
        <article className="admin-customer-panel">
          <header>
            <Building2 size={18} aria-hidden="true" />
            <h2>{text.organization}</h2>
          </header>
          <div className="admin-customer-detail-list">
            <DetailValue label={text.customer}>{data.customerId}</DetailValue>
            <DetailValue label={text.businessCountry}>
              {data.organization.billingCountry ?? "—"}
            </DetailValue>
            <DetailValue label={text.market}>
              {data.subscription?.commercialTerms.market ?? "—"}
            </DetailValue>
            <DetailValue label={text.created}>
              {formatCustomerDate(data.organization.createdAt, locale)}
            </DetailValue>
            <DetailValue label={text.owner}>
              {data.organization.owner ? (
                <>
                  {data.organization.owner.displayName}
                  <small>{data.organization.owner.email}</small>
                </>
              ) : (
                "—"
              )}
            </DetailValue>
          </div>
        </article>
        <article className="admin-customer-panel">
          <header>
            <Landmark size={18} aria-hidden="true" />
            <h2>{text.account}</h2>
          </header>
          <div className="admin-customer-detail-list">
            <DetailValue label={text.activePrograms}>{data.account.activeProgramCount}</DetailValue>
            <DetailValue label={text.publishedPrograms}>
              {data.account.publishedProgramCount}
            </DetailValue>
            <DetailValue label={text.joined}>
              {formatCustomerDate(data.organization.owner?.joinedAt ?? null, locale)}
            </DetailValue>
            <DetailValue label={text.status}>{data.organization.status}</DetailValue>
            <DetailValue label={text.trial}>{data.trial.status}</DetailValue>
          </div>
        </article>
        <article className="admin-customer-panel">
          <header>
            <FileClock size={18} aria-hidden="true" />
            <h2>{text.trialContract}</h2>
          </header>
          <div className="admin-customer-detail-list">
            <DetailValue label={text.trialStarted}>
              {formatCustomerDate(data.trial.start, locale)}
            </DetailValue>
            <DetailValue label={text.trialEnds}>
              {formatCustomerDate(data.trial.end, locale)}
            </DetailValue>
            <DetailValue label={text.conversion}>
              {data.trial.converted === true
                ? formatCustomerDate(data.trial.convertedAt, locale)
                : data.trial.converted === false
                  ? text.no
                  : text.notProven}
            </DetailValue>
            <DetailValue label={text.status}>{data.trial.status}</DetailValue>
          </div>
        </article>
      </section>

      <section id="subscription" className="admin-customer-panel admin-customer-panel--full">
        <header>
          <CreditCard size={18} aria-hidden="true" />
          <h2>{text.subscription}</h2>
          {billingHealth ? (
            <Link
              className="admin-customer-health-link"
              href={`/${locale}/stripe-health?customerId=${encodeURIComponent(data.customerId)}`}
            >
              <Activity size={15} aria-hidden="true" />
              {text.billingHealth}:{" "}
              {billingHealth.totalCount === 0 ? text.healthy : billingHealth.totalCount}
            </Link>
          ) : null}
        </header>
        {!current ? (
          <EmptyHistory>{text.noSubscription}</EmptyHistory>
        ) : (
          <div className="admin-customer-subscription-grid">
            <div className="admin-customer-detail-list">
              <DetailValue label={text.plan}>{customerPlanLabel(current.plan, locale)}</DetailValue>
              <DetailValue label={text.cadence}>
                {customerCadenceLabel(current.cadence, locale)}
              </DetailValue>
              <DetailValue label={text.subscriptionStatus}>
                {customerStatusLabel(current.status, locale)}
              </DetailValue>
              <DetailValue label={text.entitlement}>{current.entitlement.code}</DetailValue>
              <DetailValue label={text.started}>
                {formatCustomerDate(current.startedAt, locale)}
              </DetailValue>
              <DetailValue label={text.periodStart}>
                {formatCustomerDate(current.currentPeriodStart, locale)}
              </DetailValue>
              <DetailValue label={text.renewal}>
                {formatCustomerDate(current.nextRenewalAt, locale)}
              </DetailValue>
            </div>
            <div className="admin-customer-detail-list">
              <DetailValue label={text.currentTerms}>
                <Money
                  amountMinor={current.commercialTerms.amountMinor}
                  currency={current.commercialTerms.currency}
                  locale={locale}
                />
              </DetailValue>
              <DetailValue label={text.market}>{current.commercialTerms.market ?? "—"}</DetailValue>
              <DetailValue label={text.pricingVersion}>
                {current.commercialTerms.pricingVersion
                  ? `v${current.commercialTerms.pricingVersion.version}`
                  : "—"}
              </DetailValue>
              <DetailValue label={text.grandfathered}>
                {current.commercialTerms.grandfathered ? text.yes : text.no}
              </DetailValue>
              <DetailValue label={text.stripeCustomer}>
                <code>{current.stripeCustomerReference ?? "—"}</code>
              </DetailValue>
              <DetailValue label={text.stripeSubscription}>
                <code>{current.stripeSubscriptionReference}</code>
              </DetailValue>
              <DetailValue label={text.stripePrice}>
                <code>{current.stripePriceReference}</code>
              </DetailValue>
            </div>
          </div>
        )}
      </section>

      <section id="billing" className="admin-customer-panel admin-customer-panel--full">
        <header>
          <ReceiptText size={18} aria-hidden="true" />
          <h2>{text.billingHistory}</h2>
        </header>
        {!financeAllowed || !data.financial ? (
          <EmptyHistory>{text.noFinance}</EmptyHistory>
        ) : (
          <>
            <p className="admin-customer-disclosure">{text.partialHistory}</p>
            <div className="admin-customer-financial-summary">
              <DetailValue label={text.collected}>
                {data.financial.collected.length
                  ? data.financial.collected.map((amount) => (
                      <span dir="auto" key={amount.currency}>
                        {formatCustomerMoney(amount.amountMinor, amount.currency, locale)}
                      </span>
                    ))
                  : "—"}
              </DetailValue>
              <DetailValue label={text.paidInvoices}>{data.financial.paidInvoiceCount}</DetailValue>
              <DetailValue label={text.failedPayments}>
                {data.financial.failedPaymentCount}
              </DetailValue>
            </div>
            {data.financial.invoices.length === 0 ? (
              <EmptyHistory>{text.noHistory}</EmptyHistory>
            ) : (
              <div className="admin-customer-table-scroll">
                <table className="admin-customer-table">
                  <thead>
                    <tr>
                      <th>{text.invoice}</th>
                      <th>{text.status}</th>
                      <th>{text.amountDue}</th>
                      <th>{text.amountPaid}</th>
                      <th>{text.created}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.financial.invoices.map((invoice) => (
                      <tr key={invoice.stripeInvoiceReference}>
                        <th>
                          <code>{invoice.stripeInvoiceReference}</code>
                        </th>
                        <td>{customerInvoiceStatusLabel(invoice.status, locale)}</td>
                        <td>
                          <Money
                            amountMinor={invoice.amountDueMinor}
                            currency={invoice.currency}
                            locale={locale}
                          />
                        </td>
                        <td>
                          <Money
                            amountMinor={invoice.amountPaidMinor}
                            currency={invoice.currency}
                            locale={locale}
                          />
                        </td>
                        <td>
                          {formatCustomerDate(
                            invoice.paidAt ?? invoice.failedAt ?? invoice.finalizedAt,
                            locale,
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="admin-customer-disclosure">{text.refundsUnavailable}</p>
          </>
        )}
      </section>

      <section id="pricing" className="admin-customer-panel admin-customer-panel--full">
        <header>
          <Tag size={18} aria-hidden="true" />
          <h2>{text.pricingHistory}</h2>
        </header>
        {data.pricingHistory.length === 0 ? (
          <EmptyHistory>{text.noHistory}</EmptyHistory>
        ) : (
          <div className="admin-customer-timeline">
            {data.pricingHistory.map((entry) => (
              <article key={entry.subscriptionReference}>
                <time>{formatCustomerDate(entry.startedAt, locale)}</time>
                <div>
                  <strong>
                    {customerPlanLabel(entry.plan, locale)} ·{" "}
                    {customerCadenceLabel(entry.cadence, locale)}
                  </strong>
                  <p>
                    {entry.market ?? "—"} ·{" "}
                    <Money
                      amountMinor={entry.amountMinor}
                      currency={entry.currency}
                      locale={locale}
                    />{" "}
                    · {entry.pricingVersion ? `v${entry.pricingVersion.version}` : "—"}
                  </p>
                  <small>
                    {text.grandfathered}: {entry.grandfathered ? text.yes : text.no} ·{" "}
                    <code>{entry.stripePriceReference}</code>
                  </small>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="admin-customer-panel admin-customer-panel--full">
        <header>
          <BookOpen size={18} aria-hidden="true" />
          <h2>
            {text.subscription} · {text.pricingHistory}
          </h2>
        </header>
        {data.subscriptionChanges.length === 0 ? (
          <EmptyHistory>{text.noHistory}</EmptyHistory>
        ) : (
          <div className="admin-customer-history-list">
            {data.subscriptionChanges.map((entry) => (
              <article key={entry.previewId}>
                <header>
                  <strong>{entry.status}</strong>
                  <time>{formatCustomerDate(entry.createdAt, locale)}</time>
                </header>
                <div>
                  <span>{text.source}</span>
                  <strong>
                    {customerPlanLabel(entry.source.plan, locale)} ·{" "}
                    <Money
                      amountMinor={entry.source.amountMinor}
                      currency={entry.source.currency}
                      locale={locale}
                    />
                  </strong>
                </div>
                <div>
                  <span>{text.target}</span>
                  <strong>
                    {customerPlanLabel(entry.target.plan, locale)} ·{" "}
                    <Money
                      amountMinor={entry.target.amountMinor}
                      currency={entry.target.currency}
                      locale={locale}
                    />
                  </strong>
                </div>
                <small>
                  {text.dueNow}:{" "}
                  <Money
                    amountMinor={entry.proration.amountDueNowMinor}
                    currency={entry.target.currency}
                    locale={locale}
                  />{" "}
                  · {text.credit}:{" "}
                  <Money
                    amountMinor={entry.proration.creditAmountMinor}
                    currency={entry.target.currency}
                    locale={locale}
                  />
                </small>
              </article>
            ))}
          </div>
        )}
      </section>

      <section id="repricing" className="admin-customer-panel admin-customer-panel--full">
        <header>
          <FileClock size={18} aria-hidden="true" />
          <h2>{text.repricing}</h2>
        </header>
        {data.repricingHistory.length === 0 ? (
          <EmptyHistory>{text.noHistory}</EmptyHistory>
        ) : (
          <div className="admin-customer-history-list">
            {data.repricingHistory.map((entry) => (
              <article key={entry.commandId}>
                <header>
                  <strong>{entry.status}</strong>
                  <time>{formatCustomerDate(entry.createdAt, locale)}</time>
                </header>
                <div>
                  <span>{text.effective}</span>
                  <strong>{formatCustomerDate(entry.effectiveAt, locale)}</strong>
                </div>
                <div>
                  <span>{text.notice}</span>
                  <strong>{entry.notice.status}</strong>
                </div>
                {entry.notice.snapshot ? (
                  <small>
                    <Money
                      amountMinor={entry.notice.snapshot.sourceAmountMinor}
                      currency={entry.notice.snapshot.sourceCurrency}
                      locale={locale}
                    />{" "}
                    →{" "}
                    <Money
                      amountMinor={entry.notice.snapshot.targetAmountMinor}
                      currency={entry.notice.snapshot.targetCurrency}
                      locale={locale}
                    />
                  </small>
                ) : null}
                {entry.replacesCommandId ? (
                  <small>
                    {text.replaces}: <code>{entry.replacesCommandId}</code>
                  </small>
                ) : null}
                {entry.replacedByCommandId ? (
                  <small>
                    {text.replacedBy}: <code>{entry.replacedByCommandId}</code>
                  </small>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>

      <section id="audit" className="admin-customer-panel admin-customer-panel--full">
        <header>
          <ShieldCheck size={18} aria-hidden="true" />
          <h2>{text.audit}</h2>
        </header>
        {data.audit.length === 0 ? (
          <EmptyHistory>{text.noHistory}</EmptyHistory>
        ) : (
          <div className="admin-customer-audit-list">
            {data.audit.map((entry) => (
              <article key={entry.id}>
                <time>{formatCustomerDate(entry.occurredAt, locale)}</time>
                <div>
                  <strong>{entry.action}</strong>
                  <p>
                    {entry.actor.type}
                    {entry.actor.displayName ? ` · ${entry.actor.displayName}` : ""}
                  </p>
                  {entry.metadata ? <pre>{JSON.stringify(entry.metadata, null, 2)}</pre> : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
