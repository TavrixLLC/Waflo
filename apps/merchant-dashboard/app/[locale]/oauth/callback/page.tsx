"use client";

import { isInterfaceLocale, messages, type InterfaceLocale } from "@waflo/i18n";
import { Alert } from "@waflo/ui";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { destinationAfterLogin } from "../../../../components/auth-forms";
import { AuthLayout } from "../../../../components/auth-layout";

export default function OAuthCallbackPage() {
  const params = useParams<{ locale: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const routeLocale: InterfaceLocale = isInterfaceLocale(params.locale) ? params.locale : "en";
  const initialResult = search.get("result");
  const [result, setResult] = useState(initialResult ?? "failed");
  const [interfaceLocale, setInterfaceLocale] = useState<InterfaceLocale | null>(null);

  useEffect(() => {
    const storedLocale = sessionStorage.getItem("waflo:oauth-interface-locale") ?? "";
    if (isInterfaceLocale(storedLocale) && storedLocale !== routeLocale) {
      const query = initialResult ? `?result=${encodeURIComponent(initialResult)}` : "";
      router.replace(`/${storedLocale}/oauth/callback${query}`);
      return;
    }
    sessionStorage.removeItem("waflo:oauth-interface-locale");
    setInterfaceLocale(routeLocale);
  }, [initialResult, routeLocale, router]);

  useEffect(() => {
    if (!interfaceLocale || search.get("result") !== "authenticated") return;
    window.history.replaceState(null, "", `/${interfaceLocale}/oauth/callback`);
    void destinationAfterLogin(interfaceLocale)
      .then((destination) => router.replace(destination))
      .catch(() => setResult("failed"));
  }, [interfaceLocale, router, search]);

  if (!interfaceLocale) return null;
  const copy = messages[interfaceLocale].auth;

  if (result !== "authenticated") {
    const noAccount = result === "no_account";
    return (
      <AuthLayout locale={interfaceLocale} routePath="/oauth/callback">
        <Alert
          tone={noAccount ? "info" : "danger"}
          title={noAccount ? copy.oauth.noAccountTitle : copy.oauth.failedTitle}
        >
          {noAccount ? copy.oauth.noAccountDescription : copy.oauth.failedDescription}
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
