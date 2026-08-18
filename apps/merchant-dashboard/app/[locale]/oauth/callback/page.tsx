"use client";

import type { Locale } from "@waflo/contracts";
import { isInterfaceLocale } from "@waflo/i18n";
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
  const interfaceLocale = isInterfaceLocale(params.locale) ? params.locale : "en";
  const locale: Locale = interfaceLocale === "ar" ? "ar" : "en";
  const ar = locale === "ar";
  const initialResult = search.get("result");
  const [result, setResult] = useState(initialResult ?? "failed");

  useEffect(() => {
    if (search.get("result") !== "authenticated") return;
    window.history.replaceState(null, "", `/${interfaceLocale}/oauth/callback`);
    void destinationAfterLogin(locale)
      .then((destination) =>
        router.replace(destination.replace(/^\/(?:en|ar)(?=\/|$)/, `/${interfaceLocale}`)),
      )
      .catch(() => setResult("failed"));
  }, [locale, router, search]);

  if (result !== "authenticated") {
    const noAccount = result === "no_account";
    return (
      <AuthLayout locale={locale} interfaceLocale={interfaceLocale} routePath="/oauth/callback">
        <Alert
          tone={noAccount ? "info" : "danger"}
          title={
            noAccount
              ? ar
                ? "لا يوجد حساب Waflo مرتبط"
                : "No Waflo account found"
              : ar
                ? "تعذر إكمال تسجيل الدخول"
                : "Sign-in could not be completed"
          }
        >
          {noAccount
            ? ar
              ? "أنشئ حساباً أولاً، ثم يمكنك استخدام حساب Google هذا لتسجيل الدخول."
              : "Create an account first, then you can use this Google account to sign in."
            : ar
              ? "استخدم طريقة تسجيل دخول أخرى أو تواصل مع الدعم إذا استمرت المشكلة."
              : "Use another sign-in method, or contact support if this continues."}
        </Alert>
        <Link
          className="wf-button wf-button--primary auth-oauth-action"
          href={noAccount ? `/${interfaceLocale}/signup` : `/${interfaceLocale}/login`}
        >
          {noAccount
            ? ar
              ? "إنشاء حساب"
              : "Create account"
            : ar
              ? "العودة إلى تسجيل الدخول"
              : "Back to sign in"}
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout locale={locale} interfaceLocale={interfaceLocale} routePath="/oauth/callback">
      <h2>{ar ? "جارٍ تأمين جلستك…" : "Securing your session…"}</h2>
      <p className="auth-card__intro">
        {ar ? "لحظة واحدة بينما نفتح مساحة عملك." : "One moment while we open your workspace."}
      </p>
    </AuthLayout>
  );
}
