import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseEnvironment } from "../../packages/config/src/index.js";

function syntheticEnvironment(environment: "staging" | "production"): NodeJS.ProcessEnv {
  const fixture = resolve(`deploy/vps/fixtures/release-smoke/${environment}.env.fixture`);
  return Object.fromEntries(
    readFileSync(fixture, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

describe("release image smoke configuration", () => {
  it.each(["staging", "production"] as const)(
    "accepts the canonical synthetic %s image-smoke environment",
    (environment) => {
      const values = parseEnvironment(syntheticEnvironment(environment));
      expect(values.DEPLOYMENT_ENVIRONMENT).toBe(environment);
      expect(values.ADMIN_DASHBOARD_URL).toMatch(/^https:\/\/admin(?:\.staging)?\.waflo\.app$/);
      expect(values.GOOGLE_WALLET_ALLOWED_ORIGINS).toBe(new URL(values.CUSTOMER_WEB_URL).origin);
    },
  );

  it("retains deployed cookie, infrastructure, public-origin, Wallet-origin, and Admin-origin gates", () => {
    const production = syntheticEnvironment("production");
    const rejects = (overrides: NodeJS.ProcessEnv, message: string) =>
      expect(() => parseEnvironment({ ...production, ...overrides })).toThrow(message);

    rejects({ COOKIE_SECURE: "false" }, "cookies must be secure");
    rejects({ COOKIE_NAME: "waflo_session" }, "__Host-waflo_session");
    rejects({ CUSTOMER_COOKIE_NAME: "waflo_customer" }, "__Host-waflo_customer");
    rejects({ TEST_STAFF_CLIENT_ENABLED: "true" }, "Staff Test Client");
    rejects(
      { DATABASE_URL: "postgresql://waflo:waflo_dev_password@localhost:5432/waflo" },
      "local development database",
    );
    rejects({ REDIS_URL: "" }, "requires Redis");
    rejects({ TRUSTED_PROXIES: "" }, "trusted proxy");
    rejects({ API_PUBLIC_URL: "http://api.waflo.app" }, "public URLs must use HTTPS");
    rejects(
      { GOOGLE_WALLET_ALLOWED_ORIGINS: "https://app.waflo.app" },
      "Google Wallet Save origins",
    );
    rejects(
      {
        ALLOWED_ORIGINS:
          "https://waflo.app,https://www.waflo.app,https://app.waflo.app,https://card.waflo.app",
      },
      "exact, duplicate-free Waflo web-origin allowlist",
    );
  });
});
