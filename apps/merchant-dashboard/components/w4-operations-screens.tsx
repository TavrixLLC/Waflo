"use client";

import type { Locale } from "@waflo/contracts";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  FormField,
  Modal,
  PageHeader,
  SearchableSelect,
  Select,
  Skeleton,
  StatusBadge,
  Table,
  TextArea,
  TextInput,
} from "@waflo/ui";
import { Activity, Copy, Download, MonitorSmartphone, Search, UserRound } from "lucide-react";
import Image from "next/image";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { ApiClientError, apiFetch } from "../lib/api-client";
import type { MembershipView } from "./dashboard";

function apiMessage(error: unknown, fallback: string) {
  return error instanceof ApiClientError ? error.message : fallback;
}

function formattedDate(value: string | null | undefined, ar: boolean) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(ar ? "ar-IQ-u-nu-latn" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function statusTone(value: string): "pending" | "active" | "suspended" | "archived" | "canceled" {
  if (value === "ACTIVE" || value === "COMPLETED" || value === "APPROVED") return "active";
  if (value === "SUSPENDED" || value === "COMPROMISED") return "suspended";
  if (value === "REVOKED" || value === "EXPIRED") return "archived";
  if (value === "CANCELED" || value === "DISMISSED" || value === "REJECTED") return "canceled";
  return "pending";
}

interface CustomerMembershipListItem {
  id: string;
  publicMembershipId: string;
  programName: string;
  status: "ACTIVE" | "SUSPENDED" | "EXPIRED" | "REVOKED";
  enrolledAt: string;
  progress: number;
  completedCycles: number;
  rewardReady: boolean;
}

interface CustomerListItem {
  id: string;
  displayName: string;
  preferredLocale: "EN" | "AR";
  status: string;
  maskedEmail: string | null;
  emailVerificationStatus: string | null;
  memberships: CustomerMembershipListItem[];
  createdAt: string;
}

interface CustomerDetail {
  id: string;
  displayName: string;
  preferredLocale: "EN" | "AR";
  status: string;
  contacts: Array<{
    id: string;
    type: string;
    maskedDisplayValue: string;
    verificationStatus: string;
  }>;
  memberships: Array<
    CustomerMembershipListItem & {
      progress: {
        currentCycleStampCount: number;
        completedCycleCount: number;
        rewardReady: boolean;
        projectionVersion: number;
      } | null;
      enrollmentProgramVersion: {
        id: string;
        versionNumber: number;
        operationalTimezone: string;
        stampRule: { requiredStampCount: number };
      };
      rewardEntitlements: Array<{
        publicId: string;
        threshold: number;
        status: string;
        expiresAt: string | null;
      }>;
    }
  >;
  privacyRequests: Array<{
    publicId: string;
    requestType: string;
    status: string;
    createdAt: string;
    completedAt: string | null;
  }>;
}

interface MembershipDetail {
  id: string;
  publicMembershipId: string;
  status: string;
  customer: {
    displayName: string;
    contacts: Array<{ maskedDisplayValue: string; verificationStatus: string }>;
  };
  program: { internalName: string; status: string };
  enrollmentProgramVersion: {
    versionNumber: number;
    operationalTimezone: string;
    stampRule: { requiredStampCount: number };
  };
  progress: {
    currentCycleStampCount: number;
    completedCycleCount: number;
    currentCycleNumber: number;
    rewardReady: boolean;
    projectionVersion: number;
    lastLedgerSequence: number;
  } | null;
  openRiskSignalCount: number;
  walletPassInstances: Array<{
    provider: string;
    status: string;
    lastProviderSyncAt: string | null;
    lastProviderErrorCode: string | null;
  }>;
  rewardEntitlements: Array<{
    publicId: string;
    cycleNumber: number;
    threshold: number;
    status: string;
    redemptionCount: number;
    maximumRedemptionCount: number;
    expiresAt: string | null;
    rewardDefinition: {
      internalName: string;
      requiresManagerApproval: boolean;
      thresholdStampCount: number;
    };
    redemptions: Array<{
      publicId: string;
      status: string;
      redeemedAt: string;
      reversedAt: string | null;
    }>;
  }>;
}

interface LedgerItem {
  publicId: string;
  eventType: string;
  membershipSequence: number;
  cycleNumber: number;
  stampDelta: number;
  operationalLocalDate: string;
  occurredAt: string;
  locationId: string | null;
  safeMetadata: Record<string, unknown> | null;
  operationCommand: { publicId: string; operationType: string };
}

interface ContextualApproval {
  publicId: string;
  status: "PENDING";
  membership: { publicMembershipId: string; customer: { displayName: string } } | null;
  rewardEntitlement: { rewardDefinition: { internalName: string } } | null;
  location: { name: string } | null;
  expiresAt: string;
}

interface LocationItem {
  id: string;
  name: string;
  status: string;
}

export function CustomersOperationsScreen({
  locale,
  membership,
}: {
  locale: Locale;
  membership: MembershipView;
}) {
  const ar = locale === "ar";
  const organizationId = membership.organization.id;
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [customers, setCustomers] = useState<CustomerListItem[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [membershipDetail, setMembershipDetail] = useState<MembershipDetail | null>(null);
  const [ledger, setLedger] = useState<LedgerItem[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<ContextualApproval[]>([]);
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);

  const [loadingMore, setLoadingMore] = useState(false);
  const [searching, setSearching] = useState(false);

  const loadCustomers = useCallback(
    async (cursor?: string) => {
      setError("");
      if (cursor) {
        setLoadingMore(true);
      } else {
        setSearching(true);
      }
      const parameters = new URLSearchParams({ limit: "30" });
      if (query.trim()) parameters.set("search", query.trim());
      if (status) parameters.set("membershipStatus", status);
      if (cursor) parameters.set("cursor", cursor);
      try {
        const page = await apiFetch<{
          items: CustomerListItem[];
          nextCursor: string | null;
        }>(`/v1/organizations/${organizationId}/customers?${parameters}`);
        setCustomers((current) => (cursor && current ? [...current, ...page.items] : page.items));
        setNextCursor(page.nextCursor);
      } catch (caught) {
        setError(apiMessage(caught, ar ? "تعذر تحميل العملاء." : "Unable to load customers."));
      } finally {
        setLoadingMore(false);
        setSearching(false);
      }
    },
    [ar, organizationId, query, status],
  );

  useEffect(() => {
    void Promise.all([
      loadCustomers(),
      apiFetch<{ items: LocationItem[] }>(`/v1/organizations/${organizationId}/locations`).then(
        (result) => setLocations(result.items.filter((item) => item.status === "ACTIVE")),
      ),
    ]).catch((caught) =>
      setError(
        apiMessage(caught, ar ? "تعذر تحميل مساحة العمليات." : "Unable to load operations."),
      ),
    );
  }, [ar, loadCustomers, organizationId]);

  async function openCustomer(customerId: string) {
    setWorking(true);
    setError("");
    try {
      const result = await apiFetch<CustomerDetail>(
        `/v1/organizations/${organizationId}/customers/${customerId}`,
      );
      setCustomer(result);
      setMembershipDetail(null);
      setLedger([]);
    } catch (caught) {
      setError(apiMessage(caught, ar ? "تعذر فتح العميل." : "Unable to open customer."));
    } finally {
      setWorking(false);
    }
  }

  async function openMembership(membershipId: string) {
    setWorking(true);
    setError("");
    try {
      const [detail, history, approvalPage] = await Promise.all([
        apiFetch<MembershipDetail>(
          `/v1/organizations/${organizationId}/memberships/${membershipId}`,
        ),
        apiFetch<{ items: LedgerItem[] }>(
          `/v1/organizations/${organizationId}/memberships/${membershipId}/ledger?limit=50`,
        ),
        membership.role === "STAFF"
          ? Promise.resolve({ items: [] as ContextualApproval[] })
          : apiFetch<{ items: ContextualApproval[] }>(
              `/v1/organizations/${organizationId}/operation-approvals?status=PENDING&limit=30`,
            ),
      ]);
      setMembershipDetail(detail);
      setLedger(history.items);
      setPendingApprovals(
        approvalPage.items.filter(
          (approval) => approval.membership?.publicMembershipId === detail.publicMembershipId,
        ),
      );
    } catch (caught) {
      setError(apiMessage(caught, ar ? "تعذر فتح العضوية." : "Unable to open membership."));
    } finally {
      setWorking(false);
    }
  }

  async function membershipAction(action: "suspend" | "restore" | "revoke") {
    if (!membershipDetail || !locations[0]) return;
    const reason = window.prompt(ar ? "أدخل سبباً مختصراً:" : "Enter a short reason:");
    if (!reason || reason.trim().length < 3) return;
    setWorking(true);
    try {
      await apiFetch(
        `/v1/organizations/${organizationId}/memberships/${membershipDetail.id}/${action}`,
        {
          method: "POST",
          body: JSON.stringify({
            commandId: crypto.randomUUID(),
            reason,
            locationId: locations[0].id,
          }),
        },
      );
      await openMembership(membershipDetail.id);
      if (customer) await openCustomer(customer.id);
    } catch (caught) {
      setError(apiMessage(caught, ar ? "تعذر تحديث العضوية." : "Unable to update membership."));
    } finally {
      setWorking(false);
    }
  }

  async function manualAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!membershipDetail) return;
    const form = new FormData(event.currentTarget);
    setWorking(true);
    try {
      await apiFetch(
        `/v1/organizations/${organizationId}/memberships/${membershipDetail.id}/manual-adjustment`,
        {
          method: "POST",
          body: JSON.stringify({
            commandId: crypto.randomUUID(),
            stampDelta: Number(form.get("stampDelta")),
            reason: String(form.get("reason") ?? ""),
            locationId: String(form.get("locationId") ?? ""),
          }),
        },
      );
      setAdjustmentOpen(false);
      await openMembership(membershipDetail.id);
    } catch (caught) {
      setError(apiMessage(caught, ar ? "تعذر تسجيل التصحيح." : "Unable to record correction."));
    } finally {
      setWorking(false);
    }
  }

  async function decideApproval(approvalId: string, decision: "approve" | "reject") {
    if (!membershipDetail) return;
    const reason = window.prompt(ar ? "أضف ملاحظة قصيرة للقرار:" : "Add a short decision note:");
    if (!reason || reason.trim().length < 3) return;
    setWorking(true);
    try {
      await apiFetch(
        `/v1/organizations/${organizationId}/operation-approvals/${approvalId}/${decision}`,
        {
          method: "POST",
          body: JSON.stringify({ reason }),
        },
      );
      await openMembership(membershipDetail.id);
    } catch (caught) {
      setError(apiMessage(caught, ar ? "تعذر حفظ القرار." : "Unable to save the decision."));
    } finally {
      setWorking(false);
    }
  }

  async function privacyRequest(kind: "privacy-export" | "erasure") {
    if (!customer) return;
    const reasonOrLegalBasis = window.prompt(
      ar ? "أدخل الأساس القانوني أو سبب الطلب:" : "Enter the legal basis or request reason:",
    );
    if (!reasonOrLegalBasis || reasonOrLegalBasis.trim().length < 3) return;
    setWorking(true);
    try {
      await apiFetch(`/v1/organizations/${organizationId}/customers/${customer.id}/${kind}`, {
        method: "POST",
        body: JSON.stringify({
          commandId: crypto.randomUUID(),
          confirmation: "CONFIRM",
          reasonOrLegalBasis,
        }),
      });
      await openCustomer(customer.id);
    } catch (caught) {
      setError(
        apiMessage(caught, ar ? "تعذر إنشاء طلب الخصوصية." : "Unable to create privacy request."),
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <>
      <PageHeader
        title={ar ? "العملاء" : "Customers"}
        description={
          ar
            ? "ابحث عن عميل وراجع بطاقات الولاء الخاصة به."
            : "Find a customer and review their loyalty cards."
        }
      />
      <section className="dashboard-filter-bar" aria-label={ar ? "بحث العملاء" : "Customer search"}>
        <form
          className="dashboard-filter-form"
          onSubmit={(event) => {
            event.preventDefault();
            void loadCustomers();
          }}
        >
          <div className="dashboard-filter-fields">
            <FormField label={ar ? "ابحث" : "Search"}>
              <TextInput
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={ar ? "الاسم أو البريد" : "Name or email"}
              />
            </FormField>
            <FormField label={ar ? "حالة العضوية" : "Membership status"}>
              <Select
                name="customer-status"
                value={status}
                onChange={(event) => {
                  setStatus(event.currentTarget.value);
                }}
              >
                <option value="">{ar ? "كل الحالات" : "All statuses"}</option>
                <option value="ACTIVE">{ar ? "نشطة" : "Active"}</option>
                <option value="SUSPENDED">{ar ? "موقوفة" : "Suspended"}</option>
                <option value="EXPIRED">{ar ? "منتهية" : "Expired"}</option>
                <option value="REVOKED">{ar ? "ملغاة" : "Revoked"}</option>
              </Select>
            </FormField>
          </div>
          <Button type="submit" loading={searching}>
            <Search size={17} /> {ar ? "بحث" : "Search"}
          </Button>
        </form>
      </section>
      {error ? <Alert tone="danger" title={error} /> : null}
      {!customers ? (
        <Skeleton height="18rem" />
      ) : customers.length ? (
        <>
          <Table
            className="dashboard-team-table dashboard-customers-table"
            caption={ar ? "عملاء المؤسسة" : "Organization customers"}
            headers={
              ar
                ? ["العميل", "العضوية والتقدم", "الحالة", "الإجراء"]
                : ["Customer", "Membership & Progress", "Status", "Action"]
            }
            rows={customers.map((item) => {
              const primaryMembership = item.memberships[0];
              const membershipCount = item.memberships.length;
              const membershipSummary = primaryMembership
                ? `${primaryMembership.programName} · ${primaryMembership.progress} ${ar ? "أختام" : "stamps"}`
                : ar
                  ? "لا توجد عضويات"
                  : "No memberships";
              const statusLabel =
                item.status === "ACTIVE" ? (ar ? "نشط" : "Active") : ar ? "موقوف" : "Suspended";

              return [
                <div className="dashboard-member" key="customer">
                  <Avatar name={item.displayName} />
                  <span>
                    <strong>{item.displayName}</strong>
                    <small>
                      {item.maskedEmail ?? (ar ? "لا يوجد بريد محفوظ" : "No stored email")}
                    </small>
                    <small className="dashboard-member__mobile-meta">
                      {membershipSummary} · {statusLabel}
                    </small>
                  </span>
                </div>,
                <div className="dashboard-customer-membership" key="membership">
                  {primaryMembership ? (
                    <div className="dashboard-customer-membership__primary">
                      <strong>{primaryMembership.programName}</strong>
                      <div className="dashboard-customer-membership__progress">
                        <span dir="ltr" className="numeric-fraction">
                          {primaryMembership.progress} {ar ? "أختام" : "stamps"}
                        </span>
                        {primaryMembership.rewardReady ? (
                          <StatusBadge
                            status="active"
                            label={ar ? "مكافأة جاهزة" : "Reward ready"}
                          />
                        ) : null}
                        {membershipCount > 1 ? (
                          <span className="dashboard-customer-membership__count">
                            +{membershipCount - 1} {ar ? "أخرى" : "more"}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <span>—</span>
                  )}
                </div>,
                <StatusBadge key="status" status={statusTone(item.status)} label={statusLabel} />,
                <div className="dashboard-team-actions" key="action">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void openCustomer(item.id)}
                    aria-label={`${ar ? "عرض تفاصيل" : "View details"}: ${item.displayName}`}
                  >
                    <UserRound size={16} aria-hidden="true" />
                    {ar ? "عرض" : "View"}
                  </Button>
                </div>,
              ];
            })}
          />
          {nextCursor ? (
            <div className="dashboard-load-more">
              <Button
                variant="secondary"
                loading={loadingMore}
                onClick={() => void loadCustomers(nextCursor)}
              >
                {ar ? "تحميل المزيد" : "Load more"}
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <div className="dashboard-empty-inline">
          <EmptyState
            icon={<UserRound />}
            title={ar ? "لا توجد نتائج" : "No customers found"}
            description={ar ? "جرّب مرشحاً مختلفاً." : "Try a different search or filter."}
          />
        </div>
      )}

      <Modal
        open={Boolean(customer)}
        title={customer?.displayName ?? ""}
        onClose={() => {
          setCustomer(null);
          setMembershipDetail(null);
          setLedger([]);
        }}
      >
        {working && !customer ? <Skeleton height="10rem" /> : null}
        {customer ? (
          <div className="dashboard-form">
            <div className="dashboard-customer-summary">
              <StatusBadge
                status={statusTone(customer.status)}
                label={customer.status === "ACTIVE" ? (ar ? "نشط" : "Active") : customer.status}
              />
              <span>
                {customer.contacts[0]?.maskedDisplayValue ??
                  (ar ? "لا يوجد بريد محفوظ" : "No stored email")}
              </span>
            </div>
            <h3>{ar ? "بطاقات الولاء" : "Loyalty cards"}</h3>
            <div className="dashboard-membership-list">
              {customer.memberships.map((item) => (
                <div className="dashboard-membership-row" key={item.id}>
                  <div>
                    <strong>{item.programName}</strong>
                    <small dir="ltr" className="numeric-fraction">
                      {item.progress?.currentCycleStampCount ?? 0} /{" "}
                      {item.enrollmentProgramVersion.stampRule.requiredStampCount}{" "}
                      {ar ? "أختام" : "stamps"}
                    </small>
                  </div>
                  <div className="dashboard-actions">
                    <StatusBadge
                      status={statusTone(item.status)}
                      label={item.status === "ACTIVE" ? (ar ? "نشطة" : "Active") : item.status}
                    />
                    {item.progress?.rewardReady ? (
                      <StatusBadge status="active" label={ar ? "مكافأة جاهزة" : "Reward ready"} />
                    ) : null}
                  </div>
                  <Button variant="tertiary" onClick={() => void openMembership(item.id)}>
                    {ar ? "التفاصيل" : "Details"}
                  </Button>
                </div>
              ))}
            </div>
            <details className="dashboard-disclosure">
              <summary>{ar ? "خيارات الخصوصية" : "Privacy options"}</summary>
              <div className="dashboard-actions">
                <Button variant="secondary" onClick={() => void privacyRequest("privacy-export")}>
                  <Download size={16} /> {ar ? "طلب نسخة من البيانات" : "Request data copy"}
                </Button>
                {membership.role === "OWNER" ? (
                  <Button variant="destructive" onClick={() => void privacyRequest("erasure")}>
                    {ar ? "طلب حذف البيانات" : "Request data deletion"}
                  </Button>
                ) : null}
              </div>
              {customer.privacyRequests.length ? (
                <div className="dashboard-compact-history">
                  {customer.privacyRequests.map((request) => (
                    <p key={request.publicId}>
                      {request.requestType} · {request.status} ·{" "}
                      {formattedDate(request.createdAt, ar)}
                    </p>
                  ))}
                </div>
              ) : null}
            </details>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(membershipDetail)}
        title={membershipDetail?.program.internalName ?? ""}
        onClose={() => {
          setMembershipDetail(null);
          setLedger([]);
        }}
      >
        {membershipDetail ? (
          <div className="dashboard-form">
            <div className="dashboard-customer-summary">
              <StatusBadge
                status={statusTone(membershipDetail.status)}
                label={
                  membershipDetail.status === "ACTIVE"
                    ? ar
                      ? "نشطة"
                      : "Active"
                    : membershipDetail.status
                }
              />
              {membershipDetail.progress?.rewardReady ? (
                <StatusBadge status="active" label={ar ? "مكافأة جاهزة" : "Reward ready"} />
              ) : null}
            </div>
            <div className="dashboard-loyalty-progress">
              <strong dir="ltr" className="numeric-fraction">
                {membershipDetail.progress?.currentCycleStampCount ?? 0} /{" "}
                {membershipDetail.enrollmentProgramVersion.stampRule.requiredStampCount}
              </strong>
              <span>{ar ? "التقدم نحو المكافأة القادمة" : "Progress toward the next reward"}</span>
            </div>
            {pendingApprovals.map((approval) => (
              <section className="dashboard-contextual-approval" key={approval.publicId}>
                <div>
                  <strong>
                    {ar ? "طلب استبدال يحتاج قرارك" : "A reward redemption needs your decision"}
                  </strong>
                  <span>
                    {approval.rewardEntitlement?.rewardDefinition.internalName ??
                      (ar ? "مكافأة" : "Reward")}{" "}
                    · {approval.location?.name ?? "—"} · {ar ? "ينتهي" : "expires"}{" "}
                    {formattedDate(approval.expiresAt, ar)}
                  </span>
                </div>
                <div className="dashboard-actions">
                  <Button
                    disabled={working}
                    onClick={() => void decideApproval(approval.publicId, "approve")}
                  >
                    {ar ? "موافقة" : "Approve"}
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={working}
                    onClick={() => void decideApproval(approval.publicId, "reject")}
                  >
                    {ar ? "رفض" : "Reject"}
                  </Button>
                </div>
              </section>
            ))}
            <div className="dashboard-actions">
              {membershipDetail.status === "ACTIVE" ? (
                <Button variant="secondary" onClick={() => void membershipAction("suspend")}>
                  {ar ? "تعليق" : "Suspend"}
                </Button>
              ) : membershipDetail.status === "SUSPENDED" ? (
                <Button variant="secondary" onClick={() => void membershipAction("restore")}>
                  {ar ? "استعادة" : "Restore"}
                </Button>
              ) : null}
              {!["REVOKED", "EXPIRED"].includes(membershipDetail.status) ? (
                <Button variant="destructive" onClick={() => void membershipAction("revoke")}>
                  {ar ? "إلغاء العضوية" : "Revoke membership"}
                </Button>
              ) : null}
              <Button variant="secondary" onClick={() => setAdjustmentOpen(true)}>
                {ar ? "تعديل الأختام" : "Adjust stamps"}
              </Button>
            </div>
            <details className="dashboard-disclosure">
              <summary>{ar ? "النشاط والمكافآت" : "Activity and rewards"}</summary>
              {ledger.length ? (
                <Table
                  caption={ar ? "نشاط بطاقة الولاء" : "Loyalty activity"}
                  headers={
                    ar ? ["النشاط", "تغير الأختام", "الوقت"] : ["Activity", "Stamp change", "Time"]
                  }
                  rows={ledger.map((entry) => [
                    ["STAMP_EARNED", "STAMP_ISSUED"].includes(entry.eventType)
                      ? ar
                        ? "إضافة ختم"
                        : "Stamp added"
                      : entry.eventType === "REWARD_REDEEMED"
                        ? ar
                          ? "استبدال مكافأة"
                          : "Reward redeemed"
                        : ar
                          ? "تحديث البطاقة"
                          : "Card updated",
                    entry.stampDelta > 0 ? `+${entry.stampDelta}` : String(entry.stampDelta),
                    formattedDate(entry.occurredAt, ar),
                  ])}
                />
              ) : (
                <Alert title={ar ? "لا توجد أحداث بعد." : "No ledger events yet."} />
              )}
              <h3>{ar ? "المكافآت" : "Rewards"}</h3>
              {membershipDetail.rewardEntitlements.length ? (
                <Table
                  caption={ar ? "مكافآت العضوية" : "Membership rewards"}
                  headers={
                    ar
                      ? ["المكافأة", "الدورة", "الحد", "الحالة", "الاستخدام"]
                      : ["Reward", "Cycle", "Threshold", "Status", "Usage"]
                  }
                  rows={membershipDetail.rewardEntitlements.map((entitlement) => [
                    entitlement.rewardDefinition.internalName,
                    String(entitlement.cycleNumber),
                    String(entitlement.threshold),
                    <StatusBadge
                      key="status"
                      status={statusTone(entitlement.status)}
                      label={entitlement.status}
                    />,
                    `${entitlement.redemptionCount}/${entitlement.maximumRedemptionCount}`,
                  ])}
                />
              ) : (
                <Alert title={ar ? "لا توجد مكافآت مكتسبة بعد." : "No earned rewards yet."} />
              )}
            </details>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={adjustmentOpen}
        title={ar ? "تعديل الأختام" : "Adjust stamps"}
        onClose={() => setAdjustmentOpen(false)}
      >
        <form className="dashboard-form" onSubmit={manualAdjustment}>
          <FormField label={ar ? "تغير الأختام" : "Stamp delta"} required>
            <TextInput name="stampDelta" type="number" min={-30} max={30} required />
          </FormField>
          <FormField label={ar ? "الموقع" : "Location"} required>
            <SearchableSelect
              name="locationId"
              required
              defaultValue={locations[0]?.id ?? ""}
              options={locations.map((location) => ({ value: location.id, label: location.name }))}
            />
          </FormField>
          <FormField label={ar ? "السبب" : "Reason"} required>
            <TextArea name="reason" minLength={3} maxLength={500} required />
          </FormField>
          <Button type="submit" loading={working} disabled={!locations.length}>
            {ar ? "حفظ التعديل" : "Save adjustment"}
          </Button>
        </form>
      </Modal>
    </>
  );
}

interface StaffDeviceItem {
  publicId: string;
  displayName: string;
  platform: string;
  status: string;
  trustLevel: string;
  appVersion: string;
  pairedAt: string | null;
  lastSeenAt: string | null;
  staff: { id: string; role: string; status: string; user: { displayName: string } } | null;
  locations: Array<{
    locationId: string;
    earningAllowed: boolean;
    redemptionAllowed: boolean;
  }>;
}

interface TeamMemberItem {
  id: string;
  role: "OWNER" | "MANAGER" | "STAFF";
  status: string;
  user: { displayName: string };
}

interface PairingResult {
  publicId: string;
  status: string;
  expiresAt: string;
  staffDisplayName: string;
  manualPairingCode: string;
  pairingQrSvg: string;
  accessibleLabel: string;
}

export function DevicesOperationsScreen({
  locale,
  membership,
}: {
  locale: Locale;
  membership: MembershipView;
}) {
  const ar = locale === "ar";
  const organizationId = membership.organization.id;
  const [devices, setDevices] = useState<StaffDeviceItem[] | null>(null);
  const [members, setMembers] = useState<TeamMemberItem[]>([]);
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [pairingOpen, setPairingOpen] = useState(false);
  const [pairing, setPairing] = useState<PairingResult | null>(null);
  const [pairingCodeCopied, setPairingCodeCopied] = useState(false);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const [devicePage, team, locationPage] = await Promise.all([
        apiFetch<{ items: StaffDeviceItem[] }>(`/v1/organizations/${organizationId}/staff-devices`),
        apiFetch<{ members: TeamMemberItem[] }>(`/v1/organizations/${organizationId}/members`),
        apiFetch<{ items: LocationItem[] }>(`/v1/organizations/${organizationId}/locations`),
      ]);
      setDevices(devicePage.items);
      setMembers(team.members.filter((item) => item.status === "ACTIVE"));
      setLocations(locationPage.items.filter((item) => item.status === "ACTIVE"));
    } catch (caught) {
      setError(apiMessage(caught, ar ? "تعذر تحميل الأجهزة." : "Unable to load devices."));
    }
  }, [ar, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createPairing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const staffMemberId = String(form.get("staffMemberId") ?? "");
    const locationId = String(form.get("locationId") ?? "");
    setWorking(true);
    setError("");
    try {
      const result = await apiFetch<PairingResult>(
        `/v1/organizations/${organizationId}/device-pairing-sessions`,
        {
          method: "POST",
          body: JSON.stringify({
            staffMemberId,
            locations: [{ locationId, earningAllowed: true, redemptionAllowed: true }],
            deviceLabelSuggestion: String(form.get("label") ?? "") || undefined,
            expiresInMinutes: 10,
          }),
        },
      );
      setPairingCodeCopied(false);
      setPairing(result);
    } catch (caught) {
      setError(apiMessage(caught, ar ? "تعذر إنشاء الاقتران." : "Unable to create pairing."));
    } finally {
      setWorking(false);
    }
  }

  async function cancelPairing() {
    if (!pairing) return;
    await apiFetch(
      `/v1/organizations/${organizationId}/device-pairing-sessions/${pairing.publicId}/cancel`,
      { method: "POST" },
    );
    setPairing(null);
    setPairingCodeCopied(false);
    setPairingOpen(false);
  }

  async function deviceAction(deviceId: string, action: "revoke" | "mark-compromised") {
    const reason = window.prompt(ar ? "أدخل سبباً مختصراً:" : "Enter a short reason:");
    if (!reason || reason.trim().length < 3) return;
    setWorking(true);
    try {
      await apiFetch(`/v1/organizations/${organizationId}/staff-devices/${deviceId}/${action}`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      await load();
    } catch (caught) {
      setError(apiMessage(caught, ar ? "تعذر تحديث الجهاز." : "Unable to update device."));
    } finally {
      setWorking(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow={ar ? "أمان نقطة الخدمة" : "Point-of-service security"}
        title={ar ? "أجهزة الموظفين" : "Staff devices"}
        description={
          ar
            ? "اقترن بمفتاح Ed25519، وقيّد الجلسة بالموقع، وألغِ كل الجلسات فوراً عند الاشتباه."
            : "Pair with an Ed25519 key, bind sessions to a location, and revoke all sessions immediately when needed."
        }
        actions={
          <Button onClick={() => setPairingOpen(true)}>
            <MonitorSmartphone size={17} /> {ar ? "اقتران جهاز" : "Pair device"}
          </Button>
        }
      />
      {error ? <Alert tone="danger" title={error} /> : null}
      {!devices ? (
        <Skeleton height="18rem" />
      ) : devices.length ? (
        <Table
          caption={ar ? "أجهزة الموظفين" : "Paired staff devices"}
          headers={
            ar
              ? ["الجهاز", "الموظف", "المنصة", "الحالة", "آخر ظهور", "الإجراء"]
              : ["Device", "Staff", "Platform", "Status", "Last seen", "Action"]
          }
          rows={devices.map((device) => [
            device.displayName,
            device.staff?.user.displayName ?? "—",
            device.platform === "TEST_CLIENT" ? "TEST CLIENT" : device.platform,
            <StatusBadge key="status" status={statusTone(device.status)} label={device.status} />,
            formattedDate(device.lastSeenAt, ar),
            device.status === "ACTIVE" ? (
              <div className="dashboard-actions" key="actions">
                <Button
                  variant="ghost"
                  onClick={() => void deviceAction(device.publicId, "revoke")}
                  disabled={working}
                >
                  {ar ? "إلغاء" : "Revoke"}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => void deviceAction(device.publicId, "mark-compromised")}
                  disabled={working}
                >
                  {ar ? "مخترق" : "Compromised"}
                </Button>
              </div>
            ) : (
              "—"
            ),
          ])}
        />
      ) : (
        <Card>
          <EmptyState
            icon={<MonitorSmartphone />}
            title={ar ? "لا توجد أجهزة مقترنة" : "No paired devices"}
            description={
              ar
                ? "أنشئ رمز اقتران لموظف وموقع مصرح."
                : "Create a pairing code for an authorized Staff member and location."
            }
          />
        </Card>
      )}
      <Modal
        open={pairingOpen}
        title={ar ? "اقتران جهاز موظف" : "Pair a Staff device"}
        onClose={() => {
          setPairingOpen(false);
          setPairing(null);
          setPairingCodeCopied(false);
        }}
      >
        {pairing ? (
          <div className="dashboard-form">
            <Alert
              tone="warning"
              title={ar ? "رمز حساس وقصير العمر" : "Sensitive, short-lived pairing code"}
            >
              {ar
                ? "اعرضه للموظف المقصود فقط. لا يتم حفظ الرمز الخام أو عرضه بعد إغلاق النافذة."
                : "Show this only to the intended Staff member. The raw code is not stored or shown again after closing."}
            </Alert>
            <Image
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(pairing.pairingQrSvg)}`}
              alt={pairing.accessibleLabel}
              width={360}
              height={360}
              unoptimized
            />
            <div className="dashboard-pairing-manual">
              <div>
                <span>{ar ? "رمز الإدخال اليدوي" : "Manual pairing code"}</span>
                <strong dir="ltr">{pairing.manualPairingCode}</strong>
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  void navigator.clipboard.writeText(pairing.manualPairingCode).then(() => {
                    setPairingCodeCopied(true);
                  })
                }
              >
                <Copy size={17} aria-hidden="true" />
                {ar ? "نسخ الرمز" : "Copy code"}
              </Button>
              <p>
                {ar
                  ? "أدخل هذا الرمز في تطبيق الموظف إذا تعذر مسح رمز QR. تنتهي صلاحية الطريقتين في الوقت نفسه."
                  : "Enter this code in the Staff app if the QR cannot be scanned. Both methods expire at the same time."}
              </p>
              <span className="wf-sr-only" role="status" aria-live="polite">
                {pairingCodeCopied ? (ar ? "تم نسخ الرمز." : "Code copied.") : ""}
              </span>
            </div>
            <p>
              {pairing.staffDisplayName} · {formattedDate(pairing.expiresAt, ar)}
            </p>
            <Button variant="secondary" onClick={() => void cancelPairing()}>
              {ar ? "إلغاء الاقتران" : "Cancel pairing"}
            </Button>
          </div>
        ) : (
          <form className="dashboard-form" onSubmit={createPairing}>
            <FormField label={ar ? "عضو الفريق" : "Team member"} required>
              <Select name="staffMemberId" required>
                {members
                  .filter((item) => item.role === "STAFF")
                  .map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.user.displayName} · {item.role}
                    </option>
                  ))}
              </Select>
            </FormField>
            <FormField label={ar ? "الموقع الموثوق" : "Trusted location"} required>
              <Select name="locationId" required>
                {locations.map((location) => (
                  <option value={location.id} key={location.id}>
                    {location.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label={ar ? "اسم الجهاز" : "Device label"}>
              <TextInput name="label" maxLength={120} />
            </FormField>
            <Button type="submit" loading={working} disabled={!members.length || !locations.length}>
              {ar ? "إنشاء رمز الاقتران" : "Create pairing code"}
            </Button>
          </form>
        )}
      </Modal>
    </>
  );
}

interface AnalyticsOverview {
  activeMemberships: number;
  newEnrollments: number;
  stampUnitsIssued: number;
  stampOperations: number;
  rewardsUnlocked: number;
  rewardsRedeemed: number;
  redemptionRate: number;
  completedCycles: number;
  uniqueActiveMembers: number;
  reversals: number;
  recentOperations: Array<{
    publicId: string;
    eventType: string;
    stampDelta: number;
    occurredAt: string;
  }>;
  plan: string;
  advancedAnalyticsAvailable: boolean;
}

export function OperationalAnalyticsScreen({
  locale,
  membership,
}: {
  locale: Locale;
  membership: MembershipView;
}) {
  const ar = locale === "ar";
  const dimensionLabels = {
    programs: ar ? "بطاقات الولاء" : "Loyalty cards",
    locations: ar ? "المواقع" : "Locations",
    staff: ar ? "الموظفون" : "Staff",
    cohorts: ar ? "المجموعات" : "Cohorts",
  } as const;
  const [data, setData] = useState<AnalyticsOverview | null>(null);
  const [dimensionRows, setDimensionRows] = useState<Array<Record<string, unknown>>>([]);
  const [dimension, setDimension] = useState("");
  const [dimensionRange, setDimensionRange] = useState<{ from: string; to: string } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void apiFetch<AnalyticsOverview>(
      `/v1/organizations/${membership.organization.id}/analytics/overview`,
    )
      .then(setData)
      .catch((caught) =>
        setError(apiMessage(caught, ar ? "تعذر تحميل التحليلات." : "Unable to load analytics.")),
      );
  }, [ar, membership.organization.id]);

  async function loadDimension(value: "programs" | "locations" | "staff" | "cohorts") {
    setError("");
    try {
      const result = await apiFetch<{
        items: Array<Record<string, unknown>>;
        dateRange: { from: string; to: string };
      }>(`/v1/organizations/${membership.organization.id}/analytics/${value}`);
      setDimension(value);
      setDimensionRows(result.items);
      setDimensionRange(result.dateRange);
    } catch (caught) {
      setError(
        apiMessage(
          caught,
          ar ? "تتطلب هذه المقارنة ترقية الخطة." : "This comparison requires a plan upgrade.",
        ),
      );
    }
  }

  return (
    <>
      <PageHeader
        title={ar ? "التحليلات" : "Analytics"}
        description={
          ar
            ? "تابع نشاط بطاقات الولاء ومشاركة العملاء."
            : "Understand loyalty activity and customer engagement."
        }
      />
      {error ? <Alert tone="warning" title={error} /> : null}
      {!data ? (
        <Skeleton height="18rem" />
      ) : (
        <>
          <section className="analytics-overview-card">
            <div className="dashboard-section-heading">
              <div>
                <span className="dashboard-card__label">
                  {ar ? "مؤشرات الأداء" : "PERFORMANCE OVERVIEW"}
                </span>
                <h2>{ar ? "نشاط برنامج الولاء" : "Loyalty activity summary"}</h2>
              </div>
              <Badge tone="neutral">{ar ? "آخر 30 يوماً" : "Last 30 days"}</Badge>
            </div>
            <dl className="analytics-metric-grid">
              <div>
                <dt>{ar ? "العضويات النشطة" : "Active memberships"}</dt>
                <dd>
                  <bdi dir="ltr">{data.activeMemberships}</bdi>
                </dd>
                <dd className="dashboard-metric-detail">
                  <small>{ar ? "إجمالي الأعضاء المنضمين" : "Enrolled members"}</small>
                </dd>
              </div>
              <div>
                <dt>{ar ? "الأختام المضافة" : "Stamps added"}</dt>
                <dd>
                  <bdi dir="ltr">{data.stampUnitsIssued}</bdi>
                </dd>
                <dd className="dashboard-metric-detail">
                  <small>{ar ? "إجمالي الأختام الممنوحة" : "Issued to customer cards"}</small>
                </dd>
              </div>
              <div>
                <dt>{ar ? "المكافآت المستخدمة" : "Rewards used"}</dt>
                <dd>
                  <bdi dir="ltr">{data.rewardsRedeemed}</bdi>
                </dd>
                <dd className="dashboard-metric-detail">
                  <small>{ar ? "مكافآت تم استردادها" : "Redemptions completed"}</small>
                </dd>
              </div>
              <div>
                <dt>{ar ? "معدل استخدام المكافآت" : "Reward use rate"}</dt>
                <dd>
                  <bdi dir="ltr">
                    {new Intl.NumberFormat(ar ? "ar-IQ-u-nu-latn" : "en-US", {
                      style: "percent",
                      maximumFractionDigits: 1,
                    }).format(data.redemptionRate)}
                  </bdi>
                </dd>
                <dd className="dashboard-metric-detail">
                  <small>
                    {ar
                      ? `${data.completedCycles} دورة مكتملة`
                      : `${data.completedCycles} cycles completed`}
                  </small>
                </dd>
              </div>
            </dl>
          </section>

          <section className="analytics-comparison-card">
            <div className="dashboard-section-heading">
              <div>
                <span className="dashboard-card__label">
                  {ar ? "تحليلات تفصيلية" : "DEEP DIVE"}
                </span>
                <h2>{ar ? "مقارنات متقدمة" : "Advanced comparisons"}</h2>
              </div>
              {data.advancedAnalyticsAvailable ? (
                <Badge tone="brand">{ar ? "الخطة مفعلة" : "Growth / Scale"}</Badge>
              ) : (
                <Badge tone="neutral">
                  {ar ? "يتطلب Growth أو Scale" : "Growth or Scale required"}
                </Badge>
              )}
            </div>
            {data.advancedAnalyticsAvailable ? (
              <div className="dashboard-actions" style={{ marginTop: "1rem" }}>
                {(["programs", "locations", "staff", "cohorts"] as const).map((value) => (
                  <Button
                    key={value}
                    variant={dimension === value ? "primary" : "secondary"}
                    onClick={() => void loadDimension(value)}
                  >
                    {dimensionLabels[value]}
                  </Button>
                ))}
              </div>
            ) : (
              <Alert
                tone="info"
                title={ar ? "متاح في باقات Growth وScale" : "Available on Growth and Scale"}
              >
                {ar
                  ? "قم بترقية خطتك للحصول على مقارنات أداء بطاقات الولاء والمواقع والموظفين ومجموعات العملاء."
                  : "Upgrade your plan to unlock deep-dive comparisons across cards, locations, staff, and customer cohorts."}
              </Alert>
            )}

            {dimension ? (
              <div style={{ marginTop: "1.25rem" }}>
                <p
                  role="status"
                  style={{
                    marginBottom: "0.85rem",
                    color: "var(--waflo-muted)",
                    fontSize: "0.88rem",
                  }}
                >
                  {ar
                    ? `${dimensionRows.length} نتيجة من ${dimensionRange?.from ?? "—"} إلى ${dimensionRange?.to ?? "—"}.`
                    : `${dimensionRows.length} results from ${dimensionRange?.from ?? "—"} to ${dimensionRange?.to ?? "—"}.`}
                </p>
                <Table
                  caption={
                    ar
                      ? `تحليلات ${dimensionLabels[dimension as keyof typeof dimensionLabels]}`
                      : `${dimensionLabels[dimension as keyof typeof dimensionLabels]} analytics`
                  }
                  headers={
                    dimension === "programs"
                      ? ar
                        ? ["بطاقة الولاء", "الاشتراكات", "عمليات الختم", "معدل الاسترداد"]
                        : ["Loyalty card", "Enrollments", "Stamp operations", "Redemption rate"]
                      : dimension === "locations"
                        ? ar
                          ? ["الموقع", "النشاط", "الأعضاء الفريدون", "التحويل"]
                          : ["Location", "Activity", "Unique members", "Conversion"]
                        : dimension === "staff"
                          ? ar
                            ? ["الموظف", "العمليات", "الأختام"]
                            : ["Staff", "Activity", "Stamps"]
                          : ar
                            ? ["الفوج", "الحجم", "الاحتفاظ", "ساعات أول ختم"]
                            : ["Cohort", "Size", "Retention", "Hours to first stamp"]
                  }
                  rows={dimensionRows.map((row) =>
                    dimension === "programs"
                      ? [
                          String(row.programName ?? "—"),
                          String(row.enrollments ?? 0),
                          String(row.stampOperations ?? 0),
                          new Intl.NumberFormat(ar ? "ar-IQ-u-nu-latn" : "en-US", {
                            style: "percent",
                            maximumFractionDigits: 1,
                          }).format(Number(row.redemptionRate ?? 0)),
                        ]
                      : dimension === "locations"
                        ? [
                            String(row.locationName ?? "—"),
                            String(row.activity ?? 0),
                            String(row.uniqueMembers ?? 0),
                            new Intl.NumberFormat(ar ? "ar-IQ-u-nu-latn" : "en-US", {
                              style: "percent",
                              maximumFractionDigits: 1,
                            }).format(Number(row.conversionRate ?? 0)),
                          ]
                        : dimension === "staff"
                          ? [
                              String(row.staffName ?? "—"),
                              String(row.operations ?? 0),
                              String(row.stampUnits ?? 0),
                            ]
                          : [
                              String(row.cohort ?? "—"),
                              String(row.cohortSize ?? 0),
                              new Intl.NumberFormat(ar ? "ar-IQ-u-nu-latn" : "en-US", {
                                style: "percent",
                                maximumFractionDigits: 1,
                              }).format(Number(row.retainedRate ?? 0)),
                              row.averageHoursToFirstStamp === null
                                ? "—"
                                : String(Number(row.averageHoursToFirstStamp ?? 0).toFixed(1)),
                            ],
                  )}
                />
              </div>
            ) : null}
          </section>

          <section className="analytics-activity-card">
            <div className="dashboard-section-heading">
              <div>
                <span className="dashboard-card__label">
                  {ar ? "سجل العمليات" : "ACTIVITY STREAM"}
                </span>
                <h2>{ar ? "أحدث العمليات" : "Recent operations"}</h2>
              </div>
              <Badge tone="neutral">
                {ar
                  ? `${data.recentOperations.length} عملية`
                  : `${data.recentOperations.length} events`}
              </Badge>
            </div>
            {data.recentOperations.length ? (
              <Table
                caption={ar ? "أحدث عمليات الولاء" : "Recent loyalty operations"}
                headers={ar ? ["الحدث", "تغير الأختام", "الوقت"] : ["Event", "Stamp delta", "Time"]}
                rows={data.recentOperations.map((operation) => [
                  operation.eventType === "STAMP_EARNED"
                    ? ar
                      ? "إضافة ختم"
                      : "Stamp added"
                    : operation.eventType === "REWARD_REDEEMED"
                      ? ar
                        ? "استخدام مكافأة"
                        : "Reward used"
                      : ar
                        ? "تحديث بطاقة"
                        : "Card updated",
                  String(operation.stampDelta),
                  formattedDate(operation.occurredAt, ar),
                ])}
              />
            ) : (
              <EmptyState
                icon={<Activity />}
                title={ar ? "لا توجد عمليات بعد" : "No operations yet"}
                description={
                  ar
                    ? "ستظهر عمليات الختم والمكافآت هنا."
                    : "Stamp and reward activity will appear here."
                }
              />
            )}
          </section>
        </>
      )}
    </>
  );
}

type ExportType =
  | "MEMBERSHIP_SUMMARY"
  | "LEDGER_OPERATIONS"
  | "REWARD_REDEMPTIONS"
  | "LOCATION_PERFORMANCE"
  | "STAFF_PERFORMANCE"
  | "RISK_SIGNALS"
  | "AGGREGATE_ANALYTICS";

interface ExportJob {
  publicId: string;
  exportType?: ExportType;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "EXPIRED";
  rowCount?: number | null;
  createdAt?: string;
  completedAt?: string | null;
  safeFailureCode?: string | null;
}

type VisibleExportType = Exclude<ExportType, "RISK_SIGNALS">;

export function ExportsOperationsScreen({
  locale,
  membership,
}: {
  locale: Locale;
  membership: MembershipView;
}) {
  const ar = locale === "ar";
  const organizationId = membership.organization.id;
  const [exportType, setExportType] = useState<VisibleExportType>("MEMBERSHIP_SUMMARY");
  const [jobs, setJobs] = useState<ExportJob[]>([]);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const exportLabels: Record<VisibleExportType, string> = {
    MEMBERSHIP_SUMMARY: ar ? "ملخص العملاء" : "Customer summary",
    LEDGER_OPERATIONS: ar ? "نشاط بطاقات الولاء" : "Loyalty activity",
    REWARD_REDEMPTIONS: ar ? "المكافآت المستخدمة" : "Rewards used",
    LOCATION_PERFORMANCE: ar ? "أداء المواقع" : "Location performance",
    STAFF_PERFORMANCE: ar ? "أداء الموظفين" : "Staff performance",
    AGGREGATE_ANALYTICS: ar ? "ملخص التحليلات" : "Analytics summary",
  };
  const labelForExport = (value: ExportType | undefined) =>
    value && value !== "RISK_SIGNALS"
      ? exportLabels[value]
      : ar
        ? "تقرير أمان قديم"
        : "Legacy security report";

  useEffect(() => {
    void apiFetch<{ items: ExportJob[] }>(`/v1/organizations/${organizationId}/exports?limit=50`)
      .then((result) => setJobs(result.items))
      .catch((caught) =>
        setError(apiMessage(caught, ar ? "تعذر تحميل التصديرات." : "Unable to load exports.")),
      );
  }, [ar, organizationId]);

  async function createExport() {
    setWorking(true);
    setError("");
    try {
      const job = await apiFetch<ExportJob>(`/v1/organizations/${organizationId}/exports`, {
        method: "POST",
        body: JSON.stringify({ exportType, filters: {} }),
      });
      setJobs((current) => [{ ...job, exportType }, ...current]);
    } catch (caught) {
      setError(apiMessage(caught, ar ? "تعذر إنشاء التصدير." : "Unable to create export."));
    } finally {
      setWorking(false);
    }
  }

  async function refresh(job: ExportJob) {
    try {
      const updated = await apiFetch<ExportJob>(
        `/v1/organizations/${organizationId}/exports/${job.publicId}`,
      );
      setJobs((current) =>
        current.map((item) => {
          if (item.publicId !== job.publicId) return item;
          const preservedType = updated.exportType ?? item.exportType;
          return preservedType ? { ...updated, exportType: preservedType } : updated;
        }),
      );
    } catch (caught) {
      setError(apiMessage(caught, ar ? "تعذر تحديث المهمة." : "Unable to refresh export."));
    }
  }

  return (
    <>
      <PageHeader
        title={ar ? "التصدير" : "Exports"}
        description={
          ar
            ? "أنشئ ملفات CSV للبيانات التي تحتاجها."
            : "Create CSV files for the information you need."
        }
      />
      {error ? <Alert tone="danger" title={error} /> : null}
      <section className="export-composer dashboard-open-section">
        <div>
          <span className="dashboard-card__label">{ar ? "تصدير جديد" : "New export"}</span>
          <h2>{exportLabels[exportType]}</h2>
          <p>
            {ar
              ? "سيكون رابط التنزيل خاصاً ومتاحاً لمدة محدودة."
              : "The private download link will be available for a limited time."}
          </p>
        </div>
        <div className="export-composer__controls">
          <FormField label={ar ? "نوع التصدير" : "Export type"}>
            <Select
              name="export-type"
              value={exportType}
              onChange={(event) => setExportType(event.currentTarget.value as VisibleExportType)}
            >
              {(Object.keys(exportLabels) as VisibleExportType[]).map((value) => (
                <option key={value} value={value}>
                  {exportLabels[value]}
                </option>
              ))}
            </Select>
          </FormField>
          <Button onClick={() => void createExport()} loading={working}>
            <Download size={17} /> {ar ? "إنشاء ملف" : "Create export"}
          </Button>
        </div>
      </section>
      {jobs.length ? (
        <section className="dashboard-open-section export-jobs-card">
          <div className="dashboard-section-heading">
            <div>
              <span className="dashboard-card__label">{ar ? "سجل الملفات" : "FILE HISTORY"}</span>
              <h2>{ar ? "مهام التصدير" : "Export jobs"}</h2>
            </div>
            <span className="dashboard-count">{jobs.length}</span>
          </div>
          <Table
            caption={ar ? "مهام التصدير الحالية" : "Current export jobs"}
            headers={
              ar ? ["النوع", "الحالة", "الصفوف", "الإجراء"] : ["Type", "Status", "Rows", "Action"]
            }
            rows={jobs.map((job) => [
              labelForExport(job.exportType),
              <StatusBadge
                key="status"
                status={statusTone(job.status)}
                label={
                  job.status === "COMPLETED"
                    ? ar
                      ? "جاهز"
                      : "Ready"
                    : job.status === "PROCESSING" || job.status === "PENDING"
                      ? ar
                        ? "جارٍ الإنشاء"
                        : "Creating"
                      : job.status
                }
              />,
              job.rowCount === null || job.rowCount === undefined ? "—" : String(job.rowCount),
              <div className="dashboard-actions" key="actions">
                <Button variant="tertiary" onClick={() => void refresh(job)}>
                  <Activity size={16} /> {ar ? "تحديث" : "Refresh"}
                </Button>
                {job.status === "COMPLETED" ? (
                  <a
                    className="wf-button wf-button--secondary"
                    href={`/api/waflo/v1/organizations/${organizationId}/exports/${job.publicId}/download`}
                  >
                    {ar ? "تنزيل" : "Download"}
                  </a>
                ) : null}
              </div>,
            ])}
          />
        </section>
      ) : (
        <div className="dashboard-empty-inline">
          <EmptyState
            icon={<Download />}
            title={ar ? "لا توجد مهام تصدير" : "No export jobs"}
            description={
              ar ? "اختر نوعاً وأنشئ أول ملف." : "Choose a type and create the first file."
            }
          />
        </div>
      )}
    </>
  );
}
