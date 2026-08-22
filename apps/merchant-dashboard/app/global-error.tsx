"use client";

/**
 * Root-level global error boundary (Next.js App Router).
 *
 * Rules for this file:
 * - Must be a Client Component.
 * - Must render its own <html> and <body> because it replaces the root layout.
 * - Must NOT import ThemeProvider, router, toast, query, or any context that
 *   assumes the normal shell is mounted. The static i18n registry is safe.
 * - Must not expose internal error details, digests, or stack traces to the user.
 */

import { isInterfaceLocale, localeRegistry, type InterfaceLocale } from "@waflo/i18n";
import { Cairo, Manrope, Noto_Sans_Arabic } from "next/font/google";
import { useEffect, useState } from "react";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });
const cairo = Cairo({ subsets: ["arabic", "latin"], variable: "--font-cairo", display: "swap" });
const notoSansArabic = Noto_Sans_Arabic({
  subsets: ["arabic"],
  variable: "--font-noto-sans-arabic",
  display: "swap",
});

export default function GlobalError({
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
    // Report to browser console only — never to the user.
    if (typeof globalThis.reportError === "function") {
      globalThis.reportError(
        new Error(`Waflo global render failure (${error.digest ?? "no-digest"})`),
      );
    }
  }, [error]);

  if (!locale) {
    return (
      <html lang="en">
        <body />
      </html>
    );
  }

  const definition = localeRegistry[locale];
  const copy = definition.messages.auth.globalError;

  return (
    <html
      lang={definition.htmlLang}
      dir={definition.direction}
      data-interface-typography={definition.typography}
    >
      <body
        className={`${manrope.variable} ${cairo.variable}${
          locale.startsWith("ku-") ? ` ${notoSansArabic.variable}` : ""
        }`}
      >
        <style>{`
          *,*::before,*::after{box-sizing:border-box}
          body{margin:0;min-height:100dvh;display:grid;place-items:center;
            font-family:var(--font-manrope),system-ui,sans-serif;
            background:#faf9f8;color:#241916}
          html[data-interface-typography="cairo"] body{
            font-family:var(--font-cairo),system-ui,sans-serif}
          html:lang(kmr-Arab-IQ) body,html:lang(ckb-Arab-IQ) body{
            font-family:var(--font-noto-sans-arabic),var(--font-cairo),system-ui,sans-serif;
            font-kerning:normal;font-variant-ligatures:common-ligatures contextual;
            letter-spacing:normal}
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
          <h1>{copy.title}</h1>
          <p>{copy.description}</p>
          <button type="button" onClick={() => reset()}>
            {copy.retry}
          </button>
        </div>
      </body>
    </html>
  );
}
