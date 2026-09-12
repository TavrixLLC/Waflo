"use client";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  (process.env.NODE_ENV === "production" ? "https://api.waflo.app" : "http://localhost:4000");

interface SuccessEnvelope<T> {
  data: T;
}

export class AdminApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

let csrfToken: string | null = null;

async function csrf(): Promise<string> {
  if (csrfToken) return csrfToken;
  const response = await fetch(`${API_URL}/v1/admin/auth/csrf`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok)
    throw new AdminApiError("NETWORK_ERROR", "Admin security could not initialize.");
  const envelope = (await response.json()) as SuccessEnvelope<{ csrfToken: string }>;
  csrfToken = envelope.data.csrfToken;
  return csrfToken;
}

export async function adminApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = options.method?.toUpperCase() ?? "GET";
  const headers = new Headers(options.headers);
  headers.set("accept", "application/json");
  if (options.body) headers.set("content-type", "application/json");
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    headers.set("x-csrf-token", await csrf());
  }
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers,
      credentials: "include",
      cache: "no-store",
    });
  } catch {
    throw new AdminApiError("NETWORK_ERROR", "Waflo Admin could not reach the API.");
  }
  const payload = (await response.json().catch(() => ({}))) as {
    data?: T;
    error?: { code?: string; message?: string };
  };
  if (!response.ok) {
    throw new AdminApiError(
      payload.error?.code ?? "REQUEST_FAILED",
      payload.error?.message ?? "The administrator request could not be completed.",
    );
  }
  return payload.data as T;
}

export function resetAdminCsrf(): void {
  csrfToken = null;
}
