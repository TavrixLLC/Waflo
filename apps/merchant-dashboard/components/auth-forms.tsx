"use client";

import {
  contentLocaleForInterface,
  messages,
  type InterfaceLocale,
  type InterfaceMessages,
} from "@waflo/i18n";
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

type AuthCopy = InterfaceMessages["auth"];

const authErrorKeys = {
  NETWORK_ERROR: "network",
  RATE_LIMITED: "rateLimited",
  ACCOUNT_NOT_CREATED: "accountNotCreated",
  AUTHENTICATION_FAILED: "invalidCredentials",
  INVALID_CREDENTIALS: "invalidCredentials",
  EMAIL_DELIVERY_UNAVAILABLE: "deliveryUnavailable",
  EMAIL_VERIFICATION_REQUIRED: "verificationRequired",
  VERIFICATION_LINK_INVALID: "verificationInvalid",
  RESET_LINK_INVALID: "resetInvalid",
  LEGAL_ACCEPTANCE_REQUIRED: "legalRequired",
  EXTERNAL_AUTH_FAILED: "externalFailed",
  EXTERNAL_AUTH_INVALID: "externalFailed",
  EXTERNAL_AUTH_ACTION_REQUIRED: "externalFailed",
  INVITATION_UNAVAILABLE: "invitationUnavailable",
  INVITATION_CANCELED: "invitationUnavailable",
  INVITATION_NOT_FOUND: "invitationUnavailable",
  INVITATION_EXPIRED: "invitationExpired",
  INVITATION_ALREADY_ACCEPTED: "invitationAccepted",
  INVITATION_EMAIL_MISMATCH: "invitationEmailMismatch",
} as const satisfies Record<string, keyof AuthCopy["apiErrors"]>;

function errorMessage(error: unknown, copy: AuthCopy, fallback: string): string {
  if (!(error instanceof ApiClientError)) return fallback;
  const key = authErrorKeys[error.code as keyof typeof authErrorKeys];
  return key ? copy.apiErrors[key] : copy.apiErrors.generic;
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

export async function destinationAfterLogin(locale: InterfaceLocale): Promise<string> {
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
  locale: InterfaceLocale;
  registration?: boolean;
  legalAccepted?: boolean;
}) {
  const copy = messages[locale].auth;
  const contentLocale = contentLocaleForInterface(locale);
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
            locale: contentLocale,
            termsAccepted: true,
            privacyAccepted: true,
          }),
        },
      );
      sessionStorage.setItem("waflo:oauth-interface-locale", locale);
      window.location.assign(result.authorizationUrl);
    } catch (caught) {
      setError(errorMessage(caught, copy, copy.external.signupError));
      setWorking(false);
    }
  }

  const label = registration ? copy.external.continueWithGoogle : copy.external.signInWithGoogle;
  return (
    <fieldset className="external-auth">
      <legend className="external-auth__legend">{copy.external.options}</legend>
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
            {working ? copy.external.continuing : label}
          </button>
        ) : (
          <a
            className="external-auth__button"
            href={`${apiUrl}/v1/auth/external/google/start?${new URLSearchParams({ locale: contentLocale }).toString()}`}
            onClick={() => sessionStorage.setItem("waflo:oauth-interface-locale", locale)}
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
        <p className="external-auth__hint">{copy.external.acceptLegal}</p>
      ) : null}
      <div className="external-auth__separator">
        <span>{copy.external.separator}</span>
      </div>
    </fieldset>
  );
}

export function SignupForm({ locale }: { locale: InterfaceLocale }) {
  const copy = messages[locale].auth;
  const contentLocale = contentLocaleForInterface(locale);
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
      setError(copy.signup.passwordsDoNotMatch);
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
          locale: contentLocale,
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
      setError(errorMessage(caught, copy, copy.signup.createError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <h2>{copy.signup.title}</h2>
      <p className="auth-card__intro">{copy.signup.intro}</p>
      {error ? <Alert tone="danger" title={error} /> : null}
      {verificationRecoveryAvailable ? (
        <Link className="auth-link" href={`/${locale}/verify-email`}>
          {copy.signup.verificationRecovery}
        </Link>
      ) : null}
      <ExternalAuthRail
        locale={locale}
        registration
        legalAccepted={termsAccepted && privacyAccepted}
      />
      <form className="auth-form" onSubmit={submit}>
        <FormField label={copy.common.fullName} required>
          <TextInput
            name="displayName"
            autoComplete="name"
            minLength={2}
            maxLength={100}
            required
          />
        </FormField>
        <FormField label={copy.common.emailAddress} required>
          <EmailInput name="email" required />
        </FormField>
        <FormField label={copy.common.password} hint={copy.signup.passwordHint} required>
          <PasswordInput
            name="password"
            minLength={12}
            maxLength={128}
            autoComplete="new-password"
            required
          />
        </FormField>
        <FormField label={copy.common.confirmPassword} required>
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
            <a
              href={`${process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://waflo.app"}/${contentLocale}/terms`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {copy.signup.termsAgreement}
            </a>
          }
        />
        <Checkbox
          name="privacy"
          required
          checked={privacyAccepted}
          onChange={(event) => setPrivacyAccepted(event.currentTarget.checked)}
          label={
            <a
              href={`${process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://waflo.app"}/${contentLocale}/privacy`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {copy.signup.privacyAgreement}
            </a>
          }
        />
        <p className="auth-form__legal-support">
          <a
            href={`${process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://waflo.app"}/${contentLocale}/refunds`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {copy.signup.refundPolicy}
          </a>{" "}
          <span>{copy.signup.refundExplanation}</span>
        </p>
        <Button type="submit" loading={loading} loadingLabel={copy.signup.creating}>
          {copy.signup.create}
        </Button>
      </form>
      <p className="auth-form__footer">
        {copy.signup.existingAccount} <Link href={`/${locale}/login`}>{copy.signup.logIn}</Link>
      </p>
    </>
  );
}

export function LoginForm({ locale }: { locale: InterfaceLocale }) {
  const copy = messages[locale].auth;
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
      setError(errorMessage(caught, copy, copy.login.error));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <h2>{copy.login.title}</h2>
      <p className="auth-card__intro">{copy.login.intro}</p>
      {error ? <Alert tone="danger" title={error} /> : null}
      <ExternalAuthRail locale={locale} />
      <form className="auth-form" onSubmit={submit}>
        <FormField label={copy.common.emailAddress} required>
          <EmailInput name="email" required />
        </FormField>
        <FormField label={copy.common.password} required>
          <PasswordInput name="password" required />
        </FormField>
        <div style={{ textAlign: "end" }}>
          <a className="auth-link" href={`/${locale}/forgot-password`}>
            {copy.login.forgotPassword}
          </a>
        </div>
        <Button type="submit" loading={loading} loadingLabel={copy.login.signingIn}>
          {copy.common.signIn}
        </Button>
      </form>
      <p className="auth-form__footer">
        {copy.login.newToWaflo} <a href={`/${locale}/signup`}>{copy.login.createAccount}</a>
      </p>
    </>
  );
}

export function VerificationForm({ locale }: { locale: InterfaceLocale }) {
  const router = useRouter();
  const copy = messages[locale].auth;
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
      setMessage(copy.verification.invalidOrExpired);
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
        setMessage(errorMessage(caught, copy, copy.verification.invalidOrExpiredShort));
        setState("error");
      });
  }, [copy]);

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
      setMessage(copy.verification.accepted);
      setMessageTone("success");
    } catch (caught) {
      setMessage(errorMessage(caught, copy, copy.verification.resendError));
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
        <h2>{copy.verification.verifiedTitle}</h2>
        <p className="auth-card__intro">{copy.verification.verifiedIntro}</p>
        <Link
          className="wf-button wf-button--primary auth-primary-action"
          href={`/${locale}/login`}
        >
          {copy.verification.continueToSignIn}
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
        {state === "verifying" ? copy.verification.verifyingTitle : copy.verification.checkTitle}
      </h2>
      <p className="auth-card__intro">{copy.verification.intro}</p>
      {deliveryAccepted && email ? (
        <div className="auth-verify__recipient">
          <span>{copy.verification.sentTo}</span>
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
            {copy.verification.resend}
          </Button>
          <Link className="auth-link auth-verify__back-link" href={`/${locale}/login`}>
            {copy.common.backToSignIn}
          </Link>
        </div>
      ) : null}
      <p className="auth-form__footer auth-verify__help">{copy.verification.help}</p>
    </div>
  );
}

export function ForgotPasswordForm({ locale }: { locale: InterfaceLocale }) {
  const copy = messages[locale].auth;
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
      setMessage(copy.forgotPassword.accepted);
    } catch (caught) {
      setError(errorMessage(caught, copy, copy.forgotPassword.error));
    } finally {
      setLoading(false);
    }
  }
  return (
    <>
      <h2>{copy.forgotPassword.title}</h2>
      <p className="auth-card__intro">{copy.forgotPassword.intro}</p>
      {message ? <Alert tone="success" title={message} /> : null}
      {error ? <Alert tone="danger" title={error} /> : null}
      <form className="auth-form" onSubmit={submit}>
        <FormField label={copy.common.emailAddress} required>
          <EmailInput name="email" required />
        </FormField>
        <Button type="submit" loading={loading}>
          {copy.forgotPassword.send}
        </Button>
      </form>
      <p className="auth-form__footer">
        <a href={`/${locale}/login`}>{copy.common.backToSignIn}</a>
      </p>
    </>
  );
}

export function ResetPasswordForm({ locale }: { locale: InterfaceLocale }) {
  const copy = messages[locale].auth;
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
      setError(copy.resetPassword.invalidOrExpired);
      return;
    }

    const hash = window.location.hash;
    // Remove the fragment immediately before any async work.
    window.history.replaceState(null, "", window.location.pathname + window.location.search);

    const fragmentToken = hash.startsWith("#token=")
      ? decodeURIComponent(hash.slice("#token=".length))
      : "";
    setToken(fragmentToken);
  }, [copy]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      setError(copy.resetPassword.invalid);
      return;
    }
    setLoading(true);
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password !== String(form.get("confirmPassword") ?? "")) {
      setError(copy.signup.passwordsDoNotMatch);
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
      setError(errorMessage(caught, copy, copy.resetPassword.error));
    } finally {
      setLoading(false);
    }
  }
  if (complete) {
    return (
      <>
        <Alert tone="success" title={copy.resetPassword.changed} />
        <Link
          className="wf-button wf-button--primary auth-primary-action"
          href={`/${locale}/login`}
        >
          {copy.common.signIn}
        </Link>
      </>
    );
  }
  return (
    <>
      <h2>{copy.resetPassword.title}</h2>
      <p className="auth-card__intro">{copy.resetPassword.intro}</p>
      {error ? <Alert tone="danger" title={error} /> : null}
      <form className="auth-form" onSubmit={submit}>
        <FormField label={copy.resetPassword.newPassword} required>
          <PasswordInput
            name="password"
            minLength={12}
            maxLength={128}
            autoComplete="new-password"
            required
          />
        </FormField>
        <FormField label={copy.common.confirmPassword} required>
          <PasswordInput
            name="confirmPassword"
            minLength={12}
            maxLength={128}
            autoComplete="new-password"
            required
          />
        </FormField>
        <Button type="submit" loading={loading}>
          {copy.resetPassword.save}
        </Button>
      </form>
    </>
  );
}

export function LoggedOutState({
  locale,
  expired = false,
}: {
  locale: InterfaceLocale;
  expired?: boolean;
}) {
  const copy = messages[locale].auth;
  return (
    <>
      <Alert
        tone={expired ? "warning" : "success"}
        title={expired ? copy.loggedOut.expiredTitle : copy.loggedOut.signedOutTitle}
      >
        {expired ? copy.loggedOut.expiredDescription : copy.loggedOut.signedOutDescription}
      </Alert>
      <Link className="wf-button wf-button--primary auth-primary-action" href={`/${locale}/login`}>
        {copy.common.signIn}
      </Link>
    </>
  );
}
