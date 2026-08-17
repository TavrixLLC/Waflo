"use client";

/**
 * Root-level global error boundary (Next.js App Router).
 *
 * Rules for this file:
 * - Must be a Client Component.
 * - Must render its own <html> and <body> because it replaces the root layout.
 * - Must NOT import ThemeProvider, i18n, router, toast, query, or any context
 *   that assumes the normal shell is mounted — that is what caused the original
 *   `useContext` TypeError on /_global-error.
 * - Must not expose internal error details, digests, or stack traces to the user.
 */

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Report to browser console only — never to the user.
    if (typeof globalThis.reportError === "function") {
      globalThis.reportError(
        new Error(`Waflo global render failure (${error.digest ?? "no-digest"})`),
      );
    }
  }, [error]);

  return (
    <html lang="en">
      <body>
        <style>{`
          *,*::before,*::after{box-sizing:border-box}
          body{margin:0;min-height:100dvh;display:grid;place-items:center;
            font-family:system-ui,-apple-system,sans-serif;
            background:#faf9f8;color:#241916}
          .ge-card{width:min(480px,calc(100vw - 2rem));padding:2rem;
            background:#fff;border:1px solid #e5ddd9;border-radius:16px;
            text-align:center}
          h1{margin:0 0 0.5rem;font-size:1.4rem;font-weight:750}
          p{margin:0 0 1.5rem;color:#7a6e6b;line-height:1.6;font-size:0.95rem}
          button{display:inline-flex;align-items:center;justify-content:center;
            min-height:44px;padding:0 1.5rem;background:#ae3115;color:#fff;
            border:0;border-radius:10px;font-size:0.95rem;font-weight:650;
            cursor:pointer;transition:background 0.15s}
          button:hover{background:#8f2710}
          button:focus-visible{outline:3px solid #3157d5;outline-offset:3px}
        `}</style>
        <div className="ge-card">
          <h1>Something went wrong</h1>
          <p>
            Waflo ran into an unexpected error. No account data was included in this screen. Reload
            the page or try again.
          </p>
          <button type="button" onClick={() => reset()}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
