import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const hopByHop = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-port",
  "x-forwarded-proto",
  "cf-connecting-ip",
]);

const tenantSlug = /^[a-z0-9](?:[a-z0-9-]{0,47}[a-z0-9])?$/;
const reservedMerchantHosts = new Set([
  "www",
  "app",
  "api",
  "card",
  "app-staging",
  "api-staging",
  "card-staging",
  "staging",
]);

function hostnameFromHeader(value: string): string {
  return value.toLocaleLowerCase("en-US").split(":")[0] ?? "";
}

function compatibilityCustomerHostname(): string {
  const fallback =
    process.env.DEPLOYMENT_ENVIRONMENT === "production"
      ? "https://card.waflo.app"
      : "https://card-staging.waflo.app";
  try {
    return new URL(process.env.CUSTOMER_WEB_URL ?? fallback).hostname.toLocaleLowerCase("en-US");
  } catch {
    return "";
  }
}

/**
 * A tenant query may be redundant on a canonical merchant host, but it must
 * never change that host's identity. This narrow parser is only for deciding
 * whether to discard a redundant query before forwarding to the API; the API
 * remains the authoritative host and tenant resolver.
 */
function merchantSlugForHostname(hostname: string): string | null {
  const suffix = [".waflo.app", ".localhost", ".lvh.me"].find((candidate) =>
    hostname.endsWith(candidate),
  );
  if (!suffix) return null;
  const slug = hostname.slice(0, -suffix.length);
  if (!tenantSlug.test(slug) || reservedMerchantHosts.has(slug)) return null;
  return slug;
}

function tenantOverrideError(code: "TENANT_OVERRIDE_HOST_FORBIDDEN" | "TENANT_OVERRIDE_INVALID") {
  return Response.json(
    {
      error: {
        code,
        message:
          code === "TENANT_OVERRIDE_INVALID"
            ? "The tenant override is invalid."
            : "Tenant overrides are accepted only on the customer compatibility host.",
      },
    },
    { status: 400 },
  );
}

function safeUpstreamPath(path: string[]): string {
  if (path.length === 0) throw new Error("Missing API path");
  for (const segment of path) {
    const decoded = decodeURIComponent(segment);
    if (
      !segment ||
      segment.includes("\\") ||
      /%2f|%5c|%2e/i.test(segment) ||
      decoded === "." ||
      decoded === ".." ||
      decoded.includes("/") ||
      decoded.includes("\\")
    ) {
      throw new Error("Invalid API path");
    }
  }
  return `/${path.join("/")}`;
}

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const apiUrl =
    process.env.API_INTERNAL_URL ?? process.env.API_PUBLIC_URL ?? "http://localhost:4000";
  const configuredOrigin = new URL(apiUrl).origin;
  let upstream: URL;
  try {
    upstream = new URL(safeUpstreamPath(path), apiUrl);
  } catch {
    return Response.json({ error: "Invalid API path" }, { status: 400 });
  }
  if (upstream.origin !== configuredOrigin) {
    return Response.json({ error: "Invalid API path" }, { status: 400 });
  }
  upstream.search = request.nextUrl.search;
  const requestHeaders = new Headers();
  for (const [key, value] of request.headers) {
    if (!hopByHop.has(key.toLowerCase())) requestHeaders.set(key, value);
  }
  // This BFF is reachable only through Waflo's tunnel/network, but it still
  // rebuilds forwarding metadata instead of relaying caller-controlled chains.
  const cloudflareClientIp = request.headers.get("cf-connecting-ip");
  if (cloudflareClientIp && /^[0-9a-f:.]{2,64}$/i.test(cloudflareClientIp)) {
    requestHeaders.set("x-forwarded-for", cloudflareClientIp);
  }
  requestHeaders.set("x-forwarded-proto", "https");
  const directHost = request.headers.get("host") ?? "";
  // Rebuild forwarding metadata at this BFF boundary. Fastify uses the trusted
  // forwarded host for tenant resolution, so relaying an upstream chain here
  // would make compatibility links resolve against the API hostname instead
  // of the customer hostname.
  requestHeaders.set("x-forwarded-host", directHost);
  requestHeaders.delete("x-forwarded-port");
  const normalizedHost = hostnameFromHeader(directHost);
  const queryTenant = request.nextUrl.searchParams.get("tenant");
  if (queryTenant && !tenantSlug.test(queryTenant))
    return tenantOverrideError("TENANT_OVERRIDE_INVALID");
  const compatibilityHost = normalizedHost === compatibilityCustomerHostname();
  const hostTenant = merchantSlugForHostname(normalizedHost);
  if (queryTenant && !compatibilityHost) {
    // The canonical hostname is authoritative. A matching query is harmless
    // legacy noise, so drop it; anything else is a tenant-spoofing attempt.
    if (!hostTenant || hostTenant !== queryTenant) {
      return tenantOverrideError("TENANT_OVERRIDE_HOST_FORBIDDEN");
    }
    upstream.searchParams.delete("tenant");
  }
  // The query override exists solely for the exact compatibility host. A
  // merchant hostname, including local `slug.lvh.me`, is the tenant identity.
  const tenant = compatibilityHost ? queryTenant : null;
  if (tenant && !upstream.searchParams.has("tenant")) {
    upstream.searchParams.set("tenant", tenant);
  }
  requestHeaders.set("host", directHost);
  const response = await fetch(upstream, {
    method: request.method,
    headers: requestHeaders,
    ...(request.method === "GET" || request.method === "HEAD"
      ? {}
      : { body: await request.arrayBuffer() }),
    cache: "no-store",
    redirect: "manual",
  });
  const responseHeaders = new Headers();
  for (const [key, value] of response.headers) {
    if (!hopByHop.has(key.toLowerCase()) && key.toLowerCase() !== "set-cookie") {
      responseHeaders.set(key, value);
    }
  }
  for (const cookie of response.headers.getSetCookie())
    responseHeaders.append("set-cookie", cookie);
  responseHeaders.set("cache-control", "no-store");
  return new Response(response.body, {
    status: response.status,
    headers: responseHeaders,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
