"use client";

import { RefreshCcw } from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo } from "react";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const ar = useMemo(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("lang") === "ar",
    [],
  );
  useEffect(() => {
    if (typeof globalThis.reportError === "function") {
      globalThis.reportError(new Error(`Customer render failure (${error.digest ?? "unknown"})`));
    }
  }, [error]);

  return (
    <main
      className="customer-page customer-centered"
      lang={ar ? "ar" : "en"}
      dir={ar ? "rtl" : "ltr"}
    >
      <section className="customer-state-card customer-error-state" role="alert">
        <Image
          className="customer-logo"
          src="/brand/waflo-logo-primary-horizontal.svg"
          alt="Waflo"
          width={280}
          height={80}
          priority
        />
        <span className="customer-error-state__icon" aria-hidden="true">
          <RefreshCcw size={22} />
        </span>
        <p className="customer-kicker">Waflo</p>
        <h1>{ar ? "تعذر فتح هذه الصفحة" : "We could not open this page"}</h1>
        <p>
          {ar
            ? "قد تكون المشكلة مؤقتة. تحقق من الرابط ثم حاول مرة أخرى."
            : "This may be temporary. Check the link, then try again."}
        </p>
        <button className="wf-button wf-button--primary" type="button" onClick={reset}>
          <RefreshCcw size={16} aria-hidden="true" />
          {ar ? "حاول مرة أخرى" : "Try again"}
        </button>
      </section>
    </main>
  );
}
