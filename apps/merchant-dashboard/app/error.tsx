"use client";

import { isInterfaceLocale, messages, type InterfaceLocale } from "@waflo/i18n";
import { useEffect, useState } from "react";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [locale, setLocale] = useState<InterfaceLocale | null>(null);
  useEffect(() => {
    const routeLocale = window.location.pathname.split("/").filter(Boolean)[0] ?? "";
    setLocale(isInterfaceLocale(routeLocale) ? routeLocale : "en");
  }, []);
  useEffect(() => {
    if (typeof globalThis.reportError === "function") {
      globalThis.reportError(new Error(`Dashboard render failure (${error.digest ?? "unknown"})`));
    }
  }, [error]);
  if (!locale) return null;
  const copy = messages[locale].auth.globalError;
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <h1>{copy.title}</h1>
        <p>{copy.description}</p>
        <button type="button" onClick={reset}>
          {copy.retry}
        </button>
      </section>
    </main>
  );
}
