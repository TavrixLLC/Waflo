import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CustomerPublicApiError,
  fetchCustomerApi,
} from "../../apps/customer-web/app/server-api.js";

afterEach(() => vi.unstubAllGlobals());

describe("customer public error states", () => {
  it("keeps a safe upstream code and status for the branded page state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                code: "PUBLIC_PROGRAM_NOT_FOUND",
                message: "This loyalty program is unavailable.",
              },
            }),
            { status: 404, headers: { "content-type": "application/json" } },
          ),
      ),
    );
    await expect(
      fetchCustomerApi("/v1/public/programs/missing", "merchant.lvh.me"),
    ).rejects.toMatchObject({
      name: "CustomerPublicApiError",
      status: 404,
      code: "PUBLIC_PROGRAM_NOT_FOUND",
    } satisfies Partial<CustomerPublicApiError>);
  });

  it("uses branded, retryable customer states without exposing backend errors", () => {
    const boundary = readFileSync("apps/customer-web/app/error.tsx", "utf8");
    const joinPage = readFileSync("apps/customer-web/app/join/[programSlug]/page.tsx", "utf8");
    expect(boundary).toContain("customer-error-state");
    expect(boundary).toContain("Try again");
    expect(boundary).not.toContain("error.stack");
    expect(joinPage).toContain("PUBLIC_PROGRAM_NOT_FOUND");
    expect(joinPage).toContain("We could not find this merchant");
    expect(joinPage).toContain("We could not open this merchant page");
    expect(joinPage).toContain('directHostname === "card.waflo.app"');
    expect(joinPage).toContain("https://${result.merchant.slug}.waflo.app");
    expect(joinPage).not.toContain('canonical.searchParams.set("tenant"');
  });
});
