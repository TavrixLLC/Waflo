"use client";

import type { Locale } from "@waflo/contracts";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  FormField,
  Modal,
  PageHeader,
  Select,
  Skeleton,
  StatusBadge,
  Table,
  TextArea,
  TextInput,
} from "@waflo/ui";
import {
  Activity,
  CheckCircle2,
  Download,
  History,
  MonitorSmartphone,
  Search,
  ShieldAlert,
  UserRound,
} from "lucide-react";
import Image from "next/image";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ApiClientError, apiFetch } from "../lib/api-client";
import type { MembershipView } from "./dashboard";

function apiMessage(error: unknown, fallback: string) {
  return error instanceof ApiClientError ? error.message : fallback;
}

function formattedDate(value: string | null | undefined, ar: boolean) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(ar ? "ar-IQ" : "en-US", {
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
  const [selectedLedgerEntry, setSelectedLedgerEntry] = useState<LedgerItem | null>(null);
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);

  const loadCustomers = useCallback(
    async (cursor?: string) => {
      setError("");
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
      const [detail, history] = await Promise.all([
        apiFetch<MembershipDetail>(
          `/v1/organizations/${organizationId}/memberships/${membershipId}`,
        ),
        apiFetch<{ items: LedgerItem[] }>(
          `/v1/organizations/${organizationId}/memberships/${membershipId}/ledger?limit=50`,
        ),
      ]);
      setMembershipDetail(detail);
      setLedger(history.items);
    } catch (caught) {
      setError(apiMessage(caught, ar ? "تعذر فتح العضوية." : "Unable to open membership."));
    } finally {
      setWorking(false);
    }
  }

  async function membershipAction(action: "suspend" | "restore" | "revoke") {
    if (!membershipDetail || !locations[0]) return;
    const reason = window.prompt(ar ? "أدخل سبباً واضحاً للتدقيق:" : "Enter a clear audit reason:");
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

  async function verifyProjection() {
    if (!membershipDetail) return;
    setWorking(true);
    try {
      const result = await apiFetch<{ valid: boolean; drift: boolean }>(
        `/v1/organizations/${organizationId}/memberships/${membershipDetail.id}/verify-projection`,
        { method: "POST" },
      );
      window.alert(
        result.valid && !result.drift
          ? ar
            ? "سجل العمليات والإسقاط متطابقان."
            : "Ledger and projection match."
          : ar
            ? "تم اكتشاف اختلاف. استخدم إعادة البناء المصرّح بها."
            : "Drift detected. Use the authorized rebuild action.",
      );
    } catch (caught) {
      setError(apiMessage(caught, ar ? "تعذر التحقق." : "Unable to verify projection."));
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
        eyebrow={ar ? "العمليات الحقيقية" : "Real loyalty operations"}
        title={ar ? "العملاء والعضويات" : "Customers and memberships"}
        description={
          ar
            ? "ابحث بالاسم أو البريد المطابق، وراجع التقدم والمكافآت وسجل الأحداث غير القابل للتعديل."
            : "Search by name or exact email, then review progress, rewards, and the immutable event history."
        }
      />
      <Card className="dashboard-form-card">
        <form
          className="dashboard-form"
          onSubmit={(event) => {
            event.preventDefault();
            void loadCustomers();
          }}
        >
          <div className="studio-form-grid">
            <FormField label={ar ? "البحث" : "Search"}>
              <TextInput
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={ar ? "الاسم أو البريد المطابق" : "Name or exact email"}
              />
            </FormField>
            <FormField label={ar ? "حالة العضوية" : "Membership status"}>
              <Select value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="">{ar ? "كل الحالات" : "All statuses"}</option>
                <option value="ACTIVE">ACTIVE</option>
                <option value="SUSPENDED">SUSPENDED</option>
                <option value="EXPIRED">EXPIRED</option>
                <option value="REVOKED">REVOKED</option>
              </Select>
            </FormField>
          </div>
          <Button type="submit">
            <Search size={17} /> {ar ? "بحث" : "Search"}
          </Button>
        </form>
      </Card>
      {error ? <Alert tone="danger" title={error} /> : null}
      {!customers ? (
        <Skeleton height="18rem" />
      ) : customers.length ? (
        <>
          <Table
            caption={ar ? "عملاء المؤسسة" : "Organization customers"}
            headers={
              ar
                ? ["العميل", "البريد الآمن", "العضويات", "آخر حالة"]
                : ["Customer", "Safe email", "Memberships", "Latest state"]
            }
            rows={customers.map((item) => [
              <Button key="customer" variant="ghost" onClick={() => void openCustomer(item.id)}>
                <UserRound size={16} /> {item.displayName}
              </Button>,
              item.maskedEmail ?? "—",
              String(item.memberships.length),
              item.memberships[0] ? (
                <StatusBadge
                  key="status"
                  status={statusTone(item.memberships[0].status)}
                  label={item.memberships[0].status}
                />
              ) : (
                "—"
              ),
            ])}
          />
          {nextCursor ? (
            <Button variant="secondary" onClick={() => void loadCustomers(nextCursor)}>
              {ar ? "تحميل المزيد" : "Load more"}
            </Button>
          ) : null}
        </>
      ) : (
        <Card>
          <EmptyState
            icon={<UserRound />}
            title={ar ? "لا توجد نتائج" : "No customers found"}
            description={ar ? "جرّب مرشحاً مختلفاً." : "Try a different search or filter."}
          />
        </Card>
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
            <div>
              <Badge>{customer.preferredLocale}</Badge> <Badge>{customer.status}</Badge>
            </div>
            <p>
              {customer.contacts[0]?.maskedDisplayValue ??
                (ar ? "لا يوجد بريد محفوظ" : "No stored email")}
            </p>
            <div className="dashboard-actions">
              <Button variant="secondary" onClick={() => void privacyRequest("privacy-export")}>
                <Download size={16} /> {ar ? "تصدير الخصوصية" : "Privacy export"}
              </Button>
              {membership.role === "OWNER" ? (
                <Button variant="secondary" onClick={() => void privacyRequest("erasure")}>
                  {ar ? "طلب المحو" : "Request erasure"}
                </Button>
              ) : null}
            </div>
            <h3>{ar ? "العضويات" : "Memberships"}</h3>
            {customer.memberships.map((item) => (
              <Card key={item.id}>
                <div className="dashboard-actions">
                  <strong>{item.programName}</strong>
                  <Badge>{item.status}</Badge>
                  {item.progress?.rewardReady ? <Badge tone="brand">REWARD READY</Badge> : null}
                </div>
                <p>
                  {item.progress?.currentCycleStampCount ?? 0} /{" "}
                  {item.enrollmentProgramVersion.stampRule.requiredStampCount} ·{" "}
                  {item.enrollmentProgramVersion.operationalTimezone}
                </p>
                <Button variant="secondary" onClick={() => void openMembership(item.id)}>
                  <History size={16} /> {ar ? "فتح السجل" : "Open ledger"}
                </Button>
              </Card>
            ))}
            {customer.privacyRequests.length ? (
              <>
                <h3>{ar ? "طلبات الخصوصية" : "Privacy requests"}</h3>
                {customer.privacyRequests.map((request) => (
                  <p key={request.publicId}>
                    {request.requestType} · {request.status} ·{" "}
                    {formattedDate(request.createdAt, ar)}
                  </p>
                ))}
              </>
            ) : null}
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
            <div className="dashboard-actions">
              <Badge>{membershipDetail.status}</Badge>
              {membershipDetail.progress?.rewardReady ? (
                <Badge tone="brand">REWARD READY</Badge>
              ) : null}
              {membershipDetail.openRiskSignalCount ? (
                <Badge tone="danger">{membershipDetail.openRiskSignalCount} RISK</Badge>
              ) : null}
            </div>
            <Card>
              <strong>
                {membershipDetail.progress?.currentCycleStampCount ?? 0} /{" "}
                {membershipDetail.enrollmentProgramVersion.stampRule.requiredStampCount}
              </strong>
              <p>
                {ar ? "الدورة" : "Cycle"} {membershipDetail.progress?.currentCycleNumber ?? 1} ·{" "}
                {ar ? "إصدار الإسقاط" : "Projection"}{" "}
                {membershipDetail.progress?.projectionVersion ?? 0}
              </p>
            </Card>
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
                <Button variant="secondary" onClick={() => void membershipAction("revoke")}>
                  {ar ? "إلغاء" : "Revoke"}
                </Button>
              ) : null}
              <Button variant="secondary" onClick={() => setAdjustmentOpen(true)}>
                {ar ? "تصحيح يدوي" : "Manual correction"}
              </Button>
              <Button variant="secondary" onClick={() => void verifyProjection()}>
                <CheckCircle2 size={16} /> {ar ? "تحقق من الإسقاط" : "Verify projection"}
              </Button>
            </div>
            <h3>{ar ? "سجل الأحداث" : "Event ledger"}</h3>
            {ledger.length ? (
              <Table
                caption={ar ? "سجل العضوية" : "Membership ledger"}
                headers={
                  ar
                    ? ["التسلسل", "الحدث", "الدورة", "تغير الأختام", "الوقت"]
                    : ["Sequence", "Event", "Cycle", "Stamp delta", "Time"]
                }
                rows={ledger.map((entry) => [
                  String(entry.membershipSequence),
                  <Button key="event" variant="ghost" onClick={() => setSelectedLedgerEntry(entry)}>
                    {entry.eventType}
                  </Button>,
                  String(entry.cycleNumber),
                  String(entry.stampDelta),
                  formattedDate(entry.occurredAt, ar),
                ])}
              />
            ) : (
              <Alert title={ar ? "لا توجد أحداث بعد." : "No ledger events yet."} />
            )}
            <h3>{ar ? "استحقاقات المكافآت" : "Reward entitlements"}</h3>
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
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(selectedLedgerEntry)}
        title={ar ? "تفاصيل العملية" : "Operation detail"}
        onClose={() => setSelectedLedgerEntry(null)}
      >
        {selectedLedgerEntry ? (
          <div className="dashboard-form">
            <div className="dashboard-actions">
              <Badge>{selectedLedgerEntry.eventType}</Badge>
              <Badge>
                {ar ? "التسلسل" : "Sequence"} {selectedLedgerEntry.membershipSequence}
              </Badge>
            </div>
            <Card>
              <p>
                {ar ? "نوع الأمر" : "Command"}: {selectedLedgerEntry.operationCommand.operationType}
              </p>
              <p>
                {ar ? "الدورة" : "Cycle"}: {selectedLedgerEntry.cycleNumber}
              </p>
              <p>
                {ar ? "تغير الأختام" : "Stamp delta"}: {selectedLedgerEntry.stampDelta}
              </p>
              <p>
                {ar ? "الوقت" : "Time"}: {formattedDate(selectedLedgerEntry.occurredAt, ar)}
              </p>
            </Card>
            <Card>
              <strong>{ar ? "بيانات آمنة" : "Safe metadata"}</strong>
              <pre>{JSON.stringify(selectedLedgerEntry.safeMetadata ?? {}, null, 2)}</pre>
            </Card>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={adjustmentOpen}
        title={ar ? "تصحيح يدوي مسجل" : "Ledger-backed manual correction"}
        onClose={() => setAdjustmentOpen(false)}
      >
        <form className="dashboard-form" onSubmit={manualAdjustment}>
          <FormField label={ar ? "تغير الأختام" : "Stamp delta"} required>
            <TextInput name="stampDelta" type="number" min={-30} max={30} required />
          </FormField>
          <FormField label={ar ? "الموقع" : "Location"} required>
            <Select name="locationId" required>
              {locations.map((location) => (
                <option value={location.id} key={location.id}>
                  {location.name}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label={ar ? "سبب التدقيق" : "Audit reason"} required>
            <TextArea name="reason" minLength={3} maxLength={500} required />
          </FormField>
          <Button type="submit" loading={working} disabled={!locations.length}>
            {ar ? "تسجيل التصحيح" : "Record correction"}
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
    setPairingOpen(false);
  }

  async function deviceAction(deviceId: string, action: "revoke" | "mark-compromised") {
    const reason = window.prompt(ar ? "أدخل سبباً واضحاً للتدقيق:" : "Enter a clear audit reason:");
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

interface ManagerApprovalItem {
  publicId: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "CONSUMED";
  membership: {
    publicMembershipId: string;
    customer: { displayName: string };
  } | null;
  rewardEntitlement: {
    publicId: string;
    threshold: number;
    rewardDefinition: { internalName: string };
  } | null;
  staffDevice: { publicId: string; displayName: string } | null;
  location: { name: string } | null;
  requestedBy: { displayName: string } | null;
  approvedBy: { displayName: string } | null;
  expiresAt: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  consumedAt: string | null;
  createdAt: string;
}

export function ManagerApprovalsScreen({
  locale,
  membership,
}: {
  locale: Locale;
  membership: MembershipView;
}) {
  const ar = locale === "ar";
  const organizationId = membership.organization.id;
  const [status, setStatus] = useState("");
  const [approvals, setApprovals] = useState<ManagerApprovalItem[] | null>(null);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    setError("");
    const parameters = new URLSearchParams({ limit: "50" });
    if (status) parameters.set("status", status);
    try {
      const result = await apiFetch<{ items: ManagerApprovalItem[] }>(
        `/v1/organizations/${organizationId}/operation-approvals?${parameters}`,
      );
      setApprovals(result.items);
    } catch (caught) {
      setError(apiMessage(caught, ar ? "تعذر تحميل طلبات الموافقة." : "Unable to load approvals."));
    }
  }, [ar, organizationId, status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(approval: ManagerApprovalItem, decision: "approve" | "reject") {
    const reason = window.prompt(
      ar ? "أدخل سبب القرار لأغراض التدقيق:" : "Enter the audited decision reason:",
    );
    if (!reason || reason.trim().length < 3) return;
    setWorking(true);
    setError("");
    try {
      await apiFetch(
        `/v1/organizations/${organizationId}/operation-approvals/${approval.publicId}/${decision}`,
        { method: "POST", body: JSON.stringify({ reason }) },
      );
      await load();
    } catch (caught) {
      setError(apiMessage(caught, ar ? "تعذر تسجيل القرار." : "Unable to record the decision."));
    } finally {
      setWorking(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow={ar ? "تفويض قصير العمر" : "Short-lived authorization"}
        title={ar ? "موافقات المدير" : "Manager approvals"}
        description={
          ar
            ? "راجع سياق العضوية والمكافأة والجهاز والموقع قبل اعتماد العملية أو رفضها."
            : "Review the bound membership, reward, device, and location before approving or rejecting."
        }
      />
      <Card className="dashboard-form-card">
        <FormField label={ar ? "الحالة" : "Status"}>
          <Select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">{ar ? "كل الحالات" : "All statuses"}</option>
            <option value="PENDING">PENDING</option>
            <option value="APPROVED">APPROVED</option>
            <option value="REJECTED">REJECTED</option>
            <option value="EXPIRED">EXPIRED</option>
            <option value="CONSUMED">CONSUMED</option>
          </Select>
        </FormField>
      </Card>
      {error ? <Alert tone="danger" title={error} /> : null}
      {!approvals ? (
        <Skeleton height="18rem" />
      ) : approvals.length ? (
        <Table
          caption={ar ? "تحديات موافقة المدير" : "Manager approval challenges"}
          headers={
            ar
              ? ["العميل والمكافأة", "الجهاز والموقع", "الحالة", "الصلاحية", "الإجراء"]
              : ["Customer and reward", "Device and location", "Status", "Expires", "Action"]
          }
          rows={approvals.map((approval) => [
            <span key="context">
              <strong>{approval.membership?.customer.displayName ?? "—"}</strong>
              <br />
              {approval.rewardEntitlement?.rewardDefinition.internalName ?? "—"} ·{" "}
              {approval.membership?.publicMembershipId ?? "—"}
            </span>,
            <span key="device">
              {approval.staffDevice?.displayName ?? "—"}
              <br />
              {approval.location?.name ?? "—"}
            </span>,
            <StatusBadge
              key="status"
              status={statusTone(approval.status)}
              label={approval.status}
            />,
            formattedDate(approval.expiresAt, ar),
            approval.status === "PENDING" ? (
              <div className="dashboard-actions" key="actions">
                <Button
                  variant="ghost"
                  disabled={working}
                  onClick={() => void decide(approval, "approve")}
                >
                  {ar ? "اعتماد" : "Approve"}
                </Button>
                <Button
                  variant="ghost"
                  disabled={working}
                  onClick={() => void decide(approval, "reject")}
                >
                  {ar ? "رفض" : "Reject"}
                </Button>
              </div>
            ) : (
              <span key="decision">
                {approval.approvedBy?.displayName ??
                  (approval.rejectedAt ? (ar ? "مرفوض" : "Rejected") : "—")}
              </span>
            ),
          ])}
        />
      ) : (
        <Card>
          <EmptyState
            icon={<CheckCircle2 />}
            title={ar ? "لا توجد موافقات مطابقة" : "No matching approvals"}
            description={
              ar
                ? "ستظهر طلبات الاسترداد التي تتطلب مديراً هنا."
                : "Redemptions requiring a manager will appear here."
            }
          />
        </Card>
      )}
    </>
  );
}

interface RiskItem {
  publicId: string;
  ruleCode: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED" | "DISMISSED";
  score: number;
  safeEvidence: Record<string, unknown> | null;
  membershipId: string | null;
  locationId: string | null;
  createdAt: string;
  resolutionNote: string | null;
}

export function RiskOperationsScreen({
  locale,
  membership,
}: {
  locale: Locale;
  membership: MembershipView;
}) {
  const ar = locale === "ar";
  const organizationId = membership.organization.id;
  const [signals, setSignals] = useState<RiskItem[] | null>(null);
  const [status, setStatus] = useState("OPEN");
  const [severity, setSeverity] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [selectedSignal, setSelectedSignal] = useState<RiskItem | null>(null);

  const load = useCallback(async () => {
    const parameters = new URLSearchParams({ limit: "50" });
    if (status) parameters.set("status", status);
    if (severity) parameters.set("severity", severity);
    try {
      const result = await apiFetch<{ items: RiskItem[] }>(
        `/v1/organizations/${organizationId}/risk-signals?${parameters}`,
      );
      setSignals(result.items);
    } catch (caught) {
      setError(
        apiMessage(caught, ar ? "تعذر تحميل إشارات المخاطر." : "Unable to load risk signals."),
      );
    }
  }, [ar, organizationId, severity, status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(signal: RiskItem, action: "acknowledge" | "resolve" | "dismiss") {
    const note = window.prompt(ar ? "أدخل ملاحظة المراجعة:" : "Enter the review note:");
    if (!note || note.trim().length < 3) return;
    setWorking(true);
    try {
      await apiFetch(
        `/v1/organizations/${organizationId}/risk-signals/${signal.publicId}/${action}`,
        { method: "POST", body: JSON.stringify({ note }) },
      );
      await load();
    } catch (caught) {
      setError(apiMessage(caught, ar ? "تعذر تحديث الإشارة." : "Unable to update signal."));
    } finally {
      setWorking(false);
    }
  }

  async function openSignal(signal: RiskItem) {
    setWorking(true);
    setError("");
    try {
      const detail = await apiFetch<RiskItem>(
        `/v1/organizations/${organizationId}/risk-signals/${signal.publicId}`,
      );
      setSelectedSignal(detail);
    } catch (caught) {
      setError(apiMessage(caught, ar ? "تعذر فتح الإشارة." : "Unable to open the signal."));
    } finally {
      setWorking(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow={ar ? "مراجعة تشغيلية" : "Operational review"}
        title={ar ? "إشارات المخاطر" : "Risk signals"}
        description={
          ar
            ? "راجع التجاوزات والأنماط غير المعتادة باستخدام أدلة آمنة، ثم سجّل القرار."
            : "Review overrides and unusual patterns using safe evidence, then record the decision."
        }
      />
      <Card className="dashboard-form-card">
        <div className="studio-form-grid">
          <FormField label={ar ? "الحالة" : "Status"}>
            <Select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">{ar ? "كل الحالات" : "All statuses"}</option>
              <option value="OPEN">OPEN</option>
              <option value="ACKNOWLEDGED">ACKNOWLEDGED</option>
              <option value="RESOLVED">RESOLVED</option>
              <option value="DISMISSED">DISMISSED</option>
            </Select>
          </FormField>
          <FormField label={ar ? "الخطورة" : "Severity"}>
            <Select value={severity} onChange={(event) => setSeverity(event.target.value)}>
              <option value="">{ar ? "كل الدرجات" : "All severities"}</option>
              <option value="CRITICAL">CRITICAL</option>
              <option value="HIGH">HIGH</option>
              <option value="MEDIUM">MEDIUM</option>
              <option value="LOW">LOW</option>
            </Select>
          </FormField>
        </div>
      </Card>
      {error ? <Alert tone="danger" title={error} /> : null}
      {!signals ? (
        <Skeleton height="18rem" />
      ) : signals.length ? (
        <Table
          caption={ar ? "إشارات المخاطر" : "Operational risk signals"}
          headers={
            ar
              ? ["القاعدة", "الخطورة", "النقاط", "الحالة", "الوقت", "الإجراء"]
              : ["Rule", "Severity", "Score", "Status", "Created", "Action"]
          }
          rows={signals.map((signal) => [
            signal.ruleCode,
            <Badge key="severity" tone={signal.severity === "CRITICAL" ? "danger" : "warning"}>
              {signal.severity}
            </Badge>,
            String(signal.score),
            signal.status,
            formattedDate(signal.createdAt, ar),
            signal.status === "OPEN" ? (
              <div className="dashboard-actions" key="actions">
                <Button variant="ghost" disabled={working} onClick={() => void openSignal(signal)}>
                  {ar ? "التفاصيل" : "Details"}
                </Button>
                <Button
                  variant="ghost"
                  disabled={working}
                  onClick={() => void decide(signal, "acknowledge")}
                >
                  {ar ? "إقرار" : "Acknowledge"}
                </Button>
                <Button
                  variant="ghost"
                  disabled={working}
                  onClick={() => void decide(signal, "resolve")}
                >
                  {ar ? "حل" : "Resolve"}
                </Button>
                <Button
                  variant="ghost"
                  disabled={working}
                  onClick={() => void decide(signal, "dismiss")}
                >
                  {ar ? "استبعاد" : "Dismiss"}
                </Button>
              </div>
            ) : (
              <div className="dashboard-actions" key="actions">
                <Button variant="ghost" disabled={working} onClick={() => void openSignal(signal)}>
                  {ar ? "التفاصيل" : "Details"}
                </Button>
                <span>{signal.resolutionNote ?? "—"}</span>
              </div>
            ),
          ])}
        />
      ) : (
        <Card>
          <EmptyState
            icon={<ShieldAlert />}
            title={ar ? "لا توجد إشارات مطابقة" : "No matching risk signals"}
            description={
              ar
                ? "لا توجد عناصر تحتاج مراجعة ضمن المرشح."
                : "Nothing needs review for this filter."
            }
          />
        </Card>
      )}
      <Modal
        open={Boolean(selectedSignal)}
        title={ar ? "تفاصيل إشارة المخاطر" : "Risk signal detail"}
        onClose={() => setSelectedSignal(null)}
      >
        {selectedSignal ? (
          <div className="dashboard-form">
            <div className="dashboard-actions">
              <Badge tone={selectedSignal.severity === "CRITICAL" ? "danger" : "warning"}>
                {selectedSignal.severity}
              </Badge>
              <StatusBadge
                status={statusTone(selectedSignal.status)}
                label={selectedSignal.status}
              />
            </div>
            <Card>
              <strong>{selectedSignal.ruleCode}</strong>
              <p>
                {ar ? "درجة المخاطر" : "Risk score"}: {selectedSignal.score}
              </p>
              <p>
                {ar ? "وقت الإنشاء" : "Created"}: {formattedDate(selectedSignal.createdAt, ar)}
              </p>
              <p>
                {ar ? "سياق العضوية" : "Membership context"}:{" "}
                {selectedSignal.membershipId ? (ar ? "مرتبط" : "Bound") : "—"}
              </p>
            </Card>
            <Card>
              <strong>{ar ? "الأدلة الآمنة" : "Safe evidence"}</strong>
              <pre>{JSON.stringify(selectedSignal.safeEvidence ?? {}, null, 2)}</pre>
            </Card>
          </div>
        ) : null}
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
  riskSignals: number;
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

  const metrics = useMemo(
    () =>
      data
        ? [
            [ar ? "العضويات النشطة" : "Active memberships", data.activeMemberships],
            [ar ? "الأختام المصدرة" : "Stamp units issued", data.stampUnitsIssued],
            [ar ? "المكافآت المستردة" : "Rewards redeemed", data.rewardsRedeemed],
            [ar ? "الدورات المكتملة" : "Completed cycles", data.completedCycles],
            [ar ? "عمليات العكس" : "Reversals", data.reversals],
            [ar ? "إشارات المخاطر" : "Risk signals", data.riskSignals],
          ]
        : [],
    [ar, data],
  );

  return (
    <>
      <PageHeader
        eyebrow={ar ? "بيانات تشغيلية مجمعة" : "Aggregated operational data"}
        title={ar ? "التحليلات" : "Analytics"}
        description={
          ar
            ? "كل رقم مشتق من أحداث التشغيل والمجاميع اليومية الفعلية."
            : "Every number is derived from real operation events and daily aggregates."
        }
      />
      {error ? <Alert tone="warning" title={error} /> : null}
      {!data ? (
        <Skeleton height="18rem" />
      ) : (
        <>
          <div className="dashboard-status-band dashboard-status-band--analytics">
            <div>
              <span>{ar ? "مصدر البيانات" : "Data source"}</span>
              <strong>{ar ? "أحداث تشغيلية فعلية" : "Verified operational events"}</strong>
            </div>
            <Badge tone={data.advancedAnalyticsAvailable ? "success" : "neutral"}>
              {data.plan} ·{" "}
              {data.advancedAnalyticsAvailable
                ? ar
                  ? "مقارنات متقدمة"
                  : "Advanced comparisons"
                : ar
                  ? "مقاييس أساسية"
                  : "Core metrics"}
            </Badge>
          </div>
          <div className="dashboard-metric-grid dashboard-metric-grid--analytics">
            {metrics.map(([label, value]) => (
              <Card className="dashboard-card dashboard-card--metric" key={String(label)}>
                <span className="dashboard-card__label">{label}</span>
                <span className="dashboard-card__value">{value}</span>
              </Card>
            ))}
            <Card className="dashboard-card dashboard-card--metric dashboard-card--accent">
              <span className="dashboard-card__label">
                {ar ? "معدل الاسترداد" : "REDEMPTION RATE"}
              </span>
              <span className="dashboard-card__value">
                {new Intl.NumberFormat(ar ? "ar-IQ" : "en-US", {
                  style: "percent",
                  maximumFractionDigits: 1,
                }).format(data.redemptionRate)}
              </span>
            </Card>
          </div>
          <Card className="dashboard-form-card">
            <h2>{ar ? "مقارنات متقدمة" : "Advanced comparisons"}</h2>
            {data.advancedAnalyticsAvailable ? (
              <div className="dashboard-actions">
                {(["programs", "locations", "staff", "cohorts"] as const).map((value) => (
                  <Button key={value} variant="secondary" onClick={() => void loadDimension(value)}>
                    {dimensionLabels[value]}
                  </Button>
                ))}
              </div>
            ) : (
              <Alert
                tone="info"
                title={ar ? "متاح في Growth وScale" : "Available on Growth and Scale"}
              />
            )}
          </Card>
          {dimension ? (
            <Card className="dashboard-form-card">
              <p role="status">
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
                      ? [
                          "بطاقة الولاء والإعداد المحفوظ",
                          "الاشتراكات",
                          "عمليات الختم",
                          "معدل الاسترداد",
                        ]
                      : [
                          "Loyalty card and saved setup",
                          "Enrollments",
                          "Stamp operations",
                          "Redemption rate",
                        ]
                    : dimension === "locations"
                      ? ar
                        ? ["الموقع", "النشاط", "الأعضاء الفريدون", "التحويل"]
                        : ["Location", "Activity", "Unique members", "Conversion"]
                      : dimension === "staff"
                        ? ar
                          ? ["الموظف", "العمليات", "وحدات الختم", "معدل المخاطر"]
                          : ["Staff", "Operations", "Stamp units", "Risk rate"]
                        : ar
                          ? ["الفوج", "الحجم", "الاحتفاظ", "ساعات أول ختم"]
                          : ["Cohort", "Size", "Retention", "Hours to first stamp"]
                }
                rows={dimensionRows.map((row) =>
                  dimension === "programs"
                    ? [
                        `${String(row.programName ?? "—")} · ${
                          ar ? "الإعداد المحفوظ" : "Saved setup"
                        } ${String(row.versionNumber ?? "—")}`,
                        String(row.enrollments ?? 0),
                        String(row.stampOperations ?? 0),
                        new Intl.NumberFormat(ar ? "ar-IQ" : "en-US", {
                          style: "percent",
                          maximumFractionDigits: 1,
                        }).format(Number(row.redemptionRate ?? 0)),
                      ]
                    : dimension === "locations"
                      ? [
                          String(row.locationName ?? "—"),
                          String(row.activity ?? 0),
                          String(row.uniqueMembers ?? 0),
                          new Intl.NumberFormat(ar ? "ar-IQ" : "en-US", {
                            style: "percent",
                            maximumFractionDigits: 1,
                          }).format(Number(row.conversionRate ?? 0)),
                        ]
                      : dimension === "staff"
                        ? [
                            String(row.staffName ?? "—"),
                            String(row.operations ?? 0),
                            String(row.stampUnits ?? 0),
                            new Intl.NumberFormat(ar ? "ar-IQ" : "en-US", {
                              style: "percent",
                              maximumFractionDigits: 1,
                            }).format(Number(row.riskRate ?? 0)),
                          ]
                        : [
                            String(row.cohort ?? "—"),
                            String(row.cohortSize ?? 0),
                            new Intl.NumberFormat(ar ? "ar-IQ" : "en-US", {
                              style: "percent",
                              maximumFractionDigits: 1,
                            }).format(Number(row.retainedRate ?? 0)),
                            row.averageHoursToFirstStamp === null
                              ? "—"
                              : String(Number(row.averageHoursToFirstStamp ?? 0).toFixed(1)),
                          ],
                )}
              />
            </Card>
          ) : null}
          <Card className="dashboard-form-card dashboard-card--full">
            <div className="dashboard-section-heading">
              <div>
                <span className="dashboard-card__label">
                  {ar ? "سجل النشاط" : "ACTIVITY STREAM"}
                </span>
                <h2>{ar ? "أحدث الأحداث" : "Recent operations"}</h2>
              </div>
            </div>
            {data.recentOperations.length ? (
              <Table
                caption={ar ? "أحدث عمليات الولاء" : "Recent loyalty operations"}
                headers={ar ? ["الحدث", "تغير الأختام", "الوقت"] : ["Event", "Stamp delta", "Time"]}
                rows={data.recentOperations.map((operation) => [
                  operation.eventType,
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
          </Card>
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

export function ExportsOperationsScreen({
  locale,
  membership,
}: {
  locale: Locale;
  membership: MembershipView;
}) {
  const ar = locale === "ar";
  const organizationId = membership.organization.id;
  const [exportType, setExportType] = useState<ExportType>("MEMBERSHIP_SUMMARY");
  const [jobs, setJobs] = useState<ExportJob[]>([]);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const exportLabels: Record<ExportType, string> = {
    MEMBERSHIP_SUMMARY: ar ? "ملخص العضويات" : "Membership summary",
    LEDGER_OPERATIONS: ar ? "عمليات السجل" : "Ledger operations",
    REWARD_REDEMPTIONS: ar ? "استرداد المكافآت" : "Reward redemptions",
    LOCATION_PERFORMANCE: ar ? "أداء المواقع" : "Location performance",
    STAFF_PERFORMANCE: ar ? "أداء الموظفين" : "Staff performance",
    RISK_SIGNALS: ar ? "إشارات المخاطر" : "Risk signals",
    AGGREGATE_ANALYTICS: ar ? "التحليلات المجمعة" : "Aggregate analytics",
  };

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
        eyebrow={ar ? "Scale" : "Scale"}
        title={ar ? "تصدير العمليات" : "Operational exports"}
        description={
          ar
            ? "تُنشأ الملفات في الخلفية، وتُحفظ بصورة خاصة، وتنتهي صلاحيتها تلقائياً."
            : "Files are built in the background, stored privately, and expire automatically."
        }
      />
      {error ? <Alert tone="danger" title={error} /> : null}
      <div className="dashboard-status-band dashboard-status-band--exports">
        <div>
          <span>{ar ? "الحماية" : "File handling"}</span>
          <strong>{ar ? "خاص · مؤقت · قابل للتدقيق" : "Private · expiring · audited"}</strong>
        </div>
        <Badge tone="brand">{membership.organization.selectedPlan}</Badge>
      </div>
      <Card className="dashboard-form-card export-composer">
        <div>
          <span className="dashboard-card__label">{ar ? "تصدير جديد" : "NEW EXPORT"}</span>
          <h2>{exportLabels[exportType]}</h2>
          <p>
            {ar
              ? "ينشئ Waflo لقطة CSV من البيانات المصرح بها حالياً. ينتهي رابط التنزيل تلقائياً."
              : "Waflo creates a CSV snapshot from data you can currently access. Its download expires automatically."}
          </p>
        </div>
        <div className="export-composer__controls">
          <FormField label={ar ? "نوع التصدير" : "Export type"}>
            <Select
              value={exportType}
              onChange={(event) => setExportType(event.target.value as ExportType)}
            >
              {(Object.keys(exportLabels) as ExportType[]).map((value) => (
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
      </Card>
      {jobs.length ? (
        <Card className="dashboard-form-card dashboard-card--full export-jobs-card">
          <div className="dashboard-section-heading">
            <div>
              <span className="dashboard-card__label">{ar ? "سجل الملفات" : "FILE HISTORY"}</span>
              <h2>{ar ? "مهام التصدير" : "Export jobs"}</h2>
            </div>
            <Badge>{jobs.length}</Badge>
          </div>
          <Table
            caption={ar ? "مهام التصدير الحالية" : "Current export jobs"}
            headers={
              ar ? ["النوع", "الحالة", "الصفوف", "الإجراء"] : ["Type", "Status", "Rows", "Action"]
            }
            rows={jobs.map((job) => [
              job.exportType ? exportLabels[job.exportType] : "—",
              job.status,
              job.rowCount === null || job.rowCount === undefined ? "—" : String(job.rowCount),
              <div className="dashboard-actions" key="actions">
                <Button variant="ghost" onClick={() => void refresh(job)}>
                  <Activity size={16} /> {ar ? "تحديث" : "Refresh"}
                </Button>
                {job.status === "COMPLETED" ? (
                  <a
                    className="wf-button wf-button--secondary"
                    href={`/api/waflo/v1/organizations/${organizationId}/exports/${job.publicId}/download`}
                  >
                    {ar ? "تنزيل مصرح" : "Authorized download"}
                  </a>
                ) : null}
              </div>,
            ])}
          />
        </Card>
      ) : (
        <Card>
          <EmptyState
            icon={<Download />}
            title={ar ? "لا توجد مهام تصدير" : "No export jobs"}
            description={
              ar ? "اختر نوعاً وأنشئ أول ملف." : "Choose a type and create the first file."
            }
          />
        </Card>
      )}
    </>
  );
}
