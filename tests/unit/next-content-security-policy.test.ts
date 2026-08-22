import { afterEach, describe, expect, it } from "vitest";
import customerConfig from "../../apps/customer-web/next.config";
import marketingConfig from "../../apps/marketing-web/next.config";
import dashboardConfig from "../../apps/merchant-dashboard/next.config";
import { createNextContentSecurityPolicy } from "../../packages/security/src/index";

const originalNodeEnvironment = process.env.NODE_ENV;
const originalPublicApiUrl = process.env.NEXT_PUBLIC_API_URL;
const originalLocalProductionSmoke = process.env.WAFLO_LOCAL_PRODUCTION_SMOKE;

const applicationConfigs = [
  ["marketing-web", marketingConfig],
  ["merchant-dashboard", dashboardConfig],
  ["customer-web", customerConfig],
] as const;

const preservedDirectives = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob:",
] as const;

afterEach(() => {
  if (originalNodeEnvironment === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnvironment;
  if (originalPublicApiUrl === undefined) delete process.env.NEXT_PUBLIC_API_URL;
  else process.env.NEXT_PUBLIC_API_URL = originalPublicApiUrl;
  if (originalLocalProductionSmoke === undefined) delete process.env.WAFLO_LOCAL_PRODUCTION_SMOKE;
  else process.env.WAFLO_LOCAL_PRODUCTION_SMOKE = originalLocalProductionSmoke;
});

async function contentSecurityPolicyFor(
  config: (typeof applicationConfigs)[number][1],
  nodeEnvironment: "development" | "production" | "test",
): Promise<string> {
  process.env.NODE_ENV = nodeEnvironment;
  const groups = (await config.headers?.()) ?? [];
  const policy = groups
    .flatMap((group) => group.headers)
    .find((header) => header.key === "Content-Security-Policy")?.value;

  expect(policy).toBeDefined();
  return policy ?? "";
}

function expectPreservedSecurityDirectives(policy: string): void {
  for (const directive of preservedDirectives) expect(policy).toContain(directive);
  expect(policy).toContain("font-src 'self' data:");
  expect(policy).toContain("style-src 'self' 'unsafe-inline'");
  expect(policy).not.toMatch(/(?:^|\s)\*(?:\s|;|$)/);
}

describe("Next.js Content-Security-Policy", () => {
  it("adds only the React development eval source in development", () => {
    const policy = createNextContentSecurityPolicy("development");

    expect(policy).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
    expect(policy).toContain("connect-src 'self' http://localhost:4000 https://api.waflo.app");
    expect(policy.match(/'unsafe-eval'/g)).toHaveLength(1);
    expectPreservedSecurityDirectives(policy);
  });

  it("allows only the two Google Fonts origins when an application actually imports them", () => {
    const policy = createNextContentSecurityPolicy("production", { googleFonts: true });

    expect(policy).toContain("font-src 'self' data: https://fonts.gstatic.com");
    expect(policy).toContain("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com");
    expect(policy).toContain(
      "connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com https://api.waflo.app",
    );
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).not.toContain("*.googleapis.com");
    expect(policy).not.toContain("*.gstatic.com");
    expectPreservedSecurityDirectives(policy);
  });

  it("allows Stripe.js only when the embedded payment surface opts in", () => {
    const policy = createNextContentSecurityPolicy("production", { stripeJs: true });

    expect(policy).toContain(
      "frame-src 'self' https://*.js.stripe.com https://js.stripe.com https://hooks.stripe.com",
    );
    expect(policy).toContain(
      "script-src 'self' 'unsafe-inline' https://*.js.stripe.com https://js.stripe.com",
    );
    expect(policy).toContain("connect-src 'self' https://api.stripe.com https://api.waflo.app");
    expect(policy).not.toContain("https://*.stripe.com");
    expect(policy).not.toContain("https://checkout.stripe.com");
    expectPreservedSecurityDirectives(policy);
  });

  it("allows only the Mapbox map/search endpoints and a blob worker when the picker opts in", () => {
    const policy = createNextContentSecurityPolicy("production", { mapboxGl: true });

    expect(policy).toContain("worker-src 'self' blob:");
    expect(policy).toContain("https://api.mapbox.com");
    expect(policy).toContain("https://events.mapbox.com");
    expect(policy).not.toContain("api.mapbox.cn");
    expect(policy).not.toContain("*.mapbox.com");
    expect(policy).not.toContain("'unsafe-eval'");
    expectPreservedSecurityDirectives(policy);
  });

  it.each(["production", "test", undefined])(
    "keeps the shared policy strict for NODE_ENV=%s",
    (nodeEnvironment) => {
      const policy = createNextContentSecurityPolicy(nodeEnvironment);

      expect(policy).toContain("script-src 'self' 'unsafe-inline'");
      expect(policy).not.toContain("'unsafe-eval'");
      expect(policy).toContain("connect-src 'self' https://api.waflo.app");
      expect(policy).not.toContain("http://localhost:4000");
      expectPreservedSecurityDirectives(policy);
    },
  );

  it("permits a loopback API only for an explicit local production smoke build", async () => {
    process.env.NEXT_PUBLIC_API_URL = "http://localhost:4000/v1";
    process.env.WAFLO_LOCAL_PRODUCTION_SMOKE = "1";

    const policy = await contentSecurityPolicyFor(dashboardConfig, "production");

    expect(policy).toContain("connect-src 'self'");
    expect(policy).toContain(" http://localhost:4000");
    expect(policy).toContain("img-src 'self' data: blob: http://localhost:4000");
    expect(policy).not.toContain("https://api.waflo.app");
    expect(policy).not.toContain("'unsafe-eval'");
  });

  it("allows merchant-hosted image assets only from the validated API origin", () => {
    const policy = createNextContentSecurityPolicy("production", {
      apiUrl: "https://api-staging.waflo.app/v1",
    });

    expect(policy).toContain("img-src 'self' data: blob: https://api-staging.waflo.app");
    expect(policy).not.toContain("https://api.waflo.app");
  });

  it("binds Customer Web to its configured staging API instead of the production fallback", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api-staging.waflo.app/v1";

    const policy = await contentSecurityPolicyFor(customerConfig, "production");

    expect(policy).toContain("connect-src 'self' https://api-staging.waflo.app");
    expect(policy).toContain("img-src 'self' data: blob: https://api-staging.waflo.app");
    expect(policy).not.toContain("https://api.waflo.app");
  });

  it("rejects unsafe or malformed configured API origins", () => {
    const insecure = createNextContentSecurityPolicy("production", {
      apiUrl: "http://example.test:4000/header; injection",
    });
    const malformed = createNextContentSecurityPolicy("production", {
      apiUrl: "not a URL; script-src *",
      allowLoopbackApi: true,
    });

    expect(insecure).not.toContain("example.test");
    expect(insecure).not.toContain("injection");
    expect(malformed).not.toContain("not a URL");
    expect(malformed).not.toContain("script-src *");
  });

  for (const [applicationName, config] of applicationConfigs) {
    it(`${applicationName} permits eval in development and never in production or test`, async () => {
      const developmentPolicy = await contentSecurityPolicyFor(config, "development");
      const productionPolicy = await contentSecurityPolicyFor(config, "production");
      const testPolicy = await contentSecurityPolicyFor(config, "test");

      expect(developmentPolicy).toContain("'unsafe-eval'");
      expect(developmentPolicy).toContain("http://localhost:4000");
      expect(productionPolicy).not.toContain("'unsafe-eval'");
      expect(productionPolicy).not.toContain("http://localhost:4000");
      expect(testPolicy).not.toContain("'unsafe-eval'");
      expect(testPolicy).not.toContain("http://localhost:4000");
      expectPreservedSecurityDirectives(developmentPolicy);
      expectPreservedSecurityDirectives(productionPolicy);
      expectPreservedSecurityDirectives(testPolicy);
      if (applicationName === "customer-web") {
        expect(productionPolicy).not.toContain("fonts.googleapis.com");
        expect(productionPolicy).not.toContain("fonts.gstatic.com");
      } else {
        expect(productionPolicy).toContain("https://fonts.googleapis.com");
        expect(productionPolicy).toContain("https://fonts.gstatic.com");
      }
      if (applicationName === "merchant-dashboard") {
        expect(productionPolicy).toContain("https://js.stripe.com");
        expect(productionPolicy).toContain("https://hooks.stripe.com");
        expect(productionPolicy).toContain("https://api.mapbox.com");
        expect(productionPolicy).toContain("worker-src 'self' blob:");
        expect(productionPolicy).toContain("https://api.stripe.com");
      } else {
        expect(productionPolicy).not.toContain("https://js.stripe.com");
        expect(productionPolicy).not.toContain("https://hooks.stripe.com");
        expect(productionPolicy).not.toContain("https://api.stripe.com");
      }
    });
  }
});
