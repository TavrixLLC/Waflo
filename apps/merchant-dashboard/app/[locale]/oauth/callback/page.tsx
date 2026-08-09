"use client";

import type { Locale } from "@waflo/contracts";
import { Alert, Button } from "@waflo/ui";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { destinationAfterLogin } from "../../../../components/auth-forms";

export default function OAuthCallbackPage() {
  const params = useParams<{ locale: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const locale: Locale = params.locale === "ar" ? "ar" : "en";
  const ar = locale === "ar";
  const [failed, setFailed] = useState(search.get("result") !== "authenticated");

  useEffect(() => {
    if (search.get("result") !== "authenticated") return;
    window.history.replaceState(null, "", `/${locale}/oauth/callback`);
    void destinationAfterLogin(locale)
      .then((destination) => router.replace(destination))
      .catch(() => setFailed(true));
  }, [locale, router, search]);

  if (failed) {
    return (
      <>
        <Alert
          tone="danger"
          title={ar ? "تعذر إكمال تسجيل الدخول" : "Sign-in could not be completed"}
        >
          {ar
            ? "استخدم طريقة تسجيل دخول أخرى أو تواصل مع الدعم إذا استمرت المشكلة."
            : "Use another sign-in method, or contact support if this continues."}
        </Alert>
        <a href={`/${locale}/login`}>
          <Button style={{ marginTop: "1rem", width: "100%" }}>
            {ar ? "العودة إلى تسجيل الدخول" : "Back to sign in"}
          </Button>
        </a>
      </>
    );
  }

  return (
    <>
      <h2>{ar ? "جارٍ تأمين جلستك…" : "Securing your session…"}</h2>
      <p className="auth-card__intro">
        {ar ? "لحظة واحدة بينما نفتح مساحة عملك." : "One moment while we open your workspace."}
      </p>
    </>
  );
}
