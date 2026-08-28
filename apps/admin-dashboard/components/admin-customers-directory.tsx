"use client";

import type { Locale } from "@waflo/contracts";
import { Alert, Button, Skeleton } from "@waflo/ui";
import { ChevronLeft, ChevronRight, Search, SlidersHorizontal, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { adminApi } from "../lib/admin-api";
import {
  type AdminCustomerDirectoryResponse,
  adminCustomersCopy,
  adminCustomersPath,
  customerCadenceLabel,
  customerPageSizes,
  customerPlanLabel,
  customerPlans,
  customerQueryWith,
  customerStatuses,
  customerStatusLabel,
  formatCustomerDate,
  formatCustomerMoney,
} from "./admin-customers";
import { RequireAdminCapability } from "./admin-session";

function statusTone(status: string | null) {
  if (status === "ACTIVE") return "good";
  if (status === "TRIALING" || status === "GRACE_PERIOD") return "trial";
  if (status === "PAST_DUE" || status === "SUSPENDED") return "risk";
  return "neutral";
}

export function AdminCustomersDirectory({ locale }: { locale: Locale }) {
  const text = adminCustomersCopy(locale);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const queryKey = params.toString();
  const [search, setSearch] = useState(params.get("search") ?? "");
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "ready"; data: AdminCustomerDirectoryResponse }
  >({ kind: "loading" });
  const [revision, setRevision] = useState(0);

  useEffect(() => setSearch(params.get("search") ?? ""), [params]);

  // Revision is deliberately included to retry the same server-authoritative query.
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision is an intentional retry trigger.
  useEffect(() => {
    let active = true;
    setState({ kind: "loading" });
    void adminApi<AdminCustomerDirectoryResponse>(adminCustomersPath(new URLSearchParams(queryKey)))
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
  }, [queryKey, revision, text.failed]);

  function update(patch: Record<string, string | null>) {
    const next = customerQueryWith(new URLSearchParams(queryKey), patch);
    router.replace(`${pathname}${next.toString() ? `?${next}` : ""}`);
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    update({ search: search || null, page: "1" });
  }

  return (
    <RequireAdminCapability permission="admin.customers.read" locale={locale}>
      <div className="admin-customers" dir={locale === "ar" ? "rtl" : "ltr"}>
        <header className="admin-customers__header">
          <div>
            <span>{text.eyebrow}</span>
            <h1>{text.title}</h1>
            <p>{text.subtitle}</p>
          </div>
        </header>

        <section className="admin-customer-controls" aria-label={text.title}>
          <search>
            <form onSubmit={submitSearch} className="admin-customer-search">
              <label htmlFor="admin-customer-search" className="sr-only">
                {text.search}
              </label>
              <Search size={17} aria-hidden="true" />
              <input
                id="admin-customer-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={text.search}
              />
              <Button type="submit" variant="secondary">
                {text.search}
              </Button>
            </form>
          </search>
          <div className="admin-customer-filters">
            <SlidersHorizontal size={16} aria-hidden="true" />
            <label>
              <span>{text.status}</span>
              <select
                value={params.get("status") ?? ""}
                onChange={(event) => update({ status: event.target.value || null, page: "1" })}
              >
                <option value="">{text.all}</option>
                {customerStatuses.map((status) => (
                  <option key={status} value={status}>
                    {customerStatusLabel(status, locale)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{text.plan}</span>
              <select
                value={params.get("plan") ?? ""}
                onChange={(event) => update({ plan: event.target.value || null, page: "1" })}
              >
                <option value="">{text.all}</option>
                {customerPlans.map((plan) => (
                  <option key={plan} value={plan}>
                    {customerPlanLabel(plan, locale)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{text.market}</span>
              <input
                value={params.get("market") ?? ""}
                onChange={(event) =>
                  update({ market: event.target.value.toUpperCase() || null, page: "1" })
                }
                maxLength={32}
                placeholder="GLOBAL"
              />
            </label>
            <label>
              <span>{text.country}</span>
              <input
                value={params.get("country") ?? ""}
                onChange={(event) =>
                  update({ country: event.target.value.toUpperCase() || null, page: "1" })
                }
                maxLength={2}
                placeholder="SA"
              />
            </label>
            <label>
              <span>{text.currency}</span>
              <input
                value={params.get("currency") ?? ""}
                onChange={(event) =>
                  update({ currency: event.target.value.toUpperCase() || null, page: "1" })
                }
                maxLength={3}
                placeholder="SAR"
              />
            </label>
            <label>
              <span>{text.grandfathered}</span>
              <select
                value={params.get("grandfathered") ?? "all"}
                onChange={(event) => update({ grandfathered: event.target.value, page: "1" })}
              >
                <option value="all">{text.all}</option>
                <option value="yes">{text.yes}</option>
                <option value="no">{text.no}</option>
              </select>
            </label>
            <label>
              <span>{text.createdFrom}</span>
              <input
                type="date"
                value={params.get("createdFrom") ?? ""}
                onChange={(event) => update({ createdFrom: event.target.value || null, page: "1" })}
              />
            </label>
            <label>
              <span>{text.createdTo}</span>
              <input
                type="date"
                value={params.get("createdTo") ?? ""}
                onChange={(event) => update({ createdTo: event.target.value || null, page: "1" })}
              />
            </label>
            <label>
              <span>{text.scheduled}</span>
              <select
                value={params.get("scheduledRepricing") ?? "all"}
                onChange={(event) => update({ scheduledRepricing: event.target.value, page: "1" })}
              >
                <option value="all">{text.all}</option>
                <option value="yes">{text.yes}</option>
                <option value="no">{text.no}</option>
              </select>
            </label>
            <label>
              <span>{text.sort}</span>
              <select
                value={`${params.get("sort") ?? "createdAt"}:${params.get("direction") ?? "desc"}`}
                onChange={(event) => {
                  const [sort, direction] = event.target.value.split(":");
                  update({ sort: sort ?? null, direction: direction ?? null, page: "1" });
                }}
              >
                <option value="createdAt:desc">{text.newest}</option>
                <option value="createdAt:asc">{text.oldest}</option>
                <option value="name:asc">{text.nameAZ}</option>
                <option value="status:asc">{text.statusSort}</option>
              </select>
            </label>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setSearch("");
                router.replace(pathname);
              }}
            >
              <X size={15} aria-hidden="true" />
              {text.clear}
            </Button>
          </div>
        </section>

        {state.kind === "loading" ? (
          <section className="admin-customer-loading" aria-live="polite" aria-busy="true">
            <Skeleton height="3rem" />
            <Skeleton height="22rem" />
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
          <>
            {state.data.items.length === 0 ? (
              <p className="admin-customer-empty">{text.empty}</p>
            ) : (
              <div className="admin-customer-table-scroll">
                <table className="admin-customer-table">
                  <thead>
                    <tr>
                      <th>{text.customer}</th>
                      <th>{text.country}</th>
                      <th>{text.plan}</th>
                      <th>{text.status}</th>
                      <th>{text.price}</th>
                      <th>{text.market}</th>
                      <th>{text.joined}</th>
                      <th>{text.renewal}</th>
                      <th>{text.grandfathered}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.data.items.map((item) => {
                      const terms = item.subscription;
                      const price = formatCustomerMoney(
                        terms?.amountMinor ?? null,
                        terms?.currency ?? null,
                        locale,
                      );
                      return (
                        <tr key={item.customerId}>
                          <th data-label={text.customer}>
                            <Link
                              href={`/${locale}/customers/${item.customerId}`}
                              aria-label={`${text.details}: ${item.organization.name}`}
                            >
                              <strong>{item.organization.name}</strong>
                              <small>
                                {item.organization.owner?.displayName ?? item.customerId}
                              </small>
                            </Link>
                          </th>
                          <td data-label={text.country}>{item.billing.country ?? "—"}</td>
                          <td data-label={text.plan}>
                            {customerPlanLabel(terms?.plan ?? null, locale)}
                            <small>{customerCadenceLabel(terms?.cadence ?? null, locale)}</small>
                          </td>
                          <td data-label={text.status}>
                            <span
                              className="admin-customer-status"
                              data-tone={statusTone(terms?.status ?? item.billing.profileStatus)}
                            >
                              {customerStatusLabel(
                                terms?.status ?? item.billing.profileStatus,
                                locale,
                              )}
                            </span>
                            {terms?.scheduledRepricing ? (
                              <small className="admin-customer-indicator">{text.scheduled}</small>
                            ) : null}
                          </td>
                          <td data-label={text.price}>
                            {price ? <span dir="auto">{price}</span> : "—"}
                          </td>
                          <td data-label={text.market}>{terms?.market ?? "—"}</td>
                          <td data-label={text.joined}>
                            {formatCustomerDate(item.organization.createdAt, locale)}
                          </td>
                          <td data-label={text.renewal}>
                            {formatCustomerDate(terms?.nextRenewalAt ?? null, locale)}
                          </td>
                          <td data-label={text.grandfathered}>
                            {terms?.grandfathered ? text.yes : text.no}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <nav className="admin-customer-pagination" aria-label={text.page}>
              <span>
                {text.page} <strong>{state.data.page}</strong> {text.of}{" "}
                <strong>{state.data.totalPages}</strong>
              </span>
              <label>
                <span className="sr-only">{text.page}</span>
                <select
                  value={state.data.pageSize}
                  onChange={(event) => update({ pageSize: event.target.value, page: "1" })}
                >
                  {customerPageSizes.map((size) => (
                    <option value={size} key={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                type="button"
                variant="secondary"
                disabled={state.data.page <= 1}
                onClick={() => update({ page: String(state.data.page - 1) })}
              >
                <ChevronLeft size={16} aria-hidden="true" />
                {text.previous}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={state.data.page >= state.data.totalPages}
                onClick={() => update({ page: String(state.data.page + 1) })}
              >
                {text.next}
                <ChevronRight size={16} aria-hidden="true" />
              </Button>
            </nav>
          </>
        ) : null}
      </div>
    </RequireAdminCapability>
  );
}
