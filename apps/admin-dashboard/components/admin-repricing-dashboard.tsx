"use client";

import type { Locale } from "@waflo/contracts";
import { Alert, Button, Modal, Skeleton, Toast } from "@waflo/ui";
import { CalendarClock, ChevronRight, CircleAlert, FileClock, Plus } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  type Dispatch,
  type FormEvent,
  type SetStateAction,
  useEffect,
  useMemo,
  useState,
} from "react";
import { adminApi } from "../lib/admin-api";
import type { AdminPricingMarket, AdminPricingOverview } from "./admin-pricing";
import {
  type RepricingCampaign,
  type RepricingImpact,
  type RepricingOverview,
  repricingCopy,
  repricingDate,
  repricingMoney,
  repricingPath,
} from "./admin-repricing";
import { RequireAdminCapability, useAdminSession } from "./admin-session";

export function AdminRepricingDashboard({ locale }: { locale: Locale }) {
  const text = repricingCopy(locale);
  const params = useSearchParams();
  const { me } = useAdminSession();
  const selectedMarketId = params.get("marketId");
  const selectedPlan = params.get("plan");
  const selectedCadence = params.get("cadence");
  const selectedTargetVersionId = params.get("targetVersionId");
  const canWrite = me.permissions.includes("admin.repricing.write");
  const [revision, setRevision] = useState(0);
  const [open, setOpen] = useState(Boolean(params.get("targetVersionId")));
  const [notice, setNotice] = useState<string | null>(null);
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "ready"; overview: RepricingOverview; pricing: AdminPricingOverview }
  >({ kind: "loading" });

  // biome-ignore lint/correctness/useExhaustiveDependencies: revision is the explicit data revalidation control.
  useEffect(() => {
    let active = true;
    setState({ kind: "loading" });
    void Promise.all([
      adminApi<RepricingOverview>("/v1/admin/repricing/overview"),
      adminApi<AdminPricingOverview>("/v1/admin/pricing/overview"),
    ])
      .then(([overview, pricing]) => active && setState({ kind: "ready", overview, pricing }))
      .catch(
        (error: unknown) =>
          active &&
          setState({ kind: "error", message: error instanceof Error ? error.message : text.error }),
      );
    return () => {
      active = false;
    };
  }, [revision, text.error]);

  return (
    <RequireAdminCapability permission="admin.repricing.read" locale={locale}>
      <main className="admin-repricing" dir={locale === "ar" ? "rtl" : "ltr"}>
        <header className="admin-pricing__header admin-repricing__header">
          <div>
            <span>{text.eyebrow}</span>
            <h1>{text.title}</h1>
            <p>{text.subtitle}</p>
          </div>
          {canWrite ? (
            <Button onClick={() => setOpen(true)}>
              <Plus size={16} aria-hidden="true" />
              {text.newCampaign}
            </Button>
          ) : null}
        </header>
        {notice ? <Toast>{notice}</Toast> : null}
        {state.kind === "loading" ? <Loading text={text.loading} /> : null}
        {state.kind === "error" ? (
          <Failure
            text={state.message}
            retry={() => setRevision((value) => value + 1)}
            retryText={text.retry}
          />
        ) : null}
        {state.kind === "ready" ? (
          <>
            <Summary overview={state.overview} locale={locale} />
            <section className="admin-repricing-rule" aria-label={text.title}>
              <CircleAlert size={18} aria-hidden="true" />
              <div>
                <strong>{text.renewals}</strong>
                <p>{text.noProration}</p>
                <p>{text.annual}</p>
                <p>{text.historical}</p>
              </div>
            </section>
            <Campaigns campaigns={state.overview.campaigns} locale={locale} />
            <RepricingPlanner
              open={open}
              locale={locale}
              pricing={state.pricing}
              preselected={{
                ...(selectedMarketId ? { marketId: selectedMarketId } : {}),
                ...(selectedPlan ? { plan: selectedPlan } : {}),
                ...(selectedCadence ? { cadence: selectedCadence } : {}),
                ...(selectedTargetVersionId ? { targetVersionId: selectedTargetVersionId } : {}),
              }}
              onClose={() => setOpen(false)}
              onScheduled={() => {
                setOpen(false);
                setNotice(text.scheduleSuccess);
                setRevision((value) => value + 1);
              }}
            />
          </>
        ) : null}
      </main>
    </RequireAdminCapability>
  );
}

function Summary({ overview, locale }: { overview: RepricingOverview; locale: Locale }) {
  const text = repricingCopy(locale);
  const facts = [
    [text.grandfathered, overview.summary.grandfatheredSubscribers],
    [text.eligible, overview.summary.eligibleForRepricing],
    [text.pending, overview.summary.pending],
    [text.executed, overview.summary.executed],
    [text.failed, overview.summary.failed],
    [text.canceled, overview.summary.canceled],
    [text.superseded, overview.summary.superseded],
    [text.upcomingRenewals, overview.summary.upcomingRenewals],
  ] as const;
  return (
    <section className="admin-repricing-facts" aria-label={text.title}>
      {facts.map(([label, value]) => (
        <article key={label}>
          <span>{label}</span>
          <strong>{new Intl.NumberFormat(locale).format(value)}</strong>
        </article>
      ))}
    </section>
  );
}

function Campaigns({ campaigns, locale }: { campaigns: RepricingCampaign[]; locale: Locale }) {
  const text = repricingCopy(locale);
  return (
    <section className="admin-pricing-panel admin-repricing-list">
      <header>
        <div>
          <FileClock size={18} aria-hidden="true" />
          <h2>{text.campaigns}</h2>
        </div>
      </header>
      {!campaigns.length ? (
        <p className="admin-pricing-empty">{text.empty}</p>
      ) : (
        <div className="admin-pricing-table-scroll">
          <table className="admin-pricing-table">
            <thead>
              <tr>
                <th>{text.market}</th>
                <th>{text.target}</th>
                <th>{text.effective}</th>
                <th>{text.eligible}</th>
                <th>{text.status}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {campaigns.map((campaign) => (
                <tr key={campaign.campaignId}>
                  <th data-label={text.market}>
                    {campaign.market.code}
                    <small>
                      {campaign.plan} / {campaign.cadence}
                    </small>
                  </th>
                  <td data-label={text.target} dir="auto">
                    v{campaign.target.version} ·{" "}
                    {repricingMoney(campaign.target.amountMinor, campaign.target.currency, locale)}
                  </td>
                  <td data-label={text.effective}>
                    {repricingDate(campaign.effectiveOnOrAfter, locale)}
                  </td>
                  <td data-label={text.eligible}>{campaign.impact.eligibleCount}</td>
                  <td data-label={text.status}>
                    <Status status={campaign.status} locale={locale} />
                  </td>
                  <td>
                    <Link
                      className="admin-repricing-link"
                      href={repricingPath(locale, campaign.campaignId)}
                    >
                      {text.campaigns}
                      <ChevronRight size={15} aria-hidden="true" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function Status({ status, locale }: { status: string; locale: Locale }) {
  const text = repricingCopy(locale);
  const label: Record<string, string> = {
    PREVIEWED: text.preview,
    SCHEDULED: text.scheduled,
    CREATED: text.created,
    IN_PROGRESS: text.pending,
    COMPLETED: text.executed,
    PARTIAL_FAILURE: text.failed,
    CANCELED: text.canceled,
    SUPERSEDED: text.superseded,
    PENDING: text.pending,
    APPLIED: text.executed,
    FAILED: text.failed,
    EXCLUDED: text.excluded,
  };
  return (
    <span
      className="admin-pricing-status"
      data-tone={
        status.includes("FAIL") || status === "FAILED"
          ? "risk"
          : status === "SCHEDULED" || status === "PENDING"
            ? "warn"
            : "good"
      }
    >
      {label[status] ?? status}
    </span>
  );
}

export function RepricingPlanner({
  open,
  locale,
  pricing,
  preselected,
  replacesCampaignId,
  onClose,
  onScheduled,
}: {
  open: boolean;
  locale: Locale;
  pricing: AdminPricingOverview;
  preselected?: Partial<{
    marketId: string;
    plan: string;
    cadence: string;
    targetVersionId: string;
  }>;
  replacesCampaignId?: string;
  onClose: () => void;
  onScheduled: () => void;
}) {
  const text = repricingCopy(locale);
  const { me } = useAdminSession();
  const canWrite = me.permissions.includes("admin.repricing.write");
  const [marketId, setMarketId] = useState(preselected?.marketId ?? pricing.markets[0]?.id ?? "");
  const [plan, setPlan] = useState(preselected?.plan?.toUpperCase() ?? pricing.plans[0] ?? "");
  const [cadence, setCadence] = useState(
    preselected?.cadence?.toUpperCase() ?? pricing.cadences[0] ?? "",
  );
  const [targetVersionId, setTargetVersionId] = useState(preselected?.targetVersionId ?? "");
  const [effectiveOnOrAfter, setEffectiveOnOrAfter] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [noticeDays, setNoticeDays] = useState("30");
  const [preview, setPreview] = useState<
    (RepricingImpact & { previewId: string; expiresAt: string }) | null
  >(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const market = pricing.markets.find((candidate) => candidate.id === marketId) ?? null;
  const targets = useMemo(
    () =>
      market?.versions.filter(
        (version) =>
          version.status === "CURRENT" && version.plan === plan && version.cadence === cadence,
      ) ?? [],
    [market, plan, cadence],
  );

  useEffect(() => {
    if (!targets.some((target) => target.id === targetVersionId))
      setTargetVersionId(targets[0]?.id ?? "");
  }, [targets, targetVersionId]);
  async function requestPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await adminApi<RepricingImpact & { previewId: string; expiresAt: string }>(
        "/v1/admin/repricing/preview",
        {
          method: "POST",
          body: JSON.stringify({
            marketId,
            plan: plan.toLowerCase(),
            cadence: cadence.toLowerCase(),
            targetPricingVersionId: targetVersionId,
            effectiveOnOrAfter,
            noticeDays: Number(noticeDays),
            ...(replacesCampaignId ? { replacesCampaignId } : {}),
          }),
        },
      );
      setPreview(data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : text.error);
    } finally {
      setBusy(false);
    }
  }
  async function schedule() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi("/v1/admin/pricing/reauth", {
        method: "POST",
        body: JSON.stringify({ currentPassword: password }),
      });
      await adminApi(
        replacesCampaignId
          ? `/v1/admin/repricing/campaigns/${encodeURIComponent(replacesCampaignId)}/replace`
          : "/v1/admin/repricing/schedule",
        {
          method: "POST",
          body: JSON.stringify(
            replacesCampaignId
              ? { replacementPreviewId: preview.previewId }
              : { campaignId: preview.previewId },
          ),
        },
      );
      onScheduled();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : text.error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={open}
      title={replacesCampaignId ? text.replace : text.newCampaign}
      description={text.renewals}
      descriptionVisible
      onClose={onClose}
      locked={busy}
    >
      {!preview ? (
        <form className="admin-pricing-form" onSubmit={(event) => void requestPreview(event)}>
          <PlannerFields
            marketId={marketId}
            setMarketId={setMarketId}
            plan={plan}
            setPlan={setPlan}
            cadence={cadence}
            setCadence={setCadence}
            targetVersionId={targetVersionId}
            setTargetVersionId={setTargetVersionId}
            effectiveOnOrAfter={effectiveOnOrAfter}
            setEffectiveOnOrAfter={setEffectiveOnOrAfter}
            noticeDays={noticeDays}
            setNoticeDays={setNoticeDays}
            pricing={pricing}
            targets={targets}
            locale={locale}
          />
          {error ? <Alert tone="danger" title={error} /> : null}
          <div className="wf-dialog__actions">
            <Button type="button" variant="secondary" onClick={onClose}>
              {text.back}
            </Button>
            <Button type="submit" disabled={!canWrite || !targetVersionId} loading={busy}>
              {text.preview}
            </Button>
          </div>
        </form>
      ) : (
        <div className="admin-repricing-confirmation">
          <Impact preview={preview} locale={locale} />
          <div className="admin-repricing-rule">
            <CalendarClock size={18} aria-hidden="true" />
            <div>
              <p>{text.noProration}</p>
              <p>{text.annual}</p>
            </div>
          </div>
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
            <Button variant="secondary" onClick={() => setPreview(null)} disabled={busy}>
              {text.preview}
            </Button>
            <Button
              onClick={() => void schedule()}
              disabled={!password || new Date(preview.expiresAt) <= new Date()}
              loading={busy}
            >
              {replacesCampaignId ? text.confirmReplace : text.confirmSchedule}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

type PlannerFieldsProps = {
  marketId: string;
  setMarketId: Dispatch<SetStateAction<string>>;
  plan: string;
  setPlan: Dispatch<SetStateAction<string>>;
  cadence: string;
  setCadence: Dispatch<SetStateAction<string>>;
  targetVersionId: string;
  setTargetVersionId: Dispatch<SetStateAction<string>>;
  effectiveOnOrAfter: string;
  setEffectiveOnOrAfter: Dispatch<SetStateAction<string>>;
  noticeDays: string;
  setNoticeDays: Dispatch<SetStateAction<string>>;
  pricing: AdminPricingOverview;
  targets: AdminPricingMarket["versions"];
  locale: Locale;
};

function PlannerFields({
  marketId,
  setMarketId,
  plan,
  setPlan,
  cadence,
  setCadence,
  targetVersionId,
  setTargetVersionId,
  effectiveOnOrAfter,
  setEffectiveOnOrAfter,
  noticeDays,
  setNoticeDays,
  pricing,
  targets,
  locale,
}: PlannerFieldsProps) {
  const text = repricingCopy(locale);
  return (
    <>
      <label>
        <span>{text.market}</span>
        <select value={marketId} onChange={(event) => setMarketId(event.target.value)}>
          {pricing.markets
            .filter((market: AdminPricingMarket) => market.active)
            .map((market: AdminPricingMarket) => (
              <option key={market.id} value={market.id}>
                {market.code} / {market.configuredCurrency ?? "—"}
              </option>
            ))}
        </select>
      </label>
      <label>
        <span>{text.plan}</span>
        <select value={plan} onChange={(event) => setPlan(event.target.value)}>
          {pricing.plans.map((item: string) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </label>
      <label>
        <span>{text.cadence}</span>
        <select value={cadence} onChange={(event) => setCadence(event.target.value)}>
          {pricing.cadences.map((item: string) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </label>
      <label>
        <span>{text.target}</span>
        <select
          value={targetVersionId}
          onChange={(event) => setTargetVersionId(event.target.value)}
        >
          {targets.map((target) => (
            <option key={target.id} value={target.id}>
              v{target.version} · {repricingMoney(target.amountMinor, target.currency, locale)}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>{text.effective}</span>
        <input
          type="date"
          value={effectiveOnOrAfter}
          onChange={(event) => setEffectiveOnOrAfter(event.target.value)}
          required
        />
      </label>
      <label>
        <span>{text.noticeDays}</span>
        <input
          type="number"
          min="0"
          max="365"
          value={noticeDays}
          onChange={(event) => setNoticeDays(event.target.value)}
          required
        />
      </label>
    </>
  );
}

export function Impact({ preview, locale }: { preview: RepricingImpact; locale: Locale }) {
  const text = repricingCopy(locale);
  return (
    <section className="admin-repricing-impact">
      <h3>{text.previewReady}</h3>
      <div>
        <strong>{preview.eligibleCount}</strong>
        <span>{text.eligible}</span>
      </div>
      <div>
        <strong>{preview.excludedCount}</strong>
        <span>{text.excluded}</span>
      </div>
      <dl>
        <div>
          <dt>{text.newPrice}</dt>
          <dd dir="auto">{repricingMoney(preview.targetAmountMinor, preview.currency, locale)}</dd>
        </div>
        <div>
          <dt>{text.currentMrr}</dt>
          <dd dir="auto">{repricingMoney(preview.currentMrrMinor, preview.currency, locale)}</dd>
        </div>
        <div>
          <dt>{text.projectedMrr}</dt>
          <dd dir="auto">{repricingMoney(preview.projectedMrrMinor, preview.currency, locale)}</dd>
        </div>
        <div>
          <dt>{text.monthlyDelta}</dt>
          <dd dir="auto">{repricingMoney(preview.monthlyDeltaMinor, preview.currency, locale)}</dd>
        </div>
        <div>
          <dt>{text.annualizedDelta}</dt>
          <dd dir="auto">
            {repricingMoney(preview.annualizedDeltaMinor, preview.currency, locale)}
          </dd>
        </div>
        <div>
          <dt>{text.effective}</dt>
          <dd>{repricingDate(preview.earliestEffectiveRenewal, locale)}</dd>
        </div>
      </dl>
    </section>
  );
}

function Loading({ text }: { text: string }) {
  return (
    <section className="admin-pricing-loading" aria-live="polite" aria-busy="true">
      <Skeleton height="8rem" />
      <Skeleton height="20rem" />
      <span>{text}</span>
    </section>
  );
}
function Failure({
  text,
  retry,
  retryText,
}: {
  text: string;
  retry: () => void;
  retryText: string;
}) {
  return (
    <section className="admin-pricing-error" aria-live="assertive">
      <Alert tone="danger" title={text} />
      <Button variant="secondary" onClick={retry}>
        {retryText}
      </Button>
    </section>
  );
}
