"use client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

interface SuccessEnvelope<T> {
  data: T;
  requestId: string;
}

interface ErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
    requestId?: string;
  };
}

export class ApiClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

let csrfToken: string | null = null;

function csrfCookie(): string | null {
  if (typeof document === "undefined") return null;
  const value = document.cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith("waflo_csrf="))
    ?.slice("waflo_csrf=".length);
  return value ? decodeURIComponent(value) : null;
}

async function ensureCsrf(): Promise<string> {
  const sharedCookieToken = csrfCookie();
  if (sharedCookieToken) {
    csrfToken = sharedCookieToken;
    return sharedCookieToken;
  }
  if (csrfToken) return csrfToken;
  const response = await fetch(`${API_URL}/v1/auth/csrf`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) throw new ApiClientError("NETWORK_ERROR", "Unable to initialize security.");
  const envelope = (await response.json()) as SuccessEnvelope<{ csrfToken: string }>;
  csrfToken = envelope.data.csrfToken;
  return csrfToken;
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = options.method?.toUpperCase() ?? "GET";
  const unsafe = !["GET", "HEAD", "OPTIONS"].includes(method);
  const headers = new Headers(options.headers);
  headers.set("accept", "application/json");
  if (
    options.body &&
    !(typeof FormData !== "undefined" && options.body instanceof FormData) &&
    !headers.has("content-type")
  )
    headers.set("content-type", "application/json");
  if (unsafe) headers.set("x-csrf-token", await ensureCsrf());
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers,
      credentials: "include",
      cache: "no-store",
    });
  } catch {
    throw new ApiClientError("NETWORK_ERROR", "Waflo could not reach the server. Try again.");
  }
  const payload = (await response.json().catch(() => ({}))) as SuccessEnvelope<T> | ErrorEnvelope;
  if (!response.ok) {
    const error = "error" in payload ? payload.error : undefined;
    throw new ApiClientError(
      error?.code ?? "REQUEST_FAILED",
      error?.message ?? "The request could not be completed.",
      error?.details,
    );
  }
  return (payload as SuccessEnvelope<T>).data;
}

export function resetCsrf(): void {
  csrfToken = null;
}

export const apiUrl = API_URL;
