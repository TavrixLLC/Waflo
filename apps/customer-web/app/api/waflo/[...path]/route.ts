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
  const normalizedHost = directHost.toLocaleLowerCase("en-US").split(":")[0] ?? "";
  const localSuffix = [".localhost", ".lvh.me"].find((suffix) => normalizedHost.endsWith(suffix));
  const localHostTenant = localSuffix ? normalizedHost.slice(0, -localSuffix.length) : "";
  const tenant =
    request.nextUrl.searchParams.get("tenant") ??
    (/^[a-z0-9](?:[a-z0-9-]{0,47}[a-z0-9])?$/.test(localHostTenant) ? localHostTenant : null);
  if (tenant && !upstream.searchParams.has("tenant")) {
    upstream.searchParams.set("tenant", tenant);
  }
  const localTenantHost =
    tenant &&
    /^[a-z0-9](?:[a-z0-9-]{0,47}[a-z0-9])?$/.test(tenant) &&
    (directHost.startsWith("localhost") || directHost.startsWith("127.0.0.1"))
      ? `${tenant}.localhost`
      : null;
  requestHeaders.set(
    "host",
    localTenantHost ??
      (directHost.includes(".localhost") || directHost.includes(".lvh.me")
        ? directHost
        : directHost),
  );
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
