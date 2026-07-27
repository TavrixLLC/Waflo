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
      globalThis.reportError(new Error(`Marketing render failure (${error.digest ?? "unknown"})`));
    }
  }, [error]);
  return (
    <main>
      <h1>Something went wrong</h1>
      <p>The page could not be loaded safely.</p>
      <button type="button" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
