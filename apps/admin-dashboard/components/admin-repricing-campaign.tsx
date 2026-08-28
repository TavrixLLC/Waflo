"use client";

import type { Locale } from "@waflo/contracts";
import { Alert, Button, Modal, Skeleton, Toast } from "@waflo/ui";
import { ArrowLeft, CircleAlert, FileClock, Users } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import { adminApi } from "../lib/admin-api";
import type { AdminPricingOverview } from "./admin-pricing";
import {
  type RepricingCampaign,
  type RepricingSubscribers,
  repricingCopy,
  repricingDate,
  repricingMoney,
} from "./admin-repricing";
import { Impact, RepricingPlanner, Status } from "./admin-repricing-dashboard";
import { RequireAdminCapability, useAdminSession } from "./admin-session";

export function AdminRepricingCampaignDetail({
  campaignId,
  locale,
}: {
  campaignId: string;
  locale: Locale;
}) {
  const text = repricingCopy(locale);
  const { me } = useAdminSession();
  const canWrite = me.permissions.includes("admin.repricing.write");
  const [revision, setRevision] = useState(0);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "ready"; campaign: RepricingCampaign; pricing: AdminPricingOverview }
  >({ kind: "loading" });

  // biome-ignore lint/correctness/useExhaustiveDependencies: revision is the explicit revalidation trigger.
  useEffect(() => {
    let active = true;
    setState({ kind: "loading" });
    void Promise.all([
      adminApi<RepricingCampaign>(
        `/v1/admin/repricing/campaigns/${encodeURIComponent(campaignId)}`,
      ),
      adminApi<AdminPricingOverview>("/v1/admin/pricing/overview"),
    ])
      .then(([campaign, pricing]) => active && setState({ kind: "ready", campaign, pricing }))
      .catch(
        (error: unknown) =>
          active &&
          setState({ kind: "error", message: error instanceof Error ? error.message : text.error }),
      );
    return () => {
      active = false;
    };
  }, [campaignId, revision, text.error]);
  return (
    <RequireAdminCapability permission="admin.repricing.read" locale={locale}>
      <main className="admin-repricing" dir={locale === "ar" ? "rtl" : "ltr"}>
        <Link className="admin-customer-back" href={`/${locale}/repricing`}>
          <ArrowLeft size={16} aria-hidden="true" />
          {text.back}
        </Link>
        {notice ? <Toast>{notice}</Toast> : null}
        {state.kind === "loading" ? (
          <section className="admin-pricing-loading" aria-live="polite" aria-busy="true">
            <Skeleton height="10rem" />
            <Skeleton height="22rem" />
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
                <span>
                  {state.campaign.market.code} / {state.campaign.plan} / {state.campaign.cadence}
                </span>
                <h1>{text.title}</h1>
                <p>{text.renewals}</p>
              </div>
              <Status status={state.campaign.status} locale={locale} />
            </header>
            <section className="admin-repricing-campaign-summary">
              <article>
                <span>{text.target}</span>
                <strong dir="auto">
                  v{state.campaign.target.version} ·{" "}
                  {repricingMoney(
                    state.campaign.target.amountMinor,
                    state.campaign.target.currency,
                    locale,
                  )}
                </strong>
              </article>
              <article>
                <span>{text.effective}</span>
                <strong>{repricingDate(state.campaign.effectiveOnOrAfter, locale)}</strong>
              </article>
              <article>
                <span>{text.noticeDays}</span>
                <strong>{state.campaign.noticeDays}</strong>
              </article>
            </section>
            <Impact preview={state.campaign.impact} locale={locale} />
            <section className="admin-repricing-rule">
              <CircleAlert size={18} aria-hidden="true" />
              <div>
                <p>{text.noProration}</p>
                <p>{text.annual}</p>
                <p>{text.historical}</p>
              </div>
            </section>
            {canWrite && state.campaign.status === "SCHEDULED" ? (
              <div className="admin-repricing-actions">
                <Button variant="secondary" onClick={() => setReplaceOpen(true)}>
                  {text.replace}
                </Button>
                <Button variant="danger" onClick={() => setCancelOpen(true)}>
                  {text.cancelCampaign}
                </Button>
              </div>
            ) : null}
            {state.campaign.replacesCampaignId ? (
              <p className="admin-repricing-history">
                <FileClock size={16} aria-hidden="true" />
                {text.previous}:{" "}
                <Link href={`/${locale}/repricing/${state.campaign.replacesCampaignId}`}>
                  {state.campaign.replacesCampaignId}
                </Link>
              </p>
            ) : null}
            {state.campaign.replacedByCampaignId ? (
              <p className="admin-repricing-history">
                <FileClock size={16} aria-hidden="true" />
                {text.replacement}:{" "}
                <Link href={`/${locale}/repricing/${state.campaign.replacedByCampaignId}`}>
                  {state.campaign.replacedByCampaignId}
                </Link>
              </p>
            ) : null}
            <CampaignSubscribers campaignId={campaignId} locale={locale} />
            <SensitiveCampaignAction
              open={cancelOpen}
              campaignId={campaignId}
              locale={locale}
              onClose={() => setCancelOpen(false)}
              onCompleted={() => {
                setCancelOpen(false);
                setNotice(text.cancelSuccess);
                setRevision((value) => value + 1);
              }}
            />
            <RepricingPlanner
              open={replaceOpen}
              locale={locale}
              pricing={state.pricing}
              replacesCampaignId={campaignId}
              preselected={{
                marketId: state.campaign.market.id,
                plan: state.campaign.plan,
                cadence: state.campaign.cadence,
              }}
              onClose={() => setReplaceOpen(false)}
              onScheduled={() => {
                setReplaceOpen(false);
                setNotice(text.replaceSuccess);
                setRevision((value) => value + 1);
              }}
            />
          </>
        ) : null}
      </main>
    </RequireAdminCapability>
  );
}

function CampaignSubscribers({ campaignId, locale }: { campaignId: string; locale: Locale }) {
  const text = repricingCopy(locale);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "ready"; data: RepricingSubscribers }
  >({ kind: "loading" });
  useEffect(() => {
    let active = true;
    setState({ kind: "loading" });
    const query = new URLSearchParams({
      page: String(page),
      pageSize: "25",
      ...(status ? { status } : {}),
    });
    void adminApi<RepricingSubscribers>(
      `/v1/admin/repricing/campaigns/${encodeURIComponent(campaignId)}/subscribers?${query}`,
    )
      .then((data) => active && setState({ kind: "ready", data }))
      .catch(
        (error: unknown) =>
          active &&
          setState({ kind: "error", message: error instanceof Error ? error.message : text.error }),
      );
    return () => {
      active = false;
    };
  }, [campaignId, page, status, text.error]);
  return (
    <section className="admin-pricing-panel admin-repricing-subscribers">
      <header>
        <div>
          <Users size={18} aria-hidden="true" />
          <h2>{text.eligible}</h2>
        </div>
        <label>
          <span>{text.status}</span>
          <select
            value={status}
            onChange={(event) => {
              setPage(1);
              setStatus(event.target.value);
            }}
          >
            <option value="">{text.all}</option>
            <option value="PENDING">{text.pending}</option>
            <option value="APPLIED">{text.executed}</option>
            <option value="FAILED">{text.failed}</option>
            <option value="CANCELED">{text.canceled}</option>
            <option value="SUPERSEDED">{text.superseded}</option>
            <option value="EXCLUDED">{text.excluded}</option>
          </select>
        </label>
      </header>
      {state.kind === "loading" ? <Skeleton height="12rem" /> : null}
      {state.kind === "error" ? <Alert tone="danger" title={state.message} /> : null}
      {state.kind === "ready" ? (
        <>
          <div className="admin-pricing-table-scroll">
            <table className="admin-pricing-table">
              <thead>
                <tr>
                  <th>{text.customer}</th>
                  <th>{text.currentVersion}</th>
                  <th>{text.currentPrice}</th>
                  <th>{text.targetVersion}</th>
                  <th>{text.newPrice}</th>
                  <th>{text.status}</th>
                  <th>{text.notice}</th>
                  <th>{text.renewal}</th>
                  <th>{text.failure}</th>
                </tr>
              </thead>
              <tbody>
                {state.data.rows.map((row) => (
                  <tr key={`${row.customer.publicId}:${row.targetPricingVersionId}`}>
                    <th data-label={text.customer}>
                      <Link
                        href={`/${locale}/customers/${encodeURIComponent(row.customer.publicId)}`}
                      >
                        {row.customer.name}
                      </Link>
                    </th>
                    <td data-label={text.currentVersion}>
                      {row.currentVersion === null ? "—" : `v${row.currentVersion}`}
                    </td>
                    <td data-label={text.currentPrice} dir="auto">
                      {row.currentAmountMinor && row.currency
                        ? repricingMoney(row.currentAmountMinor, row.currency, locale)
                        : "—"}
                    </td>
                    <td data-label={text.targetVersion}>
                      {row.targetVersion === null ? "—" : `v${row.targetVersion}`}
                    </td>
                    <td data-label={text.newPrice} dir="auto">
                      {row.targetAmountMinor && row.currency
                        ? repricingMoney(row.targetAmountMinor, row.currency, locale)
                        : "—"}
                    </td>
                    <td data-label={text.status}>
                      <Status status={row.status} locale={locale} />
                    </td>
                    <td data-label={text.notice}>
                      {row.noticeStatus ? (
                        <Status status={row.noticeStatus} locale={locale} />
                      ) : (
                        "—"
                      )}
                    </td>
                    <td data-label={text.renewal}>
                      {repricingDate(row.expectedRenewalAt, locale)}
                    </td>
                    <td data-label={text.failure}>{row.failureCode ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav className="admin-repricing-pagination" aria-label={text.campaigns}>
            <Button
              variant="secondary"
              disabled={page <= 1}
              onClick={() => setPage((value) => value - 1)}
            >
              {"‹"}
            </Button>
            <span>
              {page} / {Math.max(1, Math.ceil(state.data.total / state.data.pageSize))}
            </span>
            <Button
              variant="secondary"
              disabled={page * state.data.pageSize >= state.data.total}
              onClick={() => setPage((value) => value + 1)}
            >
              {"›"}
            </Button>
          </nav>
        </>
      ) : null}
    </section>
  );
}

function SensitiveCampaignAction({
  open,
  campaignId,
  locale,
  onClose,
  onCompleted,
}: {
  open: boolean;
  campaignId: string;
  locale: Locale;
  onClose: () => void;
  onCompleted: () => void;
}) {
  const text = repricingCopy(locale);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await adminApi("/v1/admin/pricing/reauth", {
        method: "POST",
        body: JSON.stringify({ currentPassword: password }),
      });
      await adminApi(`/v1/admin/repricing/campaigns/${encodeURIComponent(campaignId)}/cancel`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      onCompleted();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : text.error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={open}
      title={text.cancelCampaign}
      description={text.historical}
      descriptionVisible
      onClose={onClose}
      locked={busy}
    >
      <form className="admin-pricing-form" onSubmit={(event) => void submit(event)}>
        <label>
          <span>{text.reauth}</span>
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
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            {text.back}
          </Button>
          <Button type="submit" variant="danger" loading={busy}>
            {text.confirmCancel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
