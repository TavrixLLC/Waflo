"use client";

import { billingCadenceCatalog, cadencePrice } from "@waflo/billing";
import {
  countryOptions,
  type BillingCadence,
  type Locale,
  type PlanCode,
  timeZoneOptions,
} from "@waflo/contracts";
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
  PasswordInput,
  PlanCard,
  SearchableSelect,
  Select,
  Skeleton,
  StatusBadge,
  Table,
  TextArea,
  TextInput,
  UsageMeter,
} from "@waflo/ui";
import {
  CalendarClock,
  CheckCircle2,
  Copy,
  CreditCard,
  Gift,
  MapPin,
  Plus,
  QrCode,
  RefreshCcw,
} from "lucide-react";
import Image from "next/image";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiClientError, apiFetch, resetCsrf } from "../lib/api-client";
import type { DashboardSection, MembershipView } from "./dashboard";

function message(error: unknown, fallback: string): string {
  return error instanceof ApiClientError ? error.message : fallback;
}

interface OrganizationView {
  id: string;
  name: string;
  merchantSlug: string;
  businessCategory: string | null;
  defaultLocale: "EN" | "AR";
  timezone: string;
  status: "ACTIVE" | "SUSPENDED" | "ARCHIVED";
  selectedPlan: "STARTER" | "GROWTH" | "SCALE";
  onboardingState: "BUSINESS" | "LOCATION" | "COMPLETE";
  onboardingCompletedAt: string | null;
  billingProfile: {
    subscriptionStatus:
      | "PENDING_ACTIVATION"
      | "TRIALING"
      | "ACTIVE"
      | "PAST_DUE"
      | "GRACE_PERIOD"
      | "SUSPENDED"
      | "CANCELED";
    trialStart: string | null;
    trialEnd: string | null;
  };
  domains: { hostname: string }[];
  locations?: { name: string }[];
  _count: { locations: number; members: number };
}

interface AuditItem {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  createdAt: string;
  actor: { id: string; displayName: string } | null;
}

export function OverviewScreen({
  locale,
  membership,
}: {
  locale: Locale;
  membership: MembershipView;
}) {
  const ar = locale === "ar";
  const [organization, setOrganization] = useState<OrganizationView | null>(null);
  const [audit, setAudit] = useState<AuditItem[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    const id = membership.organization.id;
    void Promise.all([
      apiFetch<OrganizationView>(`/v1/organizations/${id}`),
      membership.role === "OWNER"
        ? apiFetch<{ items: AuditItem[] }>(`/v1/organizations/${id}/audit`)
        : Promise.resolve({ items: [] }),
    ])
      .then(([org, events]) => {
        setOrganization(org);
        setAudit(events.items.slice(0, 5));
      })
      .catch((caught: unknown) =>
        setError(
          message(caught, ar ? "تعذر تحميل البيانات." : "Unable to load organization data."),
        ),
      );
  }, [membership.organization.id, membership.role, ar]);
  if (error) return <Alert tone="danger" title={error} />;
  if (!organization) {
    return (
      <>
        <Skeleton width="45%" height="2.5rem" />
        <div style={{ marginTop: "1.5rem" }}>
          <Skeleton height="12rem" />
        </div>
      </>
    );
  }
  return (
    <>
      <PageHeader
        eyebrow={ar ? "لوحة التاجر" : "Merchant dashboard"}
        title={ar ? `مرحباً في ${organization.name}` : `Welcome to ${organization.name}`}
        description={
          ar
            ? "هذه النظرة مبنية على حالة مؤسستك الفعلية، من دون أرقام أو بطاقات ولاء وهمية."
            : "This overview uses your organization’s real state—no fabricated loyalty metrics or cards."
        }
      />
      <div className="dashboard-grid">
        <Card className="dashboard-card dashboard-card--full dashboard-trial">
          <div>
            <span className="dashboard-card__label">{ar ? "حالة التجربة" : "TRIAL STATUS"}</span>
            <span className="dashboard-card__value">{ar ? "لم تبدأ بعد" : "Not started yet"}</span>
            <p>
              {ar
                ? "تجربتك المجانية لمدة 15 يوماً لم تبدأ. ستبدأ عند نشر أول بطاقة ولاء."
                : "Your 15-day free trial has not started. It will begin when you publish your first loyalty card."}
            </p>
          </div>
          <StatusBadge status="pending" label="pending_activation" />
        </Card>
        <Card className="dashboard-card">
          <span className="dashboard-card__label">{ar ? "الخطة المختارة" : "SELECTED PLAN"}</span>
          <span className="dashboard-card__value">{organization.selectedPlan}</span>
          <p style={{ color: "var(--waflo-muted)" }}>
            {ar ? "ليست دليلاً على اشتراك مدفوع." : "This does not imply a paid subscription."}
          </p>
        </Card>
        <Card className="dashboard-card">
          <span className="dashboard-card__label">
            {ar ? "المواقع النشطة" : "ACTIVE LOCATIONS"}
          </span>
          <span className="dashboard-card__value">{organization._count.locations}</span>
          <UsageMeter
            label={ar ? "استخدام المواقع" : "Location usage"}
            current={organization._count.locations}
            limit={
              organization.selectedPlan === "STARTER"
                ? 1
                : organization.selectedPlan === "GROWTH"
                  ? 3
                  : null
            }
          />
        </Card>
        <Card className="dashboard-card">
          <span className="dashboard-card__label">{ar ? "أعضاء الفريق" : "TEAM MEMBERS"}</span>
          <span className="dashboard-card__value">{organization._count.members}</span>
          <p style={{ color: "var(--waflo-muted)" }}>
            {ar ? "يشمل المالك." : "Includes the Owner."}
          </p>
        </Card>
        <Card className="dashboard-card dashboard-card--wide">
          <h2>{ar ? "رابط التاجر" : "Merchant URL"}</h2>
          <p style={{ color: "var(--waflo-muted)" }}>
            {ar
              ? "تظهر صفحة تحضير تحمل هوية Waflo إلى أن تصبح بطاقة الولاء جاهزة."
              : "A branded preparation page is live until a loyalty card is ready."}
          </p>
          <div className="dashboard-url" dir="ltr">
            <span>https://{organization.merchantSlug}.waflo.app</span>
            <button
              type="button"
              className="wf-icon-button wf-button--ghost"
              aria-label={ar ? "نسخ الرابط" : "Copy URL"}
              onClick={() =>
                void navigator.clipboard.writeText(`https://${organization.merchantSlug}.waflo.app`)
              }
            >
              <Copy size={18} />
            </button>
          </div>
        </Card>
        <Card className="dashboard-card">
          <h2>{ar ? "الخطوة التالية" : "Next step"}</h2>
          <p style={{ color: "var(--waflo-muted)", lineHeight: 1.65 }}>
            {ar
              ? "أنشئ بطاقة ولاء أو تابع إدارة بطاقاتك المنشورة."
              : "Create a loyalty card or continue managing your published cards."}
          </p>
          <a
            className="wf-button wf-button--primary dashboard-action-link"
            href={`/${locale}/dashboard/programs`}
          >
            {ar ? "إدارة بطاقات الولاء" : "Manage loyalty cards"}
          </a>
        </Card>
        {membership.role === "OWNER" ? (
          <Card className="dashboard-card dashboard-card--full">
            <h2>{ar ? "أحدث التغييرات" : "Recent activity"}</h2>
            {audit.length ? (
              <Table
                caption={ar ? "أحدث أحداث التدقيق" : "Recent audit events"}
                headers={ar ? ["الإجراء", "المنفذ", "التاريخ"] : ["Action", "Actor", "Date"]}
                rows={audit.map((event) => [
                  event.action,
                  event.actor?.displayName ?? (ar ? "النظام" : "System"),
                  new Intl.DateTimeFormat(ar ? "ar-IQ" : "en-US", { dateStyle: "medium" }).format(
                    new Date(event.createdAt),
                  ),
                ])}
              />
            ) : (
              <p style={{ color: "var(--waflo-muted)" }}>
                {ar ? "لا توجد تغييرات حديثة." : "No recent changes."}
              </p>
            )}
          </Card>
        ) : null}
      </div>
    </>
  );
}

interface LocationItem {
  id: string;
  name: string;
  city: string | null;
  phone: string | null;
  timezone: string;
  latitude: number | null;
  longitude: number | null;
  status: "ACTIVE" | "ARCHIVED";
  createdAt: string;
}

interface UsageDecision {
  allowed: boolean;
  limit: number | null;
  currentUsage: number;
  remaining: number | null;
  recommendedPlan: PlanCode | null;
}

export function LocationsScreen({
  locale,
  membership,
}: {
  locale: Locale;
  membership: MembershipView;
}) {
  const ar = locale === "ar";
  const [data, setData] = useState<{ items: LocationItem[]; usage: UsageDecision } | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<LocationItem | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const canManage = membership.role !== "STAFF";
  const countries = useMemo(
    () => countryOptions(locale).map((option) => ({ value: option.code, label: option.name })),
    [locale],
  );
  const timezones = useMemo(
    () =>
      timeZoneOptions(locale).map((option) => ({
        value: option.id,
        label: option.label,
        group: option.group,
      })),
    [locale],
  );
  const load = useCallback(async () => {
    try {
      setData(await apiFetch(`/v1/organizations/${membership.organization.id}/locations`));
    } catch (caught) {
      setError(message(caught, ar ? "تعذر تحميل المواقع." : "Unable to load locations."));
    }
  }, [membership.organization.id, ar]);
  useEffect(() => {
    void load();
  }, [load]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await apiFetch(`/v1/organizations/${membership.organization.id}/locations`, {
        method: "POST",
        body: JSON.stringify({
          name: String(form.get("name") ?? ""),
          city: String(form.get("city") ?? "") || undefined,
          phone: String(form.get("phone") ?? "") || undefined,
          countryCode: String(form.get("countryCode") ?? "") || undefined,
          timezone: String(form.get("timezone") ?? "Asia/Baghdad"),
          latitude: form.get("latitude") ? Number(form.get("latitude")) : undefined,
          longitude: form.get("longitude") ? Number(form.get("longitude")) : undefined,
        }),
      });
      setOpen(false);
      await load();
    } catch (caught) {
      setError(message(caught, ar ? "تعذر إنشاء الموقع." : "Unable to create location."));
    } finally {
      setSaving(false);
    }
  }
  async function updateCoordinates(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const latitude = String(form.get("latitude") ?? "").trim();
    const longitude = String(form.get("longitude") ?? "").trim();
    try {
      await apiFetch(`/v1/organizations/${membership.organization.id}/locations/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          latitude: latitude ? Number(latitude) : null,
          longitude: longitude ? Number(longitude) : null,
        }),
      });
      setEditing(null);
      await load();
    } catch (caught) {
      setError(
        message(caught, ar ? "تعذر حفظ إحداثيات الموقع." : "Unable to save location coordinates."),
      );
    } finally {
      setSaving(false);
    }
  }
  async function archive(id: string) {
    try {
      await apiFetch(`/v1/organizations/${membership.organization.id}/locations/${id}/archive`, {
        method: "POST",
      });
      await load();
    } catch (caught) {
      setError(message(caught, ar ? "تعذر أرشفة الموقع." : "Unable to archive location."));
    }
  }
  async function restore(id: string) {
    try {
      await apiFetch(`/v1/organizations/${membership.organization.id}/locations/${id}/restore`, {
        method: "POST",
      });
      await load();
    } catch (caught) {
      setError(message(caught, ar ? "تعذر استعادة الموقع." : "Unable to restore location."));
    }
  }
  return (
    <>
      <PageHeader
        eyebrow={ar ? "المؤسسة" : "Organization"}
        title={ar ? "المواقع" : "Locations"}
        description={
          ar
            ? "أدر المواقع النشطة والمؤرشفة ضمن حدود خطتك."
            : "Manage active and archived locations within your plan limits."
        }
        actions={
          canManage ? (
            <Button onClick={() => setOpen(true)} disabled={data ? !data.usage.allowed : true}>
              <Plus size={17} />
              {ar ? "إضافة موقع" : "Add location"}
            </Button>
          ) : undefined
        }
      />
      {error ? <Alert tone="danger" title={error} /> : null}
      {data ? (
        <>
          <Card className="dashboard-form-card" style={{ marginBottom: "1rem" }}>
            <UsageMeter
              label={ar ? "استخدام المواقع النشطة" : "Active location usage"}
              current={data.usage.currentUsage}
              limit={data.usage.limit}
            />
            {!data.usage.allowed ? (
              <Alert tone="warning" title={ar ? "وصلت إلى حد المواقع" : "Location limit reached"}>
                {ar
                  ? `تقترح Waflo الترقية إلى ${data.usage.recommendedPlan ?? "خطة أعلى"} قبل إضافة موقع آخر.`
                  : `Upgrade to ${data.usage.recommendedPlan ?? "a higher plan"} before adding another active location.`}
              </Alert>
            ) : null}
          </Card>
          {data.items.length ? (
            <Table
              caption={ar ? "مواقع المؤسسة" : "Organization locations"}
              headers={
                ar
                  ? ["الموقع", "المدينة", "الإحداثيات", "المنطقة الزمنية", "الحالة", "الإجراء"]
                  : ["Location", "City", "Coordinates", "Timezone", "Status", "Action"]
              }
              rows={data.items.map((location) => [
                <strong key="name">{location.name}</strong>,
                location.city ?? "—",
                location.latitude !== null && location.longitude !== null ? (
                  <span dir="ltr" key="coordinates">
                    {location.latitude}, {location.longitude}
                  </span>
                ) : (
                  <span key="coordinates">{ar ? "غير مهيأة" : "Not configured"}</span>
                ),
                <span dir="ltr" key="timezone">
                  {location.timezone}
                </span>,
                <StatusBadge
                  key="status"
                  status={location.status === "ACTIVE" ? "active" : "archived"}
                  label={location.status}
                />,
                canManage ? (
                  <div className="dashboard-actions" key="action">
                    <Button type="button" variant="ghost" onClick={() => setEditing(location)}>
                      {ar ? "الإحداثيات" : "Coordinates"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() =>
                        void (location.status === "ACTIVE"
                          ? archive(location.id)
                          : restore(location.id))
                      }
                    >
                      {location.status === "ACTIVE"
                        ? ar
                          ? "أرشفة"
                          : "Archive"
                        : ar
                          ? "استعادة"
                          : "Restore"}
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
                icon={<MapPin />}
                title={ar ? "لا توجد مواقع" : "No locations yet"}
                description={
                  ar ? "أنشئ موقعك الأول للمتابعة." : "Create your first location to continue."
                }
              />
            </Card>
          )}
        </>
      ) : (
        <Skeleton height="16rem" />
      )}
      <Modal open={open} title={ar ? "إضافة موقع" : "Add location"} onClose={() => setOpen(false)}>
        <form className="dashboard-form" onSubmit={create}>
          <FormField label={ar ? "اسم الموقع" : "Location name"} required>
            <TextInput name="name" minLength={2} required />
          </FormField>
          <FormField label={ar ? "المدينة" : "City"}>
            <TextInput name="city" />
          </FormField>
          <FormField label={ar ? "الهاتف" : "Phone"}>
            <TextInput name="phone" type="tel" />
          </FormField>
          <FormField label={ar ? "البلد" : "Country"} required>
            <SearchableSelect
              name="countryCode"
              options={countries}
              defaultValue="IQ"
              placeholder={ar ? "ابحث عن بلد" : "Search countries"}
              required
            />
          </FormField>
          <FormField label={ar ? "المنطقة الزمنية" : "Timezone"} required>
            <SearchableSelect
              name="timezone"
              options={timezones}
              defaultValue="Asia/Baghdad"
              placeholder={ar ? "ابحث عن منطقة زمنية" : "Search timezones"}
              required
            />
          </FormField>
          <div className="dashboard-grid-two">
            <FormField label={ar ? "خط العرض" : "Latitude"} hint="−90 … 90">
              <TextInput
                name="latitude"
                type="number"
                inputMode="decimal"
                min={-90}
                max={90}
                step="any"
              />
            </FormField>
            <FormField label={ar ? "خط الطول" : "Longitude"} hint="−180 … 180">
              <TextInput
                name="longitude"
                type="number"
                inputMode="decimal"
                min={-180}
                max={180}
                step="any"
              />
            </FormField>
          </div>
          <div className="dashboard-actions">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {ar ? "إلغاء" : "Cancel"}
            </Button>
            <Button type="submit" loading={saving}>
              {ar ? "إنشاء الموقع" : "Create location"}
            </Button>
          </div>
        </form>
      </Modal>
      <Modal
        open={Boolean(editing)}
        title={ar ? "إحداثيات الموقع التجاري" : "Business location coordinates"}
        description={
          ar
            ? "أدخل إحداثيات الموقع التجاري الموثقة. لا تستخدم إحداثيات جهاز العميل."
            : "Enter verified business coordinates. Customer device coordinates are never used."
        }
        descriptionVisible
        onClose={() => setEditing(null)}
      >
        {editing ? (
          <form className="dashboard-form" onSubmit={updateCoordinates}>
            <Alert tone="info" title={editing.name}>
              {ar
                ? "تستخدم Apple وGoogle هذه الإحداثيات لتحديد صلة بطاقة Wallet بالقرب من النشاط."
                : "Apple and Google use these coordinates for provider-native Wallet relevance near the business."}
            </Alert>
            <div className="dashboard-grid-two">
              <FormField label={ar ? "خط العرض" : "Latitude"} hint="−90 … 90">
                <TextInput
                  name="latitude"
                  type="number"
                  inputMode="decimal"
                  min={-90}
                  max={90}
                  step="any"
                  defaultValue={editing.latitude ?? ""}
                />
              </FormField>
              <FormField label={ar ? "خط الطول" : "Longitude"} hint="−180 … 180">
                <TextInput
                  name="longitude"
                  type="number"
                  inputMode="decimal"
                  min={-180}
                  max={180}
                  step="any"
                  defaultValue={editing.longitude ?? ""}
                />
              </FormField>
            </div>
            <p className="dashboard-form__hint">
              {ar
                ? "اترك الحقلين فارغين لإزالة الإحداثيات."
                : "Leave both fields empty to remove coordinates."}
            </p>
            <div className="dashboard-actions">
              <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
                {ar ? "إلغاء" : "Cancel"}
              </Button>
              <Button type="submit" loading={saving}>
                {ar ? "حفظ الإحداثيات" : "Save coordinates"}
              </Button>
            </div>
          </form>
        ) : null}
      </Modal>
    </>
  );
}

interface TeamData {
  members: {
    id: string;
    role: "OWNER" | "MANAGER" | "STAFF";
    status: "ACTIVE" | "SUSPENDED";
    accessType: "QR" | "ACCOUNT";
    user: { id: string; displayName: string; email: string | null };
  }[];
  invitations: {
    id: string;
    email: string;
    intendedRole: "MANAGER" | "STAFF";
    expiresAt: string;
  }[];
  usage: UsageDecision;
}

interface StaffPairingResult {
  publicId: string;
  status: string;
  expiresAt: string;
  staffDisplayName: string;
  pairingQrSvg: string;
  accessibleLabel: string;
}

interface TeamStaffDevice {
  publicId: string;
  displayName: string;
  platform: string;
  status: string;
  lastSeenAt: string | null;
  staff: { id: string } | null;
}

export function TeamScreen({ locale, membership }: { locale: Locale; membership: MembershipView }) {
  const ar = locale === "ar";
  const [data, setData] = useState<TeamData | null>(null);
  const [locations, setLocations] = useState<Array<{ id: string; name: string; status: string }>>(
    [],
  );
  const [devices, setDevices] = useState<TeamStaffDevice[]>([]);
  const [open, setOpen] = useState(false);
  const [pairingMemberId, setPairingMemberId] = useState<string | null>(null);
  const [pairing, setPairing] = useState<StaffPairingResult | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const canManage = membership.role === "OWNER" || membership.role === "MANAGER";
  const load = useCallback(async () => {
    try {
      const [team, locationPage, devicePage] = await Promise.all([
        apiFetch<TeamData>(`/v1/organizations/${membership.organization.id}/members`),
        apiFetch<{ items: Array<{ id: string; name: string; status: string }> }>(
          `/v1/organizations/${membership.organization.id}/locations`,
        ),
        apiFetch<{ items: TeamStaffDevice[] }>(
          `/v1/organizations/${membership.organization.id}/staff-devices`,
        ),
      ]);
      setData(team);
      setLocations(locationPage.items.filter((location) => location.status === "ACTIVE"));
      setDevices(devicePage.items);
    } catch (caught) {
      setError(message(caught, ar ? "تعذر تحميل الفريق." : "Unable to load team."));
    }
  }, [membership.organization.id, ar]);
  useEffect(() => {
    void load();
  }, [load]);
  async function createStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    const form = new FormData(event.currentTarget);
    try {
      await apiFetch(`/v1/organizations/${membership.organization.id}/members`, {
        method: "POST",
        body: JSON.stringify({
          name: String(form.get("name") ?? ""),
          role: String(form.get("role") ?? "STAFF"),
        }),
      });
      setOpen(false);
      await load();
    } catch (caught) {
      setError(message(caught, ar ? "تعذر إنشاء الموظف." : "Unable to create Staff member."));
    } finally {
      setSaving(false);
    }
  }
  async function generatePairing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pairingMemberId) return;
    const form = new FormData(event.currentTarget);
    const locationId = String(form.get("locationId") ?? "");
    setSaving(true);
    setError("");
    try {
      await apiFetch(
        `/v1/organizations/${membership.organization.id}/members/${pairingMemberId}/location-assignments/${locationId}`,
        {
          method: "PUT",
          body: JSON.stringify({ earningAllowed: true, redemptionAllowed: true }),
        },
      );
      const result = await apiFetch<StaffPairingResult>(
        `/v1/organizations/${membership.organization.id}/device-pairing-sessions`,
        {
          method: "POST",
          body: JSON.stringify({
            staffMemberId: pairingMemberId,
            locations: [{ locationId, earningAllowed: true, redemptionAllowed: true }],
            expiresInMinutes: 10,
          }),
        },
      );
      setPairing(result);
      await load();
    } catch (caught) {
      setError(
        message(caught, ar ? "تعذر إنشاء رمز تسجيل الدخول." : "Unable to generate sign-in QR."),
      );
    } finally {
      setSaving(false);
    }
  }
  async function closePairing(cancel = false) {
    if (cancel && pairing) {
      await apiFetch(
        `/v1/organizations/${membership.organization.id}/device-pairing-sessions/${pairing.publicId}/cancel`,
        { method: "POST" },
      );
    }
    setPairing(null);
    setPairingMemberId(null);
  }
  async function cancel(id: string) {
    try {
      await apiFetch(`/v1/organizations/${membership.organization.id}/invitations/${id}`, {
        method: "DELETE",
      });
      await load();
    } catch (caught) {
      setError(message(caught, ar ? "تعذر إلغاء الدعوة." : "Unable to cancel invitation."));
    }
  }
  async function updateRole(memberId: string, role: "MANAGER" | "STAFF") {
    try {
      await apiFetch(`/v1/organizations/${membership.organization.id}/members/${memberId}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
      await load();
    } catch (caught) {
      setError(message(caught, ar ? "تعذر تغيير الدور." : "Unable to change the role."));
    }
  }
  async function removeMember(memberId: string) {
    try {
      await apiFetch(`/v1/organizations/${membership.organization.id}/members/${memberId}`, {
        method: "DELETE",
      });
      await load();
    } catch (caught) {
      setError(message(caught, ar ? "تعذر إزالة العضو." : "Unable to remove the member."));
    }
  }
  return (
    <>
      <PageHeader
        eyebrow={ar ? "الوصول والصلاحيات" : "Access and roles"}
        title={ar ? "الفريق" : "Team"}
        description={
          ar
            ? "الأدوار والصلاحيات تُفرض في الخادم لكل مؤسسة."
            : "Create local staff identities, then pair one current device with a short-lived QR."
        }
        actions={
          canManage ? (
            <Button onClick={() => setOpen(true)} disabled={data ? !data.usage.allowed : true}>
              <Plus size={17} />
              {ar ? "إضافة موظف" : "Add staff"}
            </Button>
          ) : undefined
        }
      />
      {error ? <Alert tone="danger" title={error} /> : null}
      {data ? (
        <div className="dashboard-grid">
          <Card className="dashboard-card dashboard-card--full">
            <UsageMeter
              label={
                ar
                  ? "مقاعد الفريق المستخدمة (المالك الأول لا يُحتسب)"
                  : "Team seats used (first Owner excluded)"
              }
              current={data.usage.currentUsage}
              limit={data.usage.limit}
            />
            {!data.usage.allowed ? (
              <Alert tone="warning" title={ar ? "وصلت إلى حد الفريق" : "Team limit reached"}>
                {ar
                  ? "غيّر الخطة قبل إرسال دعوة أخرى."
                  : "Choose a higher plan or remove a seat before adding another staff member."}
              </Alert>
            ) : null}
          </Card>
          <Card className="dashboard-card dashboard-card--full">
            <h2>{ar ? "الأعضاء النشطون" : "Active members"}</h2>
            <Table
              caption={ar ? "أعضاء الفريق" : "Team members"}
              headers={
                ar
                  ? ["العضو", "الدور", "الوصول", "الحالة", "الإجراء"]
                  : ["Member", "Role", "Access", "Status", "Action"]
              }
              rows={data.members.map((item) => [
                <div className="dashboard-member" key="member">
                  <Avatar name={item.user.displayName} />
                  <span>
                    <strong>{item.user.displayName}</strong>
                    <small>
                      {item.user.email ?? (ar ? "دخول QR من دون بريد" : "QR sign-in · no email")}
                    </small>
                  </span>
                </div>,
                <Badge key="role" tone={item.role === "OWNER" ? "brand" : "neutral"}>
                  {item.role}
                </Badge>,
                <div className="dashboard-access-state" key="access">
                  <Badge tone={item.accessType === "QR" ? "brand" : "neutral"}>
                    {item.accessType === "QR" ? "QR" : ar ? "حساب" : "Account"}
                  </Badge>
                  {devices.some(
                    (device) => device.staff?.id === item.id && device.status === "ACTIVE",
                  ) ? (
                    <small>{ar ? "جهاز مرتبط" : "Device paired"}</small>
                  ) : item.accessType === "QR" ? (
                    <small>{ar ? "بانتظار الربط" : "Awaiting pairing"}</small>
                  ) : null}
                </div>,
                <StatusBadge
                  key="status"
                  status={item.status === "ACTIVE" ? "active" : "suspended"}
                  label={item.status}
                />,
                item.role === "OWNER" ? (
                  <span key="protected">{ar ? "مالك محمي" : "Protected Owner"}</span>
                ) : membership.role === "OWNER" ? (
                  <div className="dashboard-actions" key="actions">
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setPairing(null);
                        setPairingMemberId(item.id);
                      }}
                    >
                      <QrCode size={16} />
                      {ar ? "رمز الدخول" : "Sign-in QR"}
                    </Button>
                    <Select
                      aria-label={
                        ar ? `دور ${item.user.displayName}` : `Role for ${item.user.displayName}`
                      }
                      value={item.role}
                      onChange={(event) =>
                        void updateRole(item.id, event.currentTarget.value as "MANAGER" | "STAFF")
                      }
                    >
                      <option value="STAFF">{ar ? "موظف" : "Staff"}</option>
                      <option value="MANAGER">{ar ? "مدير" : "Manager"}</option>
                    </Select>
                    <Button variant="ghost" onClick={() => void removeMember(item.id)}>
                      {ar ? "إزالة" : "Remove"}
                    </Button>
                  </div>
                ) : membership.role === "MANAGER" && item.role === "STAFF" ? (
                  <div className="dashboard-actions" key="manager-actions">
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setPairing(null);
                        setPairingMemberId(item.id);
                      }}
                    >
                      <QrCode size={16} />
                      {ar ? "رمز الدخول" : "Sign-in QR"}
                    </Button>
                    <Button variant="ghost" onClick={() => void removeMember(item.id)}>
                      {ar ? "إزالة" : "Remove"}
                    </Button>
                  </div>
                ) : (
                  "—"
                ),
              ])}
            />
          </Card>
          <Card className="dashboard-card dashboard-card--full">
            <h2>{ar ? "الدعوات القديمة المعلقة" : "Legacy pending invitations"}</h2>
            {data.invitations.length ? (
              <Table
                caption={ar ? "الدعوات المعلقة" : "Pending invitations"}
                headers={
                  ar
                    ? ["البريد", "الدور", "الانتهاء", "الإجراء"]
                    : ["Email", "Role", "Expires", "Action"]
                }
                rows={data.invitations.map((item) => [
                  item.email,
                  item.intendedRole,
                  new Intl.DateTimeFormat(ar ? "ar-IQ" : "en-US", { dateStyle: "medium" }).format(
                    new Date(item.expiresAt),
                  ),
                  <Button key="cancel" variant="ghost" onClick={() => void cancel(item.id)}>
                    {ar ? "إلغاء" : "Cancel"}
                  </Button>,
                ])}
              />
            ) : (
              <p style={{ color: "var(--waflo-muted)" }}>
                {ar ? "لا توجد دعوات معلقة." : "No pending invitations."}
              </p>
            )}
          </Card>
        </div>
      ) : (
        <Skeleton height="18rem" />
      )}
      <Modal
        open={open}
        title={ar ? "إضافة موظف" : "Add staff member"}
        onClose={() => setOpen(false)}
      >
        <form className="dashboard-form" onSubmit={createStaff}>
          <FormField label={ar ? "الاسم" : "Name"} required>
            <TextInput name="name" minLength={2} maxLength={100} required autoFocus />
          </FormField>
          <FormField label={ar ? "الدور" : "Role"} required>
            <Select name="role" defaultValue="STAFF">
              <option value="STAFF">{ar ? "موظف" : "Staff"}</option>
              {membership.role === "OWNER" ? (
                <option value="MANAGER">{ar ? "مدير" : "Manager"}</option>
              ) : null}
            </Select>
          </FormField>
          <Alert tone="info" title={ar ? "لا حاجة إلى بريد إلكتروني" : "No email required"}>
            {ar
              ? "بعد إنشاء الموظف، أنشئ رمز QR من صفه لربط تطبيق الهاتف."
              : "After creation, generate a QR from the staff row to pair the mobile app."}
          </Alert>
          <div className="dashboard-actions">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {ar ? "إلغاء" : "Cancel"}
            </Button>
            <Button type="submit" loading={saving}>
              {ar ? "إنشاء الموظف" : "Create staff"}
            </Button>
          </div>
        </form>
      </Modal>
      <Modal
        open={Boolean(pairingMemberId)}
        title={ar ? "ربط جهاز الموظف" : "Pair staff device"}
        onClose={() => void closePairing(Boolean(pairing))}
      >
        {pairing ? (
          <div className="dashboard-pairing-sheet">
            <Alert
              tone="warning"
              title={ar ? "هذا هو الرمز الوحيد الصالح" : "This is the only valid code"}
            >
              {ar
                ? "إنشاء هذا الرمز ألغى أي رمز وجلسة وجهاز سابق لهذا الموظف فوراً."
                : "Generating this code immediately revoked every prior code, session, and device for this staff member."}
            </Alert>
            <div className="dashboard-pairing-qr">
              <Image
                src={pairing.pairingQrSvg}
                width={280}
                height={280}
                unoptimized
                alt={pairing.accessibleLabel}
              />
            </div>
            <div className="dashboard-pairing-meta">
              <strong>{pairing.staffDisplayName}</strong>
              <span>
                {ar ? "ينتهي" : "Expires"}{" "}
                {new Intl.DateTimeFormat(ar ? "ar-IQ" : "en-US", {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(pairing.expiresAt))}
              </span>
            </div>
            <div className="dashboard-actions">
              <Button variant="secondary" onClick={() => void closePairing(true)}>
                {ar ? "إلغاء الرمز" : "Cancel code"}
              </Button>
              <Button onClick={() => void closePairing(false)}>{ar ? "تم" : "Done"}</Button>
            </div>
          </div>
        ) : (
          <form className="dashboard-form" onSubmit={generatePairing}>
            <p>
              {ar
                ? "اختر موقعاً لهذا الموظف قبل إنشاء الرمز."
                : "Choose a location for this staff member before generating the code."}
            </p>
            <FormField label={ar ? "الموقع" : "Location"} required>
              <Select name="locationId" required defaultValue={locations[0]?.id ?? ""}>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <Alert
              tone="warning"
              title={ar ? "إعادة الربط تلغي الوصول السابق" : "Regeneration signs out prior access"}
            >
              {ar
                ? "سيُلغى أي رمز أو جلسة أو جهاز نشط سابق بمجرد إنشاء رمز جديد."
                : "Any previous QR, active session, or paired device is revoked as soon as a new code is generated."}
            </Alert>
            <div className="dashboard-actions">
              <Button type="button" variant="secondary" onClick={() => void closePairing(false)}>
                {ar ? "إلغاء" : "Cancel"}
              </Button>
              <Button type="submit" loading={saving} disabled={!locations.length}>
                <QrCode size={17} />
                {ar ? "إنشاء رمز QR" : "Generate QR"}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}

interface BillingView {
  selectedPlan: "STARTER" | "GROWTH" | "SCALE";
  canManageBilling: boolean;
  selectedCadence: BillingCadence;
  profile: {
    subscriptionStatus: string;
    trialStart: string | null;
    trialEnd: string | null;
  } | null;
  customerPortalAvailable: boolean;
  subscriptions: {
    id: string;
    status: string;
    planCode: string;
    cadence: string;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    createdAt: string;
  }[];
  stripeConfigured: boolean;
  cadenceAvailability: Record<BillingCadence, boolean>;
  paymentMethod:
    | { status: "none" | "unavailable"; reason?: string }
    | {
        status: "saved";
        brand: string;
        last4: string;
        expMonth: number;
        expYear: number;
        isDefault: boolean;
      };
  billingIdentity: {
    name: string;
    email: string | null;
    countryCode: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    region: string | null;
    postalCode: string | null;
    locale: Locale;
    timezone: string;
    syncedAt: string | null;
  };
  authoritativeState: {
    subscriptionStatus: string;
    trialStart: string | null;
    trialEnd: string | null;
    renewalDate: string | null;
    nextExpectedChargeDate: string | null;
    nextExpectedAmount: number | null;
    currency: string | null;
    latestPaymentStatus: string | null;
    gracePeriodEnd: string | null;
    outstandingInvoice: {
      invoiceNumber: string | null;
      status: string;
      amountRemaining: number;
      currency: string;
      failureCategory: string | null;
      graceEndsAt: string | null;
    } | null;
  };
  invoices: Array<{
    id: string;
    number: string | null;
    status: string;
    paymentStatus: string;
    amountDue: number;
    amountPaid: number;
    amountRemaining: number;
    currency: string;
    date: string;
    periodStart: string | null;
    periodEnd: string | null;
    paidAt: string | null;
    hostedInvoiceUrl: string | null;
    invoicePdfUrl: string | null;
    refundable: boolean;
    amountRefunded: number;
    remainingRefundableAmount: number;
    paymentMethod: {
      brand: string;
      last4: string;
      expMonth: number | null;
      expYear: number | null;
    } | null;
    refunds: Array<{
      id: string;
      status: string;
      reason: string;
      explanation: string | null;
      requestedAmount: number;
      approvedAmount: number | null;
      currency: string;
      requestedAt: string;
      completedAt: string | null;
      failureCode: string | null;
    }>;
  }>;
  downgradeOptions: Array<{
    plan: PlanCode;
    violations: Array<{
      code: string;
      message: string;
      actual?: number;
      limit?: number | null;
    }>;
  }>;
}

export function BillingScreen({
  locale,
  membership,
}: {
  locale: Locale;
  membership: MembershipView;
}) {
  const ar = locale === "ar";
  const [data, setData] = useState<BillingView | null>(null);
  const [cadence, setCadence] = useState<BillingCadence>("monthly");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<PlanCode | null>(null);
  const [stripeActionInFlight, setStripeActionInFlight] = useState<"checkout" | "portal" | null>(
    null,
  );
  const stripeActionInFlightRef = useRef<"checkout" | "portal" | null>(null);
  const [checkoutCommandId, setCheckoutCommandId] = useState<string | null>(null);
  const [identitySaving, setIdentitySaving] = useState(false);
  const [refundInvoiceId, setRefundInvoiceId] = useState<string | null>(null);
  const [refundSaving, setRefundSaving] = useState(false);
  const selectedRefundInvoice = data?.invoices.find((invoice) => invoice.id === refundInvoiceId);
  const billingCountries = useMemo(
    () =>
      countryOptions(locale).map((country) => ({
        value: country.code,
        label: country.name,
      })),
    [locale],
  );
  const formatBillingDate = useCallback(
    (value: string | null) =>
      value
        ? new Intl.DateTimeFormat(ar ? "ar-IQ" : "en-US", {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: data?.billingIdentity.timezone ?? "UTC",
          }).format(new Date(value))
        : ar
          ? "غير متوفر"
          : "Not available",
    [ar, data?.billingIdentity.timezone],
  );
  const formatMoney = useCallback(
    (amount: number | null, currency: string | null) =>
      amount === null || !currency
        ? ar
          ? "غير متوفر"
          : "Not available"
        : new Intl.NumberFormat(ar ? "ar-IQ" : "en-US", {
            style: "currency",
            currency,
          }).format(amount / 100),
    [ar],
  );
  const formatRefundReason = useCallback(
    (reason: string) => {
      const normalized = reason.toLocaleUpperCase("en-US");
      const labels: Record<string, { en: string; ar: string }> = {
        DUPLICATE_CHARGE: { en: "Duplicate charge", ar: "دفعة مكررة" },
        INCORRECT_CHARGE: { en: "Incorrect charge", ar: "مبلغ غير صحيح" },
        SERVICE_FAILURE: { en: "Material service failure", ar: "مشكلة جوهرية في الخدمة" },
        UNAUTHORIZED_PAYMENT: { en: "Unauthorized payment", ar: "دفعة غير مصرح بها" },
        OTHER: { en: "Other", ar: "سبب آخر" },
      };
      return labels[normalized]?.[ar ? "ar" : "en"] ?? reason;
    },
    [ar],
  );
  const load = useCallback(async () => {
    try {
      const result = await apiFetch<BillingView>(
        `/v1/organizations/${membership.organization.id}/billing`,
      );
      setData(result);
      setCadence(result.selectedCadence);
      setError("");
    } catch (caught) {
      setError(message(caught, ar ? "تعذر تحميل الفوترة." : "Unable to load billing."));
    }
  }, [membership.organization.id, ar]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const refresh = () => void load();
    const visible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [load]);
  async function select(plan: PlanCode, selectedCadence: BillingCadence = cadence) {
    setSaving(plan);
    setError("");
    try {
      await apiFetch(`/v1/organizations/${membership.organization.id}/billing/selected-plan`, {
        method: "PATCH",
        body: JSON.stringify({ plan, cadence: selectedCadence }),
      });
      await load();
    } catch (caught) {
      if (caught instanceof ApiClientError && caught.code === "PLAN_DOWNGRADE_BLOCKED") {
        const violations = Array.isArray(caught.details?.violations)
          ? (caught.details.violations as Array<{ message?: string }>)
          : [];
        setError(
          violations.length
            ? violations
                .map((violation) => violation.message)
                .filter(Boolean)
                .join(" · ")
            : caught.message,
        );
      } else {
        setError(message(caught, ar ? "تعذر تغيير الخطة." : "Unable to change plan."));
      }
    } finally {
      setSaving(null);
    }
  }
  async function chooseCadence(nextCadence: BillingCadence) {
    setCadence(nextCadence);
    if (data) await select(data.selectedPlan.toLocaleLowerCase("en-US") as PlanCode, nextCadence);
  }
  async function stripeAction(kind: "checkout" | "portal") {
    if (stripeActionInFlightRef.current) return;
    const commandId =
      kind === "checkout" ? (checkoutCommandId ?? globalThis.crypto.randomUUID()) : null;
    if (kind === "checkout" && !checkoutCommandId) setCheckoutCommandId(commandId);
    stripeActionInFlightRef.current = kind;
    setStripeActionInFlight(kind);
    try {
      const result = await apiFetch<{ url: string | null; sessionId?: string | null }>(
        `/v1/organizations/${membership.organization.id}/billing/${kind}`,
        {
          method: "POST",
          ...(commandId ? { headers: { "x-idempotency-key": commandId } } : {}),
          ...(kind === "checkout" ? { body: JSON.stringify({ cadence }) } : {}),
        },
      );
      if (result.url) {
        if (kind === "checkout") setCheckoutCommandId(null);
        window.location.assign(result.url);
      }
    } catch (caught) {
      if (
        kind === "checkout" &&
        caught instanceof ApiClientError &&
        [
          "CHECKOUT_IDEMPOTENCY_KEY_INVALID",
          "CHECKOUT_IDEMPOTENCY_KEY_REQUIRED",
          "CHECKOUT_IDEMPOTENCY_KEY_CONFLICT",
        ].includes(caught.code)
      ) {
        setCheckoutCommandId(null);
      }
      setError(message(caught, ar ? "تعذر فتح Stripe." : "Unable to open Stripe."));
    } finally {
      stripeActionInFlightRef.current = null;
      setStripeActionInFlight(null);
    }
  }
  async function reconcile() {
    setError("");
    try {
      await apiFetch(`/v1/organizations/${membership.organization.id}/billing/reconcile`, {
        method: "POST",
      });
      await load();
    } catch (caught) {
      setError(message(caught, ar ? "تعذر تحديث حالة Stripe." : "Unable to refresh Stripe state."));
    }
  }
  async function saveBillingIdentity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIdentitySaving(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "").trim() || null;
    try {
      await apiFetch(`/v1/organizations/${membership.organization.id}/billing/identity`, {
        method: "PATCH",
        body: JSON.stringify({
          name: text("name"),
          email: text("email"),
          countryCode: text("countryCode"),
          addressLine1: text("addressLine1"),
          addressLine2: text("addressLine2"),
          city: text("city"),
          region: text("region"),
          postalCode: text("postalCode"),
        }),
      });
      await load();
    } catch (caught) {
      setError(message(caught, ar ? "تعذر حفظ هوية الفوترة." : "Unable to save billing identity."));
    } finally {
      setIdentitySaving(false);
    }
  }
  async function requestRefund(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedRefundInvoice) return;
    setRefundSaving(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const amount = Number(form.get("amount"));
    const commandId = globalThis.crypto.randomUUID();
    try {
      await apiFetch(
        `/v1/organizations/${membership.organization.id}/billing/invoices/${selectedRefundInvoice.id}/refunds`,
        {
          method: "POST",
          headers: { "x-idempotency-key": commandId },
          body: JSON.stringify({
            reason: String(form.get("reason") ?? "other"),
            amount: Math.round(amount * 100),
            explanation: String(form.get("explanation") ?? "").trim() || null,
          }),
        },
      );
      setRefundInvoiceId(null);
      await load();
    } catch (caught) {
      setError(
        message(caught, ar ? "تعذر إرسال طلب الاسترداد." : "Unable to submit the refund request."),
      );
    } finally {
      setRefundSaving(false);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow={ar ? "الاشتراك" : "Subscription"}
        title={ar ? "الفوترة والخطط" : "Billing and plans"}
        description={
          ar
            ? "الخطة المختارة مستقلة عن حالة الاشتراك والدفع والتجربة."
            : "Your selected plan is distinct from payment, subscription, and trial status."
        }
      />
      {error ? <Alert tone="danger" title={error} /> : null}
      {saving ? (
        <Alert
          tone="info"
          title={ar ? `جارٍ اختيار خطة ${saving}…` : `Selecting the ${saving} plan…`}
        />
      ) : null}
      {data ? (
        <>
          <div className="dashboard-status-band dashboard-status-band--billing">
            <div>
              <span>{ar ? "إعداد الفوترة" : "Billing setup"}</span>
              <strong>
                {data.paymentMethod.status === "saved"
                  ? ar
                    ? "طريقة دفع محفوظة"
                    : "Payment method saved"
                  : ar
                    ? "لا توجد بطاقة محفوظة"
                    : "No saved card yet"}
              </strong>
            </div>
            <Badge
              tone={data.authoritativeState.subscriptionStatus === "ACTIVE" ? "success" : "neutral"}
            >
              {data.authoritativeState.subscriptionStatus}
            </Badge>
          </div>
          <section
            className="billing-charge-rail"
            aria-label={ar ? "ملخص دورة الفوترة" : "Billing cycle summary"}
          >
            <div className="billing-charge-rail__step">
              <span>01</span>
              <small>{ar ? "الخطة" : "Plan"}</small>
              <strong>{data.selectedPlan}</strong>
              <p>{billingCadenceCatalog[data.selectedCadence].label}</p>
            </div>
            <div className="billing-charge-rail__step billing-charge-rail__step--charge">
              <span>02</span>
              <small>{ar ? "الدفعة القادمة" : "Next charge"}</small>
              <strong>
                {formatMoney(
                  data.authoritativeState.nextExpectedAmount,
                  data.authoritativeState.currency,
                )}
              </strong>
              <p>{formatBillingDate(data.authoritativeState.nextExpectedChargeDate)}</p>
            </div>
            <div className="billing-charge-rail__step">
              <span>03</span>
              <small>{ar ? "البطاقة التي ستُخصم" : "Card to charge"}</small>
              <strong dir="ltr">
                {data.paymentMethod.status === "saved"
                  ? `${data.paymentMethod.brand.toLocaleUpperCase("en-US")} •••• ${data.paymentMethod.last4}`
                  : ar
                    ? "تحتاج طريقة دفع"
                    : "Payment method needed"}
              </strong>
              <p>
                {data.paymentMethod.status === "saved"
                  ? `${ar ? "تنتهي" : "Expires"} ${String(data.paymentMethod.expMonth).padStart(2, "0")}/${data.paymentMethod.expYear}`
                  : ar
                    ? "أضف بطاقة بأمان عبر Stripe"
                    : "Add a card securely in Stripe"}
              </p>
            </div>
          </section>
          {data.authoritativeState.outstandingInvoice ? (
            <Alert tone="danger" title={ar ? "دفعة تحتاج إجراء" : "A payment needs attention"}>
              {ar ? "الفاتورة" : "Invoice"}{" "}
              {data.authoritativeState.outstandingInvoice.invoiceNumber ?? "—"} ·{" "}
              {formatMoney(
                data.authoritativeState.outstandingInvoice.amountRemaining,
                data.authoritativeState.outstandingInvoice.currency,
              )}
              {data.authoritativeState.gracePeriodEnd
                ? ` · ${ar ? "مهلة الاسترداد حتى" : "Recovery window ends"} ${formatBillingDate(data.authoritativeState.gracePeriodEnd)}`
                : ""}
              .{" "}
              {ar
                ? "حدّث طريقة الدفع لإعادة محاولة الفاتورة نفسها."
                : "Update the payment method to retry this same invoice."}
            </Alert>
          ) : null}
          <div className="dashboard-metric-grid dashboard-metric-grid--billing">
            <Card className="dashboard-card dashboard-card--metric">
              <span className="dashboard-card__label">
                {ar ? "الخطة المختارة" : "SELECTED PLAN"}
              </span>
              <span className="dashboard-card__value">{data.selectedPlan}</span>
              <small>{billingCadenceCatalog[data.selectedCadence].label}</small>
            </Card>
            <Card className="dashboard-card dashboard-card--metric">
              <span className="dashboard-card__label">
                {ar ? "اشتراك المزود" : "PROVIDER SUBSCRIPTION"}
              </span>
              <span className="dashboard-card__value">
                {data.authoritativeState.subscriptionStatus}
              </span>
              <small>
                {data.subscriptions[0]?.cancelAtPeriodEnd
                  ? ar
                    ? "سيُلغى في نهاية المدة"
                    : "Cancels at period end"
                  : data.subscriptions[0]?.currentPeriodEnd
                    ? `${ar ? "التجديد" : "Renews"} ${new Intl.DateTimeFormat(ar ? "ar-IQ" : "en-US", { dateStyle: "medium" }).format(new Date(data.subscriptions[0].currentPeriodEnd))}`
                    : ar
                      ? "بانتظار مزامنة Stripe"
                      : "Awaiting Stripe sync"}
              </small>
            </Card>
            <Card className="dashboard-card dashboard-card--metric">
              <span className="dashboard-card__label">{ar ? "حالة التجربة" : "TRIAL"}</span>
              <span className="dashboard-card__value">
                {data.authoritativeState.trialStart
                  ? ar
                    ? "بدأت"
                    : "Started"
                  : ar
                    ? "لم تبدأ"
                    : "Not started"}
              </span>
              <small>
                {data.authoritativeState.trialEnd
                  ? `${ar ? "تنتهي" : "Ends"} ${new Intl.DateTimeFormat(ar ? "ar-IQ" : "en-US", { dateStyle: "medium" }).format(new Date(data.authoritativeState.trialEnd))}`
                  : ar
                    ? "تبدأ عند أول نشر"
                    : "Starts at first publication"}
              </small>
            </Card>
            <Card className="dashboard-card dashboard-card--metric dashboard-payment-card">
              <span className="dashboard-card__label">{ar ? "طريقة الدفع" : "PAYMENT METHOD"}</span>
              {data.paymentMethod.status === "saved" ? (
                <>
                  <span className="dashboard-payment-card__brand">
                    <CreditCard size={20} />
                    {data.paymentMethod.brand.toLocaleUpperCase("en-US")} ••••{" "}
                    {data.paymentMethod.last4}
                  </span>
                  <small>
                    {ar ? "تنتهي" : "Expires"}{" "}
                    {String(data.paymentMethod.expMonth).padStart(2, "0")}/
                    {data.paymentMethod.expYear}
                    {data.paymentMethod.isDefault ? (ar ? " · الافتراضية" : " · Default") : ""}
                  </small>
                </>
              ) : (
                <>
                  <span className="dashboard-card__value">{ar ? "غير محفوظة" : "Not saved"}</span>
                  <small>
                    {data.paymentMethod.status === "unavailable"
                      ? ar
                        ? "تعذر التحقق من Stripe الآن"
                        : "Stripe could not be checked right now"
                      : ar
                        ? "أضف بطاقة آمنة عبر Stripe"
                        : "Add one securely through Stripe"}
                  </small>
                </>
              )}
            </Card>
          </div>
          <Card className="dashboard-card dashboard-card--full billing-cadence-card">
            <div className="dashboard-section-heading">
              <div>
                <span className="dashboard-card__label">
                  {ar ? "وتيرة الدفع" : "BILLING CADENCE"}
                </span>
                <h2>{ar ? "اختر موعد الفوترة" : "Choose when you are billed"}</h2>
              </div>
              <Badge tone="brand">{billingCadenceCatalog[cadence].label}</Badge>
            </div>
            <div className="billing-cadence-options" role="radiogroup" aria-label="Billing cadence">
              {(["monthly", "quarterly", "yearly"] as const).map((option) => {
                const pricing = cadencePrice(
                  data.selectedPlan.toLocaleLowerCase("en-US") as PlanCode,
                  option,
                );
                const definition = billingCadenceCatalog[option];
                return (
                  <label
                    className={`billing-cadence-option ${cadence === option ? "billing-cadence-option--selected" : ""}`}
                    key={option}
                  >
                    <input
                      type="radio"
                      name="billing-cadence"
                      value={option}
                      checked={cadence === option}
                      disabled={!data.cadenceAvailability[option] || saving !== null}
                      onChange={() => void chooseCadence(option)}
                    />
                    <span>
                      <strong>{definition.label}</strong>
                      {definition.discountRate ? (
                        <Badge tone="success">
                          {Math.round(definition.discountRate * 100)}% off
                        </Badge>
                      ) : null}
                    </span>
                    <b>${pricing.billedAmountUsd.toFixed(2)}</b>
                    <small>
                      {option === "monthly"
                        ? ar
                          ? "شهرياً"
                          : "billed monthly"
                        : `$${pricing.monthlyEquivalentUsd.toFixed(2)}/${ar ? "شهر" : "mo"} · ${ar ? "دفعة واحدة" : "one charge"}`}
                    </small>
                    {!data.cadenceAvailability[option] ? (
                      <em>{ar ? "يتطلب سعر Stripe" : "Stripe price required"}</em>
                    ) : cadence === option ? (
                      <CheckCircle2 size={18} />
                    ) : null}
                  </label>
                );
              })}
            </div>
          </Card>
          {!data.stripeConfigured ? (
            <Alert
              tone="warning"
              title={ar ? "يلزم إعداد Stripe التجريبي" : "Stripe test configuration required"}
            >
              {ar
                ? "يمكنك تغيير الخطة المختارة، لكن لن ندّعي نجاح الدفع من دون مفاتيح اختبار صالحة."
                : "You can change the selected setup plan, but Waflo will not simulate payment without valid test credentials."}
            </Alert>
          ) : null}
          <div
            className="dashboard-section-grid dashboard-section-grid--plans"
            style={{ marginTop: "1rem" }}
          >
            {(["starter", "growth", "scale"] as const).map((plan) => (
              <PlanCard
                key={plan}
                plan={plan}
                selected={data.selectedPlan.toLocaleLowerCase("en-US") === plan}
                locale={locale}
                cadence={cadence}
                onSelect={(value) => void select(value)}
              />
            ))}
          </div>
          <div className="dashboard-actions" style={{ marginTop: "1.5rem" }}>
            <Button
              onClick={() => void stripeAction("checkout")}
              loading={stripeActionInFlight === "checkout"}
              disabled={!data.stripeConfigured || stripeActionInFlight !== null}
            >
              {ar ? "الاشتراك عبر Stripe" : "Continue to Stripe Checkout"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => void stripeAction("portal")}
              loading={stripeActionInFlight === "portal"}
              disabled={
                !data.stripeConfigured ||
                !data.customerPortalAvailable ||
                stripeActionInFlight !== null
              }
            >
              {ar ? "فتح بوابة العميل" : "Open Customer Portal"}
            </Button>
            <Button variant="ghost" onClick={() => void reconcile()}>
              <RefreshCcw size={16} />
              {ar ? "تحديث حالة Stripe" : "Refresh Stripe state"}
            </Button>
          </div>
          <div className="billing-detail-grid">
            <Card className="dashboard-card billing-identity-card">
              <div className="dashboard-section-heading">
                <div>
                  <span className="dashboard-card__label">
                    {ar ? "هوية العميل" : "BILLING IDENTITY"}
                  </span>
                  <h2>{ar ? "بيانات تظهر في Stripe" : "Customer details sent to Stripe"}</h2>
                </div>
                <Badge tone={data.billingIdentity.syncedAt ? "success" : "neutral"}>
                  {data.billingIdentity.syncedAt
                    ? ar
                      ? "متزامنة"
                      : "Synced"
                    : ar
                      ? "محلية"
                      : "Local"}
                </Badge>
              </div>
              <form
                className="billing-identity-form"
                onSubmit={(event) => void saveBillingIdentity(event)}
              >
                <FormField label={ar ? "الاسم" : "Customer / organization name"} required>
                  <TextInput
                    name="name"
                    defaultValue={data.billingIdentity.name}
                    required
                    maxLength={160}
                  />
                </FormField>
                <FormField label={ar ? "بريد الفوترة" : "Billing email"} required>
                  <TextInput
                    name="email"
                    type="email"
                    defaultValue={data.billingIdentity.email ?? ""}
                    required
                  />
                </FormField>
                <FormField label={ar ? "بلد الفوترة" : "Billing country"}>
                  <SearchableSelect
                    name="countryCode"
                    options={billingCountries}
                    defaultValue={data.billingIdentity.countryCode ?? ""}
                    placeholder={ar ? "ابحث عن بلد" : "Search countries"}
                  />
                </FormField>
                <FormField label={ar ? "العنوان" : "Address line 1"}>
                  <TextInput
                    name="addressLine1"
                    defaultValue={data.billingIdentity.addressLine1 ?? ""}
                  />
                </FormField>
                <FormField label={ar ? "تفاصيل العنوان" : "Address line 2"}>
                  <TextInput
                    name="addressLine2"
                    defaultValue={data.billingIdentity.addressLine2 ?? ""}
                  />
                </FormField>
                <div className="billing-identity-form__row">
                  <FormField label={ar ? "المدينة" : "City"}>
                    <TextInput name="city" defaultValue={data.billingIdentity.city ?? ""} />
                  </FormField>
                  <FormField label={ar ? "المحافظة / الولاية" : "Region / state"}>
                    <TextInput name="region" defaultValue={data.billingIdentity.region ?? ""} />
                  </FormField>
                  <FormField label={ar ? "الرمز البريدي" : "Postal code"}>
                    <TextInput
                      name="postalCode"
                      defaultValue={data.billingIdentity.postalCode ?? ""}
                    />
                  </FormField>
                </div>
                <small className="field-help">
                  {ar
                    ? `تُعرض تواريخ الفوترة وفق ${data.billingIdentity.timezone}. بلد الفوترة مستقل عن بلد موقع النشاط.`
                    : `Billing dates use ${data.billingIdentity.timezone}. Billing country remains separate from operating locations.`}
                </small>
                <Button type="submit" loading={identitySaving}>
                  {ar ? "حفظ هوية الفوترة" : "Save billing identity"}
                </Button>
              </form>
            </Card>
            <Card className="dashboard-card billing-latest-card">
              <span className="dashboard-card__label">{ar ? "آخر دفعة" : "LATEST PAYMENT"}</span>
              <strong>
                {data.authoritativeState.latestPaymentStatus ??
                  (ar ? "لا توجد دفعة" : "No payment yet")}
              </strong>
              <dl>
                <div>
                  <dt>{ar ? "التجديد" : "Renewal"}</dt>
                  <dd>{formatBillingDate(data.authoritativeState.renewalDate)}</dd>
                </div>
                <div>
                  <dt>{ar ? "الحالة" : "Subscription"}</dt>
                  <dd>{data.authoritativeState.subscriptionStatus}</dd>
                </div>
                <div>
                  <dt>{ar ? "العملة" : "Currency"}</dt>
                  <dd>{data.authoritativeState.currency ?? "—"}</dd>
                </div>
              </dl>
            </Card>
          </div>
          <Card className="dashboard-card dashboard-card--full billing-invoice-history">
            <div className="dashboard-section-heading">
              <div>
                <span className="dashboard-card__label">
                  {ar ? "السجل المالي" : "INVOICE & RECEIPT HISTORY"}
                </span>
                <h2>{ar ? "فواتير Stripe الموثوقة" : "Authoritative Stripe invoices"}</h2>
              </div>
              <Badge tone="neutral">{data.invoices.length}</Badge>
            </div>
            {data.invoices.length ? (
              <Table
                caption={ar ? "سجل الفواتير والإيصالات" : "Invoice and receipt history"}
                headers={
                  ar
                    ? [
                        "الفاتورة",
                        "التاريخ",
                        "المبلغ",
                        "الحالة",
                        "حالة الدفع",
                        "طريقة الدفع",
                        "الاسترداد",
                        "المستند",
                      ]
                    : [
                        "Invoice",
                        "Date",
                        "Amount",
                        "Status",
                        "Payment",
                        "Payment method",
                        "Refund",
                        "Document",
                      ]
                }
                rows={data.invoices.map((invoice) => [
                  <strong key="number">{invoice.number ?? "—"}</strong>,
                  <span key="date" className="billing-invoice-date">
                    {formatBillingDate(invoice.date)}
                    {invoice.periodStart && invoice.periodEnd ? (
                      <small>
                        {formatBillingDate(invoice.periodStart)} –{" "}
                        {formatBillingDate(invoice.periodEnd)}
                      </small>
                    ) : null}
                  </span>,
                  <span key="amount" className="billing-mono">
                    {formatMoney(invoice.amountDue, invoice.currency)}
                  </span>,
                  <Badge
                    key="status"
                    tone={
                      invoice.status === "paid"
                        ? "success"
                        : invoice.amountRemaining > 0
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {invoice.status}
                  </Badge>,
                  <Badge
                    key="payment-status"
                    tone={invoice.paymentStatus === "paid" ? "success" : "warning"}
                  >
                    {invoice.paymentStatus}
                  </Badge>,
                  <span key="method" className="billing-mono" dir="ltr">
                    {invoice.paymentMethod
                      ? `${invoice.paymentMethod.brand.toLocaleUpperCase("en-US")} •••• ${invoice.paymentMethod.last4}`
                      : "—"}
                  </span>,
                  <div key="refund" className="billing-refund-cell">
                    {invoice.refunds[0] ? (
                      <>
                        <Badge
                          tone={
                            invoice.refunds[0].status === "SUCCEEDED"
                              ? "success"
                              : invoice.refunds[0].status === "FAILED" ||
                                  invoice.refunds[0].status === "REJECTED"
                                ? "danger"
                                : "warning"
                          }
                        >
                          {invoice.refunds[0].status}
                        </Badge>
                        <small>
                          {formatMoney(
                            invoice.refunds[0].approvedAmount ?? invoice.refunds[0].requestedAmount,
                            invoice.refunds[0].currency,
                          )}
                        </small>
                        <small>{formatRefundReason(invoice.refunds[0].reason)}</small>
                        {invoice.refunds[0].explanation ? (
                          <small>{invoice.refunds[0].explanation}</small>
                        ) : null}
                      </>
                    ) : invoice.refundable && data.canManageBilling ? (
                      <Button
                        variant="ghost"
                        onClick={() => setRefundInvoiceId(invoice.id)}
                        aria-label={`${ar ? "طلب استرداد للفاتورة" : "Request refund for invoice"} ${invoice.number ?? ""}`}
                      >
                        {ar ? "طلب استرداد" : "Request refund"}
                      </Button>
                    ) : invoice.amountRefunded > 0 ? (
                      <small>
                        {ar ? "تم استرداد" : "Refunded"}{" "}
                        {formatMoney(invoice.amountRefunded, invoice.currency)}
                      </small>
                    ) : (
                      <span>—</span>
                    )}
                  </div>,
                  invoice.hostedInvoiceUrl || invoice.invoicePdfUrl ? (
                    <a
                      key="document"
                      className="billing-invoice-link"
                      href={invoice.hostedInvoiceUrl ?? invoice.invoicePdfUrl ?? undefined}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {invoice.status === "paid"
                        ? ar
                          ? "الفاتورة / الإيصال"
                          : "Invoice / receipt"
                        : ar
                          ? "عرض الفاتورة"
                          : "View invoice"}
                    </a>
                  ) : (
                    <span key="document">—</span>
                  ),
                ])}
              />
            ) : (
              <EmptyState
                icon={<CreditCard />}
                title={ar ? "لا توجد فواتير بعد" : "No invoices yet"}
                description={
                  ar
                    ? "ستظهر فواتير Stripe وإيصالات الدفع هنا."
                    : "Stripe invoices and paid receipt links will appear here."
                }
              />
            )}
          </Card>
          <div className="billing-policy-link">
            <span>
              {ar
                ? "الإلغاء والتخفيض والاسترداد حالات مختلفة."
                : "Cancellation, downgrade, and refund are different outcomes."}
            </span>
            <a
              href={`${process.env.NEXT_PUBLIC_MARKETING_URL ?? "http://localhost:3000"}/${locale}/refunds`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {ar ? "سياسة الفوترة والاسترداد" : "Billing & Refund Policy"}
            </a>
          </div>
          {data.downgradeOptions.length ? (
            <Card className="dashboard-card dashboard-card--full billing-downgrade-card">
              <div className="dashboard-section-heading">
                <div>
                  <span className="dashboard-card__label">
                    {ar ? "سلامة التخفيض" : "DOWNGRADE SAFETY"}
                  </span>
                  <h2>{ar ? "المتطلبات قبل خفض الخطة" : "Requirements before moving down"}</h2>
                  <p>
                    {ar
                      ? "يجب حل هذه العناصر قبل خفض الخطة."
                      : "You need to resolve these items before downgrading."}
                  </p>
                </div>
              </div>
              <div className="billing-downgrade-options">
                {data.downgradeOptions.map((option) => (
                  <div key={option.plan} className="billing-downgrade-option">
                    <div>
                      <strong>{option.plan.toLocaleUpperCase("en-US")}</strong>
                      <Badge tone={option.violations.length ? "warning" : "success"}>
                        {option.violations.length
                          ? `${option.violations.length} ${ar ? "متطلبات" : "to resolve"}`
                          : ar
                            ? "جاهز"
                            : "Ready"}
                      </Badge>
                    </div>
                    {option.violations.length ? (
                      <ul>
                        {option.violations.map((violation) => (
                          <li key={`${option.plan}-${violation.code}`}>{violation.message}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>
                        {ar
                          ? "الحساب يطابق حدود هذه الخطة."
                          : "The account fits this plan's limits."}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
          <Alert tone="info" title={ar ? "التجربة لم تبدأ" : "Trial remains pending"}>
            {ar
              ? "لا تبدأ التجربة عند اختيار الخطة أو فتح Stripe؛ تبدأ عند نشر أول بطاقة ولاء."
              : "The trial does not start when you select a plan or open Stripe; it starts when your first loyalty card is published."}
          </Alert>
        </>
      ) : (
        <Skeleton height="20rem" />
      )}
      <Modal
        open={Boolean(selectedRefundInvoice)}
        title={ar ? "طلب مراجعة استرداد" : "Request a refund review"}
        onClose={() => {
          if (!refundSaving) setRefundInvoiceId(null);
        }}
      >
        {selectedRefundInvoice ? (
          <form className="billing-refund-form" onSubmit={(event) => void requestRefund(event)}>
            <div className="billing-refund-summary">
              <div>
                <span>{ar ? "الفاتورة" : "Invoice"}</span>
                <strong>{selectedRefundInvoice.number ?? "—"}</strong>
              </div>
              <div>
                <span>{ar ? "تاريخ الدفع" : "Payment date"}</span>
                <strong>{formatBillingDate(selectedRefundInvoice.paidAt)}</strong>
              </div>
              <div>
                <span>{ar ? "المبلغ المدفوع" : "Originally paid"}</span>
                <strong>
                  {formatMoney(selectedRefundInvoice.amountPaid, selectedRefundInvoice.currency)}
                </strong>
              </div>
              <div>
                <span>{ar ? "المتاح للمراجعة" : "Remaining refundable"}</span>
                <strong>
                  {formatMoney(
                    selectedRefundInvoice.remainingRefundableAmount,
                    selectedRefundInvoice.currency,
                  )}
                </strong>
              </div>
            </div>
            <Alert
              tone="info"
              title={
                ar
                  ? "هذا طلب مراجعة، وليس استرداداً فورياً"
                  : "This starts a review; it does not refund automatically"
              }
            >
              {ar
                ? "تتحقق Waflo من الفاتورة والمبلغ ومسار الدفع الأصلي قبل أي تنفيذ."
                : "Waflo verifies the invoice, amount, and original payment path before execution."}
            </Alert>
            <FormField label={ar ? "سبب الطلب" : "Reason"} required>
              <Select name="reason" required defaultValue="duplicate_charge">
                <option value="duplicate_charge">{ar ? "دفعة مكررة" : "Duplicate charge"}</option>
                <option value="incorrect_charge">
                  {ar ? "مبلغ غير صحيح" : "Incorrect charge"}
                </option>
                <option value="service_failure">
                  {ar ? "مشكلة جوهرية في الخدمة" : "Material service failure"}
                </option>
                <option value="unauthorized_payment">
                  {ar ? "دفعة غير مصرح بها" : "Unauthorized payment"}
                </option>
                <option value="other">{ar ? "سبب آخر" : "Other"}</option>
              </Select>
            </FormField>
            <FormField
              label={`${ar ? "المبلغ" : "Amount"} (${selectedRefundInvoice.currency})`}
              hint={ar ? "يمكن طلب استرداد جزئي." : "A partial refund can be requested."}
              required
            >
              <TextInput
                name="amount"
                type="number"
                min="0.01"
                max={(selectedRefundInvoice.remainingRefundableAmount / 100).toFixed(2)}
                step="0.01"
                defaultValue={(selectedRefundInvoice.remainingRefundableAmount / 100).toFixed(2)}
                inputMode="decimal"
                required
              />
            </FormField>
            <FormField
              label={ar ? "شرح اختياري" : "Optional explanation"}
              hint={
                ar
                  ? "لا تُدخل رقم البطاقة الكامل أو رمز CVC."
                  : "Do not include a full card number or CVC."
              }
            >
              <TextArea name="explanation" maxLength={2000} rows={5} />
            </FormField>
            <div className="dashboard-actions">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setRefundInvoiceId(null)}
                disabled={refundSaving}
              >
                {ar ? "إلغاء" : "Cancel"}
              </Button>
              <Button type="submit" loading={refundSaving}>
                {ar ? "إرسال طلب المراجعة" : "Submit refund request"}
              </Button>
            </div>
          </form>
        ) : null}
      </Modal>
    </>
  );
}

export function AuditScreen({
  locale,
  membership,
}: {
  locale: Locale;
  membership: MembershipView;
}) {
  const ar = locale === "ar";
  const [items, setItems] = useState<AuditItem[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    void apiFetch<{ items: AuditItem[] }>(`/v1/organizations/${membership.organization.id}/audit`)
      .then((result) => setItems(result.items))
      .catch((caught: unknown) =>
        setError(message(caught, ar ? "تعذر تحميل سجل التدقيق." : "Unable to load audit history.")),
      );
  }, [membership.organization.id, ar]);
  return (
    <>
      <PageHeader
        eyebrow={ar ? "تاريخ غير قابل للتعديل" : "Append-only history"}
        title={ar ? "سجل التدقيق" : "Audit log"}
        description={
          ar
            ? "الأحداث المعروضة آمنة ومحدودة ولا تشمل رموزاً أو أسراراً."
            : "Displayed events are redacted and never include tokens or secrets."
        }
      />
      {error ? <Alert tone="danger" title={error} /> : null}
      <Card className="dashboard-list-card">
        {items.length ? (
          <Table
            caption={ar ? "أحداث التدقيق" : "Audit events"}
            headers={
              ar ? ["الإجراء", "المنفذ", "الهدف", "التاريخ"] : ["Action", "Actor", "Target", "Date"]
            }
            rows={items.map((item) => [
              <span className="dashboard-audit-action" key="action">
                {item.action}
              </span>,
              item.actor?.displayName ?? (ar ? "النظام" : "System"),
              <span className="dashboard-audit-meta" key="target">
                {item.targetType}
              </span>,
              new Intl.DateTimeFormat(ar ? "ar-IQ" : "en-US", {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(item.createdAt)),
            ])}
          />
        ) : (
          <EmptyState
            icon={<CalendarClock />}
            title={ar ? "لا توجد أحداث بعد" : "No events yet"}
            description={
              ar
                ? "ستظهر تغييرات المؤسسة المصرح بها هنا."
                : "Authorized organization changes will appear here."
            }
          />
        )}
      </Card>
    </>
  );
}

export function SettingsScreen({
  locale,
  membership,
  onOrganizationChanged,
}: {
  locale: Locale;
  membership: MembershipView;
  onOrganizationChanged: () => Promise<void>;
}) {
  const ar = locale === "ar";
  const [organization, setOrganization] = useState<OrganizationView | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const timezones = useMemo(
    () =>
      timeZoneOptions(locale).map((option) => ({
        value: option.id,
        label: option.label,
        group: option.group,
      })),
    [locale],
  );
  const load = useCallback(async () => {
    try {
      setOrganization(await apiFetch(`/v1/organizations/${membership.organization.id}`));
    } catch (caught) {
      setError(message(caught, ar ? "تعذر تحميل الإعدادات." : "Unable to load settings."));
    }
  }, [membership.organization.id, ar]);
  useEffect(() => {
    void load();
  }, [load]);
  async function saveGeneral(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await apiFetch(`/v1/organizations/${membership.organization.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: String(form.get("name") ?? ""),
          businessCategory: String(form.get("category") ?? "") || null,
          defaultLocale: String(form.get("locale") ?? "en"),
          timezone: String(form.get("timezone") ?? "Asia/Baghdad"),
        }),
      });
      setNotice(ar ? "تم حفظ الإعدادات." : "Settings saved.");
      await load();
      await onOrganizationChanged();
    } catch (caught) {
      setError(message(caught, ar ? "تعذر الحفظ." : "Unable to save."));
    }
  }
  async function changeSlug(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await apiFetch(`/v1/organizations/${membership.organization.id}/slug`, {
        method: "PATCH",
        body: JSON.stringify({
          slug: String(form.get("slug") ?? ""),
          password: String(form.get("password") ?? ""),
        }),
      });
      setNotice(
        ar
          ? "تم تغيير رابط التاجر وحجز الرابط السابق مؤقتاً."
          : "Merchant URL changed; the previous slug is temporarily reserved.",
      );
      await load();
      await onOrganizationChanged();
    } catch (caught) {
      setError(message(caught, ar ? "تعذر تغيير الرابط." : "Unable to change URL."));
    }
  }
  return (
    <>
      <PageHeader
        eyebrow={ar ? "إعدادات المؤسسة" : "Organization settings"}
        title={ar ? "الإعدادات" : "Settings"}
        description={
          ar
            ? "تُحفظ التغييرات في الخادم وتُسجّل في سجل التدقيق."
            : "Changes are stored server-side and recorded in the audit log."
        }
      />
      {error ? <Alert tone="danger" title={error} /> : null}
      {notice ? <Alert tone="success" title={notice} /> : null}
      {organization ? (
        <div className="dashboard-section-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <Card className="dashboard-form-card">
            <h2>{ar ? "عام" : "General"}</h2>
            <form className="dashboard-form" onSubmit={saveGeneral}>
              <FormField label={ar ? "اسم المؤسسة" : "Organization name"} required>
                <TextInput name="name" defaultValue={organization.name} required />
              </FormField>
              <FormField label={ar ? "نوع النشاط" : "Business category"}>
                <TextInput name="category" defaultValue={organization.businessCategory ?? ""} />
              </FormField>
              <FormField label={ar ? "اللغة الافتراضية" : "Default language"}>
                <Select
                  name="locale"
                  defaultValue={organization.defaultLocale.toLocaleLowerCase("en-US")}
                >
                  <option value="en">English</option>
                  <option value="ar">العربية</option>
                </Select>
              </FormField>
              <FormField label={ar ? "المنطقة الزمنية" : "Timezone"}>
                <SearchableSelect
                  name="timezone"
                  options={timezones}
                  defaultValue={organization.timezone}
                  placeholder={ar ? "ابحث عن منطقة زمنية" : "Search timezones"}
                  required
                />
              </FormField>
              <Button type="submit">{ar ? "حفظ التغييرات" : "Save changes"}</Button>
            </form>
          </Card>
          <Card className="dashboard-form-card">
            <h2>{ar ? "رابط التاجر" : "Merchant URL"}</h2>
            <Alert tone="warning" title={ar ? "تغيير حساس" : "Sensitive change"}>
              {ar
                ? "يتطلب كلمة المرور، ويسجَّل، ويُحجز الرابط السابق لمدة 90 يوماً."
                : "Requires your password, is audited, and reserves the previous slug for 90 days."}
            </Alert>
            <form className="dashboard-form" onSubmit={changeSlug}>
              <FormField label={ar ? "الرابط الجديد" : "New slug"} required>
                <TextInput
                  name="slug"
                  defaultValue={organization.merchantSlug}
                  dir="ltr"
                  pattern="[a-z0-9-]{3,40}"
                  required
                />
              </FormField>
              <div className="dashboard-url" dir="ltr">
                https://{organization.merchantSlug}.waflo.app
              </div>
              <FormField label={ar ? "تأكيد كلمة المرور" : "Confirm password"} required>
                <PasswordInput name="password" required />
              </FormField>
              <Button type="submit">{ar ? "تغيير رابط التاجر" : "Change merchant URL"}</Button>
            </form>
          </Card>
        </div>
      ) : (
        <Skeleton height="24rem" />
      )}
    </>
  );
}

interface SessionItem {
  id: string;
  deviceLabel: string | null;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
  current: boolean;
}

interface SecurityEvent {
  id: string;
  eventType: string;
  severity: string;
  createdAt: string;
}

interface ExternalIdentityView {
  provider: "GOOGLE" | "APPLE";
  providerEmail: string | null;
  createdAt: string;
  lastUsedAt: string;
}

interface ExternalIdentitySettings {
  passwordEnabled: boolean;
  identities: ExternalIdentityView[];
}

interface ExternalProviderCapabilities {
  googleSignInAvailable: boolean;
  appleSignInAvailable: boolean;
}

export function SecurityScreen({
  locale,
  membership,
}: {
  locale: Locale;
  membership: MembershipView;
}) {
  const ar = locale === "ar";
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [identitySettings, setIdentitySettings] = useState<ExternalIdentitySettings | null>(null);
  const [providerCapabilities, setProviderCapabilities] = useState<ExternalProviderCapabilities>({
    googleSignInAvailable: false,
    appleSignInAvailable: false,
  });
  const [identityPassword, setIdentityPassword] = useState("");
  const [dangerConfirmation, setDangerConfirmation] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    try {
      const [sessionData, eventData, identityData, capabilities] = await Promise.all([
        apiFetch<SessionItem[]>("/v1/auth/sessions"),
        apiFetch<{ items: SecurityEvent[] }>("/v1/security/events"),
        apiFetch<ExternalIdentitySettings>("/v1/auth/external/identities"),
        apiFetch<ExternalProviderCapabilities>("/v1/auth/external/providers"),
      ]);
      setSessions(sessionData);
      setEvents(eventData.items);
      setIdentitySettings(identityData);
      setProviderCapabilities(capabilities);
    } catch (caught) {
      setError(
        message(caught, ar ? "تعذر تحميل إعدادات الأمان." : "Unable to load security settings."),
      );
    }
  }, [ar]);
  useEffect(() => {
    void load();
  }, [load]);
  async function revoke(id: string) {
    try {
      const result = await apiFetch<{ currentSessionRevoked: boolean }>(`/v1/auth/sessions/${id}`, {
        method: "DELETE",
      });
      if (result.currentSessionRevoked) {
        resetCsrf();
        window.location.assign(`/${locale}/logged-out`);
        return;
      }
      await load();
    } catch (caught) {
      setError(message(caught, ar ? "تعذر إنهاء الجلسة." : "Unable to revoke session."));
    }
  }
  async function revokeOthers() {
    try {
      const result = await apiFetch<{ revoked: number }>("/v1/auth/sessions/revoke-others", {
        method: "POST",
      });
      setNotice(ar ? `تم إنهاء ${result.revoked} جلسات.` : `Revoked ${result.revoked} sessions.`);
      await load();
    } catch (caught) {
      setError(message(caught, ar ? "تعذر إنهاء الجلسات." : "Unable to revoke sessions."));
    }
  }
  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("newPassword") ?? "");
    if (newPassword !== String(form.get("confirmPassword") ?? "")) {
      setError(ar ? "كلمتا المرور غير متطابقتين." : "Passwords do not match.");
      return;
    }
    try {
      await apiFetch("/v1/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: String(form.get("currentPassword") ?? ""),
          newPassword,
        }),
      });
      setNotice(
        ar ? "تم تغيير كلمة المرور وتدوير الجلسة." : "Password changed and session rotated.",
      );
      await load();
    } catch (caught) {
      setError(message(caught, ar ? "تعذر تغيير كلمة المرور." : "Unable to change password."));
    }
  }
  async function linkIdentity(provider: "google" | "apple") {
    setError("");
    try {
      const result = await apiFetch<{ authorizationUrl: string }>(
        `/v1/auth/external/${provider}/link`,
        {
          method: "POST",
          body: JSON.stringify({ currentPassword: identityPassword, locale }),
        },
      );
      window.location.assign(result.authorizationUrl);
    } catch (caught) {
      setError(
        message(
          caught,
          ar ? "تعذر بدء ربط طريقة تسجيل الدخول." : "Unable to start account linking.",
        ),
      );
    }
  }
  async function unlinkIdentity(provider: "google" | "apple") {
    setError("");
    try {
      await apiFetch(`/v1/auth/external/${provider}`, {
        method: "DELETE",
        body: JSON.stringify({ currentPassword: identityPassword }),
      });
      setNotice(ar ? "تم فصل طريقة تسجيل الدخول بأمان." : "Sign-in method disconnected safely.");
      setIdentityPassword("");
      await load();
    } catch (caught) {
      setError(
        message(
          caught,
          ar ? "تعذر فصل طريقة تسجيل الدخول." : "Unable to disconnect sign-in method.",
        ),
      );
    }
  }
  async function accountLifecycle(type: "deactivate" | "deletion-request") {
    const confirmation = type === "deactivate" ? "DEACTIVATE" : "REQUEST DELETION";
    if (dangerConfirmation !== confirmation) return;
    setError("");
    try {
      await apiFetch(`/v1/auth/me/${type}`, {
        method: "POST",
        body: JSON.stringify({
          commandId: crypto.randomUUID(),
          confirmation,
          currentPassword: identityPassword,
        }),
      });
      resetCsrf();
      window.location.assign(`/${locale}/logged-out`);
    } catch (caught) {
      setError(
        message(
          caught,
          ar ? "تعذر إكمال طلب دورة حياة الحساب." : "Unable to complete the account request.",
        ),
      );
    }
  }
  async function closeOrganization() {
    if (dangerConfirmation !== "CLOSE ORGANIZATION") return;
    setError("");
    try {
      await apiFetch(`/v1/organizations/${membership.organization.id}/close`, {
        method: "POST",
        body: JSON.stringify({
          confirmation: dangerConfirmation,
          currentPassword: identityPassword,
        }),
      });
      window.location.assign(`/${locale}`);
    } catch (caught) {
      setError(message(caught, ar ? "تعذر إغلاق المؤسسة." : "Unable to close the organization."));
    }
  }
  return (
    <>
      <PageHeader
        eyebrow={ar ? "أمان الحساب" : "Account security"}
        title={ar ? "الجلسات وكلمة المرور" : "Sessions and password"}
        description={
          ar
            ? "راجع الأجهزة وأنهِ أي جلسة لا تعرفها."
            : "Review signed-in devices and revoke anything you do not recognize."
        }
      />
      {error ? <Alert tone="danger" title={error} /> : null}
      {notice ? <Alert tone="success" title={notice} /> : null}
      <div className="dashboard-status-band dashboard-status-band--security">
        <div>
          <span>{ar ? "وضع الحساب" : "Account posture"}</span>
          <strong>{ar ? "مراقبة الوصول مفعّلة" : "Access monitoring active"}</strong>
        </div>
        <div className="dashboard-status-band__facts">
          <span>
            {sessions.length} {ar ? "جلسات" : "sessions"}
          </span>
          <span>
            {identitySettings?.identities.length ?? 0} {ar ? "طرق خارجية" : "linked providers"}
          </span>
          <span>
            {events.length} {ar ? "أحداث حديثة" : "recent events"}
          </span>
        </div>
      </div>
      <div className="dashboard-section-grid security-layout">
        <Card className="dashboard-form-card">
          <div className="dashboard-section-heading">
            <h2>{ar ? "الجلسات النشطة" : "Active sessions"}</h2>
            <Button variant="secondary" onClick={() => void revokeOthers()}>
              {ar ? "إنهاء الجلسات الأخرى" : "Revoke others"}
            </Button>
          </div>
          <Table
            caption={ar ? "الجلسات النشطة" : "Active sessions"}
            headers={
              ar
                ? ["الجهاز", "آخر نشاط", "الحالة", "الإجراء"]
                : ["Device", "Last active", "Status", "Action"]
            }
            rows={sessions.map((session) => [
              session.deviceLabel ?? (ar ? "جهاز غير معروف" : "Unknown device"),
              new Intl.DateTimeFormat(ar ? "ar-IQ" : "en-US", {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(session.lastActiveAt)),
              session.current ? (
                <Badge key="current" tone="success">
                  {ar ? "الحالية" : "Current"}
                </Badge>
              ) : (
                <Badge key="other">{ar ? "نشطة" : "Active"}</Badge>
              ),
              <Button key="revoke" variant="ghost" onClick={() => void revoke(session.id)}>
                {ar ? "إنهاء" : "Revoke"}
              </Button>,
            ])}
          />
        </Card>
        <Card className="dashboard-form-card">
          <h2>{ar ? "تغيير كلمة المرور" : "Change password"}</h2>
          <form className="dashboard-form" onSubmit={changePassword}>
            <FormField label={ar ? "كلمة المرور الحالية" : "Current password"} required>
              <PasswordInput name="currentPassword" required />
            </FormField>
            <FormField label={ar ? "كلمة المرور الجديدة" : "New password"} required>
              <PasswordInput
                name="newPassword"
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
                required
              />
            </FormField>
            <FormField label={ar ? "التأكيد" : "Confirm"} required>
              <PasswordInput
                name="confirmPassword"
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
                required
              />
            </FormField>
            <Button type="submit">{ar ? "تغيير كلمة المرور" : "Change password"}</Button>
          </form>
        </Card>
        <Card className="dashboard-form-card dashboard-card--full">
          <h2>{ar ? "طرق تسجيل الدخول" : "Sign-in methods"}</h2>
          <p style={{ color: "var(--waflo-muted)", maxWidth: "68ch" }}>
            {ar
              ? "اربط حساب Google أو Apple بهوية وافلو الحالية. البريد الوارد من المزود هو بيانات وصفية وليس معرّف الحساب."
              : "Connect Google or Apple to this Waflo identity. Provider email is metadata, never your permanent account identifier."}
          </p>
          {identitySettings?.passwordEnabled ? (
            <FormField label={ar ? "كلمة المرور الحالية للتأكيد" : "Current password to confirm"}>
              <PasswordInput
                value={identityPassword}
                onChange={(event) => setIdentityPassword(event.currentTarget.value)}
                autoComplete="current-password"
              />
            </FormField>
          ) : (
            <p style={{ color: "var(--waflo-muted)" }}>
              {ar
                ? "للحسابات الخارجية فقط، يلزم تسجيل دخول حديث قبل إضافة طريقة أخرى."
                : "OAuth-only accounts require a recent sign-in before another method can be connected."}
            </p>
          )}
          <div className="dashboard-form__row">
            {(["google", "apple"] as const).map((provider) => {
              const code = provider.toUpperCase() as "GOOGLE" | "APPLE";
              const linked = identitySettings?.identities.find((item) => item.provider === code);
              const available =
                provider === "google"
                  ? providerCapabilities.googleSignInAvailable
                  : providerCapabilities.appleSignInAvailable;
              const label = provider === "google" ? "Google" : "Apple";
              return (
                <Card key={provider} style={{ padding: "1rem", flex: "1 1 18rem" }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: "1rem",
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <strong>{label}</strong>
                      <div style={{ color: "var(--waflo-muted)", marginTop: ".25rem" }}>
                        {linked
                          ? (linked.providerEmail ?? (ar ? "مرتبط" : "Connected"))
                          : available
                            ? ar
                              ? "متاح للربط"
                              : "Available to connect"
                            : ar
                              ? "غير مهيأ"
                              : "Not configured"}
                      </div>
                    </div>
                    {linked ? (
                      <Button variant="ghost" onClick={() => void unlinkIdentity(provider)}>
                        {ar ? "فصل" : "Disconnect"}
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        disabled={
                          !available ||
                          (Boolean(identitySettings?.passwordEnabled) && !identityPassword)
                        }
                        onClick={() => void linkIdentity(provider)}
                      >
                        {ar ? "ربط" : "Connect"}
                      </Button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </Card>
        <Card className="dashboard-form-card dashboard-card--full">
          <h2>{ar ? "أحداث الأمان الحديثة" : "Recent security events"}</h2>
          {events.length ? (
            <Table
              caption={ar ? "أحداث الأمان" : "Security events"}
              headers={ar ? ["الحدث", "الخطورة", "التاريخ"] : ["Event", "Severity", "Date"]}
              rows={events.map((event) => [
                event.eventType,
                <Badge
                  key="severity"
                  tone={
                    event.severity === "HIGH" || event.severity === "CRITICAL"
                      ? "danger"
                      : "neutral"
                  }
                >
                  {event.severity}
                </Badge>,
                new Intl.DateTimeFormat(ar ? "ar-IQ" : "en-US", {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(event.createdAt)),
              ])}
            />
          ) : (
            <p style={{ color: "var(--waflo-muted)" }}>
              {ar ? "لا توجد أحداث أمان حديثة." : "No recent security events."}
            </p>
          )}
        </Card>
        <Card className="dashboard-form-card dashboard-card--full dashboard-danger-zone">
          <h2>{ar ? "إجراءات حساسة" : "Sensitive account actions"}</h2>
          <p style={{ color: "var(--waflo-muted)", maxWidth: "72ch" }}>
            {ar
              ? "اكتب DEACTIVATE لتعطيل الحساب، أو REQUEST DELETION لتسجيل طلب حذف ومراجعته وفق السياسة. مالك المؤسسة يمكنه كتابة CLOSE ORGANIZATION لإيقاف العمليات مع الاحتفاظ بسجل التدقيق."
              : "Type DEACTIVATE to disable your account, REQUEST DELETION to record a policy-reviewed deletion request, or—if you are the owner—CLOSE ORGANIZATION to stop operations while retaining audit history."}
          </p>
          <FormField label={ar ? "عبارة التأكيد" : "Confirmation phrase"}>
            <TextInput
              value={dangerConfirmation}
              onChange={(event) => setDangerConfirmation(event.currentTarget.value)}
              autoComplete="off"
            />
          </FormField>
          <div className="dashboard-form__row">
            <Button
              variant="secondary"
              disabled={dangerConfirmation !== "DEACTIVATE"}
              onClick={() => void accountLifecycle("deactivate")}
            >
              {ar ? "تعطيل الحساب" : "Deactivate account"}
            </Button>
            <Button
              variant="secondary"
              disabled={dangerConfirmation !== "REQUEST DELETION"}
              onClick={() => void accountLifecycle("deletion-request")}
            >
              {ar ? "طلب حذف الحساب" : "Request account deletion"}
            </Button>
            {membership.role === "OWNER" ? (
              <Button
                variant="secondary"
                disabled={dangerConfirmation !== "CLOSE ORGANIZATION"}
                onClick={() => void closeOrganization()}
              >
                {ar ? "إغلاق المؤسسة" : "Close organization"}
              </Button>
            ) : null}
          </div>
        </Card>
      </div>
    </>
  );
}

export function FutureScreen({ locale }: { locale: Locale; section: DashboardSection }) {
  const ar = locale === "ar";
  const title = ar ? "هذا القسم غير متاح" : "This section is unavailable";
  const description = ar
    ? "استخدم قائمة لوحة التحكم للعودة إلى قسم متاح."
    : "Use the dashboard navigation to return to an available section.";
  return (
    <>
      <PageHeader
        eyebrow={ar ? "لوحة التحكم" : "Dashboard"}
        title={title}
        description={description}
      />
      <Card>
        <EmptyState icon={<Gift />} title={title} description={description} />
      </Card>
    </>
  );
}
