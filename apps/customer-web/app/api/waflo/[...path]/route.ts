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
]);

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const apiUrl = process.env.API_PUBLIC_URL ?? "http://localhost:4000";
  const upstream = new URL(`/${path.join("/")}`, apiUrl);
  upstream.search = request.nextUrl.search;
  const requestHeaders = new Headers();
  for (const [key, value] of request.headers) {
    if (!hopByHop.has(key.toLowerCase())) requestHeaders.set(key, value);
  }
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
        : (request.headers.get("x-forwarded-host") ?? directHost)),
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
