"use client";

import { type InterfaceLocale, isInterfaceLocale, messages } from "@waflo/i18n";
import { Alert } from "@waflo/ui";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { destinationAfterLogin } from "../../../../components/auth-forms";
import { AuthLayout } from "../../../../components/auth-layout";
import {
  oauthInterfaceLocaleKey,
  oauthReturnPathKey,
  safeOAuthReturnPath,
} from "../../../../lib/oauth-reauthentication";

export default function OAuthCallbackPage() {
  const params = useParams<{ locale: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const routeLocale: InterfaceLocale = isInterfaceLocale(params.locale) ? params.locale : "en";
  const initialResult = search.get("result");
  const [result, setResult] = useState(initialResult ?? "failed");
  const [interfaceLocale, setInterfaceLocale] = useState<InterfaceLocale | null>(null);

  useEffect(() => {
    const storedLocale = sessionStorage.getItem(oauthInterfaceLocaleKey) ?? "";
    if (isInterfaceLocale(storedLocale) && storedLocale !== routeLocale) {
      const query = initialResult ? `?result=${encodeURIComponent(initialResult)}` : "";
      router.replace(`/${storedLocale}/oauth/callback${query}`);
      return;
    }
    sessionStorage.removeItem(oauthInterfaceLocaleKey);
    setInterfaceLocale(routeLocale);
  }, [initialResult, routeLocale, router]);

  useEffect(() => {
    if (!interfaceLocale || search.get("result") !== "authenticated") return;
    window.history.replaceState(null, "", `/${interfaceLocale}/oauth/callback`);
    const returnPath = safeOAuthReturnPath(
      sessionStorage.getItem(oauthReturnPathKey),
      interfaceLocale,
    );
    sessionStorage.removeItem(oauthReturnPathKey);
    if (returnPath) {
      router.replace(returnPath);
      return;
    }
    void destinationAfterLogin(interfaceLocale)
      .then((destination) => router.replace(destination))
      .catch(() => setResult("failed"));
  }, [interfaceLocale, router, search]);

  useEffect(() => {
    if (!interfaceLocale || result === "authenticated") return;
    sessionStorage.removeItem(oauthReturnPathKey);
  }, [interfaceLocale, result]);

  if (!interfaceLocale) return null;
  const copy = messages[interfaceLocale].auth;

  if (result !== "authenticated") {
    const noAccount = result === "no_account";
    const actionRequired = result === "action_required";
    const expired = result === "expired";
    const unavailable = result === "unavailable";
    const title = noAccount
      ? copy.oauth.noAccountTitle
      : actionRequired
        ? copy.oauth.actionRequiredTitle
        : expired
          ? copy.oauth.expiredTitle
          : unavailable
            ? copy.oauth.unavailableTitle
            : copy.oauth.failedTitle;
    const description = noAccount
      ? copy.oauth.noAccountDescription
      : actionRequired
        ? copy.oauth.actionRequiredDescription
        : expired
          ? copy.oauth.expiredDescription
          : unavailable
            ? copy.oauth.unavailableDescription
            : copy.oauth.failedDescription;
    return (
      <AuthLayout locale={interfaceLocale} routePath="/oauth/callback">
        <Alert tone={noAccount || actionRequired || expired ? "info" : "danger"} title={title}>
          {description}
        </Alert>
        <Link
          className="wf-button wf-button--primary auth-oauth-action"
          href={noAccount ? `/${interfaceLocale}/signup` : `/${interfaceLocale}/login`}
        >
          {noAccount ? copy.oauth.createAccount : copy.common.backToSignIn}
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout locale={interfaceLocale} routePath="/oauth/callback">
      <h2>{copy.oauth.securingTitle}</h2>
      <p className="auth-card__intro">{copy.oauth.securingDescription}</p>
    </AuthLayout>
  );
}
