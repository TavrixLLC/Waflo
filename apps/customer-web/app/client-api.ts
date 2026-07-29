"use client";

export class CustomerApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CustomerApiError";
  }
}

export function customerCommandId(prefix: "enroll" | "transfer"): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  const token = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${prefix}:${token}`;
}

export async function customerApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("accept", "application/json");
  if (options.body && !(options.body instanceof FormData) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const target = new URL(`/api/waflo${path}`, window.location.origin);
  const tenant = new URLSearchParams(window.location.search).get("tenant");
  if (tenant && !target.searchParams.has("tenant")) target.searchParams.set("tenant", tenant);
  const method = (options.method ?? "GET").toUpperCase();
  if (
    (path.startsWith("/v1/customer/") || path.startsWith("/v1/public/transfers/request")) &&
    !["GET", "HEAD", "OPTIONS"].includes(method)
  ) {
    const csrfTarget = new URL("/api/waflo/v1/customer/csrf", window.location.origin);
    if (tenant) csrfTarget.searchParams.set("tenant", tenant);
    const csrfResponse = await fetch(csrfTarget, {
      headers: { accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
    });
    const csrfPayload = (await csrfResponse.json().catch(() => ({}))) as {
      data?: { token?: string };
      error?: { code?: string; message?: string };
    };
    const optionalTransferCsrf = path.startsWith("/v1/public/transfers/request");
    if (!csrfResponse.ok && optionalTransferCsrf) {
      // The recipient QR flow is deliberately usable without an existing
      // customer session; proof is the one-time credential/challenge instead.
    } else if (!csrfResponse.ok || !csrfPayload.data?.token) {
      throw new CustomerApiError(
        csrfPayload.error?.code ?? "CUSTOMER_CSRF_INVALID",
        csrfPayload.error?.message ?? "This customer request could not be verified.",
      );
    } else {
      headers.set("x-csrf-token", csrfPayload.data.token);
    }
  }
  const response = await fetch(target, {
    ...options,
    headers,
    credentials: "same-origin",
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as {
    data?: T;
    error?: { code?: string; message?: string };
  };
  if (!response.ok || payload.data === undefined) {
    throw new CustomerApiError(
      payload.error?.code ?? "REQUEST_FAILED",
      payload.error?.message ?? "The request could not be completed.",
    );
  }
  return payload.data;
}
