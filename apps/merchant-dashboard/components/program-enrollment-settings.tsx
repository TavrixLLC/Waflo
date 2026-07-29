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

interface WalletHealth {
  provider: "APPLE" | "GOOGLE";
  mode: "DISABLED" | "TEST_ADAPTER" | "REAL";
  status: string;
  safeMessage: string;
  demo: boolean;
  configured?: boolean;
  providerReachable?: boolean;
  externallyCertified?: boolean;
}

export function ProgramEnrollmentSettings({
  organizationId,
  programId,
  ar,
  onChanged,
}: {
  organizationId: string;
  programId: string;
  ar: boolean;
  onChanged?: (() => Promise<void>) | undefined;
}) {
  const [settings, setSettings] = useState<EnrollmentSettings | null>(null);
  const [policy, setPolicy] = useState<EnrollmentPolicy | null>(null);
  const [slug, setSlug] = useState("");
  const [health, setHealth] = useState<WalletHealth[]>([]);
  const [busy, setBusy] = useState<"policy" | "slug" | "wallet" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [next, providers] = await Promise.all([
      apiFetch<EnrollmentSettings>(
        `/v1/organizations/${organizationId}/programs/${programId}/enrollment`,
      ),
      apiFetch<WalletHealth[]>(`/v1/organizations/${organizationId}/wallet/providers`),
    ]);
    setSettings(next);
    setPolicy(next.editableVersion?.policy ?? next.publishedVersion?.policy ?? null);
    setSlug(next.publicSlug ?? "");
    setHealth(providers);
  }, [organizationId, programId]);

  useEffect(() => {
    void load().catch((caught) =>
      setError(caught instanceof Error ? caught.message : "Unable to load enrollment settings."),
    );
  }, [load]);

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
      setMessage(ar ? "تم تحديث رابط البرنامج العام." : "Public program URL updated.");
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
      const result = await apiFetch<{ queued: number }>(
        `/v1/organizations/${organizationId}/programs/${programId}/wallet/reconcile`,
        { method: "POST" },
      );
      setMessage(
        ar
          ? `تمت جدولة ${result.queued} من مهام المزامنة الآمنة.`
          : `${result.queued} safe reconciliation commands queued.`,
      );
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to reconcile Wallet.");
    } finally {
      setBusy(null);
    }
  }

  if (!settings || !policy) return null;
  const qrBase = `${apiUrl}/v1/organizations/${organizationId}/programs/${programId}/enrollment-qr`;
  return (
    <Card className="program-enrollment-settings">
      <div className="program-enrollment-settings__heading">
        <div>
          <span className="dashboard-card__label">CUSTOMER ENROLLMENT · W3</span>
          <h2>{ar ? "التسجيل العام وWallet" : "Public enrollment & Wallet"}</h2>
          <p>
            {ar
              ? "أنشئ رابطًا ورمز QR عامًا، واضبط جمع البريد والنقل في المسودة."
              : "Publish a canonical link and QR, then control email collection and transfer policy on the draft."}
          </p>
        </div>
        <Badge tone={settings.enrollmentLinkStatus === "ACTIVE" ? "success" : "warning"}>
          {settings.enrollmentLinkStatus.replaceAll("_", " ")}
        </Badge>
      </div>
      {error ? <Alert tone="danger" title={error} /> : null}
      {message ? <Alert tone="success" title={message} /> : null}
      <div className="program-enrollment-settings__grid">
        <section>
          <h3>
            <Link2 /> {ar ? "الرابط العام" : "Public link"}
          </h3>
          <FormField
            label={ar ? "معرّف الرابط" : "Program URL slug"}
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
              <option value="HIDDEN">Hidden</option>
              <option value="OPTIONAL">Optional</option>
              <option value="REQUIRED">Required</option>
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
                : "Open enrollment when this version is published"
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
              {ar ? "حفظ في المسودة" : "Save to draft"}
            </Button>
          ) : (
            <Alert tone="info" title={ar ? "أنشئ مسودة للتعديل" : "Create a draft to edit"}>
              {ar ? "السياسة المنشورة ثابتة." : "Published enrollment policy is immutable."}
            </Alert>
          )}
        </section>
      </div>
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
            <small>{provider.safeMessage}</small>
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
    </Card>
  );
}
