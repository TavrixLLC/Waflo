"use client";

import { useEffect } from "react";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (typeof globalThis.reportError === "function") {
      globalThis.reportError(new Error(`Dashboard render failure (${error.digest ?? "unknown"})`));
    }
  }, [error]);
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <h1>Something went wrong</h1>
        <p>No account data was included in this error screen.</p>
        <button type="button" onClick={reset}>
          Try again
        </button>
      </section>
    </main>
  );
}
