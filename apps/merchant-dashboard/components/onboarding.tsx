"use client";

import type { Locale, PlanCode } from "@waflo/contracts";
import Image from "next/image";
import {
  Alert,
  Button,
  Card,
  FormField,
  LanguageSwitcher,
  PlanCard,
  Select,
  TextInput,
} from "@waflo/ui";
import { Check, Link2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { apiFetch, ApiClientError } from "../lib/api-client";

function OnboardingShell({
  locale,
  step,
  children,
}: {
  locale: Locale;
  step: 1 | 2 | 3 | 4;
  children: React.ReactNode;
}) {
  const ar = locale === "ar";
  const steps = ar
    ? ["الحساب", "النشاط", "الموقع", "الاكتمال"]
    : ["Account", "Business", "Location", "Complete"];
  return (
    <main className="onboarding-shell">
      <header className="onboarding-header">
        <Image src="/brand/waflo-logo-primary-horizontal.svg" alt="Waflo" width={280} height={80} />
        <LanguageSwitcher
          locale={locale}
          href={`/${locale === "ar" ? "en" : "ar"}/onboarding/business`}
        />
      </header>
      <div className="onboarding-main">
        <aside className="onboarding-progress" aria-label={ar ? "تقدم الإعداد" : "Setup progress"}>
          {steps.map((label, index) => {
            const number = index + 1;
            return (
              <div
                key={label}
                className={`onboarding-progress__item ${
                  number === step
                    ? "onboarding-progress__item--active"
                    : number < step
                      ? "onboarding-progress__item--complete"
                      : ""
                }`}
              >
                <span>{number < step ? <Check size={16} /> : number}</span>
                {label}
              </div>
            );
          })}
        </aside>
        <Card className="onboarding-card">{children}</Card>
      </div>
    </main>
  );
}

export function BusinessOnboarding({ locale }: { locale: Locale }) {
  const ar = locale === "ar";
  const router = useRouter();
  const [plan, setPlan] = useState<PlanCode>("starter");
  const [slug, setSlug] = useState("");
  const [availability, setAvailability] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (slug.length < 3) {
      setAvailability("");
      return;
    }
    const timeout = window.setTimeout(() => {
      void apiFetch<{ available: boolean; slug: string; reason?: string }>(
        `/v1/public/merchant-slug/availability?slug=${encodeURIComponent(slug)}`,
      )
        .then((result) =>
          setAvailability(
            result.available
              ? ar
                ? "الرابط متاح"
                : "URL is available"
              : ar
                ? "الرابط غير متاح"
                : "URL is unavailable",
          ),
        )
        .catch(() => setAvailability(""));
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [slug, ar]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const organization = await apiFetch<{ id: string }>("/v1/organizations", {
        method: "POST",
        body: JSON.stringify({
          name: String(form.get("name") ?? ""),
          merchantSlug: slug,
          businessCategory: String(form.get("category") ?? "") || undefined,
          defaultLocale: String(form.get("defaultLocale") ?? locale),
          timezone: String(form.get("timezone") ?? "Asia/Baghdad"),
          selectedPlan: plan,
        }),
      });
      sessionStorage.setItem("waflo:onboarding-organization", organization.id);
      router.push(`/${locale}/onboarding/location?organization=${organization.id}`);
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? caught.message
          : ar
            ? "تعذر حفظ بيانات النشاط."
            : "Unable to save business details.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <OnboardingShell locale={locale} step={2}>
      <span className="wf-eyebrow">{ar ? "الخطوة 2 من 4" : "Step 2 of 4"}</span>
      <h1>{ar ? "عرّفنا بنشاطك" : "Tell us about your business"}</h1>
      <p>
        {ar
          ? "سنستخدم هذه المعلومات لإعداد رابط التاجر وأول إعدادات مؤسستك."
          : "We’ll use this to prepare your merchant URL and organization defaults."}
      </p>
      {error ? <Alert tone="danger" title={error} /> : null}
      <form className="onboarding-form" onSubmit={submit}>
        <FormField label={ar ? "اسم النشاط" : "Business name"} required>
          <TextInput name="name" minLength={2} maxLength={120} required />
        </FormField>
        <FormField label={ar ? "رابط التاجر" : "Merchant URL"} hint={availability} required>
          <TextInput
            name="slug"
            value={slug}
            onChange={(event) =>
              setSlug(
                event.currentTarget.value.toLocaleLowerCase("en-US").replace(/[^a-z0-9-]/g, ""),
              )
            }
            minLength={3}
            maxLength={40}
            dir="ltr"
            required
          />
        </FormField>
        <div className="onboarding-url" dir="ltr">
          <Link2 size={17} aria-hidden="true" />
          https://{slug || "your-business"}.waflo.app
        </div>
        <div className="dashboard-form__row">
          <FormField label={ar ? "نوع النشاط (اختياري)" : "Business category (optional)"}>
            <Select name="category" defaultValue="">
              <option value="">{ar ? "اختر لاحقاً" : "Choose later"}</option>
              <option value="Café">{ar ? "مقهى" : "Café"}</option>
              <option value="Bakery">{ar ? "مخبز" : "Bakery"}</option>
              <option value="Restaurant">{ar ? "مطعم" : "Restaurant"}</option>
              <option value="Salon">{ar ? "صالون" : "Salon"}</option>
              <option value="Retail">{ar ? "متجر" : "Retail"}</option>
              <option value="Other">{ar ? "أخرى" : "Other"}</option>
            </Select>
          </FormField>
          <FormField label={ar ? "اللغة الافتراضية" : "Default language"} required>
            <Select name="defaultLocale" defaultValue={locale}>
              <option value="en">English</option>
              <option value="ar">العربية</option>
            </Select>
          </FormField>
        </div>
        <FormField label={ar ? "المنطقة الزمنية" : "Business timezone"} required>
          <Select name="timezone" defaultValue="Asia/Baghdad">
            <option value="Asia/Baghdad">Asia/Baghdad</option>
            <option value="Asia/Riyadh">Asia/Riyadh</option>
            <option value="Asia/Dubai">Asia/Dubai</option>
            <option value="Europe/London">Europe/London</option>
            <option value="America/New_York">America/New_York</option>
          </Select>
        </FormField>
        <div>
          <strong>{ar ? "الخطة المختارة للإعداد" : "Setup plan"}</strong>
          <p style={{ color: "var(--waflo-muted)", marginTop: ".35rem" }}>
            {ar
              ? "الاختيار يحدد حدود الإعداد فقط، ولا يبدأ الدفع أو التجربة."
              : "This controls setup limits only; it does not start payment or your trial."}
          </p>
          <div className="dashboard-section-grid dashboard-section-grid--plans">
            {(["starter", "growth", "scale"] as const).map((code) => (
              <PlanCard
                key={code}
                plan={code}
                selected={plan === code}
                locale={locale}
                onSelect={setPlan}
              />
            ))}
          </div>
        </div>
        <Button type="submit" loading={loading}>
          {ar ? "حفظ ومتابعة" : "Save and continue"}
        </Button>
      </form>
    </OnboardingShell>
  );
}

export function LocationOnboarding({
  locale,
  organizationId,
}: {
  locale: Locale;
  organizationId?: string;
}) {
  const ar = locale === "ar";
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const effectiveOrganizationId =
    organizationId ??
    (typeof window === "undefined"
      ? undefined
      : (sessionStorage.getItem("waflo:onboarding-organization") ?? undefined));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!effectiveOrganizationId) {
      setError(
        ar
          ? "تعذر العثور على المؤسسة. سجّل الدخول مجدداً."
          : "Organization context is missing. Sign in again.",
      );
      return;
    }
    setLoading(true);
    const form = new FormData(event.currentTarget);
    try {
      await apiFetch(`/v1/organizations/${effectiveOrganizationId}/locations`, {
        method: "POST",
        body: JSON.stringify({
          name: String(form.get("name") ?? ""),
          addressLine1: String(form.get("address") ?? "") || undefined,
          city: String(form.get("city") ?? "") || undefined,
          phone: String(form.get("phone") ?? "") || undefined,
          timezone: String(form.get("timezone") ?? "Asia/Baghdad"),
        }),
      });
      await apiFetch(`/v1/organizations/${effectiveOrganizationId}/complete-onboarding`, {
        method: "POST",
      });
      router.push(`/${locale}/onboarding/complete?organization=${effectiveOrganizationId}`);
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? caught.message
          : ar
            ? "تعذر حفظ الموقع."
            : "Unable to save location.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <OnboardingShell locale={locale} step={3}>
      <span className="wf-eyebrow">{ar ? "الخطوة 3 من 4" : "Step 3 of 4"}</span>
      <h1>{ar ? "أضف موقعك الأول" : "Add your first location"}</h1>
      <p>
        {ar
          ? "يحتاج كل نشاط إلى موقع فعّال واحد على الأقل. يمكنك إضافة المزيد حسب حدود الخطة."
          : "Every organization needs at least one active location. Add more later within plan limits."}
      </p>
      {error ? <Alert tone="danger" title={error} /> : null}
      <form className="onboarding-form" onSubmit={submit}>
        <FormField label={ar ? "اسم الموقع" : "Location name"} required>
          <TextInput
            name="name"
            placeholder={ar ? "مثلاً: فرع المنصور" : "e.g. Downtown"}
            minLength={2}
            required
          />
        </FormField>
        <FormField label={ar ? "العنوان (اختياري)" : "Address (optional)"}>
          <TextInput name="address" autoComplete="street-address" />
        </FormField>
        <div className="dashboard-form__row">
          <FormField label={ar ? "المدينة (اختياري)" : "City (optional)"}>
            <TextInput name="city" autoComplete="address-level2" />
          </FormField>
          <FormField label={ar ? "الهاتف (اختياري)" : "Phone (optional)"}>
            <TextInput name="phone" type="tel" autoComplete="tel" />
          </FormField>
        </div>
        <FormField label={ar ? "المنطقة الزمنية" : "Timezone"} required>
          <Select name="timezone" defaultValue="Asia/Baghdad">
            <option value="Asia/Baghdad">Asia/Baghdad</option>
            <option value="Asia/Riyadh">Asia/Riyadh</option>
            <option value="Asia/Dubai">Asia/Dubai</option>
          </Select>
        </FormField>
        <Button type="submit" loading={loading}>
          {ar ? "إنشاء الموقع وإكمال الإعداد" : "Create location and finish setup"}
        </Button>
      </form>
    </OnboardingShell>
  );
}

interface OrganizationSummary {
  name: string;
  merchantSlug: string;
  selectedPlan: string;
  locations: { name: string }[];
  billingProfile: {
    subscriptionStatus: "PENDING_ACTIVATION";
    trialStart: null;
    trialEnd: null;
  };
}

export function CompletionOnboarding({
  locale,
  organizationId,
}: {
  locale: Locale;
  organizationId?: string;
}) {
  const ar = locale === "ar";
  const [organization, setOrganization] = useState<OrganizationSummary | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!organizationId) return;
    void apiFetch<OrganizationSummary>(`/v1/organizations/${organizationId}`)
      .then(setOrganization)
      .catch((caught: unknown) =>
        setError(caught instanceof ApiClientError ? caught.message : "Unable to load setup."),
      );
  }, [organizationId]);
  return (
    <OnboardingShell locale={locale} step={4}>
      <span className="wf-eyebrow">{ar ? "اكتمل الإعداد" : "Setup complete"}</span>
      <h1>{ar ? "اكتمل إعداد مؤسستك." : "Your organization is ready."}</h1>
      <p>
        {ar
          ? "حفظنا مؤسستك وموقعك والخطة المختارة. لم تبدأ التجربة المجانية ولم يتم تحصيل أي مبلغ."
          : "Your organization, first location, and selected plan are saved. The trial has not started and no payment was taken."}
      </p>
      {error ? <Alert tone="danger" title={error} /> : null}
      {organization ? (
        <>
          <div className="onboarding-summary">
            <div>
              <span>{ar ? "النشاط" : "Business"}</span>
              <strong>{organization.name}</strong>
            </div>
            <div>
              <span>{ar ? "رابط التاجر" : "Merchant URL"}</span>
              <strong dir="ltr">{organization.merchantSlug}.waflo.app</strong>
            </div>
            <div>
              <span>{ar ? "الخطة المختارة" : "Selected plan"}</span>
              <strong>{organization.selectedPlan}</strong>
            </div>
            <div>
              <span>{ar ? "الموقع الأول" : "First location"}</span>
              <strong>{organization.locations[0]?.name}</strong>
            </div>
            <div>
              <span>{ar ? "حالة التجربة" : "Trial status"}</span>
              <strong>{ar ? "لم تبدأ" : "Not started"}</strong>
            </div>
          </div>
          <Alert tone="info" title={ar ? "تجربتك المجانية محفوظة" : "Your free trial is waiting"}>
            {ar
              ? "ستبدأ مدة 15 يوماً عند نشر أول بطاقة ولاء."
              : "Your 15 days begin when you publish your first loyalty card."}
          </Alert>
          <a
            className="wf-button wf-button--secondary onboarding-action-link onboarding-action-link--first"
            href={`/${locale}/dashboard`}
          >
            {ar ? "متابعة إلى لوحة التحكم" : "Continue to dashboard"}
          </a>
          <a
            className="wf-button wf-button--primary onboarding-action-link"
            href={`/${locale}/dashboard/programs/new`}
          >
            {ar ? "إنشاء أول بطاقة ولاء" : "Create first loyalty card"}
          </a>
        </>
      ) : (
        <p>{ar ? "جارٍ تحميل الملخص…" : "Loading your setup summary…"}</p>
      )}
    </OnboardingShell>
  );
}
