import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../../apps/customer-web/app/api/waflo/[...path]/route";

const context = {
  params: Promise.resolve({ path: ["v1", "public", "programs", "warm-latte-rewards-2"] }),
};

function customerRequest(host: string, tenant?: string) {
  const url = new URL(
    "https://customer-bff.test/api/waflo/v1/public/programs/warm-latte-rewards-2",
  );
  if (tenant) url.searchParams.set("tenant", tenant);
  return {
    method: "GET",
    nextUrl: url,
    headers: new Headers({
      host,
      "x-forwarded-host": "untrusted.example.test",
      "x-forwarded-proto": "http",
    }),
  } as Parameters<typeof GET>[0];
}

describe("Customer Web tenant forwarding", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("forwards a valid compatibility-host tenant using rebuilt forwarding metadata", async () => {
    vi.stubEnv("API_INTERNAL_URL", "http://api.internal:4000");
    vi.stubEnv("CUSTOMER_WEB_URL", "https://card-staging.waflo.app");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { status: "active" } }), {
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(customerRequest("card-staging.waflo.app", "hamzacafe"), context);

    expect(response.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toContain("tenant=hamzacafe");
    const headers = new Headers(init.headers);
    expect(headers.get("host")).toBe("card-staging.waflo.app");
    expect(headers.get("x-forwarded-host")).toBe("card-staging.waflo.app");
    expect(headers.get("x-forwarded-proto")).toBe("https");
  });

  it("forwards a missing compatibility tenant unchanged so the public API can return its safe state", async () => {
    vi.stubEnv("API_INTERNAL_URL", "http://api.internal:4000");
    vi.stubEnv("CUSTOMER_WEB_URL", "https://card-staging.waflo.app");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { status: "unknown" } }), {
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(customerRequest("card-staging.waflo.app"), context);
    expect(response.status).toBe(200);
    const [url] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.searchParams.has("tenant")).toBe(false);
  });

  it("keeps a matching canonical-host tenant query harmless while rejecting mismatches", async () => {
    vi.stubEnv("CUSTOMER_WEB_URL", "https://card-staging.waflo.app");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { status: "active" } }), {
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const matching = await GET(customerRequest("hamzacafe.waflo.app", "hamzacafe"), context);
    expect(matching.status).toBe(200);
    const [matchingUrl, matchingInit] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(matchingUrl.searchParams.has("tenant")).toBe(false);
    expect(new Headers(matchingInit.headers).get("x-forwarded-host")).toBe("hamzacafe.waflo.app");

    for (const [host, tenant] of [
      ["hamzacafe.waflo.app", "other-merchant"],
      ["hostile.example.test", "hamzacafe"],
      ["app.waflo.app", "app"],
    ]) {
      const response = await GET(customerRequest(host, tenant), context);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "TENANT_OVERRIDE_HOST_FORBIDDEN" },
      });
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed compatibility-host tenants and leaves local tenant hosts authoritative", async () => {
    vi.stubEnv("API_INTERNAL_URL", "http://api.internal:4000");
    vi.stubEnv("CUSTOMER_WEB_URL", "https://card-staging.waflo.app");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { status: "active" } }), {
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const invalid = await GET(customerRequest("card-staging.waflo.app", "not valid"), context);
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({
      error: { code: "TENANT_OVERRIDE_INVALID" },
    });

    const local = await GET(customerRequest("hamzacafe.lvh.me:3002"), context);
    expect(local.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.searchParams.has("tenant")).toBe(false);
    expect(new Headers(init.headers).get("x-forwarded-host")).toBe("hamzacafe.lvh.me:3002");

    const localWithMatchingLegacyQuery = await GET(
      customerRequest("hamzacafe.lvh.me:3002", "hamzacafe"),
      context,
    );
    expect(localWithMatchingLegacyQuery.status).toBe(200);
    const [localUrl] = fetchMock.mock.calls[1] as [URL, RequestInit];
    expect(localUrl.searchParams.has("tenant")).toBe(false);
  });
});
