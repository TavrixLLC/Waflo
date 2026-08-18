"use client";

import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { billingCadenceCatalog, cadencePrice } from "@waflo/billing";
import {
  type BillingCadence,
  countryOptions,
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
  DropdownMenu,
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
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  Gift,
  MapPin,
  MoreHorizontal,
  Plus,
  QrCode,
  RefreshCcw,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ApiClientError, apiFetch, resetCsrf } from "../lib/api-client";
import { billingPriceTruth, canPersistCatalogSelection } from "./billing-presentation";
import type { DashboardSection, MembershipView } from "./dashboard";
import {
  LocationAddressFields,
  LocationMapPicker,
  type LocationMapSelection,
} from "./location-map-picker";

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

export function OverviewScreen({
  locale,
  membership,
}: {
  locale: Locale;
  membership: MembershipView;
}) {
  const ar = locale === "ar";
  const [organization, setOrganization] = useState<OrganizationView | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const id = membership.organization.id;
    void apiFetch<OrganizationView>(`/v1/organizations/${id}`)
      .then(setOrganization)
      .catch((caught: unknown) =>
        setError(
          message(caught, ar ? "تعذر تحميل البيانات." : "Unable to load organization data."),
        ),
      );
  }, [membership.organization.id, ar]);
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
  const status = organization.billingProfile.subscriptionStatus;
  const statusCopy = {
    PENDING_ACTIVATION: ar ? "جاهز لبدء التجربة" : "Ready to start",
    TRIALING: ar ? "تجربة مجانية" : "Free trial",
    ACTIVE: ar ? "نشط" : "Active",
    PAST_DUE: ar ? "تعذّر الدفع" : "Payment needed",
    GRACE_PERIOD: ar ? "يتطلب انتباهك" : "Needs attention",
    SUSPENDED: ar ? "متوقف مؤقتاً" : "Paused",
    CANCELED: ar ? "ملغي" : "Canceled",
  }[status];
  const statusTone =
    status === "ACTIVE" || status === "TRIALING"
      ? "success"
      : status === "PENDING_ACTIVATION"
        ? "warning"
        : "danger";
  const trialEnd = organization.billingProfile.trialEnd
    ? new Intl.DateTimeFormat(ar ? "ar-IQ-u-nu-latn" : "en-US", { dateStyle: "medium" }).format(
        new Date(organization.billingProfile.trialEnd),
      )
    : null;
  return (
    <>
      <PageHeader
        title={ar ? `مرحباً، ${organization.name}` : `Welcome, ${organization.name}`}
        description={ar ? "كل ما يحتاج انتباهك اليوم." : "What needs your attention today."}
      />
      <div className="overview-layout">
        <section className="overview-status" aria-labelledby="overview-status-title">
          <div>
            <div className="overview-status__title">
              <h2 id="overview-status-title">{ar ? "اشتراكك" : "Your subscription"}</h2>
              <Badge tone={statusTone}>{statusCopy}</Badge>
            </div>
            <p>
              {status === "PENDING_ACTIVATION"
                ? ar
                  ? "اختر باقتك وأضف طريقة الدفع لبدء 7 أيام مجاناً."
                  : "Choose a plan and add a payment method to start 7 days free."
                : status === "TRIALING" && trialEnd
                  ? ar
                    ? `تجربتك مجانية حتى ${trialEnd}.`
                    : `Your trial is free through ${trialEnd}.`
                  : status === "ACTIVE"
                    ? ar
                      ? "اشتراكك يعمل بشكل طبيعي."
                      : "Your subscription is running normally."
                    : ar
                      ? "افتح الفوترة لمعرفة الإجراء المطلوب."
                      : "Open Billing to see what needs attention."}
            </p>
          </div>
          <Link
            className="wf-button wf-button--secondary dashboard-action-link"
            href={`/${locale}/dashboard/billing`}
          >
            {status === "PENDING_ACTIVATION"
              ? ar
                ? "ابدأ التجربة"
                : "Start trial"
              : ar
                ? "عرض الفوترة"
                : "View billing"}
          </Link>
        </section>

        <dl className="overview-metrics" aria-label={ar ? "ملخص النشاط" : "Business summary"}>
          <div>
            <dt>{ar ? "الباقة" : "Plan"}</dt>
            <dd>{organization.selectedPlan}</dd>
          </div>
          <div>
            <dt>{ar ? "الفروع" : "Locations"}</dt>
            <dd>{organization._count.locations}</dd>
          </div>
          <div>
            <dt>{ar ? "أعضاء الفريق" : "Team members"}</dt>
            <dd>{organization._count.members}</dd>
          </div>
        </dl>

        <div className="overview-columns">
          <section className="overview-next">
            <div className="overview-section-heading">
              <h2>{ar ? "خطوتك التالية" : "Next step"}</h2>
              <span aria-hidden="true">01</span>
            </div>
            <p>
              {ar
                ? "أنشئ بطاقة الولاء الأولى، ثم شاركها مع عملائك."
                : "Create your first loyalty card, then share it with customers."}
            </p>
            <Link
              className="wf-button wf-button--primary dashboard-action-link"
              href={`/${locale}/dashboard/programs`}
            >
              {ar ? "إنشاء بطاقة ولاء" : "Create loyalty card"}
            </Link>
          </section>

          <section className="overview-link">
            <div className="overview-section-heading">
              <h2>{ar ? "رابط نشاطك" : "Your business link"}</h2>
            </div>
            <p>
              {ar
                ? "استخدمه عندما تصبح بطاقتك جاهزة."
                : "Share it when your loyalty card is ready."}
            </p>
            <div className="dashboard-url" dir="ltr">
              <span>https://{organization.merchantSlug}.waflo.app</span>
              <button
                type="button"
                className="wf-icon-button wf-button--ghost"
                aria-label={ar ? "نسخ الرابط" : "Copy URL"}
                onClick={() =>
                  void navigator.clipboard.writeText(
                    `https://${organization.merchantSlug}.waflo.app`,
                  )
                }
              >
                <Copy size={18} />
              </button>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

interface LocationItem {
  id: string;
  name: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  countryCode: string | null;
  phone: string | null;
  timezone: string;
  latitude: number | null;
  longitude: number | null;
  status: "ACTIVE" | "ARCHIVED";
  createdAt: string;
}

function emptyLocationSelection(): LocationMapSelection {
  return {
    latitude: null,
    longitude: null,
    coordinatesConfirmed: false,
    addressLine1: "",
    addressLine2: "",
    city: "",
    region: "",
    postalCode: "",
    countryCode: "",
    timezone: "",
  };
}

function selectionFromLocation(location: LocationItem): LocationMapSelection {
  return {
    latitude: location.latitude,
    longitude: location.longitude,
    coordinatesConfirmed: location.latitude !== null && location.longitude !== null,
    addressLine1: location.addressLine1 ?? "",
    addressLine2: location.addressLine2 ?? "",
    city: location.city ?? "",
    region: location.region ?? "",
    postalCode: location.postalCode ?? "",
    countryCode: location.countryCode ?? "",
    timezone: location.timezone,
  };
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
  const [selection, setSelection] = useState<LocationMapSelection>(emptyLocationSelection);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const canManage = membership.role !== "STAFF";
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
  function startAdd() {
    setEditing(null);
    setSelection(emptyLocationSelection());
    setError("");
    setOpen(true);
  }
  function startEdit(location: LocationItem) {
    setEditing(location);
    setSelection(selectionFromLocation(location));
    setError("");
    setOpen(true);
  }
  function closeEditor() {
    if (saving) return;
    setOpen(false);
    setEditing(null);
  }
  async function saveLocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      selection.latitude === null ||
      selection.longitude === null ||
      !selection.coordinatesConfirmed ||
      !selection.countryCode ||
      !selection.timezone
    ) {
      setError(
        ar
          ? "حدّد موقع الفرع بدقة على الخريطة ثم أكّده قبل الحفظ."
          : "Choose the exact branch location on the map and confirm it before saving.",
      );
      return;
    }
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await apiFetch(
        `/v1/organizations/${membership.organization.id}/locations${editing ? `/${editing.id}` : ""}`,
        {
          method: editing ? "PATCH" : "POST",
          body: JSON.stringify({
            name: String(form.get("name") ?? ""),
            phone: String(form.get("phone") ?? "") || undefined,
            addressLine1: selection.addressLine1 || undefined,
            addressLine2: selection.addressLine2 || undefined,
            city: selection.city || undefined,
            region: selection.region || undefined,
            postalCode: selection.postalCode || undefined,
            countryCode: selection.countryCode,
            timezone: selection.timezone,
            latitude: selection.latitude,
            longitude: selection.longitude,
            coordinatesConfirmed: true,
          }),
        },
      );
      setOpen(false);
      setEditing(null);
      await load();
    } catch (caught) {
      setError(
        message(
          caught,
          ar ? "تعذر حفظ الموقع. حاول مرة أخرى." : "Unable to save the location. Try again.",
        ),
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
        title={ar ? "المواقع" : "Locations"}
        description={
          ar
            ? "أدر فروع نشاطك وحدد موقع كل فرع بدقة."
            : "Manage the places where your team serves customers."
        }
        actions={
          canManage ? (
            <Button
              onClick={startAdd}
              disabled={data ? !data.usage.allowed : true}
              title={
                data && !data.usage.allowed
                  ? ar
                    ? "وصلت إلى حد المواقع في باقتك"
                    : "Your plan's location limit has been reached"
                  : undefined
              }
            >
              <Plus size={17} />
              {ar ? "إضافة موقع" : "Add location"}
            </Button>
          ) : undefined
        }
      />
      {error ? <Alert tone="danger" title={error} /> : null}
      {data ? (
        <>
          {(() => {
            const readyLocations = data.items.filter(
              (location) =>
                location.status === "ACTIVE" &&
                location.latitude !== null &&
                location.longitude !== null,
            ).length;
            const unlimitedLabel =
              readyLocations === data.usage.currentUsage
                ? ar
                  ? `${readyLocations} مواقع نشطة · غير محدود`
                  : `${readyLocations} active locations · Unlimited`
                : ar
                  ? `${readyLocations} جاهزة · ${data.usage.currentUsage} إجمالاً · غير محدود`
                  : `${readyLocations} ready · ${data.usage.currentUsage} total · Unlimited`;
            return (
              <section
                className="dashboard-usage-row"
                aria-label={ar ? "استخدام المواقع" : "Location usage"}
              >
                <UsageMeter
                  label={ar ? "المواقع المستخدمة" : "Locations used"}
                  current={data.usage.currentUsage}
                  limit={data.usage.limit}
                  unlimitedLabel={unlimitedLabel}
                />
                {!data.usage.allowed ? (
                  <Alert
                    tone="warning"
                    title={ar ? "وصلت إلى حد المواقع" : "Location limit reached"}
                  >
                    {ar
                      ? "غيّر الباقة أو أرشف موقعاً قبل إضافة موقع جديد."
                      : "Change plan or archive a location before adding another."}
                  </Alert>
                ) : null}
              </section>
            );
          })()}
          {data.items.length ? (
            <section
              className="location-grid"
              aria-label={ar ? "مواقع النشاط" : "Organization locations"}
            >
              {data.items.map((location) => {
                const hasCoordinates = location.latitude !== null && location.longitude !== null;
                const isArchived = location.status !== "ACTIVE";
                const statusLabel = isArchived
                  ? ar
                    ? "مؤرشف"
                    : "Archived"
                  : hasCoordinates
                    ? ar
                      ? "نشط"
                      : "Active"
                    : ar
                      ? "الموقع مطلوب"
                      : "Location required";
                const statusToneVal = isArchived
                  ? "archived"
                  : hasCoordinates
                    ? "active"
                    : "pending";

                return (
                  <article className="location-card" key={location.id}>
                    <div className="location-card__header">
                      <div className="location-card__identity">
                        <div className="location-card__icon" aria-hidden="true">
                          <MapPin size={20} />
                        </div>
                        <div className="location-card__titles">
                          <h3>{location.name}</h3>
                          <p className="location-card__address">
                            {location.addressLine1 || location.city
                              ? [location.addressLine1, location.city].filter(Boolean).join(" · ")
                              : ar
                                ? "لا يوجد عنوان مسجل"
                                : "No registered address"}
                          </p>
                        </div>
                      </div>
                      <div className="location-card__status">
                        <StatusBadge status={statusToneVal} label={statusLabel} />
                      </div>
                    </div>

                    <div className="location-card__meta">
                      <span className="location-card__meta-item">
                        <Clock size={14} aria-hidden="true" />
                        <span dir="ltr">{location.timezone}</span>
                      </span>
                      <span
                        className={`location-card__meta-item ${hasCoordinates ? "location-card__meta-item--confirmed" : "location-card__meta-item--unconfirmed"}`}
                      >
                        <MapPin size={14} aria-hidden="true" />
                        <span>
                          {hasCoordinates
                            ? ar
                              ? "الموقع الدقيق مؤكد"
                              : "Exact location set"
                            : ar
                              ? "حدّد الموقع على الخريطة"
                              : "Map pin needed"}
                        </span>
                      </span>
                    </div>

                    {canManage ? (
                      <div className="location-card__footer">
                        <Button
                          type="button"
                          variant={!hasCoordinates ? "primary" : "secondary"}
                          onClick={() => startEdit(location)}
                        >
                          {!hasCoordinates
                            ? ar
                              ? "تحديد الموقع"
                              : "Set location"
                            : ar
                              ? "تعديل الفرع"
                              : "Edit location"}
                        </Button>
                        <DropdownMenu
                          label={
                            <span className="location-card__menu-trigger">
                              <MoreHorizontal size={18} aria-hidden="true" />
                              <span className="wf-sr-only">
                                {ar ? "المزيد" : "More actions"}: {location.name}
                              </span>
                            </span>
                          }
                        >
                          <button
                            type="button"
                            className={
                              location.status === "ACTIVE" ? "dashboard-team-menu-danger" : ""
                            }
                            onClick={() =>
                              void (location.status === "ACTIVE"
                                ? archive(location.id)
                                : restore(location.id))
                            }
                          >
                            {location.status === "ACTIVE"
                              ? ar
                                ? "أرشفة الموقع"
                                : "Archive location"
                              : ar
                                ? "استعادة الموقع"
                                : "Restore location"}
                          </button>
                        </DropdownMenu>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </section>
          ) : (
            <div className="dashboard-empty-inline">
              <EmptyState
                icon={<MapPin />}
                title={ar ? "لا توجد مواقع" : "No locations yet"}
                description={
                  ar
                    ? "أضف فرعك الأول وحدد مكانه على الخريطة."
                    : "Add your first location and place it on the map."
                }
              />
            </div>
          )}
        </>
      ) : (
        <Skeleton height="16rem" />
      )}
      <Modal
        open={open}
        className="location-map-dialog"
        title={
          editing ? (ar ? "تعديل الموقع" : "Edit location") : ar ? "إضافة موقع" : "Add location"
        }
        description={
          ar
            ? "ابحث عن الفرع ثم ضع العلامة على مدخله بدقة."
            : "Search for the branch, then place the pin on its exact entrance."
        }
        onClose={closeEditor}
        locked={saving}
      >
        {open ? (
          <form className="location-editor-form" onSubmit={saveLocation}>
            <div className="dashboard-form__row">
              <FormField label={ar ? "اسم الفرع" : "Location name"} required>
                <TextInput
                  name="name"
                  minLength={2}
                  maxLength={120}
                  defaultValue={editing?.name ?? ""}
                  autoComplete="organization"
                  required
                />
              </FormField>
              <FormField label={ar ? "الهاتف (اختياري)" : "Phone (optional)"}>
                <TextInput
                  name="phone"
                  type="tel"
                  defaultValue={editing?.phone ?? ""}
                  autoComplete="tel"
                />
              </FormField>
            </div>
            <LocationMapPicker locale={locale} value={selection} onChange={setSelection} />
            <LocationAddressFields locale={locale} value={selection} onChange={setSelection} />
            <div className="dashboard-actions">
              <Button type="button" variant="secondary" onClick={closeEditor}>
                {ar ? "إلغاء" : "Cancel"}
              </Button>
              <Button type="submit" loading={saving} disabled={!selection.coordinatesConfirmed}>
                {editing
                  ? ar
                    ? "حفظ التغييرات"
                    : "Save changes"
                  : ar
                    ? "إضافة الموقع"
                    : "Add location"}
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
        title={ar ? "الفريق" : "Team"}
        description={
          ar
            ? "أضف الموظفين واربط هواتفهم من دون بريد إلكتروني."
            : "Add staff and pair their phones—no staff email needed."
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
        <div className="dashboard-open-sections">
          <section
            className="dashboard-usage-row"
            aria-label={ar ? "استخدام الفريق" : "Team usage"}
          >
            <UsageMeter
              label={ar ? "أعضاء الفريق المستخدمون" : "Team members used"}
              current={data.usage.currentUsage}
              limit={data.usage.limit}
              unlimitedLabel={
                ar
                  ? `${data.usage.currentUsage} أعضاء فريق · غير محدود`
                  : `${data.usage.currentUsage} team members · Unlimited`
              }
            />
            {!data.usage.allowed ? (
              <Alert tone="warning" title={ar ? "وصلت إلى حد الفريق" : "Team limit reached"}>
                {ar
                  ? "غيّر الباقة أو أزل عضواً قبل إضافة موظف جديد."
                  : "Change plan or remove a member before adding another."}
              </Alert>
            ) : null}
          </section>
          <section className="dashboard-table-section">
            <div className="dashboard-section-heading">
              <h2>{ar ? "أعضاء الفريق" : "Team members"}</h2>
            </div>
            <Table
              className="dashboard-team-table"
              caption={ar ? "أعضاء الفريق" : "Team members"}
              headers={
                ar
                  ? ["العضو", "الدور", "الوصول", "الحالة", "الإجراء"]
                  : ["Member", "Role", "Access", "Status", "Action"]
              }
              rows={data.members.map((item) => {
                const roleLabel =
                  item.role === "OWNER"
                    ? ar
                      ? "مالك"
                      : "Owner"
                    : item.role === "MANAGER"
                      ? ar
                        ? "مدير"
                        : "Manager"
                      : ar
                        ? "موظف"
                        : "Staff";
                const phonePaired = devices.some(
                  (device) => device.staff?.id === item.id && device.status === "ACTIVE",
                );
                const accessLabel = phonePaired
                  ? ar
                    ? "هاتف مرتبط"
                    : "Phone paired"
                  : item.accessType === "QR"
                    ? ar
                      ? "بانتظار الربط"
                      : "Not paired"
                    : ar
                      ? "حساب Waflo"
                      : "Waflo account";
                const canEditMember =
                  item.role !== "OWNER" &&
                  (membership.role === "OWNER" ||
                    (membership.role === "MANAGER" && item.role === "STAFF"));
                const needsPairing = item.accessType === "QR" && !phonePaired;
                const openPairing = () => {
                  setPairing(null);
                  setPairingMemberId(item.id);
                };
                return [
                  <div className="dashboard-member" key="member">
                    <Avatar name={item.user.displayName} />
                    <span>
                      <strong>{item.user.displayName}</strong>
                      <small>
                        {item.user.email ?? (ar ? "دخول QR من دون بريد" : "QR sign-in · no email")}
                      </small>
                      <small className="dashboard-member__mobile-meta">
                        {roleLabel} · {accessLabel} ·{" "}
                        {item.status === "ACTIVE"
                          ? ar
                            ? "نشط"
                            : "Active"
                          : ar
                            ? "موقوف"
                            : "Suspended"}
                      </small>
                    </span>
                  </div>,
                  <span key="role">{roleLabel}</span>,
                  <div className="dashboard-access-state" key="access">
                    <span>{accessLabel}</span>
                  </div>,
                  <StatusBadge
                    key="status"
                    status={item.status === "ACTIVE" ? "active" : "suspended"}
                    label={
                      item.status === "ACTIVE"
                        ? ar
                          ? "نشط"
                          : "Active"
                        : ar
                          ? "موقوف"
                          : "Suspended"
                    }
                  />,
                  item.role === "OWNER" ? (
                    <span key="protected">{ar ? "مالك محمي" : "Protected Owner"}</span>
                  ) : canEditMember ? (
                    <div className="dashboard-team-actions" key="actions">
                      {needsPairing ? (
                        <Button variant="secondary" onClick={openPairing}>
                          <QrCode size={16} />
                          {ar ? "ربط الهاتف" : "Pair phone"}
                        </Button>
                      ) : null}
                      <DropdownMenu
                        label={
                          <span className="dashboard-team-menu-trigger">
                            <MoreHorizontal size={18} aria-hidden="true" />
                            <span className="dashboard-team-menu-label">
                              {ar ? "المزيد" : "More"}
                            </span>
                            <span className="wf-sr-only">: {item.user.displayName}</span>
                          </span>
                        }
                      >
                        {!needsPairing && item.accessType === "QR" ? (
                          <button type="button" onClick={openPairing}>
                            <QrCode size={16} aria-hidden="true" />
                            {ar ? "ربط هاتف آخر" : "Pair another phone"}
                          </button>
                        ) : null}
                        {membership.role === "OWNER" ? (
                          <button
                            type="button"
                            onClick={() =>
                              void updateRole(
                                item.id,
                                item.role === "MANAGER" ? "STAFF" : "MANAGER",
                              )
                            }
                          >
                            {item.role === "MANAGER"
                              ? ar
                                ? "تغيير الدور إلى موظف"
                                : "Change role to Staff"
                              : ar
                                ? "تغيير الدور إلى مدير"
                                : "Change role to Manager"}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="dashboard-team-menu-danger"
                          onClick={() => void removeMember(item.id)}
                        >
                          {ar ? "إزالة العضو" : "Remove member"}
                        </button>
                      </DropdownMenu>
                    </div>
                  ) : (
                    "—"
                  ),
                ];
              })}
            />
          </section>
          {data.invitations.length ? (
            <details className="dashboard-disclosure">
              <summary>
                {ar ? "دعوات قديمة معلقة" : "Legacy pending invitations"}{" "}
                <span>{data.invitations.length}</span>
              </summary>
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
                  new Intl.DateTimeFormat(ar ? "ar-IQ-u-nu-latn" : "en-US", {
                    dateStyle: "medium",
                  }).format(new Date(item.expiresAt)),
                  <Button key="cancel" variant="ghost" onClick={() => void cancel(item.id)}>
                    {ar ? "إلغاء" : "Cancel"}
                  </Button>,
                ])}
              />
            </details>
          ) : null}
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
            <SearchableSelect
              name="role"
              defaultValue="STAFF"
              options={[
                { value: "STAFF", label: ar ? "موظف" : "Staff" },
                ...(membership.role === "OWNER"
                  ? [{ value: "MANAGER", label: ar ? "مدير" : "Manager" }]
                  : []),
              ]}
              required
            />
          </FormField>
          <p className="dashboard-form__hint">
            {ar
              ? "لا يحتاج الموظف إلى بريد إلكتروني. اربط هاتفه برمز QR بعد الإنشاء."
              : "No email is needed. Pair the staff phone with a QR after creation."}
          </p>
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
                src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(pairing.pairingQrSvg)}`}
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
                {new Intl.DateTimeFormat(ar ? "ar-IQ-u-nu-latn" : "en-US", {
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
              <SearchableSelect
                name="locationId"
                required
                defaultValue={locations[0]?.id ?? ""}
                options={locations.map((location) => ({
                  value: location.id,
                  label: location.name,
                }))}
                placeholder={ar ? "اختر موقعاً" : "Choose a location"}
              />
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

interface PaymentMethodSetup {
  clientSecret: string;
  setupIntentId: string;
  publishableKey: string;
}

function PaymentMethodReplacementForm({
  locale,
  organizationId,
  commandId,
  onSaved,
}: {
  locale: Locale;
  organizationId: string;
  commandId: string;
  onSaved: () => Promise<void>;
}) {
  const ar = locale === "ar";
  const stripe = useStripe();
  const elements = useElements();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stripe || !elements) return;
    setSaving(true);
    setError("");
    const result = await stripe.confirmSetup({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/${locale}/dashboard/billing`,
      },
      redirect: "if_required",
    });
    if (result.error || result.setupIntent?.status !== "succeeded") {
      setError(
        result.error?.message ??
          (ar ? "أكمل التحقق من البطاقة للمتابعة." : "Complete card verification to continue."),
      );
      setSaving(false);
      return;
    }
    try {
      await apiFetch(`/v1/organizations/${organizationId}/billing/payment-method/complete`, {
        method: "POST",
        headers: { "x-idempotency-key": commandId },
        body: JSON.stringify({ setupIntentId: result.setupIntent.id }),
      });
      await onSaved();
    } catch (caught) {
      setError(message(caught, ar ? "تعذر حفظ البطاقة." : "Unable to save the card."));
    } finally {
      setSaving(false);
    }
  }
  return (
    <form className="dashboard-form billing-payment-element" onSubmit={submit}>
      {error ? <Alert tone="danger" title={error} /> : null}
      <p className="dashboard-form__hint">
        {ar
          ? "تتم معالجة بيانات البطاقة بأمان بواسطة Stripe. لا تحفظ Waflo رقم البطاقة أو رمز CVC."
          : "Stripe securely handles the card details. Waflo never stores the card number or CVC."}
      </p>
      <PaymentElement options={{ layout: "tabs" }} />
      <Button type="submit" loading={saving} disabled={!stripe || !elements}>
        {ar ? "حفظ طريقة الدفع" : "Save payment method"}
      </Button>
    </form>
  );
}

export function BillingScreen({
  locale,
  membership,
}: {
  locale: Locale;
  membership: MembershipView;
}) {
  const ar = locale === "ar";
  const cadenceLabel = (value: BillingCadence) =>
    ar
      ? value === "monthly"
        ? "شهري"
        : value === "quarterly"
          ? "كل 3 أشهر"
          : "سنوي"
      : billingCadenceCatalog[value].label;
  const [data, setData] = useState<BillingView | null>(null);
  const [cadence, setCadence] = useState<BillingCadence>("monthly");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<PlanCode | null>(null);
  const [paymentSetup, setPaymentSetup] = useState<PaymentMethodSetup | null>(null);
  const [paymentCommandId, setPaymentCommandId] = useState("");
  const [paymentSetupLoading, setPaymentSetupLoading] = useState(false);
  const [identitySaving, setIdentitySaving] = useState(false);
  const [refundInvoiceId, setRefundInvoiceId] = useState<string | null>(null);
  const [refundSaving, setRefundSaving] = useState(false);
  const selectedRefundInvoice = data?.invoices.find((invoice) => invoice.id === refundInvoiceId);
  const paymentStripe = useMemo(
    () => (paymentSetup ? loadStripe(paymentSetup.publishableKey) : null),
    [paymentSetup],
  );
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
        ? new Intl.DateTimeFormat(ar ? "ar-IQ-u-nu-latn" : "en-US", {
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
        : new Intl.NumberFormat("en-US", {
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
  const formatBillingStatus = useCallback(
    (status: string) => {
      const normalized = status.toLocaleUpperCase("en-US");
      const labels: Record<string, { en: string; ar: string }> = {
        ACTIVE: { en: "Active", ar: "نشط" },
        TRIALING: { en: "Free trial", ar: "تجربة مجانية" },
        PAST_DUE: { en: "Past due", ar: "متأخر" },
        GRACE_PERIOD: { en: "Payment recovery", ar: "مهلة استرداد الدفع" },
        SUSPENDED: { en: "Access restricted", ar: "الوصول مقيّد" },
        PENDING_ACTIVATION: { en: "Setup needed", ar: "يحتاج إلى إكمال" },
        CANCELED: { en: "Canceled", ar: "ملغى" },
        PAID: { en: "Paid", ar: "مدفوعة" },
        OPEN: { en: "Open", ar: "مفتوحة" },
        DRAFT: { en: "Draft", ar: "مسودة" },
        VOID: { en: "Canceled", ar: "ملغاة" },
        UNCOLLECTIBLE: { en: "Payment failed", ar: "تعذر الدفع" },
        REQUESTED: { en: "Requested", ar: "تم الطلب" },
        APPROVED: { en: "Reviewing", ar: "قيد المراجعة" },
        PROCESSING: { en: "Processing", ar: "قيد المعالجة" },
        SUCCEEDED: { en: "Refunded", ar: "تم الاسترداد" },
        REJECTED: { en: "Rejected", ar: "مرفوض" },
        FAILED: { en: "Failed", ar: "متعذر" },
      };
      return (
        labels[normalized]?.[ar ? "ar" : "en"] ??
        normalized
          .toLocaleLowerCase("en-US")
          .replaceAll("_", " ")
          .replace(/^./u, (character) => character.toLocaleUpperCase("en-US"))
      );
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
  async function select(
    plan: PlanCode,
    selectedCadence: BillingCadence = cadence,
  ): Promise<boolean> {
    setSaving(plan);
    setError("");
    try {
      await apiFetch(`/v1/organizations/${membership.organization.id}/billing/selected-plan`, {
        method: "PATCH",
        body: JSON.stringify({ plan, cadence: selectedCadence }),
      });
      await load();
      return true;
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
      return false;
    } finally {
      setSaving(null);
    }
  }
  async function chooseCadence(nextCadence: BillingCadence) {
    setCadence(nextCadence);
    if (!data || !canPersistCatalogSelection(data.authoritativeState.subscriptionStatus)) return;
    const selected = await select(
      data.selectedPlan.toLocaleLowerCase("en-US") as PlanCode,
      nextCadence,
    );
    if (!selected) setCadence(data.selectedCadence);
  }
  async function replacePaymentMethod() {
    if (paymentSetupLoading) return;
    const commandId = globalThis.crypto.randomUUID();
    setPaymentSetupLoading(true);
    setError("");
    try {
      const result = await apiFetch<PaymentMethodSetup>(
        `/v1/organizations/${membership.organization.id}/billing/payment-method/setup`,
        {
          method: "POST",
          headers: { "x-idempotency-key": commandId },
        },
      );
      setPaymentCommandId(commandId);
      setPaymentSetup(result);
    } catch (caught) {
      setError(
        message(caught, ar ? "تعذر فتح نموذج البطاقة الآمن." : "Unable to open secure card setup."),
      );
    } finally {
      setPaymentSetupLoading(false);
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
      setError(message(caught, ar ? "تعذر تحديث بيانات الفوترة." : "Unable to refresh billing."));
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
  const priceTruth = data
    ? billingPriceTruth({
        plan: data.selectedPlan.toLocaleLowerCase("en-US") as PlanCode,
        cadence: data.selectedCadence,
        nextExpectedAmount: data.authoritativeState.nextExpectedAmount,
        currency: data.authoritativeState.currency,
      })
    : null;
  const selectedCatalogPrice = priceTruth?.catalog ?? null;
  const activeRenewalDiffersFromCatalog = priceTruth?.currentSubscriptionPriceDiffers ?? false;
  const subscriptionStatus = data?.authoritativeState.subscriptionStatus ?? "PENDING_ACTIVATION";
  const subscriptionStatusTone =
    subscriptionStatus === "ACTIVE" || subscriptionStatus === "TRIALING"
      ? "success"
      : subscriptionStatus === "PAST_DUE" || subscriptionStatus === "GRACE_PERIOD"
        ? "warning"
        : "neutral";
  return (
    <>
      <PageHeader
        title={ar ? "الفوترة والدفع" : "Billing"}
        description={
          ar
            ? "أدر باقتك وطريقة الدفع والفواتير."
            : "Manage your plan, payment method, and invoices."
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
          <section
            className="billing-overview"
            aria-label={ar ? "ملخص الاشتراك" : "Subscription summary"}
          >
            <div className="billing-overview__heading">
              <div>
                <span className="dashboard-card__label">
                  {ar ? "الاشتراك الحالي" : "CURRENT SUBSCRIPTION"}
                </span>
                <h2>
                  <bdi dir="ltr">
                    {data.selectedPlan.charAt(0) +
                      data.selectedPlan.slice(1).toLocaleLowerCase("en-US")}
                  </bdi>
                  <span aria-hidden="true"> · </span>
                  {cadenceLabel(data.selectedCadence)}
                </h2>
                <p>
                  {subscriptionStatus === "TRIALING"
                    ? `${ar ? "تنتهي التجربة" : "Trial ends"} ${formatBillingDate(data.authoritativeState.trialEnd)}`
                    : data.subscriptions[0]?.cancelAtPeriodEnd
                      ? ar
                        ? "سيُلغى الاشتراك عند نهاية الفترة الحالية."
                        : "This subscription is set to cancel at the end of its current period."
                      : data.subscriptions[0]?.currentPeriodEnd
                        ? `${ar ? "يتجدد" : "Renews"} ${formatBillingDate(data.subscriptions[0].currentPeriodEnd)}`
                        : ar
                          ? "تُعرض حالة الاشتراك من مصدر الفوترة المعتمد."
                          : "Subscription status is shown from the authoritative billing source."}
                </p>
              </div>
              <Badge tone={subscriptionStatusTone}>{formatBillingStatus(subscriptionStatus)}</Badge>
            </div>
            <dl className="billing-overview__facts">
              <div>
                <dt>{ar ? "الدفعة القادمة" : "Next renewal"}</dt>
                <dd className="billing-overview__amount" dir="ltr">
                  {formatMoney(
                    data.authoritativeState.nextExpectedAmount,
                    data.authoritativeState.currency,
                  )}
                </dd>
                <dd>
                  <small>
                    {data.authoritativeState.nextExpectedChargeDate
                      ? formatBillingDate(data.authoritativeState.nextExpectedChargeDate)
                      : data.paymentMethod.status === "saved"
                        ? ar
                          ? "مجدولة تلقائياً"
                          : "Auto-scheduled"
                        : ar
                          ? "بانتظار وسيلة دفع"
                          : "Awaiting payment method"}
                  </small>
                  {data.authoritativeState.nextExpectedAmount !== null ? (
                    <small className="billing-overview__source">
                      {ar
                        ? "توقع Stripe للاشتراك الحالي"
                        : "Stripe forecast for the current subscription"}
                    </small>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt>{ar ? "طريقة الدفع" : "Payment method"}</dt>
                {data.paymentMethod.status === "saved" ? (
                  <>
                    <dd className="dashboard-payment-card__brand" dir="ltr">
                      <CreditCard size={19} />
                      {data.paymentMethod.brand.toLocaleUpperCase("en-US")} ••••{" "}
                      {data.paymentMethod.last4}
                    </dd>
                    <dd>
                      <small>
                        {ar ? "تنتهي" : "Expires"}{" "}
                        {String(data.paymentMethod.expMonth).padStart(2, "0")}/
                        {data.paymentMethod.expYear}
                      </small>
                    </dd>
                  </>
                ) : (
                  <>
                    <dd>
                      {data.paymentMethod.status === "unavailable"
                        ? ar
                          ? "غير متاحة"
                          : "Unavailable"
                        : ar
                          ? "غير مضافة"
                          : "Not added"}
                    </dd>
                    <dd>
                      <small>
                        {data.paymentMethod.status === "unavailable"
                          ? ar
                            ? "حدّث الفوترة للمحاولة مرة أخرى"
                            : "Refresh billing to try again"
                          : ar
                            ? "أضف بطاقة لإكمال الإعداد"
                            : "Add a card to complete setup"}
                      </small>
                    </dd>
                  </>
                )}
              </div>
              <div>
                <dt>{ar ? "السعر المعلن الحالي" : "Current catalog rate"}</dt>
                <dd className="billing-overview__amount" dir="ltr">
                  ${selectedCatalogPrice?.monthlyEquivalentUsd.toFixed(2) ?? "—"}/
                  {ar ? "شهر" : "mo"}
                </dd>
                <dd>
                  <small>
                    {selectedCatalogPrice
                      ? `${ar ? "إجمالي" : "Billed"} $${selectedCatalogPrice.billedAmountUsd.toFixed(2)} ${cadenceLabel(data.selectedCadence).toLocaleLowerCase("en-US")}`
                      : ar
                        ? "غير متوفر"
                        : "Not available"}
                  </small>
                </dd>
              </div>
            </dl>
          </section>
          {activeRenewalDiffersFromCatalog ? (
            <Alert
              tone="info"
              title={
                ar
                  ? "سعر الاشتراك الحالي يختلف عن السعر المعلن"
                  : "Your current subscription price differs from the catalog"
              }
            >
              {ar
                ? "الدفعة أعلاه هي توقع Stripe للاشتراك الحالي. السعر المعلن أدناه يطبق على اختيارات الخطة أو الوتيرة الجديدة ولا يغيّر فاتورتك القادمة تلقائياً."
                : "The renewal above is Stripe’s current forecast for this active subscription. The catalog below applies to a new plan or cadence selection and does not rewrite your next invoice."}
            </Alert>
          ) : null}
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
          <section className="billing-cadence-card">
            <div className="dashboard-section-heading">
              <div>
                <span className="dashboard-card__label">
                  {ar ? "كتالوج وافلو" : "WAFLO CATALOG"}
                </span>
                <h2>{ar ? "اختر وتيرة السعر الجديد" : "Choose a new catalog cadence"}</h2>
                <p className="billing-section-description">
                  {ar
                    ? "تُظهر هذه الأسعار سعر الكتالوج عند اختيار خطة أو وتيرة جديدة. اشتراكك النشط وفاتورته القادمة يبقيان مستقلين حتى يؤكد Stripe التغيير."
                    : "These are catalog prices for a new plan or cadence selection. Your active subscription and its next invoice remain authoritative until Stripe confirms a change."}
                </p>
              </div>
              <Badge tone="brand">{ar ? "معاينة السعر" : "Catalog preview"}</Badge>
            </div>
            <div
              className="billing-cadence-options"
              role="radiogroup"
              aria-label={ar ? "دورة الفوترة" : "Billing cadence"}
            >
              {(["monthly", "quarterly", "yearly"] as const).map((option) => {
                const pricing = cadencePrice(
                  data.selectedPlan.toLocaleLowerCase("en-US") as PlanCode,
                  option,
                );
                const definition = billingCadenceCatalog[option];
                const savings = pricing.undiscountedAmountUsd - pricing.billedAmountUsd;
                const discountLabel = option === "quarterly" ? "8.33%" : "16.67%";
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
                      <strong>{cadenceLabel(option)}</strong>
                      {definition.discountRate ? (
                        <Badge tone="success">
                          {option === "yearly"
                            ? ar
                              ? "شهران مجاناً"
                              : "2 months free"
                            : discountLabel}
                        </Badge>
                      ) : null}
                    </span>
                    <b>
                      <bdi dir="ltr">${pricing.billedAmountUsd.toFixed(2)}</bdi>
                    </b>
                    <small>
                      {option === "monthly" ? (
                        ar ? (
                          "إجمالي الدفعة · دون خصم"
                        ) : (
                          "Total charge · no discount"
                        )
                      ) : (
                        <>
                          <bdi dir="ltr">${pricing.monthlyEquivalentUsd.toFixed(2)}</bdi>/
                          {ar ? "شهر" : "mo"}
                          {" · "}
                          {ar ? "وفّر" : "Save"} <bdi dir="ltr">${savings.toFixed(2)}</bdi> (
                          {discountLabel})
                        </>
                      )}
                    </small>
                    {!data.cadenceAvailability[option] ? (
                      <em>{ar ? "غير متاح حالياً" : "Currently unavailable"}</em>
                    ) : cadence === option ? (
                      <CheckCircle2 size={18} />
                    ) : null}
                  </label>
                );
              })}
            </div>
          </section>
          {!data.stripeConfigured ? (
            <Alert
              tone="warning"
              title={ar ? "إعداد الدفع غير مكتمل" : "Billing configuration is incomplete"}
            >
              {ar
                ? "لا يمكن بدء اشتراك جديد الآن. حاول مرة أخرى أو تواصل مع دعم Waflo."
                : "A new subscription cannot be started right now. Try again or contact Waflo support."}
            </Alert>
          ) : null}
          <section className="billing-plan-comparison">
            <div className="dashboard-section-heading">
              <div>
                <span className="dashboard-card__label">{ar ? "الخطط" : "PLANS"}</span>
                <h2>{ar ? "قارن أسعار الكتالوج" : "Compare catalog plans"}</h2>
                <p className="billing-section-description">
                  {ar
                    ? "تظهر التكلفة الفعالة شهرياً أولاً، بينما يُحصّل إجمالي الوتيرة المختارة وفقاً للكتالوج."
                    : "Effective monthly cost is shown first; Stripe bills the full selected cadence total from the catalog."}
                </p>
              </div>
            </div>
            <div className="dashboard-section-grid dashboard-section-grid--plans">
              {(["starter", "growth", "scale"] as const).map((plan) => (
                <PlanCard
                  key={plan}
                  plan={plan}
                  selected={data.selectedPlan.toLocaleLowerCase("en-US") === plan}
                  locale={locale}
                  cadence={cadence}
                  {...(data.authoritativeState.subscriptionStatus === "PENDING_ACTIVATION"
                    ? { onSelect: (value: PlanCode) => void select(value) }
                    : {})}
                />
              ))}
            </div>
          </section>
          <div className="dashboard-actions" style={{ marginTop: "1.5rem" }}>
            {data.authoritativeState.subscriptionStatus === "PENDING_ACTIVATION" ? (
              <Link
                className="wf-button wf-button--primary"
                href={`/${locale}/onboarding/business?organization=${membership.organization.id}`}
              >
                {ar ? "إكمال إعداد التجربة" : "Complete trial setup"}
              </Link>
            ) : (
              <Button
                onClick={() => void replacePaymentMethod()}
                loading={paymentSetupLoading}
                disabled={!data.stripeConfigured}
              >
                {data.paymentMethod.status === "saved"
                  ? ar
                    ? "تغيير طريقة الدفع"
                    : "Change payment method"
                  : ar
                    ? "إضافة طريقة الدفع"
                    : "Add payment method"}
              </Button>
            )}
            <Button variant="tertiary" onClick={() => void reconcile()}>
              <RefreshCcw size={16} />
              {ar ? "تحديث الفوترة" : "Refresh billing"}
            </Button>
          </div>
          <div className="billing-detail-grid billing-detail-grid--single">
            <section className="billing-identity-card">
              <div className="dashboard-section-heading">
                <div>
                  <span className="dashboard-card__label">
                    {ar ? "هوية العميل" : "BILLING IDENTITY"}
                  </span>
                  <h2>{ar ? "بيانات الفوترة" : "Billing details"}</h2>
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
            </section>
          </div>
          <section className="billing-invoice-history">
            <div className="dashboard-section-heading">
              <div>
                <span className="dashboard-card__label">
                  {ar ? "السجل المالي" : "INVOICE & RECEIPT HISTORY"}
                </span>
                <h2>{ar ? "الفواتير" : "Invoice history"}</h2>
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
                        "طريقة الدفع",
                        "الاسترداد",
                        "المستند",
                      ]
                    : [
                        "Invoice",
                        "Date",
                        "Amount",
                        "Status",
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
                  <span key="amount" className="billing-mono" dir="ltr">
                    {formatMoney(invoice.amountDue, invoice.currency)}
                  </span>,
                  <div key="status" className="billing-status-cell">
                    <Badge
                      tone={
                        invoice.status === "paid"
                          ? "success"
                          : invoice.amountRemaining > 0
                            ? "warning"
                            : "neutral"
                      }
                    >
                      {formatBillingStatus(invoice.status)}
                    </Badge>
                    {invoice.paymentStatus && invoice.paymentStatus !== invoice.status ? (
                      <small className="billing-sub-status">
                        {formatBillingStatus(invoice.paymentStatus)}
                      </small>
                    ) : null}
                  </div>,
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
                          {formatBillingStatus(invoice.refunds[0].status)}
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
                    ? "ستظهر الفواتير والإيصالات هنا بعد بدء الاشتراك."
                    : "Invoices and receipts will appear here after your subscription begins."
                }
              />
            )}
          </section>
          <div className="billing-policy-link">
            <span>
              {ar
                ? "الإلغاء والتخفيض والاسترداد حالات مختلفة."
                : "Cancellation, downgrade, and refund are different outcomes."}
            </span>
            <a
              href={`${process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://waflo.app"}/${locale}/refunds`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {ar ? "سياسة الفوترة والاسترداد" : "Billing & Refund Policy"}
            </a>
          </div>
          {data.downgradeOptions.length ? (
            <section className="billing-downgrade-card">
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
            </section>
          ) : null}
          {data.authoritativeState.subscriptionStatus === "PENDING_ACTIVATION" ? (
            <Alert
              tone="info"
              title={ar ? "تجربتك جاهزة للإعداد" : "Your trial is ready to set up"}
            >
              {ar
                ? "اختر الباقة وأضف بيانات الفوترة والبطاقة لبدء 7 أيام مجاناً. لن يتم الخصم اليوم."
                : "Choose a plan and add billing details and a card to start 7 days free. Nothing is charged today."}
            </Alert>
          ) : null}
        </>
      ) : (
        <Skeleton height="20rem" />
      )}
      <Modal
        open={Boolean(paymentSetup)}
        title={
          data?.paymentMethod.status === "saved"
            ? ar
              ? "تغيير طريقة الدفع"
              : "Change payment method"
            : ar
              ? "إضافة طريقة الدفع"
              : "Add payment method"
        }
        onClose={() => setPaymentSetup(null)}
      >
        {paymentSetup && paymentStripe ? (
          <Elements
            stripe={paymentStripe}
            options={{
              clientSecret: paymentSetup.clientSecret,
              locale: ar ? "ar" : "en",
              appearance: {
                theme: "stripe",
                variables: {
                  colorPrimary: "#AE3115",
                  colorText: "#241916",
                  colorBackground: "#FFFFFF",
                  colorDanger: "#C93C2B",
                  fontFamily: ar
                    ? "Cairo, system-ui, sans-serif"
                    : "Manrope, system-ui, sans-serif",
                  borderRadius: "8px",
                  spacingUnit: "4px",
                },
              },
            }}
          >
            <PaymentMethodReplacementForm
              locale={locale}
              organizationId={membership.organization.id}
              commandId={paymentCommandId}
              onSaved={async () => {
                setPaymentSetup(null);
                await load();
              }}
            />
          </Elements>
        ) : null}
      </Modal>
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
        title={ar ? "الإعدادات" : "Settings"}
        description={
          ar
            ? "حدّث معلومات نشاطك واللغة والمنطقة الزمنية."
            : "Update your business details, language, and timezone."
        }
      />
      {error ? <Alert tone="danger" title={error} /> : null}
      {notice ? <Alert tone="success" title={notice} /> : null}
      {organization ? (
        <div className="dashboard-settings">
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
                <SearchableSelect
                  name="locale"
                  defaultValue={organization.defaultLocale.toLocaleLowerCase("en-US")}
                  options={[
                    { value: "en", label: "English" },
                    { value: "ar", label: "العربية" },
                  ]}
                />
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
            <Alert tone="warning" title={ar ? "تأكيد مطلوب" : "Confirmation required"}>
              {ar
                ? "سنطلب كلمة المرور لحماية رابط نشاطك. يبقى الرابط السابق محجوزاً لمدة 90 يوماً."
                : "Your password protects this change. The previous URL stays reserved for 90 days."}
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
}

function securityEventLabel(value: string, ar: boolean): string {
  if (value.includes("password")) return ar ? "تم تحديث كلمة المرور" : "Password updated";
  if (value.includes("session")) return ar ? "تغيير في جهاز مسجّل" : "Signed-in device changed";
  if (value.includes("external") || value.includes("oauth"))
    return ar ? "تغيير في طريقة تسجيل الدخول" : "Sign-in method changed";
  if (value.includes("account")) return ar ? "تغيير في الحساب" : "Account security update";
  return ar ? "تحديث أمني" : "Security update";
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
  async function linkIdentity() {
    setError("");
    try {
      const result = await apiFetch<{ authorizationUrl: string }>("/v1/auth/external/google/link", {
        method: "POST",
        body: JSON.stringify({ currentPassword: identityPassword, locale }),
      });
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
  async function unlinkIdentity() {
    setError("");
    try {
      await apiFetch("/v1/auth/external/google", {
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
  const currentSession = sessions.find((session) => session.current) ?? null;
  const otherSessions = sessions.filter((session) => !session.current);
  return (
    <>
      <PageHeader
        title={ar ? "الأمان" : "Security"}
        description={
          ar
            ? "راجع الأجهزة وأنهِ أي جلسة لا تعرفها."
            : "Review signed-in devices and revoke anything you do not recognize."
        }
      />
      {error ? <Alert tone="danger" title={error} /> : null}
      {notice ? <Alert tone="success" title={notice} /> : null}
      <div className="dashboard-section-grid security-layout">
        <Card className="dashboard-form-card">
          <h2>{ar ? "الأجهزة المسجّلة" : "Signed-in devices"}</h2>
          {currentSession ? (
            <div className="security-current-session">
              <div>
                <Badge tone="success">{ar ? "هذا الجهاز" : "This device"}</Badge>
                <strong>
                  {currentSession.deviceLabel ?? (ar ? "جهاز غير معروف" : "Unknown device")}
                </strong>
                <small>
                  {ar ? "آخر نشاط " : "Last active "}
                  {new Intl.DateTimeFormat(ar ? "ar-IQ-u-nu-latn" : "en-US", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(currentSession.lastActiveAt))}
                </small>
              </div>
              <Button variant="tertiary" onClick={() => void revoke(currentSession.id)}>
                {ar ? "تسجيل الخروج" : "Sign out"}
              </Button>
            </div>
          ) : null}
          <details className="security-other-sessions">
            <summary>
              <span>{ar ? "الأجهزة الأخرى" : "Other devices"}</span>
              <Badge tone="neutral">{otherSessions.length}</Badge>
            </summary>
            {otherSessions.length ? (
              <>
                <div className="security-other-sessions__actions">
                  <p>
                    {ar
                      ? "أنهِ أي جلسة لا تعرفها، أو سجّل الخروج من جميع الأجهزة الأخرى دفعة واحدة."
                      : "Revoke anything you do not recognize, or sign out every other device at once."}
                  </p>
                  <Button variant="secondary" onClick={() => void revokeOthers()}>
                    {ar ? "تسجيل الخروج من الأجهزة الأخرى" : "Sign out other devices"}
                  </Button>
                </div>
                <Table
                  caption={ar ? "الأجهزة الأخرى" : "Other signed-in devices"}
                  headers={
                    ar ? ["الجهاز", "آخر نشاط", "الإجراء"] : ["Device", "Last active", "Action"]
                  }
                  rows={otherSessions.map((session) => [
                    session.deviceLabel ?? (ar ? "جهاز غير معروف" : "Unknown device"),
                    new Intl.DateTimeFormat(ar ? "ar-IQ-u-nu-latn" : "en-US", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(session.lastActiveAt)),
                    <Button key="revoke" variant="tertiary" onClick={() => void revoke(session.id)}>
                      {ar ? "تسجيل الخروج" : "Sign out"}
                    </Button>,
                  ])}
                />
              </>
            ) : (
              <p className="security-other-sessions__empty">
                {ar ? "لا توجد أجهزة أخرى مسجّلة." : "No other devices are signed in."}
              </p>
            )}
          </details>
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
        <section className="dashboard-form-card dashboard-card--full security-section">
          <h2>{ar ? "حساب Google" : "Google account"}</h2>
          <p style={{ color: "var(--waflo-muted)", maxWidth: "68ch" }}>
            {ar
              ? "يمكنك استخدام حساب Google لتسجيل الدخول إلى حساب Waflo الحالي."
              : "Use Google to sign in to this existing Waflo account."}
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
                ? "يلزم تسجيل دخول حديث لإجراء هذا التغيير."
                : "A recent sign-in is required for this change."}
            </p>
          )}
          <div className="security-provider-row">
            <div>
              <strong>Google</strong>
              <span>
                {identitySettings?.identities.find((item) => item.provider === "GOOGLE")
                  ?.providerEmail ?? (ar ? "غير مرتبط" : "Not connected")}
              </span>
            </div>
            {identitySettings?.identities.some((item) => item.provider === "GOOGLE") ? (
              <Button variant="tertiary" onClick={() => void unlinkIdentity()}>
                {ar ? "فصل" : "Disconnect"}
              </Button>
            ) : (
              <Button
                variant="secondary"
                disabled={
                  !providerCapabilities.googleSignInAvailable ||
                  (Boolean(identitySettings?.passwordEnabled) && !identityPassword)
                }
                onClick={() => void linkIdentity()}
              >
                {ar ? "ربط Google" : "Connect Google"}
              </Button>
            )}
          </div>
        </section>
        <Card className="dashboard-form-card dashboard-card--full">
          <h2>{ar ? "النشاط الأخير" : "Recent activity"}</h2>
          {events.length ? (
            <Table
              caption={ar ? "أحداث الأمان" : "Security events"}
              headers={ar ? ["النشاط", "الأهمية", "التاريخ"] : ["Activity", "Importance", "Date"]}
              rows={events.map((event) => [
                securityEventLabel(event.eventType, ar),
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
                new Intl.DateTimeFormat(ar ? "ar-IQ-u-nu-latn" : "en-US", {
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
              ? "تتطلب هذه الإجراءات عبارة تأكيد وكلمة المرور. قد تستغرق طلبات الحذف وقتاً للمراجعة."
              : "These actions require a confirmation phrase and your password. Deletion requests may take time to review."}
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
              variant="destructive"
              disabled={dangerConfirmation !== "DEACTIVATE"}
              onClick={() => void accountLifecycle("deactivate")}
            >
              {ar ? "تعطيل الحساب" : "Deactivate account"}
            </Button>
            <Button
              variant="destructive"
              disabled={dangerConfirmation !== "REQUEST DELETION"}
              onClick={() => void accountLifecycle("deletion-request")}
            >
              {ar ? "طلب حذف الحساب" : "Request account deletion"}
            </Button>
            {membership.role === "OWNER" ? (
              <Button
                variant="destructive"
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
