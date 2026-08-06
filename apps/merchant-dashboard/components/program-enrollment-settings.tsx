"use client";

import { Alert, Badge, Button, Card, Checkbox, FormField, Select, TextInput } from "@waflo/ui";
import {
  Copy,
  Download,
  ExternalLink,
  Link2,
  RefreshCcw,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { apiFetch, apiUrl } from "../lib/api-client";

interface EnrollmentPolicy {
  emailCollectionMode: "HIDDEN" | "OPTIONAL" | "REQUIRED";
  primaryCustomerLocale: "en" | "ar";
  allowLocaleSelection: boolean;
  marketingConsentVisible: boolean;
  marketingConsentDefault: false;
  customerTermsRequired: true;
  transferWithoutEmailAllowed: boolean;
  enrollmentOpen: boolean;
}

interface EnrollmentSettings {
  programId: string;
  status: string;
  publicSlug: string | null;
  publicUrl: string | null;
  enrollmentLinkStatus: "ACTIVE" | "BLOCKED" | "NOT_PUBLISHED";
  editableVersion: {
    id: string;
    versionNumber: number;
    status: string;
    policy: EnrollmentPolicy;
  } | null;
  publishedVersion: {
    id: string;
    versionNumber: number;
    status: string;
    policy: EnrollmentPolicy;
  } | null;
}

export interface WalletHealth {
  provider: "APPLE" | "GOOGLE";
  mode: "DISABLED" | "TEST_ADAPTER" | "REAL";
  status: string;
  safeMessage: string;
  demo: boolean;
  configured?: boolean;
  providerReachable?: boolean;
  externallyCertified?: boolean;
}

interface WalletSyncJob {
  jobId: string;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "DEAD_LETTER";
  processedCount: number;
  safeErrorCode: string | null;
}

export function ProgramEnrollmentSettings({
  organizationId,
  programId,
  ar,
  showWalletReadiness = true,
  onChanged,
}: {
  organizationId: string;
  programId: string;
  ar: boolean;
  showWalletReadiness?: boolean;
  onChanged?: (() => Promise<void>) | undefined;
}) {
  const [settings, setSettings] = useState<EnrollmentSettings | null>(null);
  const [policy, setPolicy] = useState<EnrollmentPolicy | null>(null);
  const [slug, setSlug] = useState("");
  const [health, setHealth] = useState<WalletHealth[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [walletSyncJobId, setWalletSyncJobId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"policy" | "slug" | "wallet" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [next, providers] = await Promise.all([
      apiFetch<EnrollmentSettings>(
        `/v1/organizations/${organizationId}/programs/${programId}/enrollment`,
      ),
      showWalletReadiness
        ? apiFetch<WalletHealth[]>(`/v1/organizations/${organizationId}/wallet/providers`)
        : Promise.resolve([]),
    ]);
    setSettings(next);
    setPolicy(next.editableVersion?.policy ?? next.publishedVersion?.policy ?? null);
    setSlug(next.publicSlug ?? "");
    setHealth(providers);
  }, [organizationId, programId, showWalletReadiness]);

  useEffect(() => {
    void load()
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "Unable to load enrollment settings."),
      )
      .finally(() => setLoaded(true));
  }, [load]);

  useEffect(() => {
    if (!walletSyncJobId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const job = await apiFetch<WalletSyncJob>(
          `/v1/organizations/${organizationId}/programs/${programId}/wallet-sync/${walletSyncJobId}`,
        );
        if (!active) return;
        if (job.status === "COMPLETED") {
          setMessage(
            ar
              ? `اكتملت مزامنة ${job.processedCount} بطاقة.`
              : `Wallet reconciliation completed for ${job.processedCount} passes.`,
          );
          setWalletSyncJobId(null);
          await load();
          return;
        }
        if (job.status === "DEAD_LETTER") {
          setError(job.safeErrorCode ?? "Wallet reconciliation could not be completed.");
          setWalletSyncJobId(null);
          return;
        }
        setMessage(
          ar
            ? `مزامنة Wallet: ${job.status} · تمت معالجة ${job.processedCount}`
            : `Wallet reconciliation ${job.status.toLocaleLowerCase("en-US")} · ${job.processedCount} processed.`,
        );
        timer = setTimeout(poll, 2_000);
      } catch (caught) {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "Unable to read Wallet sync progress.");
        setWalletSyncJobId(null);
      }
    };
    void poll();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [ar, load, organizationId, programId, walletSyncJobId]);

  async function savePolicy() {
    if (!settings?.editableVersion || !policy) return;
    setBusy("policy");
    setError("");
    setMessage("");
    try {
      await apiFetch(
        `/v1/organizations/${organizationId}/programs/${programId}/versions/${settings.editableVersion.id}/enrollment`,
        { method: "PATCH", body: JSON.stringify(policy) },
      );
      setMessage(ar ? "تم حفظ سياسة التسجيل في المسودة." : "Draft enrollment policy saved.");
      await load();
      await onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save enrollment policy.");
    } finally {
      setBusy(null);
    }
  }

  async function saveSlug() {
    setBusy("slug");
    setError("");
    setMessage("");
    try {
      await apiFetch(`/v1/organizations/${organizationId}/programs/${programId}/public-slug`, {
        method: "PATCH",
        body: JSON.stringify({ slug }),
      });
      setMessage(ar ? "تم تحديث رابط البطاقة العام." : "Public card URL updated.");
      await load();
      await onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update public URL.");
    } finally {
      setBusy(null);
    }
  }

  async function reconcileWallet() {
    setBusy("wallet");
    setError("");
    try {
      const result = await apiFetch<WalletSyncJob>(
        `/v1/organizations/${organizationId}/programs/${programId}/wallet/reconcile`,
        { method: "POST" },
      );
      setWalletSyncJobId(result.jobId);
      setMessage(
        ar
          ? `تم إنشاء مهمة مزامنة Wallet بحالة ${result.status}.`
          : `Wallet reconciliation job ${result.status.toLocaleLowerCase("en-US")}.`,
      );
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to reconcile Wallet.");
    } finally {
      setBusy(null);
    }
  }

  if (!settings || !policy)
    return (
      <Card className="program-enrollment-settings program-enrollment-settings--loading">
        <div className="program-enrollment-settings__heading">
          <div>
            <span className="dashboard-card__label">{ar ? "وصول العملاء" : "CUSTOMER ACCESS"}</span>
            <h2>{ar ? "طريقة انضمام العملاء" : "How customers join"}</h2>
            <p>
              {ar
                ? "الرابط العام ورمز QR وسلوك الدخول ولغة العميل وإعدادات الموافقة المدعومة."
                : "Public link, QR code, entry behavior, customer language, and supported consent settings."}
            </p>
          </div>
        </div>
        {error ? (
          <Alert
            tone="warning"
            title={
              ar ? "تعذر تحميل إعدادات وصول العملاء" : "Customer access settings are unavailable"
            }
          >
            {error}
          </Alert>
        ) : (
          <div className="program-enrollment-settings__loading" role="status">
            <RefreshCcw className="studio-spin" size={18} aria-hidden="true" />
            {loaded
              ? ar
                ? "لا تتوفر إعدادات وصول لهذه البطاقة."
                : "No customer access settings are available for this card."
              : ar
                ? "جارٍ تحميل إعدادات وصول العملاء…"
                : "Loading customer access settings…"}
          </div>
        )}
      </Card>
    );
  const qrBase = `${apiUrl}/v1/organizations/${organizationId}/programs/${programId}/enrollment-qr`;
  return (
    <Card className="program-enrollment-settings">
      <div className="program-enrollment-settings__heading">
        <div>
          <span className="dashboard-card__label">{ar ? "وصول العملاء" : "CUSTOMER ACCESS"}</span>
          <h2>{ar ? "طريقة انضمام العملاء" : "How customers join"}</h2>
          <p>
            {ar
              ? "شارك رابط البطاقة أو رمز QR وحدد المعلومات المطلوبة عند الانضمام."
              : "Share the card link or QR code and choose what customers provide when they join."}
          </p>
        </div>
        <Badge tone={settings.enrollmentLinkStatus === "ACTIVE" ? "success" : "warning"}>
          {settings.enrollmentLinkStatus === "ACTIVE"
            ? ar
              ? "متاح للعملاء"
              : "Available to customers"
            : settings.enrollmentLinkStatus === "NOT_PUBLISHED"
              ? ar
                ? "متاح بعد الإطلاق"
                : "Available after launch"
              : ar
                ? "غير متاح حاليًا"
                : "Currently unavailable"}
        </Badge>
      </div>
      {error ? <Alert tone="danger" title={error} /> : null}
      {message ? <Alert tone="success" title={message} /> : null}
      <div className="program-enrollment-settings__grid">
        <section>
          <h3>
            <Link2 aria-hidden="true" /> {ar ? "رابط الانضمام" : "Join link"}
          </h3>
          <FormField
            label={ar ? "عنوان رابط البطاقة" : "Card link name"}
            hint={
              ar ? "يُحجز الرابط السابق لمدة 90 يومًا." : "Previous slugs are reserved for 90 days."
            }
          >
            <TextInput
              value={slug}
              onChange={(event) => setSlug(event.target.value.toLowerCase())}
            />
          </FormField>
          <div className="program-enrollment-settings__actions">
            <Button loading={busy === "slug"} onClick={() => void saveSlug()}>
              {ar ? "حفظ الرابط" : "Save URL"}
            </Button>
            {settings.publicUrl ? (
              <>
                <Button
                  variant="secondary"
                  onClick={() => void navigator.clipboard.writeText(settings.publicUrl ?? "")}
                >
                  <Copy size={16} /> {ar ? "نسخ" : "Copy"}
                </Button>
                <a href={settings.publicUrl} target="_blank" rel="noreferrer">
                  <Button variant="secondary">
                    <ExternalLink size={16} /> {ar ? "فتح" : "Open"}
                  </Button>
                </a>
              </>
            ) : null}
          </div>
          {settings.publicUrl ? (
            <code className="public-enrollment-url">{settings.publicUrl}</code>
          ) : null}
          <div className="program-enrollment-settings__actions">
            <a href={`${qrBase}?format=png&locale=${ar ? "ar" : "en"}`}>
              <Button variant="secondary">
                <Download size={16} /> QR PNG
              </Button>
            </a>
            <a href={`${qrBase}?format=svg&locale=${ar ? "ar" : "en"}`}>
              <Button variant="secondary">
                <Download size={16} /> QR SVG
              </Button>
            </a>
          </div>
        </section>
        <section>
          <h3>
            <ShieldCheck /> {ar ? "سياسة التسجيل" : "Enrollment policy"}
          </h3>
          <FormField label={ar ? "جمع البريد" : "Email collection"}>
            <Select
              value={policy.emailCollectionMode}
              disabled={!settings.editableVersion}
              onChange={(event) =>
                setPolicy({
                  ...policy,
                  emailCollectionMode: event.target
                    .value as EnrollmentPolicy["emailCollectionMode"],
                })
              }
            >
              <option value="HIDDEN">{ar ? "بدون بريد إلكتروني" : "Do not ask"}</option>
              <option value="OPTIONAL">{ar ? "اختياري" : "Optional"}</option>
              <option value="REQUIRED">{ar ? "مطلوب" : "Required"}</option>
            </Select>
          </FormField>
          <FormField label={ar ? "لغة العميل الأساسية" : "Primary customer language"}>
            <Select
              value={policy.primaryCustomerLocale}
              disabled={!settings.editableVersion}
              onChange={(event) =>
                setPolicy({ ...policy, primaryCustomerLocale: event.target.value as "en" | "ar" })
              }
            >
              <option value="en">English</option>
              <option value="ar">العربية</option>
            </Select>
          </FormField>
          <Checkbox
            checked={policy.enrollmentOpen}
            disabled={!settings.editableVersion}
            onChange={(event) => setPolicy({ ...policy, enrollmentOpen: event.target.checked })}
            label={
              ar
                ? "فتح التسجيل عند نشر هذا الإصدار"
                : "Allow customers to join when this update is published"
            }
          />
          <Checkbox
            checked={policy.allowLocaleSelection}
            disabled={!settings.editableVersion}
            onChange={(event) =>
              setPolicy({ ...policy, allowLocaleSelection: event.target.checked })
            }
            label={ar ? "السماح للعميل باختيار اللغة" : "Allow customer language selection"}
          />
          <Checkbox
            checked={policy.marketingConsentVisible}
            disabled={!settings.editableVersion || policy.emailCollectionMode === "HIDDEN"}
            onChange={(event) =>
              setPolicy({ ...policy, marketingConsentVisible: event.target.checked })
            }
            label={ar ? "إظهار موافقة تسويق منفصلة" : "Show separate marketing consent"}
          />
          <Checkbox
            checked={policy.transferWithoutEmailAllowed}
            disabled={!settings.editableVersion}
            onChange={(event) =>
              setPolicy({ ...policy, transferWithoutEmailAllowed: event.target.checked })
            }
            label={
              ar
                ? "السماح بالنقل الأقل أمانًا دون بريد"
                : "Allow lower-security transfer without email"
            }
          />
          {settings.editableVersion ? (
            <Button loading={busy === "policy"} onClick={() => void savePolicy()}>
              {ar ? "حفظ إعدادات الانضمام" : "Save access settings"}
            </Button>
          ) : (
            <Alert tone="info" title={ar ? "أنشئ مسودة للتعديل" : "Create a draft to edit"}>
              {ar
                ? "أنشئ تحديثًا لتغيير طريقة الانضمام."
                : "Create an update to change customer access."}
            </Alert>
          )}
        </section>
      </div>
      {showWalletReadiness ? (
        <section className="wallet-provider-health">
          <div>
            <h3>
              <WalletCards /> {ar ? "جاهزية Wallet" : "Wallet readiness"}
            </h3>
            <p>
              {ar
                ? "تعرض الحالة الفعلية ولا تدّعي نجاح مزود خارجي."
                : "Truthful provider state; no external success is claimed."}
            </p>
          </div>
          {health.map((provider) => (
            <span key={provider.provider}>
              <strong>{provider.provider}</strong>
              <Badge tone={provider.status === "HEALTHY" ? "success" : "warning"}>
                {provider.mode} · {provider.status}
              </Badge>
              <small dir="auto">{provider.safeMessage}</small>
              <small>
                Configured: {provider.configured ? "yes" : "no"} Â· Provider reachable:{" "}
                {provider.providerReachable ? "yes" : "no"} Â· Externally certified:{" "}
                {provider.externallyCertified ? "yes" : "no"}
              </small>
            </span>
          ))}
          <Button
            variant="secondary"
            loading={busy === "wallet"}
            onClick={() => void reconcileWallet()}
          >
            <RefreshCcw size={16} /> {ar ? "إعادة مزامنة آمنة" : "Safe reconcile"}
          </Button>
        </section>
      ) : null}
    </Card>
  );
}

export function ProgramWalletReadiness({
  organizationId,
  ar,
}: {
  organizationId: string;
  ar: boolean;
}) {
  const [health, setHealth] = useState<WalletHealth[]>([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    void apiFetch<WalletHealth[]>(`/v1/organizations/${organizationId}/wallet/providers`)
      .then((providers) => {
        if (active) {
          setHealth(providers);
          setLoaded(true);
        }
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : "Unable to load Wallet readiness.");
          setLoaded(true);
        }
      });
    return () => {
      active = false;
    };
  }, [organizationId]);

  return (
    <Card className="wallet-provider-health wallet-provider-health--launch">
      <div>
        <span className="dashboard-card__label">
          {ar ? "اختياري لإطلاق بطاقة العميل" : "OPTIONAL FOR CUSTOMER WEB LAUNCH"}
        </span>
        <h3>
          <WalletCards aria-hidden="true" /> {ar ? "توفر المحافظ" : "Wallet availability"}
        </h3>
        <p>
          {ar
            ? "توضح كل حالة توفر Apple Wallet وGoogle Wallet بشكل منفصل. عدم توفر الحالة لا يمنع إطلاق بطاقة العميل على الويب."
            : "Apple Wallet and Google Wallet are shown separately. Missing provider status does not block Customer Web launch."}
        </p>
      </div>
      {error ? (
        <Alert
          tone="info"
          title={
            ar ? "تعذر التحقق من حالة المحافظ · اختيارية" : "Wallet status unavailable · Optional"
          }
        >
          {ar
            ? "لا يمكن تأكيد توفر المحافظ حالياً. يبقى إطلاق بطاقة العميل على الويب متاحاً."
            : "Wallet availability cannot be confirmed right now. Customer Web launch remains available."}
        </Alert>
      ) : null}
      {!error && !loaded ? (
        <div className="wallet-provider-health__loading" role="status">
          <RefreshCcw className="studio-spin" size={17} aria-hidden="true" />
          {ar ? "جارٍ فحص جاهزية المحافظ…" : "Checking Wallet readiness…"}
        </div>
      ) : null}
      {!error && loaded && health.length === 0
        ? (["APPLE", "GOOGLE"] as const).map((provider) => (
            <span key={provider}>
              <strong>{provider === "APPLE" ? "Apple Wallet" : "Google Wallet"}</strong>
              <Badge tone="neutral">
                {ar ? "اختيارية · الحالة غير متاحة" : "Optional · Status unavailable"}
              </Badge>
              <small>
                {ar
                  ? "لا تتوفر بيانات مزود تسمح بتأكيد الاتصال أو الجاهزية."
                  : "No provider data is available to confirm a connection or readiness."}
              </small>
              <small>
                {ar
                  ? "لا يمنع ذلك إطلاق بطاقة العميل على الويب."
                  : "This does not block Customer Web launch."}
              </small>
            </span>
          ))
        : null}
      {health.map((provider) => {
        const providerName = provider.provider === "APPLE" ? "Apple Wallet" : "Google Wallet";
        const ready = provider.status === "HEALTHY";
        return (
          <span key={provider.provider}>
            <strong>{providerName}</strong>
            <Badge tone={ready ? "success" : "neutral"}>
              {ready
                ? ar
                  ? "جاهزة"
                  : "Ready"
                : ar
                  ? "غير متاحة · اختيارية"
                  : "Unavailable · Optional"}
            </Badge>
            <small dir="auto">{provider.safeMessage}</small>
            {!ready ? (
              <small>
                {ar
                  ? "تتأثر واجهة المحفظة فقط؛ يبقى إطلاق بطاقة العميل على الويب متاحاً."
                  : "Only this Wallet surface is affected; Customer Web launch remains available."}
              </small>
            ) : null}
          </span>
        );
      })}
    </Card>
  );
}
