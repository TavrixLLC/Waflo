"use client";

import type { Locale } from "@waflo/contracts";
import {
  Alert,
  Button,
  Checkbox,
  EmailInput,
  FormField,
  PasswordInput,
  TextInput,
} from "@waflo/ui";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { apiFetch, ApiClientError, apiUrl, resetCsrf } from "../lib/api-client";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiClientError ? error.message : fallback;
}

interface MeResponse {
  lastSelectedOrganizationId: string | null;
  memberships: {
    organization: { id: string; onboardingState: "BUSINESS" | "LOCATION" | "COMPLETE" };
  }[];
}

export async function destinationAfterLogin(locale: Locale): Promise<string> {
  const me = await apiFetch<MeResponse>("/v1/auth/me");
  if (me.memberships.length === 0) return `/${locale}/onboarding/business`;
  const membership =
    me.memberships.find((item) => item.organization.id === me.lastSelectedOrganizationId) ??
    me.memberships[0];
  if (!membership) return `/${locale}/onboarding/business`;
  if (membership.organization.onboardingState === "LOCATION") {
    return `/${locale}/onboarding/location?organization=${membership.organization.id}`;
  }
  return `/${locale}/dashboard`;
}

interface ExternalCapabilities {
  googleSignInAvailable: boolean;
  appleSignInAvailable: boolean;
}

function ExternalAuthRail({
  locale,
  registration = false,
  legalAccepted = true,
}: {
  locale: Locale;
  registration?: boolean;
  legalAccepted?: boolean;
}) {
  const ar = locale === "ar";
  const [capabilities, setCapabilities] = useState<ExternalCapabilities | null>(null);
  useEffect(() => {
    void apiFetch<ExternalCapabilities>("/v1/auth/external/providers")
      .then(setCapabilities)
      .catch(() => setCapabilities({ googleSignInAvailable: false, appleSignInAvailable: false }));
  }, []);
  const providers = [
    {
      code: "google",
      available: capabilities?.googleSignInAvailable === true,
      label: ar ? "المتابعة باستخدام Google" : "Continue with Google",
      mark: "G",
    },
    {
      code: "apple",
      available: capabilities?.appleSignInAvailable === true,
      label: ar ? "المتابعة باستخدام Apple" : "Continue with Apple",
      mark: "●",
    },
  ].filter((provider) => provider.available);
  if (providers.length === 0) return null;
  return (
    <fieldset className="external-auth">
      <legend className="external-auth__legend">
        {ar ? "خيارات تسجيل الدخول" : "Sign-in options"}
      </legend>
      <div className="external-auth__providers">
        {providers.map((provider) => {
          const query = new URLSearchParams({ locale });
          if (registration) {
            query.set("registration", "true");
            query.set("termsAccepted", "true");
            query.set("privacyAccepted", "true");
          }
          const disabled = registration && !legalAccepted;
          return disabled ? (
            <button className="external-auth__button" disabled key={provider.code} type="button">
              <span
                aria-hidden="true"
                className={`external-auth__mark external-auth__mark--${provider.code}`}
              >
                {provider.mark}
              </span>
              {provider.label}
            </button>
          ) : (
            <a
              className="external-auth__button"
              href={`${apiUrl}/v1/auth/external/${provider.code}/start?${query.toString()}`}
              key={provider.code}
            >
              <span
                aria-hidden="true"
                className={`external-auth__mark external-auth__mark--${provider.code}`}
              >
                {provider.mark}
              </span>
              {provider.label}
            </a>
          );
        })}
      </div>
      {registration && !legalAccepted ? (
        <p className="external-auth__hint">
          {ar
            ? "وافق على الشروط وسياسة الخصوصية للمتابعة."
            : "Accept the Terms and Privacy Policy to continue."}
        </p>
      ) : null}
      <div className="external-auth__separator">
        <span>{ar ? "أو" : "or"}</span>
      </div>
    </fieldset>
  );
}

export function SignupForm({ locale }: { locale: Locale }) {
  const ar = locale === "ar";
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirm = String(form.get("confirmPassword") ?? "");
    if (password !== confirm) {
      setError(ar ? "كلمتا المرور غير متطابقتين." : "Passwords do not match.");
      setLoading(false);
      return;
    }
    try {
      await apiFetch("/v1/auth/register", {
        method: "POST",
        body: JSON.stringify({
          displayName: String(form.get("displayName") ?? ""),
          email: String(form.get("email") ?? ""),
          password,
          locale,
          termsAccepted: form.get("terms") === "on",
          privacyAccepted: form.get("privacy") === "on",
        }),
      });
      sessionStorage.setItem("waflo:verification-email", String(form.get("email") ?? ""));
      router.push(`/${locale}/verify-email`);
    } catch (caught) {
      setError(errorMessage(caught, ar ? "تعذر إنشاء الحساب." : "Unable to create account."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <h2>{ar ? "أنشئ حساب التاجر" : "Create your merchant account"}</h2>
      <p className="auth-card__intro">
        {ar
          ? "ابدأ الإعداد الآن. لن تبدأ التجربة المجانية حتى تنشر أول بطاقة ولاء."
          : "Start setting up now. Your free trial will not begin until you publish your first loyalty card."}
      </p>
      {error ? <Alert tone="danger" title={error} /> : null}
      <ExternalAuthRail
        locale={locale}
        registration
        legalAccepted={termsAccepted && privacyAccepted}
      />
      <form className="auth-form" onSubmit={submit}>
        <FormField label={ar ? "الاسم الكامل" : "Full name"} required>
          <TextInput
            name="displayName"
            autoComplete="name"
            minLength={2}
            maxLength={100}
            required
          />
        </FormField>
        <FormField label={ar ? "البريد الإلكتروني" : "Email address"} required>
          <EmailInput name="email" required />
        </FormField>
        <FormField
          label={ar ? "كلمة المرور" : "Password"}
          hint={
            ar
              ? "12 حرفاً على الأقل. يمكنك استخدام مدير كلمات المرور."
              : "At least 12 characters. Password managers are welcome."
          }
          required
        >
          <PasswordInput
            name="password"
            minLength={12}
            maxLength={128}
            autoComplete="new-password"
            required
          />
        </FormField>
        <FormField label={ar ? "تأكيد كلمة المرور" : "Confirm password"} required>
          <PasswordInput
            name="confirmPassword"
            minLength={12}
            maxLength={128}
            autoComplete="new-password"
            required
          />
        </FormField>
        <Checkbox
          name="terms"
          required
          checked={termsAccepted}
          onChange={(event) => setTermsAccepted(event.currentTarget.checked)}
          label={
            ar ? (
              <>
                أوافق على{" "}
                <a
                  href={`${process.env.NEXT_PUBLIC_MARKETING_URL ?? "http://localhost:3000"}/ar/terms`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  شروط الاستخدام
                </a>
                .
              </>
            ) : (
              <>
                I agree to the{" "}
                <a
                  href={`${process.env.NEXT_PUBLIC_MARKETING_URL ?? "http://localhost:3000"}/en/terms`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Terms of Service
                </a>
                .
              </>
            )
          }
        />
        <Checkbox
          name="privacy"
          required
          checked={privacyAccepted}
          onChange={(event) => setPrivacyAccepted(event.currentTarget.checked)}
          label={
            ar ? (
              <>
                قرأت{" "}
                <a
                  href={`${process.env.NEXT_PUBLIC_MARKETING_URL ?? "http://localhost:3000"}/ar/privacy`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  سياسة الخصوصية
                </a>
                .
              </>
            ) : (
              <>
                I have read the{" "}
                <a
                  href={`${process.env.NEXT_PUBLIC_MARKETING_URL ?? "http://localhost:3000"}/en/privacy`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Privacy Policy
                </a>
                .
              </>
            )
          }
        />
        <p className="auth-form__legal-support">
          {ar ? "توضح " : "The "}
          <a
            href={`${process.env.NEXT_PUBLIC_MARKETING_URL ?? "http://localhost:3000"}/${locale}/refunds`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {ar ? "سياسة الفوترة والاسترداد" : "Billing & Refund Policy"}
          </a>{" "}
          {ar
            ? "الفرق بين الإلغاء والتخفيض والاسترداد."
            : "explains cancellation, downgrades, and refund review."}
        </p>
        <Button
          type="submit"
          loading={loading}
          loadingLabel={ar ? "جارٍ إنشاء الحساب…" : "Creating account…"}
        >
          {ar ? "إنشاء الحساب" : "Create account"}
        </Button>
      </form>
      <p className="auth-form__footer">
        {ar ? "لديك حساب؟" : "Already have an account?"}{" "}
        <a href={`/${locale}/login`}>{ar ? "سجّل الدخول" : "Log in"}</a>
      </p>
    </>
  );
}

export function LoginForm({ locale }: { locale: Locale }) {
  const ar = locale === "ar";
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await apiFetch("/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: String(form.get("email") ?? ""),
          password: String(form.get("password") ?? ""),
        }),
      });
      router.push(await destinationAfterLogin(locale));
    } catch (caught) {
      setError(errorMessage(caught, ar ? "تعذر تسجيل الدخول." : "Unable to sign in."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <h2>{ar ? "مرحباً بعودتك" : "Welcome back"}</h2>
      <p className="auth-card__intro">
        {ar
          ? "سجّل الدخول لإدارة مؤسستك وفروعك وفريقك."
          : "Sign in to manage your organization, locations, and team."}
      </p>
      {error ? <Alert tone="danger" title={error} /> : null}
      <ExternalAuthRail locale={locale} />
      <form className="auth-form" onSubmit={submit}>
        <FormField label={ar ? "البريد الإلكتروني" : "Email address"} required>
          <EmailInput name="email" required />
        </FormField>
        <FormField label={ar ? "كلمة المرور" : "Password"} required>
          <PasswordInput name="password" required />
        </FormField>
        <div style={{ textAlign: "end" }}>
          <a className="auth-link" href={`/${locale}/forgot-password`}>
            {ar ? "نسيت كلمة المرور؟" : "Forgot password?"}
          </a>
        </div>
        <Button
          type="submit"
          loading={loading}
          loadingLabel={ar ? "جارٍ تسجيل الدخول…" : "Signing in…"}
        >
          {ar ? "تسجيل الدخول" : "Sign in"}
        </Button>
      </form>
      <p className="auth-form__footer">
        {ar ? "ليس لديك حساب؟" : "New to Waflo?"}{" "}
        <a href={`/${locale}/signup`}>{ar ? "أنشئ حساباً" : "Create an account"}</a>
      </p>
    </>
  );
}

export function VerificationForm({ locale }: { locale: Locale }) {
  const ar = locale === "ar";
  const [state, setState] = useState<"pending" | "verifying" | "verified" | "error">("pending");
  const [message, setMessage] = useState("");
  const [resending, setResending] = useState(false);
  const email =
    typeof window === "undefined" ? "" : (sessionStorage.getItem("waflo:verification-email") ?? "");

  useEffect(() => {
    // Tokens travel in the URL fragment (#token=...) so the browser never
    // sends the raw value to the Next.js server. Any legacy ?token= link is
    // rejected immediately to avoid misleading the user.
    if (typeof window === "undefined") return;

    // Reject legacy query-token links: clear and show invalid state.
    const legacyUrl = new URL(window.location.href);
    if (legacyUrl.searchParams.get("token")) {
      legacyUrl.searchParams.delete("token");
      window.history.replaceState(null, "", `${legacyUrl.pathname}${legacyUrl.search}`);
      setMessage(ar ? "رابط غير صالح أو منتهي." : "This link is invalid or has expired.");
      setState("error");
      return;
    }

    const hash = window.location.hash;
    // Remove the fragment immediately before any async work.
    window.history.replaceState(null, "", window.location.pathname + window.location.search);

    const fragmentToken = hash.startsWith("#token=")
      ? decodeURIComponent(hash.slice("#token=".length))
      : null;
    if (!fragmentToken) return;

    setState("verifying");
    void apiFetch("/v1/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ token: fragmentToken }),
    })
      .then(() => setState("verified"))
      .catch((caught: unknown) => {
        setMessage(
          errorMessage(
            caught,
            ar ? "الرابط غير صالح أو منتهي." : "The link is invalid or expired.",
          ),
        );
        setState("error");
      });
  }, [ar]);

  async function resend() {
    if (!email) return;
    setResending(true);
    try {
      await apiFetch("/v1/auth/resend-verification", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setMessage(
        ar
          ? "أرسلنا رسالة جديدة إذا كان البريد مؤهلاً."
          : "A new email was sent if the address is eligible.",
      );
    } catch (caught) {
      setMessage(errorMessage(caught, ar ? "تعذرت إعادة الإرسال." : "Unable to resend."));
    } finally {
      setResending(false);
    }
  }

  if (state === "verified") {
    return (
      <>
        <Alert tone="success" title={ar ? "تم تأكيد بريدك" : "Email verified"}>
          {ar
            ? "يمكنك الآن تسجيل الدخول وإكمال إعداد مؤسستك."
            : "You can now sign in and complete your organization setup."}
        </Alert>
        <a href={`/${locale}/login`}>
          <Button style={{ width: "100%", marginTop: "1rem" }}>
            {ar ? "متابعة إلى تسجيل الدخول" : "Continue to sign in"}
          </Button>
        </a>
      </>
    );
  }
  return (
    <>
      <h2>
        {state === "verifying"
          ? ar
            ? "جارٍ تأكيد البريد…"
            : "Verifying your email…"
          : ar
            ? "تحقق من بريدك"
            : "Check your email"}
      </h2>
      <p className="auth-card__intro">
        {ar
          ? "أرسلنا رابطاً آمناً لتأكيد البريد. يجب إتمام هذه الخطوة قبل إعداد المؤسسة."
          : "We sent a secure verification link. Complete this step before organization setup."}
      </p>
      {state === "error" ? <Alert tone="danger" title={message} /> : null}
      {message && state !== "error" ? <Alert tone="success" title={message} /> : null}
      {state === "pending" ? (
        <Button variant="secondary" onClick={resend} loading={resending} disabled={!email}>
          {ar ? "إعادة إرسال الرسالة" : "Resend verification email"}
        </Button>
      ) : null}
      <p className="auth-form__footer">
        {ar
          ? "في بيئة التطوير، افتح Mailpit على localhost:8025."
          : "In local development, open Mailpit at localhost:8025."}
      </p>
    </>
  );
}

export function ForgotPasswordForm({ locale }: { locale: Locale }) {
  const ar = locale === "ar";
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await apiFetch("/v1/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: String(form.get("email") ?? "") }),
      });
      setMessage(
        ar
          ? "إذا كان الحساب موجوداً، أرسلنا تعليمات إعادة التعيين."
          : "If the account exists, reset instructions have been sent.",
      );
    } catch (caught) {
      setError(errorMessage(caught, ar ? "تعذر إرسال الطلب." : "Unable to submit the request."));
    } finally {
      setLoading(false);
    }
  }
  return (
    <>
      <h2>{ar ? "إعادة تعيين كلمة المرور" : "Reset your password"}</h2>
      <p className="auth-card__intro">
        {ar
          ? "أدخل بريدك وسنرسل تعليمات آمنة إذا كان الحساب موجوداً."
          : "Enter your email and we’ll send secure instructions if the account exists."}
      </p>
      {message ? <Alert tone="success" title={message} /> : null}
      {error ? <Alert tone="danger" title={error} /> : null}
      <form className="auth-form" onSubmit={submit}>
        <FormField label={ar ? "البريد الإلكتروني" : "Email address"} required>
          <EmailInput name="email" required />
        </FormField>
        <Button type="submit" loading={loading}>
          {ar ? "إرسال التعليمات" : "Send instructions"}
        </Button>
      </form>
      <p className="auth-form__footer">
        <a href={`/${locale}/login`}>{ar ? "العودة إلى تسجيل الدخول" : "Back to sign in"}</a>
      </p>
    </>
  );
}

export function ResetPasswordForm({ locale }: { locale: Locale }) {
  const ar = locale === "ar";
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    // Tokens travel in the URL fragment (#token=...) so the browser never
    // sends the raw value to the Next.js server. Reject legacy ?token= links.
    if (typeof window === "undefined") return;

    // Reject legacy query-token links.
    const legacyUrl = new URL(window.location.href);
    if (legacyUrl.searchParams.get("token")) {
      legacyUrl.searchParams.delete("token");
      window.history.replaceState(null, "", `${legacyUrl.pathname}${legacyUrl.search}`);
      setError(ar ? "رابط غير صالح أو منتهي." : "This link is invalid or has expired.");
      return;
    }

    const hash = window.location.hash;
    // Remove the fragment immediately before any async work.
    window.history.replaceState(null, "", window.location.pathname + window.location.search);

    const fragmentToken = hash.startsWith("#token=")
      ? decodeURIComponent(hash.slice("#token=".length))
      : "";
    setToken(fragmentToken);
  }, [ar]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      setError(ar ? "رابط إعادة التعيين غير صالح." : "The reset link is invalid.");
      return;
    }
    setLoading(true);
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password !== String(form.get("confirmPassword") ?? "")) {
      setError(ar ? "كلمتا المرور غير متطابقتين." : "Passwords do not match.");
      setLoading(false);
      return;
    }
    try {
      await apiFetch("/v1/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, password }),
      });
      resetCsrf();
      setComplete(true);
    } catch (caught) {
      setError(errorMessage(caught, ar ? "تعذر تغيير كلمة المرور." : "Unable to reset password."));
    } finally {
      setLoading(false);
    }
  }
  if (complete) {
    return (
      <>
        <Alert tone="success" title={ar ? "تم تغيير كلمة المرور" : "Password changed"} />
        <a href={`/${locale}/login`}>
          <Button style={{ width: "100%", marginTop: "1rem" }}>
            {ar ? "تسجيل الدخول" : "Sign in"}
          </Button>
        </a>
      </>
    );
  }
  return (
    <>
      <h2>{ar ? "اختر كلمة مرور جديدة" : "Choose a new password"}</h2>
      <p className="auth-card__intro">
        {ar
          ? "سيتم إنهاء الجلسات الحالية بعد نجاح إعادة التعيين."
          : "Existing sessions will be revoked after a successful reset."}
      </p>
      {error ? <Alert tone="danger" title={error} /> : null}
      <form className="auth-form" onSubmit={submit}>
        <FormField label={ar ? "كلمة المرور الجديدة" : "New password"} required>
          <PasswordInput
            name="password"
            minLength={12}
            maxLength={128}
            autoComplete="new-password"
            required
          />
        </FormField>
        <FormField label={ar ? "تأكيد كلمة المرور" : "Confirm password"} required>
          <PasswordInput
            name="confirmPassword"
            minLength={12}
            maxLength={128}
            autoComplete="new-password"
            required
          />
        </FormField>
        <Button type="submit" loading={loading}>
          {ar ? "حفظ كلمة المرور" : "Save password"}
        </Button>
      </form>
    </>
  );
}

export function LoggedOutState({ locale, expired = false }: { locale: Locale; expired?: boolean }) {
  const ar = locale === "ar";
  return (
    <>
      <Alert
        tone={expired ? "warning" : "success"}
        title={
          expired
            ? ar
              ? "انتهت جلستك"
              : "Your session expired"
            : ar
              ? "تم تسجيل الخروج"
              : "You’re signed out"
        }
      >
        {expired
          ? ar
            ? "سجّل الدخول مجدداً لمتابعة العمل بأمان."
            : "Sign in again to continue securely."
          : ar
            ? "تم إنهاء الجلسة بأمان."
            : "Your session ended securely."}
      </Alert>
      <a href={`/${locale}/login`}>
        <Button style={{ width: "100%", marginTop: "1rem" }}>
          {ar ? "تسجيل الدخول" : "Sign in"}
        </Button>
      </a>
    </>
  );
}
