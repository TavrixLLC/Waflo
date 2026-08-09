"use client";

import type { Locale, PlanCode } from "@waflo/contracts";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  EmailInput,
  FormField,
  Modal,
  PageHeader,
  PasswordInput,
  PlanCard,
  Select,
  Skeleton,
  StatusBadge,
  Table,
  TextInput,
  UsageMeter,
} from "@waflo/ui";
import { BarChart3, CalendarClock, Copy, Gift, MapPin, Plus, Users } from "lucide-react";
import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, ApiClientError, resetCsrf } from "../lib/api-client";
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
              ? "راجع مواقعك وفريقك الآن. إنشاء بطاقات الولاء يصل في W2."
              : "Review locations and team now. Loyalty-card creation arrives in W2."}
          </p>
          <Button disabled>
            {ar ? "إنشاء بطاقة ولاء — قريباً" : "Create loyalty card — coming soon"}
          </Button>
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
          timezone: String(form.get("timezone") ?? membership.organization.defaultLocale),
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
                  ? ["الموقع", "المدينة", "المنطقة الزمنية", "الحالة", "الإجراء"]
                  : ["Location", "City", "Timezone", "Status", "Action"]
              }
              rows={data.items.map((location) => [
                <strong key="name">{location.name}</strong>,
                location.city ?? "—",
                <span dir="ltr" key="timezone">
                  {location.timezone}
                </span>,
                <StatusBadge
                  key="status"
                  status={location.status === "ACTIVE" ? "active" : "archived"}
                  label={location.status}
                />,
                canManage ? (
                  <Button
                    key="action"
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
          <FormField label={ar ? "المنطقة الزمنية" : "Timezone"} required>
            <Select name="timezone" defaultValue="Asia/Baghdad">
              <option value="Asia/Baghdad">Asia/Baghdad</option>
              <option value="Asia/Riyadh">Asia/Riyadh</option>
              <option value="Asia/Dubai">Asia/Dubai</option>
            </Select>
          </FormField>
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
    </>
  );
}

interface TeamData {
  members: {
    id: string;
    role: "OWNER" | "MANAGER" | "STAFF";
    status: "ACTIVE" | "SUSPENDED";
    user: { id: string; displayName: string; email: string };
  }[];
  invitations: {
    id: string;
    email: string;
    intendedRole: "MANAGER" | "STAFF";
    expiresAt: string;
  }[];
  usage: UsageDecision;
}

export function TeamScreen({ locale, membership }: { locale: Locale; membership: MembershipView }) {
  const ar = locale === "ar";
  const [data, setData] = useState<TeamData | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const canInvite = membership.role === "OWNER" || membership.role === "MANAGER";
  const load = useCallback(async () => {
    try {
      setData(await apiFetch(`/v1/organizations/${membership.organization.id}/members`));
    } catch (caught) {
      setError(message(caught, ar ? "تعذر تحميل الفريق." : "Unable to load team."));
    }
  }, [membership.organization.id, ar]);
  useEffect(() => {
    void load();
  }, [load]);
  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    const form = new FormData(event.currentTarget);
    try {
      await apiFetch(`/v1/organizations/${membership.organization.id}/invitations`, {
        method: "POST",
        body: JSON.stringify({
          email: String(form.get("email") ?? ""),
          role: String(form.get("role") ?? "STAFF"),
        }),
      });
      setOpen(false);
      await load();
    } catch (caught) {
      setError(message(caught, ar ? "تعذرت الدعوة." : "Unable to send invitation."));
    } finally {
      setSaving(false);
    }
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
            : "Roles and permissions are enforced server-side for every organization."
        }
        actions={
          canInvite ? (
            <Button onClick={() => setOpen(true)} disabled={data ? !data.usage.allowed : true}>
              <Plus size={17} />
              {ar ? "دعوة عضو" : "Invite member"}
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
                  : "Choose a higher plan before sending another invitation."}
              </Alert>
            ) : null}
          </Card>
          <Card className="dashboard-card dashboard-card--full">
            <h2>{ar ? "الأعضاء النشطون" : "Active members"}</h2>
            <Table
              caption={ar ? "أعضاء الفريق" : "Team members"}
              headers={
                ar
                  ? ["العضو", "الدور", "الحالة", "الإجراء"]
                  : ["Member", "Role", "Status", "Action"]
              }
              rows={data.members.map((item) => [
                <div className="dashboard-member" key="member">
                  <Avatar name={item.user.displayName} />
                  <span>
                    <strong>{item.user.displayName}</strong>
                    <small>{item.user.email}</small>
                  </span>
                </div>,
                <Badge key="role" tone={item.role === "OWNER" ? "brand" : "neutral"}>
                  {item.role}
                </Badge>,
                <StatusBadge
                  key="status"
                  status={item.status === "ACTIVE" ? "active" : "suspended"}
                  label={item.status}
                />,
                item.role === "OWNER" ? (
                  <span key="protected">{ar ? "مالك محمي" : "Protected Owner"}</span>
                ) : membership.role === "OWNER" ? (
                  <div className="dashboard-actions" key="actions">
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
                  <Button key="remove" variant="ghost" onClick={() => void removeMember(item.id)}>
                    {ar ? "إزالة" : "Remove"}
                  </Button>
                ) : (
                  "—"
                ),
              ])}
            />
          </Card>
          <Card className="dashboard-card dashboard-card--full">
            <h2>{ar ? "الدعوات المعلقة" : "Pending invitations"}</h2>
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
        title={ar ? "دعوة عضو" : "Invite team member"}
        onClose={() => setOpen(false)}
      >
        <form className="dashboard-form" onSubmit={invite}>
          <FormField label={ar ? "البريد الإلكتروني" : "Email address"} required>
            <EmailInput name="email" required />
          </FormField>
          <FormField label={ar ? "الدور" : "Role"} required>
            <Select name="role" defaultValue="STAFF">
              <option value="STAFF">{ar ? "موظف" : "Staff"}</option>
              {membership.role === "OWNER" ? (
                <option value="MANAGER">{ar ? "مدير" : "Manager"}</option>
              ) : null}
            </Select>
          </FormField>
          <Alert tone="info" title={ar ? "الدعوة مرتبطة بالبريد" : "Invitation is email-bound"}>
            {ar
              ? "يجب القبول باستخدام البريد المدعو بعد تأكيده."
              : "It must be accepted by the verified invited email."}
          </Alert>
          <div className="dashboard-actions">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {ar ? "إلغاء" : "Cancel"}
            </Button>
            <Button type="submit" loading={saving}>
              {ar ? "إرسال الدعوة" : "Send invitation"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

interface BillingView {
  selectedPlan: "STARTER" | "GROWTH" | "SCALE";
  profile: {
    subscriptionStatus: string;
    trialStart: string | null;
    trialEnd: string | null;
    stripeCustomerId: string | null;
  };
  subscriptions: { id: string; status: string; planCode: string; createdAt: string }[];
  stripeConfigured: boolean;
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
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<PlanCode | null>(null);
  const [stripeActionInFlight, setStripeActionInFlight] = useState<"checkout" | "portal" | null>(
    null,
  );
  const stripeActionInFlightRef = useRef<"checkout" | "portal" | null>(null);
  const [checkoutCommandId, setCheckoutCommandId] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await apiFetch(`/v1/organizations/${membership.organization.id}/billing`));
    } catch (caught) {
      setError(message(caught, ar ? "تعذر تحميل الفوترة." : "Unable to load billing."));
    }
  }, [membership.organization.id, ar]);
  useEffect(() => {
    void load();
  }, [load]);
  async function select(plan: PlanCode) {
    setSaving(plan);
    try {
      await apiFetch(`/v1/organizations/${membership.organization.id}/billing/selected-plan`, {
        method: "PATCH",
        body: JSON.stringify({ plan }),
      });
      await load();
    } catch (caught) {
      setError(message(caught, ar ? "تعذر تغيير الخطة." : "Unable to change plan."));
    } finally {
      setSaving(null);
    }
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
          <div className="dashboard-grid" style={{ marginBottom: "1rem" }}>
            <Card className="dashboard-card">
              <span className="dashboard-card__label">
                {ar ? "الخطة المختارة" : "SELECTED PLAN"}
              </span>
              <span className="dashboard-card__value">{data.selectedPlan}</span>
            </Card>
            <Card className="dashboard-card">
              <span className="dashboard-card__label">{ar ? "حالة الاشتراك" : "SUBSCRIPTION"}</span>
              <span className="dashboard-card__value">{data.profile.subscriptionStatus}</span>
            </Card>
            <Card className="dashboard-card">
              <span className="dashboard-card__label">{ar ? "حالة التجربة" : "TRIAL"}</span>
              <span className="dashboard-card__value">
                {data.profile.trialStart
                  ? ar
                    ? "بدأت"
                    : "Started"
                  : ar
                    ? "لم تبدأ"
                    : "Not started"}
              </span>
            </Card>
          </div>
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
                !data.profile.stripeCustomerId ||
                stripeActionInFlight !== null
              }
            >
              {ar ? "فتح بوابة العميل" : "Open Customer Portal"}
            </Button>
          </div>
          <Alert tone="info" title={ar ? "التجربة لم تبدأ" : "Trial remains pending"}>
            {ar
              ? "لن تبدأ Waflo التجربة في Stripe أو محلياً خلال W1."
              : "Waflo does not start the product trial locally or in Stripe during W1."}
          </Alert>
        </>
      ) : (
        <Skeleton height="20rem" />
      )}
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
                <Select name="timezone" defaultValue={organization.timezone}>
                  <option value="Asia/Baghdad">Asia/Baghdad</option>
                  <option value="Asia/Riyadh">Asia/Riyadh</option>
                  <option value="Asia/Dubai">Asia/Dubai</option>
                </Select>
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
      <div className="dashboard-section-grid" style={{ gridTemplateColumns: "1.2fr .8fr" }}>
        <Card className="dashboard-form-card">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "1rem",
              alignItems: "center",
            }}
          >
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
        <Card className="dashboard-form-card" style={{ gridColumn: "1 / -1" }}>
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
        <Card className="dashboard-form-card" style={{ gridColumn: "1 / -1" }}>
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
        <Card className="dashboard-form-card" style={{ gridColumn: "1 / -1" }}>
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

export function FutureScreen({ locale, section }: { locale: Locale; section: DashboardSection }) {
  const ar = locale === "ar";
  const details: Record<string, { icon: ReactNode; en: [string, string]; ar: [string, string] }> = {
    programs: {
      icon: <Gift />,
      en: [
        "Loyalty cards arrive in W2",
        "Quick Mode, Pro Mode, and card publishing are intentionally not part of this foundation phase.",
      ],
      ar: [
        "بطاقات الولاء تصل في W2",
        "الوضع السريع والاحترافي ونشر البطاقات مؤجلة عمداً إلى مرحلة الأساس التالية.",
      ],
    },
    customers: {
      icon: <Users />,
      en: [
        "Customer records are not active yet",
        "Enrollment and customer memberships will be introduced after loyalty-card foundations exist.",
      ],
      ar: [
        "سجلات العملاء غير مفعلة بعد",
        "سيصل الانضمام وعضويات العملاء بعد اكتمال أساس بطاقات الولاء.",
      ],
    },
    analytics: {
      icon: <BarChart3 />,
      en: [
        "Analytics needs real loyalty activity",
        "Waflo will not show fabricated charts before customer and transaction data exists.",
      ],
      ar: [
        "التحليلات تحتاج نشاط ولاء حقيقياً",
        "لن تعرض Waflo مخططات وهمية قبل وجود بيانات عملاء وعمليات فعلية.",
      ],
    },
  };
  const view = details[section] ?? details.analytics;
  if (!view) return null;
  const [title, description] = ar ? view.ar : view.en;
  return (
    <>
      <PageHeader
        eyebrow={ar ? "ميزة مستقبلية" : "Future area"}
        title={title}
        description={description}
      />
      <Card>
        <EmptyState
          icon={view.icon}
          title={title}
          description={description}
          action={<Button disabled>{ar ? "قريباً" : "Coming in W2"}</Button>}
        />
      </Card>
    </>
  );
}
