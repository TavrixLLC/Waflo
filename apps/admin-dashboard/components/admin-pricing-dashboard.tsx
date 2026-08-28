"use client";

import type { Locale } from "@waflo/contracts";
import { Alert, Button, Modal, Skeleton, Toast } from "@waflo/ui";
import { Globe2, Landmark, Plus, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { adminApi } from "../lib/admin-api";
import {
  type AdminPricingMarket,
  type AdminPricingOverview,
  adminPricingCopy,
  adminPricingMoney,
  adminPricingStatusLabel,
  pricingMarketPath,
} from "./admin-pricing";
import { RequireAdminCapability, useAdminSession } from "./admin-session";

function currentMatrixVersion(market: AdminPricingMarket, plan: string, cadence: string) {
  return market.versions.find(
    (version) =>
      version.plan === plan && version.cadence === cadence && version.status === "CURRENT",
  );
}

export function AdminPricingDashboard({ locale }: { locale: Locale }) {
  const text = adminPricingCopy(locale);
  const { me } = useAdminSession();
  const canWrite = me.permissions.includes("admin.pricing.write");
  const [revision, setRevision] = useState(0);
  const [newMarketOpen, setNewMarketOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    country: "",
    currency: "",
    plan: "",
    cadence: "",
    status: "",
    grandfathered: "",
    binding: "",
  });
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "ready"; data: AdminPricingOverview }
  >({ kind: "loading" });

  // biome-ignore lint/correctness/useExhaustiveDependencies: revision intentionally retries the same catalog request.
  useEffect(() => {
    let active = true;
    setState({ kind: "loading" });
    void adminApi<AdminPricingOverview>("/v1/admin/pricing/overview")
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
  }, [revision, text.failed]);

  const global =
    state.kind === "ready" ? state.data.markets.find((market) => market.kind === "GLOBAL") : null;
  return (
    <RequireAdminCapability permission="admin.pricing.read" locale={locale}>
      <div className="admin-pricing" dir={locale === "ar" ? "rtl" : "ltr"}>
        <header className="admin-pricing__header">
          <div>
            <span>{text.eyebrow}</span>
            <h1>{text.title}</h1>
            <p>{text.subtitle}</p>
          </div>
          {canWrite ? (
            <Button onClick={() => setNewMarketOpen(true)}>
              <Plus size={16} aria-hidden="true" />
              {text.addMarket}
            </Button>
          ) : null}
        </header>

        {notice ? <Toast>{notice}</Toast> : null}
        {state.kind === "loading" ? (
          <section className="admin-pricing-loading" aria-live="polite" aria-busy="true">
            <Skeleton height="9rem" />
            <Skeleton height="19rem" />
            <span>{text.loading}</span>
          </section>
        ) : null}
        {state.kind === "error" ? (
          <section className="admin-pricing-error" aria-live="assertive">
            <Alert tone="danger" title={state.message} />
            <Button variant="secondary" onClick={() => setRevision((value) => value + 1)}>
              {text.retry}
            </Button>
          </section>
        ) : null}
        {state.kind === "ready" ? (
          <>
            <section className="admin-pricing-kpis" aria-label={text.title}>
              <PricingFact
                label={text.configuredMarkets}
                value={state.data.summary.configuredMarkets}
              />
              <PricingFact
                label={text.activeVersions}
                value={state.data.summary.activePriceVersions}
              />
              <PricingFact
                label={text.grandfathered}
                value={state.data.summary.grandfatheredSubscribers}
              />
              <PricingFact label={text.bindingIssues} value={state.data.summary.bindingIssues} />
            </section>
            <section className="admin-pricing-notice">
              <ShieldCheck size={18} aria-hidden="true" />
              <div>
                <strong>{text.globalSafety}</strong>
                <p>{text.regionalImpact}</p>
              </div>
            </section>
            {global ? (
              <GlobalPricing market={global} overview={state.data} locale={locale} />
            ) : null}
            <section className="admin-pricing-panel">
              <header>
                <div>
                  <Landmark size={18} aria-hidden="true" />
                  <h2>{text.regional}</h2>
                </div>
                <small>{text.noManualPrice}</small>
              </header>
              <MarketFilters
                filters={filters}
                onChange={(field, value) =>
                  setFilters((current) => ({ ...current, [field]: value }))
                }
                onClear={() =>
                  setFilters({
                    country: "",
                    currency: "",
                    plan: "",
                    cadence: "",
                    status: "",
                    grandfathered: "",
                    binding: "",
                  })
                }
                overview={state.data}
                locale={locale}
              />
              <RegionalMarkets
                markets={filterMarkets(
                  state.data.markets.filter((market) => market.kind === "COUNTRY_OVERRIDE"),
                  filters,
                )}
                locale={locale}
              />
            </section>
          </>
        ) : null}
        <NewMarketDialog
          locale={locale}
          open={newMarketOpen}
          onClose={() => setNewMarketOpen(false)}
          onCreated={() => {
            setNotice(text.marketCreated);
            setNewMarketOpen(false);
            setRevision((value) => value + 1);
          }}
        />
      </div>
    </RequireAdminCapability>
  );
}

type PricingFilters = {
  country: string;
  currency: string;
  plan: string;
  cadence: string;
  status: string;
  grandfathered: string;
  binding: string;
};

function filterMarkets(markets: AdminPricingMarket[], filters: PricingFilters) {
  return markets.filter((market) => {
    const versions = market.versions;
    const countryMatches =
      !filters.country ||
      `${market.countryCode ?? ""} ${market.code}`
        .toLowerCase()
        .includes(filters.country.toLowerCase());
    const currencyMatches = !filters.currency || market.configuredCurrency === filters.currency;
    const planMatches = !filters.plan || versions.some((version) => version.plan === filters.plan);
    const cadenceMatches =
      !filters.cadence || versions.some((version) => version.cadence === filters.cadence);
    const statusMatches =
      !filters.status || versions.some((version) => version.status === filters.status);
    const grandfatheredMatches =
      !filters.grandfathered ||
      (filters.grandfathered === "yes"
        ? market.grandfatheredSubscribers > 0
        : market.grandfatheredSubscribers === 0);
    const bindingMatches =
      !filters.binding ||
      versions.some((version) => version.stripeBinding.status === filters.binding);
    return (
      countryMatches &&
      currencyMatches &&
      planMatches &&
      cadenceMatches &&
      statusMatches &&
      grandfatheredMatches &&
      bindingMatches
    );
  });
}

function MarketFilters({
  filters,
  onChange,
  onClear,
  overview,
  locale,
}: {
  filters: PricingFilters;
  onChange: (field: keyof PricingFilters, value: string) => void;
  onClear: () => void;
  overview: AdminPricingOverview;
  locale: Locale;
}) {
  const text = adminPricingCopy(locale);
  const currencies = [
    ...new Set(
      overview.markets
        .map((market) => market.configuredCurrency)
        .filter((currency): currency is string => Boolean(currency)),
    ),
  ];
  const hasFilters = Object.values(filters).some(Boolean);
  return (
    <fieldset className="admin-pricing-filters">
      <legend>{text.filters}</legend>
      <label>
        <span>{text.country}</span>
        <input
          value={filters.country}
          onChange={(event) => onChange("country", event.target.value)}
          autoComplete="off"
        />
      </label>
      <SelectFilter
        label={text.currency}
        allLabel={text.all}
        value={filters.currency}
        onChange={(value) => onChange("currency", value)}
      >
        {currencies.map((currency) => (
          <option key={currency} value={currency}>
            {currency}
          </option>
        ))}
      </SelectFilter>
      <SelectFilter
        label={text.plan}
        allLabel={text.all}
        value={filters.plan}
        onChange={(value) => onChange("plan", value)}
      >
        {overview.plans.map((plan) => (
          <option key={plan} value={plan}>
            {plan}
          </option>
        ))}
      </SelectFilter>
      <SelectFilter
        label={text.cadence}
        allLabel={text.all}
        value={filters.cadence}
        onChange={(value) => onChange("cadence", value)}
      >
        {overview.cadences.map((cadence) => (
          <option key={cadence} value={cadence}>
            {cadence}
          </option>
        ))}
      </SelectFilter>
      <SelectFilter
        label={text.status}
        allLabel={text.all}
        value={filters.status}
        onChange={(value) => onChange("status", value)}
      >
        {(["DRAFT", "VALIDATED", "CURRENT", "RETIRED"] as const).map((status) => (
          <option key={status} value={status}>
            {adminPricingStatusLabel(status, locale)}
          </option>
        ))}
      </SelectFilter>
      <SelectFilter
        label={text.grandfathered}
        allLabel={text.all}
        value={filters.grandfathered}
        onChange={(value) => onChange("grandfathered", value)}
      >
        <option value="yes">
          {text.grandfathered}: {text.yes}
        </option>
        <option value="no">
          {text.grandfathered}: {text.no}
        </option>
      </SelectFilter>
      <SelectFilter
        label={text.binding}
        allLabel={text.all}
        value={filters.binding}
        onChange={(value) => onChange("binding", value)}
      >
        <option value="BOUND">{text.bound}</option>
        <option value="UNBOUND">{text.unbound}</option>
      </SelectFilter>
      <Button type="button" variant="secondary" onClick={onClear} disabled={!hasFilters}>
        {text.clearFilters}
      </Button>
    </fieldset>
  );
}

function SelectFilter({
  label,
  allLabel,
  value,
  onChange,
  children,
}: {
  label: string;
  allLabel: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{allLabel}</option>
        {children}
      </select>
    </label>
  );
}

function PricingFact({ label, value }: { label: string; value: number }) {
  return (
    <article>
      <span>{label}</span>
      <strong>{new Intl.NumberFormat().format(value)}</strong>
    </article>
  );
}

function GlobalPricing({
  market,
  overview,
  locale,
}: {
  market: AdminPricingMarket;
  overview: AdminPricingOverview;
  locale: Locale;
}) {
  const text = adminPricingCopy(locale);
  return (
    <section className="admin-pricing-panel admin-pricing-panel--global">
      <header>
        <div>
          <Globe2 size={18} aria-hidden="true" />
          <h2>{text.global}</h2>
        </div>
        <Link href={pricingMarketPath(locale, market.id)}>{text.details}</Link>
      </header>
      <p className="admin-pricing-panel__caption">USD · {text.current}</p>
      <div className="admin-pricing-matrix">
        {overview.plans.flatMap((plan) =>
          overview.cadences.map((cadence) => {
            const version = currentMatrixVersion(market, plan, cadence);
            return (
              <article key={`${plan}:${cadence}`}>
                <span>
                  {plan} / {cadence}
                </span>
                <strong dir="auto">
                  {version
                    ? adminPricingMoney(version.amountMinor, version.currency, locale)
                    : text.required}
                </strong>
                <small>{version ? `v${version.version}` : text.unbound}</small>
              </article>
            );
          }),
        )}
      </div>
    </section>
  );
}

function RegionalMarkets({ markets, locale }: { markets: AdminPricingMarket[]; locale: Locale }) {
  const text = adminPricingCopy(locale);
  if (!markets.length) return <p className="admin-pricing-empty">{text.empty}</p>;
  return (
    <div className="admin-pricing-table-scroll">
      <table className="admin-pricing-table">
        <thead>
          <tr>
            <th>{text.country}</th>
            <th>{text.market}</th>
            <th>{text.currency}</th>
            <th>{text.currentPrices}</th>
            <th>{text.activeVersions}</th>
            <th>{text.subscribers}</th>
            <th>{text.grandfathered}</th>
            <th>{text.binding}</th>
          </tr>
        </thead>
        <tbody>
          {markets.map((market) => {
            const current = market.versions.filter((version) => version.status === "CURRENT");
            const hasIssue = current.some((version) => version.stripeBinding.status !== "BOUND");
            return (
              <tr key={market.id}>
                <th data-label={text.country}>
                  <Link href={pricingMarketPath(locale, market.id)}>
                    {market.countryCode ?? market.code}
                  </Link>
                </th>
                <td data-label={text.market}>{market.code}</td>
                <td data-label={text.currency}>{market.configuredCurrency ?? "—"}</td>
                <td data-label={text.currentPrices}>
                  {current.length
                    ? current.map((version) => (
                        <span key={version.id} className="admin-pricing-rate" dir="auto">
                          {version.plan} / {version.cadence}:{" "}
                          {adminPricingMoney(version.amountMinor, version.currency, locale)}
                        </span>
                      ))
                    : "—"}
                </td>
                <td data-label={text.activeVersions}>{current.length}</td>
                <td data-label={text.subscribers}>{market.subscribers}</td>
                <td data-label={text.grandfathered}>{market.grandfatheredSubscribers}</td>
                <td data-label={text.binding}>
                  <span className="admin-pricing-status" data-tone={hasIssue ? "risk" : "good"}>
                    {hasIssue ? text.unbound : text.bound}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function NewMarketDialog({
  locale,
  open,
  onClose,
  onCreated,
}: {
  locale: Locale;
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const text = adminPricingCopy(locale);
  const [countryCode, setCountryCode] = useState("");
  const [currency, setCurrency] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await adminApi("/v1/admin/pricing/markets", {
        method: "POST",
        body: JSON.stringify({
          countryCode: countryCode.toUpperCase(),
          currency: currency.toUpperCase(),
        }),
      });
      onCreated();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : text.failed);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      open={open}
      title={text.addMarket}
      description={text.regionalImpact}
      descriptionVisible
      onClose={onClose}
      locked={saving}
    >
      <form className="admin-pricing-form" onSubmit={(event) => void submit(event)}>
        <label>
          <span>{text.country}</span>
          <input
            value={countryCode}
            onChange={(event) => setCountryCode(event.target.value)}
            maxLength={2}
            required
            autoComplete="off"
          />
        </label>
        <label>
          <span>{text.currency}</span>
          <input
            value={currency}
            onChange={(event) => setCurrency(event.target.value)}
            maxLength={3}
            required
            autoComplete="off"
          />
        </label>
        {error ? <Alert tone="danger" title={error} /> : null}
        <div className="wf-dialog__actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            {text.cancel}
          </Button>
          <Button type="submit" loading={saving}>
            {text.addMarket}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
