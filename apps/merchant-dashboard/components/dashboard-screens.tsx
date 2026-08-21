"use client";

import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { billingCadenceCatalog, cadencePrice, planCatalog } from "@waflo/billing";
import {
  type BillingCadence,
  countryOptions,
  type Locale,
  type PlanCode,
  timeZoneOptions,
} from "@waflo/contracts";
import { localeRegistry, type InterfaceLocale } from "@waflo/i18n";
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
import { merchantPublicUrl } from "../lib/merchant-public-url";
import { beginGoogleReauthentication } from "../lib/oauth-reauthentication";
import { billingPriceTruth, canPersistCatalogSelection } from "./billing-presentation";
import type { DashboardSection, MembershipView } from "./dashboard";
import { ProgramAssetPicker } from "./program-asset-uploader";
import type { AssetItem, ProgramItem } from "./program-studio-types";
import { deriveOverviewNextStep } from "./overview-next-step";
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
  brandLogoAsset: AssetItem | null;
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
  interfaceLocale,
  locale,
  membership,
}: {
  interfaceLocale: InterfaceLocale;
  locale: Locale;
  membership: MembershipView;
}) {
  const copy = localeRegistry[interfaceLocale].messages.merchant.overview;
  const [organization, setOrganization] = useState<OrganizationView | null>(null);
  const [programs, setPrograms] = useState<ProgramItem[]>([]);
  const [error, setError] = useState("");
  const loadOverview = useCallback(async () => {
    const id = membership.organization.id;
    try {
      const [organizationData, programData] = await Promise.all([
        apiFetch<OrganizationView>(`/v1/organizations/${id}`),
        apiFetch<{ items: ProgramItem[] }>(`/v1/organizations/${id}/programs?limit=100`),
      ]);
      setOrganization(organizationData);
      setPrograms(programData.items);
      setError("");
    } catch (caught) {
      setError(message(caught, copy.loadError));
    }
  }, [copy.loadError, membership.organization.id]);

  useEffect(() => {
    void loadOverview();
    const refresh = () => void loadOverview();
    window.addEventListener("waflo:programs-changed", refresh);
    return () => window.removeEventListener("waflo:programs-changed", refresh);
  }, [loadOverview]);
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
    PENDING_ACTIVATION: copy.status.pending,
    TRIALING: copy.status.trialing,
    ACTIVE: copy.status.active,
    PAST_DUE: copy.status.pastDue,
    GRACE_PERIOD: copy.status.grace,
    SUSPENDED: copy.status.suspended,
    CANCELED: copy.status.canceled,
  }[status];
  const statusTone =
    status === "ACTIVE" || status === "TRIALING"
      ? "success"
      : status === "PENDING_ACTIVATION"
        ? "warning"
        : "danger";
  const trialEnd = organization.billingProfile.trialEnd
    ? new Intl.DateTimeFormat(localeRegistry[interfaceLocale].dateFormattingLocale, {
        dateStyle: "medium",
      }).format(new Date(organization.billingProfile.trialEnd))
    : null;
  const nextStep = deriveOverviewNextStep(programs);
  const nextStepContent = {
    first: { description: copy.firstDescription, action: copy.firstAction },
    draft: { description: copy.draftDescription, action: copy.draftAction },
    ready: { description: copy.readyDescription, action: copy.readyAction },
    live: { description: copy.liveDescription, action: copy.liveAction },
    unpublished: {
      description: copy.unpublishedDescription,
      action: copy.unpublishedAction,
    },
    archived: { description: copy.archivedDescription, action: copy.archivedAction },
  }[nextStep];
  const publicMerchantUrl = merchantPublicUrl(organization.merchantSlug);
  return (
    <>
      <PageHeader
        title={copy.welcome.replace("{name}", organization.name)}
        description={copy.attentionToday}
      />
      <div className="overview-layout">
        <section className="overview-status" aria-labelledby="overview-status-title">
          <div>
            <div className="overview-status__title">
              <h2 id="overview-status-title">{copy.subscription}</h2>
              <Badge tone={statusTone}>{statusCopy}</Badge>
            </div>
            <p>
              {status === "PENDING_ACTIVATION"
                ? copy.pendingDescription
                : status === "TRIALING" && trialEnd
                  ? copy.trialDescription.replace("{date}", trialEnd)
                  : status === "ACTIVE"
                    ? copy.activeDescription
                    : copy.billingAttentionDescription}
            </p>
          </div>
          <Link
            className="wf-button wf-button--secondary dashboard-action-link"
            href={`/${locale}/dashboard/billing`}
          >
            {status === "PENDING_ACTIVATION" ? copy.startTrial : copy.viewBilling}
          </Link>
        </section>

        <dl className="overview-metrics" aria-label={copy.businessSummary}>
          <div>
            <dt>{copy.plan}</dt>
            <dd>{organization.selectedPlan}</dd>
          </div>
          <div>
            <dt>{copy.locations}</dt>
            <dd>{organization._count.locations}</dd>
          </div>
          <div>
            <dt>{copy.teamMembers}</dt>
            <dd>{organization._count.members}</dd>
          </div>
        </dl>

        <div className="overview-columns">
          <section className="overview-next">
            <div className="overview-section-heading">
              <h2>{copy.nextStep}</h2>
              <span aria-hidden="true">01</span>
            </div>
            <p>{nextStepContent.description}</p>
            <Link
              className="wf-button wf-button--primary dashboard-action-link"
              href={`/${locale}/dashboard/programs`}
            >
              {nextStepContent.action}
            </Link>
          </section>

          <section className="overview-link">
            <div className="overview-section-heading">
              <h2>{copy.businessLink}</h2>
            </div>
            <p>{copy.businessLinkDescription}</p>
            <div className="dashboard-url" dir="ltr">
              <a href={publicMerchantUrl} rel="noreferrer" target="_blank">
                {publicMerchantUrl}
              </a>
              <button
                type="button"
                className="wf-icon-button wf-button--ghost"
                aria-label={copy.copyUrl}
                onClick={() => void navigator.clipboard.writeText(publicMerchantUrl)}
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
  manualPairingCode: string;
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
  const [pairingCodeCopied, setPairingCodeCopied] = useState(false);
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
      setPairingCodeCopied(false);
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
    setPairingCodeCopied(false);
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
            <Select name="role" defaultValue="STAFF" required>
              <option value="STAFF">{ar ? "موظف" : "Staff"}</option>
              {membership.role === "OWNER" ? (
                <option value="MANAGER">{ar ? "مدير" : "Manager"}</option>
              ) : null}
            </Select>
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

interface SubscriptionChangePreview {
  currentPlan: PlanCode;
  currentCadence: BillingCadence;
  targetPlan: PlanCode;
  targetCadence: BillingCadence;
  amountDue: number;
  currency: string;
  effective: "IMMEDIATE" | "NO_CHANGE";
  renewalDate: string | null;
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
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState<PlanCode | null>(null);
  const [subscriptionChange, setSubscriptionChange] = useState<SubscriptionChangePreview | null>(
    null,
  );
  const [subscriptionAction, setSubscriptionAction] = useState<
    "change" | "cancel" | "resume" | null
  >(null);
  const [cancelSubscriptionOpen, setCancelSubscriptionOpen] = useState(false);
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
    if (!data) return;
    if (canPersistCatalogSelection(data.authoritativeState.subscriptionStatus)) {
      setCadence(nextCadence);
      const selected = await select(
        data.selectedPlan.toLocaleLowerCase("en-US") as PlanCode,
        nextCadence,
      );
      if (!selected) setCadence(data.selectedCadence);
      return;
    }
    await previewSubscriptionChange(
      data.selectedPlan.toLocaleLowerCase("en-US") as PlanCode,
      nextCadence,
    );
  }
  async function previewSubscriptionChange(plan: PlanCode, selectedCadence = cadence) {
    if (!data?.canManageBilling || !["ACTIVE", "TRIALING"].includes(subscriptionStatus)) return;
    setSaving(plan);
    setError("");
    setNotice("");
    try {
      const preview = await apiFetch<SubscriptionChangePreview>(
        `/v1/organizations/${membership.organization.id}/billing/subscription/change/preview`,
        {
          method: "POST",
          body: JSON.stringify({ plan, cadence: selectedCadence }),
        },
      );
      if (preview.effective === "NO_CHANGE") return;
      setCadence(selectedCadence);
      setSubscriptionChange(preview);
    } catch (caught) {
      if (caught instanceof ApiClientError && caught.code === "PLAN_DOWNGRADE_BLOCKED") {
        const violations = Array.isArray(caught.details?.violations)
          ? (caught.details.violations as Array<{ message?: string }>)
          : [];
        setError(
          violations
            .map((violation) => violation.message)
            .filter(Boolean)
            .join(" · ") || caught.message,
        );
      } else {
        setError(message(caught, ar ? "تعذرت معاينة التغيير." : "Unable to preview the change."));
      }
      setCadence(data.selectedCadence);
    } finally {
      setSaving(null);
    }
  }
  async function confirmSubscriptionChange() {
    if (!subscriptionChange) return;
    setSubscriptionAction("change");
    setError("");
    try {
      await apiFetch(
        `/v1/organizations/${membership.organization.id}/billing/subscription/change`,
        {
          method: "POST",
          headers: { "x-idempotency-key": globalThis.crypto.randomUUID() },
          body: JSON.stringify({
            plan: subscriptionChange.targetPlan,
            cadence: subscriptionChange.targetCadence,
          }),
        },
      );
      setSubscriptionChange(null);
      setNotice(ar ? "تم تحديث اشتراكك عبر Stripe." : "Your Stripe subscription was updated.");
      await load();
    } catch (caught) {
      setError(
        message(
          caught,
          ar
            ? "تعذر تغيير الاشتراك. لم يتم تطبيق أي تغيير."
            : "Unable to change the subscription. No change was applied.",
        ),
      );
    } finally {
      setSubscriptionAction(null);
    }
  }
  async function cancelSubscription(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubscriptionAction("cancel");
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await apiFetch(
        `/v1/organizations/${membership.organization.id}/billing/subscription/cancel`,
        {
          method: "POST",
          headers: { "x-idempotency-key": globalThis.crypto.randomUUID() },
          body: JSON.stringify({ reason: String(form.get("reason") ?? "").trim() || undefined }),
        },
      );
      setCancelSubscriptionOpen(false);
      setNotice(
        ar
          ? "تم جدولة الإلغاء لنهاية فترة الفوترة الحالية. يمكنك التراجع قبل ذلك."
          : "Cancellation is scheduled for the end of the current billing period. You can undo it before then.",
      );
      await load();
    } catch (caught) {
      setError(message(caught, ar ? "تعذر جدولة الإلغاء." : "Unable to schedule cancellation."));
    } finally {
      setSubscriptionAction(null);
    }
  }
  async function resumeSubscription() {
    setSubscriptionAction("resume");
    setError("");
    try {
      await apiFetch(
        `/v1/organizations/${membership.organization.id}/billing/subscription/resume`,
        {
          method: "POST",
          headers: { "x-idempotency-key": globalThis.crypto.randomUUID() },
        },
      );
      setNotice(ar ? "سيستمر اشتراكك في التجدد." : "Your subscription will continue renewing.");
      await load();
    } catch (caught) {
      setError(message(caught, ar ? "تعذر استئناف التجديد." : "Unable to resume renewal."));
    } finally {
      setSubscriptionAction(null);
    }
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
      {notice ? <Alert tone="success" title={notice} /> : null}
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
              <div data-billing-summary="next-renewal">
                <dt>{ar ? "الدفعة القادمة" : "Next renewal"}</dt>
                <dd className="billing-overview__amount">
                  {data.authoritativeState.nextExpectedAmount !== null &&
                  data.authoritativeState.currency ? (
                    <bdi dir="ltr">
                      {formatMoney(
                        data.authoritativeState.nextExpectedAmount,
                        data.authoritativeState.currency,
                      )}
                    </bdi>
                  ) : (
                    formatMoney(
                      data.authoritativeState.nextExpectedAmount,
                      data.authoritativeState.currency,
                    )
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
              <div data-billing-summary="current-catalog-rate">
                <dt>{ar ? "السعر المعلن الحالي" : "Current catalog rate"}</dt>
                <dd className="billing-overview__amount billing-overview__catalog-rate">
                  <bdi dir="ltr">
                    ${selectedCatalogPrice?.monthlyEquivalentUsd.toFixed(2) ?? "—"}
                  </bdi>
                  <span>{ar ? "/شهر" : "/mo"}</span>
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
                      disabled={
                        !data.cadenceAvailability[option] ||
                        saving !== null ||
                        !data.canManageBilling
                      }
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
                    : data.canManageBilling && ["ACTIVE", "TRIALING"].includes(subscriptionStatus)
                      ? {
                          onSelect: (value: PlanCode) =>
                            void previewSubscriptionChange(value, cadence),
                        }
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
            {data.canManageBilling &&
            ["ACTIVE", "TRIALING", "PAST_DUE"].includes(subscriptionStatus) ? (
              data.subscriptions[0]?.cancelAtPeriodEnd ? (
                <Button
                  variant="secondary"
                  onClick={() => void resumeSubscription()}
                  loading={subscriptionAction === "resume"}
                >
                  {ar ? "التراجع عن الإلغاء" : "Keep subscription"}
                </Button>
              ) : (
                <Button variant="ghost" onClick={() => setCancelSubscriptionOpen(true)}>
                  {ar ? "إلغاء الاشتراك" : "Cancel subscription"}
                </Button>
              )
            ) : null}
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
        open={Boolean(subscriptionChange)}
        title={ar ? "تأكيد تغيير الاشتراك" : "Confirm subscription change"}
        onClose={() => {
          if (subscriptionAction) return;
          setSubscriptionChange(null);
          if (data) setCadence(data.selectedCadence);
        }}
      >
        {subscriptionChange ? (
          <div className="dashboard-form">
            <div className="billing-change-summary">
              <div>
                <span>{ar ? "الاشتراك الحالي" : "Current"}</span>
                <strong>
                  {planCatalog[subscriptionChange.currentPlan].name} ·{" "}
                  {cadenceLabel(subscriptionChange.currentCadence)}
                </strong>
              </div>
              <div>
                <span>{ar ? "الاشتراك الجديد" : "New"}</span>
                <strong>
                  {planCatalog[subscriptionChange.targetPlan].name} ·{" "}
                  {cadenceLabel(subscriptionChange.targetCadence)}
                </strong>
              </div>
              <div>
                <span>{ar ? "المبلغ المستحق الآن" : "Due now"}</span>
                <strong dir="ltr">
                  {formatMoney(subscriptionChange.amountDue, subscriptionChange.currency)}
                </strong>
              </div>
            </div>
            <Alert tone="warning" title={ar ? "يُطبق التغيير فوراً" : "This change is immediate"}>
              {ar
                ? "يعيد Stripe حساب الفترة الحالية. لن يُطبق التغيير إذا تعذر تحصيل أي مبلغ مستحق."
                : "Stripe recalculates the current period. If any amount due cannot be collected, the change is not applied."}
            </Alert>
            <div className="dashboard-actions">
              <Button
                type="button"
                variant="secondary"
                disabled={subscriptionAction !== null}
                onClick={() => {
                  setSubscriptionChange(null);
                  if (data) setCadence(data.selectedCadence);
                }}
              >
                {ar ? "رجوع" : "Go back"}
              </Button>
              <Button
                type="button"
                loading={subscriptionAction === "change"}
                onClick={() => void confirmSubscriptionChange()}
              >
                {ar ? "تأكيد التغيير" : "Confirm change"}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
      <Modal
        open={cancelSubscriptionOpen}
        title={ar ? "إلغاء الاشتراك" : "Cancel subscription"}
        onClose={() => {
          if (!subscriptionAction) setCancelSubscriptionOpen(false);
        }}
      >
        <form className="dashboard-form" onSubmit={(event) => void cancelSubscription(event)}>
          <Alert tone="warning" title={ar ? "راجع ما سيحدث" : "Review what happens next"}>
            {ar
              ? `سيبقى اشتراكك متاحاً حتى ${formatBillingDate(data?.subscriptions[0]?.currentPeriodEnd ?? null)}، ثم يتوقف التجديد. لن يُحذف نشاطك، ويمكنك التراجع قبل هذا التاريخ.`
              : `Your subscription remains available until ${formatBillingDate(data?.subscriptions[0]?.currentPeriodEnd ?? null)}, then renewal stops. Your business is not deleted, and you can undo this before that date.`}
          </Alert>
          <FormField label={ar ? "سبب الإلغاء (اختياري)" : "Reason (optional)"}>
            <TextArea
              name="reason"
              maxLength={500}
              placeholder={ar ? "ساعدنا على تحسين وافلو" : "Help us improve Waflo"}
            />
          </FormField>
          <div className="dashboard-actions">
            <Button
              type="button"
              variant="secondary"
              disabled={subscriptionAction !== null}
              onClick={() => setCancelSubscriptionOpen(false)}
            >
              {ar ? "الاحتفاظ بالاشتراك" : "Keep subscription"}
            </Button>
            <Button type="submit" variant="danger" loading={subscriptionAction === "cancel"}>
              {ar ? "إلغاء عند نهاية الفترة" : "Cancel at period end"}
            </Button>
          </div>
        </form>
      </Modal>
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
  const [identitySettings, setIdentitySettings] = useState<ExternalIdentitySettings | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [logoSaving, setLogoSaving] = useState(false);
  const timezones = useMemo(
    () =>
      timeZoneOptions(locale).map((option) => ({
        value: option.id,
        label: option.label,
        group: option.group,
      })),
    [locale],
  );
  const publicMerchantUrl = organization ? merchantPublicUrl(organization.merchantSlug) : "";
  const load = useCallback(async () => {
    try {
      const [organizationData, identityData] = await Promise.all([
        apiFetch<OrganizationView>(`/v1/organizations/${membership.organization.id}`),
        apiFetch<ExternalIdentitySettings>("/v1/auth/external/identities"),
      ]);
      setOrganization(organizationData);
      setIdentitySettings(identityData);
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
      setError(
        caught instanceof ApiClientError && caught.code === "REAUTHENTICATION_REQUIRED"
          ? ar
            ? "تحقق من هويتك أولاً، ثم حاول تغيير الرابط مرة أخرى."
            : "Verify your identity first, then try changing the URL again."
          : message(caught, ar ? "تعذر تغيير الرابط." : "Unable to change URL."),
      );
    }
  }
  async function updateBrandLogo(brandLogoAssetId: string | null) {
    setLogoSaving(true);
    setError("");
    try {
      await apiFetch(`/v1/organizations/${membership.organization.id}`, {
        method: "PATCH",
        body: JSON.stringify({ brandLogoAssetId }),
      });
      setNotice(
        brandLogoAssetId
          ? ar
            ? "تم حفظ شعار نشاطك. ستتحدث بطاقات Wallet بأمان في الخلفية."
            : "Your merchant logo is saved. Existing Wallet passes will refresh safely in the background."
          : ar
            ? "تمت إزالة شعار نشاطك."
            : "Your merchant logo has been removed.",
      );
      await load();
      await onOrganizationChanged();
    } catch (caught) {
      setError(message(caught, ar ? "تعذر حفظ شعار نشاطك." : "Unable to save your merchant logo."));
    } finally {
      setLogoSaving(false);
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
          <Card className="dashboard-form-card merchant-branding-card">
            <div className="dashboard-section-heading">
              <div>
                <h2>{ar ? "الهوية البصرية" : "Branding"}</h2>
                <p>
                  {ar
                    ? "يظهر شعار نشاطك في تجربة العميل وWallet عندما يدعم مزود المحفظة ذلك."
                    : "Your merchant logo appears in the customer experience and Wallet where the provider supports it."}
                </p>
              </div>
            </div>
            <ProgramAssetPicker
              organizationId={membership.organization.id}
              category="LOGO"
              label={ar ? "شعار النشاط" : "Merchant logo"}
              assets={organization.brandLogoAsset ? [organization.brandLogoAsset] : []}
              selectedId={organization.brandLogoAsset?.id}
              onSelected={(assetId) => void updateBrandLogo(assetId)}
              onUploaded={() => undefined}
              ar={ar}
            />
            <p className="dashboard-form__hint">
              {ar
                ? "PNG أو JPEG أو WebP بحجم أقل من 2 MB. يفحص Waflo الصورة ويحذف بياناتها الوصفية ويعيد ترميزها بأمان."
                : "PNG, JPEG, or WebP under 2 MB. Waflo verifies, strips metadata, and safely normalizes every upload."}
            </p>
            {organization.brandLogoAsset ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => void updateBrandLogo(null)}
                loading={logoSaving}
              >
                {ar ? "إزالة الشعار" : "Remove logo"}
              </Button>
            ) : null}
          </Card>
          <Card className="dashboard-form-card">
            <h2>{ar ? "رابط التاجر" : "Merchant URL"}</h2>
            <Alert tone="warning" title={ar ? "تحقق من هويتك" : "Verify your identity"}>
              {identitySettings?.passwordEnabled
                ? ar
                  ? "أدخل كلمة مرور Waflo لحماية هذا التغيير. يبقى الرابط السابق محجوزاً لمدة 90 يوماً."
                  : "Enter your Waflo password to protect this change. The previous URL stays reserved for 90 days."
                : ar
                  ? "تحقق باستخدام Google قبل تغيير الرابط. يبقى الرابط السابق محجوزاً لمدة 90 يوماً."
                  : "Verify with Google before changing the URL. The previous URL stays reserved for 90 days."}
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
                <a href={publicMerchantUrl} rel="noreferrer" target="_blank">
                  {publicMerchantUrl}
                </a>
                <button
                  type="button"
                  className="wf-icon-button wf-button--ghost"
                  aria-label={ar ? "نسخ رابط التاجر" : "Copy merchant URL"}
                  onClick={() => void navigator.clipboard.writeText(publicMerchantUrl)}
                >
                  <Copy size={18} aria-hidden="true" />
                </button>
              </div>
              {identitySettings?.passwordEnabled ? (
                <FormField label={ar ? "تأكيد كلمة المرور" : "Confirm password"} required>
                  <PasswordInput name="password" autoComplete="current-password" required />
                </FormField>
              ) : (
                <div className="security-step-up-callout">
                  <p>
                    {ar
                      ? "بعد التحقق، عد إلى هنا وأرسل التغيير خلال خمس دقائق."
                      : "After verification, return here and submit the change within five minutes."}
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() =>
                      void beginGoogleReauthentication(locale, window.location.pathname).catch(
                        (caught) =>
                          setError(
                            message(
                              caught,
                              ar
                                ? "تعذر بدء التحقق عبر Google."
                                : "Unable to start Google verification.",
                            ),
                          ),
                      )
                    }
                  >
                    {ar ? "التحقق باستخدام Google" : "Verify with Google"}
                  </Button>
                </div>
              )}
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
  accountEmail: string;
  passwordEnabled: boolean;
  identities: ExternalIdentityView[];
}

interface ExternalProviderCapabilities {
  googleSignInAvailable: boolean;
}

type SensitiveAction = "deactivate" | "deletion-request" | "close-organization";

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
  const [sensitiveAction, setSensitiveAction] = useState<SensitiveAction | null>(null);
  const [sensitiveConfirmation, setSensitiveConfirmation] = useState("");
  const [sensitivePassword, setSensitivePassword] = useState("");
  const [sensitiveError, setSensitiveError] = useState("");
  const [sensitiveWorking, setSensitiveWorking] = useState(false);
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
  async function requestPasswordSetup() {
    setError("");
    try {
      await apiFetch("/v1/auth/password/setup-request", { method: "POST" });
      setNotice(
        ar
          ? "أرسلنا رابطاً آمناً لإنشاء كلمة مرور Waflo إلى بريدك الإلكتروني."
          : "We sent a secure Waflo password setup link to your email address.",
      );
    } catch (caught) {
      setError(
        message(
          caught,
          ar ? "تعذر إرسال رابط إنشاء كلمة المرور." : "Unable to send the password setup link.",
        ),
      );
    }
  }
  async function verifyWithGoogle() {
    setError("");
    try {
      await beginGoogleReauthentication(locale, window.location.pathname);
    } catch (caught) {
      setError(
        message(
          caught,
          ar ? "تعذر بدء التحقق عبر Google." : "Unable to start Google verification.",
        ),
      );
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
  function openSensitiveAction(action: SensitiveAction) {
    setSensitiveAction(action);
    setSensitiveConfirmation("");
    setSensitivePassword("");
    setSensitiveError("");
  }
  async function performSensitiveAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sensitiveAction || !identitySettings) return;
    const expected =
      sensitiveAction === "deactivate"
        ? "DEACTIVATE"
        : sensitiveAction === "deletion-request"
          ? identitySettings.accountEmail
          : membership.organization.name;
    const entered = sensitiveConfirmation.normalize("NFKC").trim();
    const matches =
      sensitiveAction === "deletion-request"
        ? entered.toLocaleLowerCase("en-US") === expected.toLocaleLowerCase("en-US")
        : entered === expected.normalize("NFKC").trim();
    if (!matches) {
      setSensitiveError(
        ar ? "اكتب عبارة التأكيد كما تظهر تماماً." : "Enter the confirmation text exactly as shown.",
      );
      return;
    }
    setSensitiveWorking(true);
    setSensitiveError("");
    try {
      if (sensitiveAction === "close-organization") {
        await apiFetch(`/v1/organizations/${membership.organization.id}/close`, {
          method: "POST",
          body: JSON.stringify({
            confirmation: entered,
            currentPassword: sensitivePassword,
          }),
        });
        window.location.assign(`/${locale}`);
        return;
      }
      await apiFetch(`/v1/auth/me/${sensitiveAction}`, {
        method: "POST",
        body: JSON.stringify({
          commandId: crypto.randomUUID(),
          confirmation: entered,
          currentPassword: sensitivePassword,
        }),
      });
      resetCsrf();
      window.location.assign(`/${locale}/logged-out`);
    } catch (caught) {
      setSensitiveError(
        caught instanceof ApiClientError && caught.code === "REAUTHENTICATION_REQUIRED"
          ? ar
            ? "تحقق باستخدام Google أو أعد إدخال كلمة مرور Waflo، ثم حاول مرة أخرى."
            : "Verify with Google or re-enter your Waflo password, then try again."
          : message(
              caught,
              sensitiveAction === "close-organization"
                ? ar
                  ? "تعذر إغلاق المؤسسة. لم يتغير شيء."
                  : "Unable to close the organization. Nothing was changed."
                : ar
                  ? "تعذر إكمال الطلب. لم يتغير شيء."
                  : "Unable to complete the request. Nothing was changed.",
            ),
      );
    } finally {
      setSensitiveWorking(false);
    }
  }
  const currentSession = sessions.find((session) => session.current) ?? null;
  const otherSessions = sessions.filter((session) => !session.current);
  const googleIdentity =
    identitySettings?.identities.find((item) => item.provider === "GOOGLE") ?? null;
  const canDisconnectGoogle = Boolean(
    identitySettings?.passwordEnabled || (identitySettings?.identities.length ?? 0) > 1,
  );
  const sensitiveExpected =
    sensitiveAction === "deactivate"
      ? "DEACTIVATE"
      : sensitiveAction === "deletion-request"
        ? (identitySettings?.accountEmail ?? "")
        : sensitiveAction === "close-organization"
          ? membership.organization.name
          : "";
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
          <h2>
            {identitySettings?.passwordEnabled
              ? ar
                ? "تغيير كلمة مرور Waflo"
                : "Change Waflo password"
              : ar
                ? "إنشاء كلمة مرور Waflo"
                : "Set a Waflo password"}
          </h2>
          {!identitySettings ? (
            <Skeleton height="12rem" />
          ) : identitySettings.passwordEnabled ? (
            <form className="dashboard-form" onSubmit={changePassword}>
              <FormField label={ar ? "كلمة المرور الحالية" : "Current password"} required>
                <PasswordInput name="currentPassword" autoComplete="current-password" required />
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
              <FormField label={ar ? "تأكيد كلمة المرور الجديدة" : "Confirm new password"} required>
                <PasswordInput
                  name="confirmPassword"
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                  required
                />
              </FormField>
              <Button type="submit">
                {ar ? "تغيير كلمة مرور Waflo" : "Change Waflo password"}
              </Button>
            </form>
          ) : (
            <div className="security-password-setup">
              <p>
                {ar
                  ? "حساب Google لا يشارك كلمة مروره مع Waflo. أنشئ كلمة مرور Waflo مستقلة لتسجيل الدخول بالبريد نفسه."
                  : "Google never shares its password with Waflo. Set a separate Waflo password to sign in with the same email address."}
              </p>
              <p>
                {ar
                  ? "سنرسل رابطاً آمناً صالحاً للاستخدام مرة واحدة إلى بريدك الموثق."
                  : "We’ll send a secure, single-use setup link to your verified email address."}
              </p>
              <Button type="button" onClick={() => void requestPasswordSetup()}>
                {ar ? "إرسال رابط إنشاء كلمة المرور" : "Send password setup link"}
              </Button>
            </div>
          )}
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
          ) : null}
          <div className="security-provider-row">
            <div className="security-provider-row__identity">
              <strong>Google</strong>
              {googleIdentity?.providerEmail ? (
                <bdi dir="ltr">{googleIdentity.providerEmail}</bdi>
              ) : (
                <span>{ar ? "غير مرتبط" : "Not connected"}</span>
              )}
            </div>
            {googleIdentity ? (
              <div className="security-provider-row__actions">
                {!identitySettings?.passwordEnabled ? (
                  <Button variant="secondary" onClick={() => void verifyWithGoogle()}>
                    {ar ? "التحقق باستخدام Google" : "Verify with Google"}
                  </Button>
                ) : null}
                <Button
                  variant="tertiary"
                  disabled={!canDisconnectGoogle}
                  onClick={() => void unlinkIdentity()}
                >
                  {ar ? "فصل" : "Disconnect"}
                </Button>
              </div>
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
          {googleIdentity && !canDisconnectGoogle ? (
            <p className="security-provider-help">
              {ar
                ? "أنشئ كلمة مرور Waflo قبل فصل Google حتى لا تفقد الوصول إلى حسابك."
                : "Set a Waflo password before disconnecting Google so you don’t lose access."}
            </p>
          ) : null}
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
          <p className="security-sensitive-intro">
            {ar
              ? "كل إجراء له تأكيد مستقل. لن ينفذ Waflo أي إجراء ما لم تؤكد النص وتتحقق من هويتك."
              : "Each action has its own confirmation. Waflo won’t proceed until you confirm the text and verify your identity."}
          </p>
          <div className="security-sensitive-actions">
            <div className="security-sensitive-action">
              <div>
                <strong>{ar ? "تعطيل الحساب" : "Deactivate account"}</strong>
                <p>
                  {ar
                    ? "ينهي جلساتك ويوقف وصولك إلى Waflo فوراً."
                    : "Ends your sessions and immediately stops access to Waflo."}
                </p>
              </div>
              <Button variant="destructive" onClick={() => openSensitiveAction("deactivate")}>
                {ar ? "تعطيل الحساب" : "Deactivate account"}
              </Button>
            </div>
            <div className="security-sensitive-action">
              <div>
                <strong>{ar ? "طلب حذف الحساب" : "Request account deletion"}</strong>
                <p>
                  {ar
                    ? "يعطل الحساب فوراً ويرسل بياناته للمراجعة وفق سياسة الاحتفاظ."
                    : "Deactivates the account immediately and submits its data for policy review."}
                </p>
              </div>
              <Button variant="destructive" onClick={() => openSensitiveAction("deletion-request")}>
                {ar ? "طلب حذف الحساب" : "Request account deletion"}
              </Button>
            </div>
            {membership.role === "OWNER" ? (
              <div className="security-sensitive-action">
                <div>
                  <strong>{ar ? "إغلاق المؤسسة" : "Close organization"}</strong>
                  <p>
                    {ar
                      ? "يؤرشف المؤسسة والمواقع والبرامج ويلغي وصول الفريق مع الاحتفاظ بالسجلات المطلوبة."
                      : "Archives the organization, locations, and programs; removes team access; and retains required records."}
                  </p>
                </div>
                <Button
                  variant="destructive"
                  onClick={() => openSensitiveAction("close-organization")}
                >
                  {ar ? "إغلاق المؤسسة" : "Close organization"}
                </Button>
              </div>
            ) : null}
          </div>
        </Card>
      </div>
      <Modal
        open={Boolean(sensitiveAction)}
        title={
          sensitiveAction === "deactivate"
            ? ar
              ? "تعطيل الحساب؟"
              : "Deactivate account?"
            : sensitiveAction === "deletion-request"
              ? ar
                ? "طلب حذف الحساب؟"
                : "Request account deletion?"
              : ar
                ? "إغلاق المؤسسة؟"
                : "Close organization?"
        }
        onClose={() => setSensitiveAction(null)}
      >
        <form className="dashboard-form sensitive-confirmation" onSubmit={performSensitiveAction}>
          <Alert
            tone="danger"
            title={ar ? "راجع العواقب قبل المتابعة" : "Review the consequences before continuing"}
          >
            {sensitiveAction === "deactivate"
              ? ar
                ? "سيتم تسجيل خروجك وتعطيل حسابك فوراً."
                : "You will be signed out and your account will be deactivated immediately."
              : sensitiveAction === "deletion-request"
                ? ar
                  ? "سيتم تعطيل حسابك فوراً. تخضع إزالة البيانات لسياسة الاحتفاظ والمراجعة القانونية."
                  : "Your account will be deactivated immediately. Data removal remains subject to retention and legal review."
                : ar
                  ? "ستؤرشف المؤسسة وتُلغى جلسات الفريق والأجهزة النشطة. لا يمكن التراجع عن ذلك من لوحة التحكم."
                  : "The organization will be archived and active team/device access will be revoked. This can’t be undone from the dashboard."}
          </Alert>
          <p className="sensitive-confirmation__instruction">
            {ar ? "اكتب النص التالي للتأكيد:" : "Enter the following text to confirm:"}{" "}
            <code dir={sensitiveAction === "deletion-request" ? "ltr" : "auto"}>
              {sensitiveExpected}
            </code>
          </p>
          <FormField label={ar ? "عبارة التأكيد" : "Confirmation text"} required>
            <TextInput
              value={sensitiveConfirmation}
              onChange={(event) => setSensitiveConfirmation(event.currentTarget.value)}
              autoComplete="off"
              spellCheck={false}
              required
            />
          </FormField>
          {identitySettings?.passwordEnabled ? (
            <FormField label={ar ? "كلمة مرور Waflo" : "Waflo password"} required>
              <PasswordInput
                value={sensitivePassword}
                onChange={(event) => setSensitivePassword(event.currentTarget.value)}
                autoComplete="current-password"
                required
              />
            </FormField>
          ) : (
            <div className="security-step-up-callout">
              <p>
                {ar
                  ? "تحقق باستخدام Google قبل تنفيذ هذا الإجراء. أكمل الإجراء خلال خمس دقائق من التحقق."
                  : "Verify with Google before performing this action. Complete it within five minutes of verification."}
              </p>
              <Button type="button" variant="secondary" onClick={() => void verifyWithGoogle()}>
                {ar ? "التحقق باستخدام Google" : "Verify with Google"}
              </Button>
            </div>
          )}
          {sensitiveError ? (
            <p className="wf-form-error" role="alert">
              {sensitiveError}
            </p>
          ) : null}
          <div className="wf-dialog__actions">
            <Button type="button" variant="secondary" onClick={() => setSensitiveAction(null)}>
              {ar ? "إلغاء" : "Cancel"}
            </Button>
            <Button type="submit" variant="destructive" loading={sensitiveWorking}>
              {sensitiveAction === "deactivate"
                ? ar
                  ? "تعطيل الحساب"
                  : "Deactivate account"
                : sensitiveAction === "deletion-request"
                  ? ar
                    ? "طلب حذف الحساب"
                    : "Request account deletion"
                  : ar
                    ? "إغلاق المؤسسة"
                    : "Close organization"}
            </Button>
          </div>
        </form>
      </Modal>
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
