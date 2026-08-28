"use client";

import { billingCadences, type Locale, planCodes } from "@waflo/contracts";
import { Alert, Button, Modal, Skeleton, Toast } from "@waflo/ui";
import { ArrowLeft, CircleDollarSign, ExternalLink, History, ShieldAlert, Tag } from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { AdminApiError, adminApi } from "../lib/admin-api";
import {
  type AdminPricingMarket,
  type AdminPricingVersion,
  adminPricingCopy,
  adminPricingCustomerLink,
  adminPricingDate,
  adminPricingMoney,
  adminPricingStatusLabel,
} from "./admin-pricing";
import { RequireAdminCapability, useAdminSession } from "./admin-session";

type SensitiveAction =
  | { kind: "publish"; version: AdminPricingVersion }
  | { kind: "retire"; version: AdminPricingVersion }
  | { kind: "deactivate"; version: null };

export function AdminPricingMarketDetail({
  marketId,
  locale,
}: {
  marketId: string;
  locale: Locale;
}) {
  const text = adminPricingCopy(locale);
  const { me } = useAdminSession();
  const canWrite = me.permissions.includes("admin.pricing.write");
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [draftOpen, setDraftOpen] = useState(false);
  const [sensitiveAction, setSensitiveAction] = useState<SensitiveAction | null>(null);
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "ready"; data: AdminPricingMarket }
  >({ kind: "loading" });

  // biome-ignore lint/correctness/useExhaustiveDependencies: revision intentionally retries the same market request.
  useEffect(() => {
    let active = true;
    setState({ kind: "loading" });
    void adminApi<AdminPricingMarket>(`/v1/admin/pricing/markets/${encodeURIComponent(marketId)}`)
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
  }, [marketId, revision, text.failed]);

  function complete(message: string) {
    setSensitiveAction(null);
    setDraftOpen(false);
    setNotice(message);
    setRevision((value) => value + 1);
  }

  return (
    <RequireAdminCapability permission="admin.pricing.read" locale={locale}>
      <div className="admin-pricing admin-pricing-market" dir={locale === "ar" ? "rtl" : "ltr"}>
        <Link className="admin-customer-back" href={`/${locale}/pricing`}>
          <ArrowLeft size={16} aria-hidden="true" />
          {text.back}
        </Link>
        {notice ? <Toast>{notice}</Toast> : null}
        {state.kind === "loading" ? (
          <section className="admin-pricing-loading" aria-live="polite" aria-busy="true">
            <Skeleton height="7rem" />
            <Skeleton height="24rem" />
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
            <header className="admin-pricing__header">
              <div>
                <span>{state.data.kind === "GLOBAL" ? text.global : text.regional}</span>
                <h1>{state.data.code}</h1>
                <p>
                  {state.data.countryCode ?? "GLOBAL"} ·{" "}
                  {state.data.configuredCurrency ?? text.required}
                </p>
              </div>
              {canWrite ? (
                <div className="admin-pricing-actions">
                  <Button onClick={() => setDraftOpen(true)} disabled={!state.data.active}>
                    <Tag size={16} aria-hidden="true" />
                    {text.createDraft}
                  </Button>
                  {state.data.kind === "COUNTRY_OVERRIDE" ? (
                    <Button
                      variant="secondary"
                      onClick={() =>
                        state.data.active
                          ? setSensitiveAction({ kind: "deactivate", version: null })
                          : void activateMarket(state.data.id, complete, text)
                      }
                    >
                      {state.data.active ? text.deactivate : text.activate}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </header>
            <section className="admin-pricing-notice">
              <ShieldAlert size={18} aria-hidden="true" />
              <div>
                <strong>{text.regionalImpact}</strong>
                <p>{text.noManualPrice}</p>
              </div>
            </section>
            <section className="admin-pricing-panel">
              <header>
                <div>
                  <CircleDollarSign size={18} aria-hidden="true" />
                  <h2>{text.matrix}</h2>
                </div>
              </header>
              <MarketMatrix market={state.data} locale={locale} />
            </section>
            <section className="admin-pricing-panel">
              <header>
                <div>
                  <History size={18} aria-hidden="true" />
                  <h2>{text.history}</h2>
                </div>
              </header>
              <VersionHistory
                market={state.data}
                locale={locale}
                canWrite={canWrite}
                onValidated={() => complete(text.validatedSuccess)}
                onSensitive={setSensitiveAction}
              />
            </section>
            <DraftDialog
              locale={locale}
              market={state.data}
              open={draftOpen}
              onClose={() => setDraftOpen(false)}
              onCreated={() => complete(text.draftSaved)}
            />
            <SensitivePricingDialog
              locale={locale}
              market={state.data}
              action={sensitiveAction}
              onClose={() => setSensitiveAction(null)}
              onCompleted={() =>
                complete(
                  sensitiveAction?.kind === "publish"
                    ? text.published
                    : sensitiveAction?.kind === "retire"
                      ? text.retiredSuccess
                      : text.inactive,
                )
              }
            />
          </>
        ) : null}
      </div>
    </RequireAdminCapability>
  );
}

async function activateMarket(
  marketId: string,
  complete: (message: string) => void,
  text: ReturnType<typeof adminPricingCopy>,
) {
  try {
    await adminApi(`/v1/admin/pricing/markets/${encodeURIComponent(marketId)}`, {
      method: "PATCH",
      body: JSON.stringify({ active: true }),
    });
    complete(text.active);
  } catch {
    complete(text.failed);
  }
}

function MarketMatrix({ market, locale }: { market: AdminPricingMarket; locale: Locale }) {
  const text = adminPricingCopy(locale);
  const current = market.versions.filter((version) => version.status === "CURRENT");
  return (
    <div className="admin-pricing-matrix admin-pricing-matrix--large">
      {current.length ? (
        current.map((version) => (
          <article key={version.id}>
            <span>
              {version.plan} / {version.cadence}
            </span>
            <strong dir="auto">
              {adminPricingMoney(version.amountMinor, version.currency, locale)}
            </strong>
            <small>
              v{version.version} ·{" "}
              {version.stripeBinding.status === "BOUND" ? text.bound : text.unbound}
            </small>
          </article>
        ))
      ) : (
        <p className="admin-pricing-empty">{text.empty}</p>
      )}
    </div>
  );
}

function VersionHistory({
  market,
  locale,
  canWrite,
  onValidated,
  onSensitive,
}: {
  market: AdminPricingMarket;
  locale: Locale;
  canWrite: boolean;
  onValidated: () => void;
  onSensitive: (action: SensitiveAction) => void;
}) {
  const text = adminPricingCopy(locale);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function validateVersion(version: AdminPricingVersion) {
    setBusyId(version.id);
    setError(null);
    try {
      await adminApi(`/v1/admin/pricing/versions/${encodeURIComponent(version.id)}/validate`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      onValidated();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : text.failed);
    } finally {
      setBusyId(null);
    }
  }
  if (!market.versions.length) return <p className="admin-pricing-empty">{text.empty}</p>;
  return (
    <>
      {error ? <Alert tone="danger" title={error} /> : null}
      <div className="admin-pricing-table-scroll">
        <table className="admin-pricing-table">
          <thead>
            <tr>
              <th>{text.plan}</th>
              <th>{text.amount}</th>
              <th>{text.status}</th>
              <th>{text.binding}</th>
              <th>{text.subscribers}</th>
              <th>{text.grandfathered}</th>
              <th>{text.allPrices}</th>
            </tr>
          </thead>
          <tbody>
            {market.versions.map((version) => {
              const target = market.versions.find(
                (candidate) =>
                  candidate.status === "CURRENT" &&
                  candidate.plan === version.plan &&
                  candidate.cadence === version.cadence,
              );
              return (
                <tr key={version.id}>
                  <th data-label={text.plan}>
                    {version.plan}
                    <small>
                      {version.cadence} · v{version.version}
                    </small>
                  </th>
                  <td data-label={text.amount} dir="auto">
                    {adminPricingMoney(version.amountMinor, version.currency, locale)}
                  </td>
                  <td data-label={text.status}>
                    <span
                      className="admin-pricing-status"
                      data-tone={
                        version.status === "CURRENT"
                          ? "good"
                          : version.status === "DRAFT"
                            ? "neutral"
                            : "warn"
                      }
                    >
                      {adminPricingStatusLabel(version.status, locale)}
                    </span>
                    <small>
                      {adminPricingDate(version.publishedAt ?? version.createdAt, locale)}
                    </small>
                  </td>
                  <td data-label={text.binding}>
                    <span
                      className="admin-pricing-status"
                      data-tone={version.stripeBinding.status === "BOUND" ? "good" : "risk"}
                    >
                      {version.stripeBinding.status === "BOUND" ? text.bound : text.unbound}
                    </span>
                    <small>
                      <code>{version.stripeBinding.stripePriceReference ?? "—"}</code>
                      <br />
                      <code>{version.stripeBinding.stripeProductReference ?? "—"}</code>
                    </small>
                    {version.stripeBinding.status === "UNBOUND" ? (
                      <Link href={`/${locale}/stripe-health?type=MISSING_PRICING_BINDING`}>
                        <ExternalLink size={13} aria-hidden="true" />
                        {text.viewStripeHealth}
                      </Link>
                    ) : null}
                  </td>
                  <td data-label={text.subscribers}>{version.subscribers}</td>
                  <td data-label={text.grandfathered}>
                    {version.grandfatheredSubscribers ? (
                      <>
                        <Link
                          href={adminPricingCustomerLink(locale, market.code, version.plan, true)}
                        >
                          {version.grandfatheredSubscribers} · {text.viewCustomers}
                        </Link>
                        {target && target.id !== version.id ? (
                          <Link
                            href={`/${locale}/repricing?marketId=${encodeURIComponent(market.id)}&plan=${encodeURIComponent(version.plan)}&cadence=${encodeURIComponent(version.cadence)}&targetVersionId=${encodeURIComponent(target.id)}`}
                          >
                            {text.planRepricing}
                          </Link>
                        ) : null}
                      </>
                    ) : (
                      0
                    )}
                  </td>
                  <td data-label={text.allPrices}>
                    {canWrite && version.status === "DRAFT" ? (
                      <Button
                        variant="secondary"
                        loading={busyId === version.id}
                        onClick={() => void validateVersion(version)}
                      >
                        {text.validate}
                      </Button>
                    ) : null}
                    {canWrite && version.status === "VALIDATED" ? (
                      <Button onClick={() => onSensitive({ kind: "publish", version })}>
                        {text.publish}
                      </Button>
                    ) : null}
                    {canWrite && version.status === "CURRENT" ? (
                      <Button
                        variant="secondary"
                        onClick={() => onSensitive({ kind: "retire", version })}
                      >
                        {text.retire}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function DraftDialog({
  locale,
  market,
  open,
  onClose,
  onCreated,
}: {
  locale: Locale;
  market: AdminPricingMarket;
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const text = adminPricingCopy(locale);
  const [plan, setPlan] = useState("GROWTH");
  const [cadence, setCadence] = useState("MONTHLY");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(market.configuredCurrency ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const currentVersion = market.versions.find(
    (version) =>
      version.status === "CURRENT" && version.plan === plan && version.cadence === cadence,
  );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await adminApi("/v1/admin/pricing/versions", {
        method: "POST",
        body: JSON.stringify({
          marketId: market.id,
          plan: plan.toLowerCase(),
          cadence: cadence.toLowerCase(),
          amount,
          currency: currency.toUpperCase(),
          ...(reason ? { reason } : {}),
        }),
      });
      onCreated();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : text.failed);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      open={open}
      title={text.createDraft}
      description={text.noManualPrice}
      descriptionVisible
      onClose={onClose}
      locked={saving}
    >
      <form className="admin-pricing-form" onSubmit={(event) => void submit(event)}>
        <label>
          <span>{text.plan}</span>
          <select value={plan} onChange={(event) => setPlan(event.target.value)}>
            {planCodes.map((supportedPlan) => (
              <option key={supportedPlan} value={supportedPlan.toUpperCase()}>
                {supportedPlan}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{text.cadence}</span>
          <select value={cadence} onChange={(event) => setCadence(event.target.value)}>
            {billingCadences.map((supportedCadence) => (
              <option key={supportedCadence} value={supportedCadence.toUpperCase()}>
                {supportedCadence}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{text.currency}</span>
          <input
            value={currency}
            onChange={(event) => setCurrency(event.target.value)}
            maxLength={3}
            readOnly={Boolean(market.configuredCurrency)}
            required
          />
        </label>
        <label>
          <span>{text.amount}</span>
          <input
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="999"
            required
          />
        </label>
        {currentVersion ? (
          <p className="admin-pricing-current-price" dir="auto">
            {text.current}:{" "}
            {adminPricingMoney(currentVersion.amountMinor, currentVersion.currency, locale)}
          </p>
        ) : null}
        <label>
          <span>{text.reason}</span>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={240}
          />
        </label>
        {error ? <Alert tone="danger" title={error} /> : null}
        <div className="wf-dialog__actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            {text.cancel}
          </Button>
          <Button type="submit" loading={saving}>
            {text.saveDraft}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function SensitivePricingDialog({
  locale,
  market,
  action,
  onClose,
  onCompleted,
}: {
  locale: Locale;
  market: AdminPricingMarket;
  action: SensitiveAction | null;
  onClose: () => void;
  onCompleted: () => void;
}) {
  const text = adminPricingCopy(locale);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const title =
    action?.kind === "publish"
      ? text.publishTitle
      : action?.kind === "retire"
        ? text.retireTitle
        : text.deactivateTitle;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action) return;
    setSaving(true);
    setError(null);
    try {
      await adminApi("/v1/admin/pricing/reauth", {
        method: "POST",
        body: JSON.stringify({ currentPassword: password }),
      });
      if (action.kind === "deactivate") {
        await adminApi(`/v1/admin/pricing/markets/${encodeURIComponent(market.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ active: false }),
        });
      } else {
        await adminApi(
          `/v1/admin/pricing/versions/${encodeURIComponent(action.version.id)}/${action.kind}`,
          { method: "POST", body: JSON.stringify({}) },
        );
      }
      setPassword("");
      onCompleted();
    } catch (failure) {
      const message =
        failure instanceof AdminApiError && failure.code === "ADMIN_PRICING_REAUTH_REQUIRED"
          ? text.reauthHint
          : failure instanceof Error
            ? failure.message
            : text.failed;
      setError(message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      open={Boolean(action)}
      title={title}
      description={text.existingImpact}
      descriptionVisible
      onClose={onClose}
      locked={saving}
    >
      <form className="admin-pricing-form" onSubmit={(event) => void submit(event)}>
        {action?.version ? (
          <div className="admin-pricing-confirmation">
            <strong>
              {action.version.plan} / {action.version.cadence}
            </strong>
            <span dir="auto">
              {adminPricingMoney(action.version.amountMinor, action.version.currency, locale)}
            </span>
            <small>{text.newCustomerImpact}</small>
            <small>{text.stripeImpact}</small>
          </div>
        ) : (
          <p>{text.regionalImpact}</p>
        )}
        <label>
          <span>{text.password}</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        {error ? <Alert tone="danger" title={error} /> : null}
        <div className="wf-dialog__actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            {text.cancel}
          </Button>
          <Button
            type="submit"
            variant={action?.kind === "publish" ? "primary" : "danger"}
            loading={saving}
          >
            {action?.kind === "publish"
              ? text.confirmPublish
              : action?.kind === "retire"
                ? text.confirmRetire
                : text.confirmDeactivate}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
