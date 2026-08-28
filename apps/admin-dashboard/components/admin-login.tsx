"use client";

import type { Locale } from "@waflo/contracts";
import { Alert, Button, EmailInput, FormField, PasswordInput } from "@waflo/ui";
import { ShieldCheck } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useState } from "react";
import { AdminApiError, adminApi } from "../lib/admin-api";
import { adminCopy } from "../lib/admin-content";

export function AdminLogin({ locale }: { locale: Locale }) {
  const text = adminCopy(locale);
  const router = useRouter();
  const search = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    const form = new FormData(event.currentTarget);
    setLoading(true);
    setError("");
    try {
      await adminApi("/v1/admin/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: String(form.get("email") ?? ""),
          password: String(form.get("password") ?? ""),
        }),
      });
      router.replace(`/${locale}`);
    } catch (caught) {
      setError(caught instanceof AdminApiError ? caught.message : text.loginError);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="admin-login">
      <section className="admin-login__context" aria-label={text.internal}>
        <div className="admin-login__seal">
          <ShieldCheck size={32} aria-hidden="true" />
        </div>
        <span>{text.internal}</span>
        <h1>{text.product}</h1>
        <p>{text.loginIntro}</p>
      </section>
      <section className="admin-login__panel">
        <form className="admin-login__card" onSubmit={submit}>
          <div className="admin-login__heading">
            <div>
              <span>W</span>
            </div>
            <a href={`/${locale === "ar" ? "en" : "ar"}/login`}>
              {locale === "ar" ? "English" : "العربية"}
            </a>
          </div>
          <h2>{text.loginTitle}</h2>
          {search.get("reason") === "session" ? (
            <Alert tone="warning" title={text.sessionExpired} />
          ) : null}
          {error ? <Alert tone="danger" title={error} /> : null}
          <FormField label={text.email} required>
            <EmailInput name="email" autoComplete="username" required />
          </FormField>
          <FormField label={text.password} required>
            <PasswordInput
              name="password"
              autoComplete="current-password"
              minLength={12}
              required
            />
          </FormField>
          <Button type="submit" loading={loading} disabled={loading}>
            {text.signIn}
          </Button>
          <small>{text.loginIntro}</small>
        </form>
      </section>
    </main>
  );
}
