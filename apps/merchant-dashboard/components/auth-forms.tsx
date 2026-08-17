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
import { CheckCircle2, Mail } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { apiFetch, ApiClientError, apiUrl, resetCsrf } from "../lib/api-client";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiClientError ? error.message : fallback;
}

interface MeResponse {
  lastSelectedOrganizationId: string | null;
  accountState: {
    email: "unverified" | "verified";
    onboarding:
      | "business_required"
      | "location_required"
      | "billing_identity_required"
      | "payment_method_required"
      | "trial_confirmation_required"
      | "complete";
    billing:
      | "none"
      | "trialing"
      | "active"
      | "past_due_grace"
      | "action_required"
      | "restricted"
      | "canceled"
      | "paused";
    access: "onboarding_only" | "full" | "read_only_billing_recovery";
    organizationId: string | null;
  } | null;
  memberships: {
    organization: { id: string; onboardingState: "BUSINESS" | "LOCATION" | "COMPLETE" };
  }[];
}

export async function destinationAfterLogin(locale: Locale): Promise<string> {
  const me = await apiFetch<MeResponse>("/v1/auth/me");
  if (me.accountState?.email === "unverified") return `/${locale}/verify-email`;
  if (me.memberships.length === 0) return `/${locale}/onboarding/business`;
  const membership =
    me.memberships.find((item) => item.organization.id === me.lastSelectedOrganizationId) ??
    me.memberships[0];
  if (!membership) return `/${locale}/onboarding/business`;
  if (me.accountState && me.accountState.onboarding !== "complete") {
    const query = new URLSearchParams({
      organization: membership.organization.id,
      resume: me.accountState.onboarding,
    });
    return `/${locale}/onboarding/business?${query.toString()}`;
  }
  return `/${locale}/dashboard`;
}

interface ExternalCapabilities {
  googleSignInAvailable: boolean;
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 18 18" width="18" height="18">
      <path
        fill="#4285F4"
        d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.482h4.844a4.14 4.14 0 0 1-1.797 2.716v2.259h2.909c1.702-1.567 2.684-3.875 2.684-6.616Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.468-.806 5.956-2.179l-2.909-2.259c-.806.54-1.835.859-3.047.859-2.344 0-4.328-1.585-5.037-3.714H.956v2.332A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.963 10.707A5.41 5.41 0 0 1 3.681 9c0-.593.102-1.17.282-1.707V4.961H.956A9 9 0 0 0 0 9c0 1.452.347 2.827.956 4.039l3.007-2.332Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.579c1.321 0 2.507.454 3.44 1.346l2.582-2.582C13.464.892 11.427 0 9 0A9 9 0 0 0 .956 4.961l3.007 2.332C4.672 5.164 6.656 3.579 9 3.579Z"
      />
    </svg>
  );
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
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    void apiFetch<ExternalCapabilities>("/v1/auth/external/providers")
      .then(setCapabilities)
      .catch(() => setCapabilities({ googleSignInAvailable: false }));
  }, []);
  if (capabilities?.googleSignInAvailable !== true) return null;

  async function startGoogleSignup() {
    if (!registration || !legalAccepted || working) return;
    setWorking(true);
    setError("");
    try {
      const result = await apiFetch<{ authorizationUrl: string }>(
        "/v1/auth/external/google/signup",
        {
          method: "POST",
          body: JSON.stringify({
            locale,
            termsAccepted: true,
            privacyAccepted: true,
          }),
        },
      );
      window.location.assign(result.authorizationUrl);
    } catch (caught) {
      setError(
        errorMessage(
          caught,
          ar ? "تعذر بدء التسجيل باستخدام Google." : "Unable to start Google signup.",
        ),
      );
      setWorking(false);
    }
  }

  const label = registration
    ? ar
      ? "المتابعة باستخدام Google"
      : "Continue with Google"
    : ar
      ? "تسجيل الدخول باستخدام Google"
      : "Sign in with Google";
  return (
    <fieldset className="external-auth">
      <legend className="external-auth__legend">
        {ar ? "خيارات تسجيل الدخول" : "Sign-in options"}
      </legend>
      <div className="external-auth__providers">
        {registration ? (
          <button
            className="external-auth__button"
            disabled={!legalAccepted || working}
            type="button"
            aria-busy={working}
            onClick={() => void startGoogleSignup()}
          >
            <span className="external-auth__mark external-auth__mark--google">
              <GoogleMark />
            </span>
            {working ? (ar ? "جارٍ المتابعة…" : "Continuing…") : label}
          </button>
        ) : (
          <a
            className="external-auth__button"
            href={`${apiUrl}/v1/auth/external/google/start?${new URLSearchParams({ locale }).toString()}`}
          >
            <span className="external-auth__mark external-auth__mark--google">
              <GoogleMark />
            </span>
            {label}
          </a>
        )}
      </div>
      {error ? (
        <p className="external-auth__error" role="alert">
          {error}
        </p>
      ) : null}
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
  const [verificationRecoveryAvailable, setVerificationRecoveryAvailable] = useState(false);

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
      const email = String(form.get("email") ?? "");
      await apiFetch("/v1/auth/register", {
        method: "POST",
        body: JSON.stringify({
          displayName: String(form.get("displayName") ?? ""),
          email,
          password,
          locale,
          termsAccepted: form.get("terms") === "on",
          privacyAccepted: form.get("privacy") === "on",
        }),
      });
      sessionStorage.setItem("waflo:verification-email", email);
      sessionStorage.setItem("waflo:verification-delivery-accepted", "true");
      router.push(`/${locale}/verify-email`);
    } catch (caught) {
      if (caught instanceof ApiClientError && caught.code === "EMAIL_DELIVERY_UNAVAILABLE") {
        sessionStorage.setItem("waflo:verification-email", String(form.get("email") ?? ""));
        sessionStorage.removeItem("waflo:verification-delivery-accepted");
        setVerificationRecoveryAvailable(true);
      }
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
          ? "أنشئ حسابك، ثم اختر باقتك وابدأ 7 أيام مجاناً بعد إضافة طريقة الدفع."
          : "Create your account, choose a plan, and start 7 days free after adding a payment method."}
      </p>
      {error ? <Alert tone="danger" title={error} /> : null}
      {verificationRecoveryAvailable ? (
        <Link className="auth-link" href={`/${locale}/verify-email`}>
          {ar ? "حاول إرسال رسالة التأكيد مرة أخرى" : "Try sending the verification email again"}
        </Link>
      ) : null}
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
                  href={`${process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://waflo.app"}/ar/terms`}
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
                  href={`${process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://waflo.app"}/en/terms`}
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
                  href={`${process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://waflo.app"}/ar/privacy`}
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
                  href={`${process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://waflo.app"}/en/privacy`}
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
            href={`${process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://waflo.app"}/${locale}/refunds`}
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
        <Link href={`/${locale}/login`}>{ar ? "سجّل الدخول" : "Log in"}</Link>
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
      if (caught instanceof ApiClientError && caught.code === "EMAIL_VERIFICATION_REQUIRED") {
        sessionStorage.setItem("waflo:verification-email", String(form.get("email") ?? ""));
        sessionStorage.removeItem("waflo:verification-delivery-accepted");
        router.replace(`/${locale}/verify-email`);
        return;
      }
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
  const router = useRouter();
  const ar = locale === "ar";
  const [state, setState] = useState<"pending" | "verifying" | "verified" | "error">("pending");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "danger">("success");
  const [resending, setResending] = useState(false);
  const [email, setEmail] = useState("");
  const [deliveryAccepted, setDeliveryAccepted] = useState(false);

  useEffect(() => {
    setEmail(sessionStorage.getItem("waflo:verification-email") ?? "");
    setDeliveryAccepted(sessionStorage.getItem("waflo:verification-delivery-accepted") === "true");
  }, []);

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
    if (!email) {
      router.push(`/${locale}/login`);
      return;
    }
    setResending(true);
    try {
      await apiFetch("/v1/auth/resend-verification", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setMessage(
        ar
          ? "إذا كان العنوان مؤهلاً، فقد قُبل طلب إرسال رسالة تأكيد جديدة."
          : "If the address is eligible, the verification request was accepted.",
      );
      setMessageTone("success");
    } catch (caught) {
      setMessage(errorMessage(caught, ar ? "تعذرت إعادة الإرسال." : "Unable to resend."));
      setMessageTone("danger");
    } finally {
      setResending(false);
    }
  }

  if (state === "verified") {
    return (
      <div className="auth-verify-state">
        <div className="auth-verify__icon-box auth-verify__icon-box--success">
          <CheckCircle2 size={28} aria-hidden="true" />
        </div>
        <h2>{ar ? "تم تأكيد بريدك" : "Email verified"}</h2>
        <p className="auth-card__intro">
          {ar
            ? "يمكنك الآن تسجيل الدخول وإكمال إعداد مؤسستك."
            : "You can now sign in and complete your organization setup."}
        </p>
        <Link
          className="wf-button wf-button--primary auth-primary-action"
          href={`/${locale}/login`}
        >
          {ar ? "متابعة إلى تسجيل الدخول" : "Continue to sign in"}
        </Link>
      </div>
    );
  }
  return (
    <div className="auth-verify-state">
      <div className="auth-verify__icon-box">
        <Mail size={28} aria-hidden="true" />
      </div>
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
          ? "أكّد بريدك الإلكتروني للمتابعة إلى إعداد مؤسستك."
          : "Verify your email to continue setting up your business."}
      </p>
      {deliveryAccepted && email ? (
        <div className="auth-verify__recipient">
          <span>{ar ? "أرسلنا رسالة التأكيد إلى:" : "Verification email sent to:"}</span>
          <strong dir="ltr">{email.replace(/^(.{2}).*(@.*)$/, "$1•••$2")}</strong>
        </div>
      ) : null}
      {state === "error" ? <Alert tone="danger" title={message} /> : null}
      {message && state !== "error" ? <Alert tone={messageTone} title={message} /> : null}
      {state === "pending" ? (
        <div className="auth-verify__actions">
          <Button
            className="wf-button wf-button--primary auth-primary-action auth-verify__action"
            variant="primary"
            onClick={() => void resend()}
            loading={resending}
          >
            {ar ? "إعادة إرسال الرسالة" : "Resend verification email"}
          </Button>
          <Link className="auth-link auth-verify__back-link" href={`/${locale}/login`}>
            {ar ? "العودة إلى تسجيل الدخول" : "Back to sign in"}
          </Link>
        </div>
      ) : null}
      <p className="auth-form__footer auth-verify__help">
        {ar
          ? "لم تصلك الرسالة؟ تحقّق من مجلد الرسائل غير المرغوب فيها."
          : "Didn’t receive it? Check your spam or junk folder."}
      </p>
    </div>
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
        <Link
          className="wf-button wf-button--primary auth-primary-action"
          href={`/${locale}/login`}
        >
          {ar ? "تسجيل الدخول" : "Sign in"}
        </Link>
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
      <Link className="wf-button wf-button--primary auth-primary-action" href={`/${locale}/login`}>
        {ar ? "تسجيل الدخول" : "Sign in"}
      </Link>
    </>
  );
}
