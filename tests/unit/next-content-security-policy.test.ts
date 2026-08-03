import { afterEach, describe, expect, it } from "vitest";
import customerConfig from "../../apps/customer-web/next.config";
import marketingConfig from "../../apps/marketing-web/next.config";
import dashboardConfig from "../../apps/merchant-dashboard/next.config";
import { createNextContentSecurityPolicy } from "../../packages/security/src/index";

const originalNodeEnvironment = process.env.NODE_ENV;

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
  "connect-src 'self' http://localhost:4000 https://api.waflo.app",
] as const;

afterEach(() => {
  if (originalNodeEnvironment === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnvironment;
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
    expect(policy.match(/'unsafe-eval'/g)).toHaveLength(1);
    expectPreservedSecurityDirectives(policy);
  });

  it("allows only the two Google Fonts origins when an application actually imports them", () => {
    const policy = createNextContentSecurityPolicy("production", { googleFonts: true });

    expect(policy).toContain("font-src 'self' data: https://fonts.gstatic.com");
    expect(policy).toContain("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).not.toContain("*.googleapis.com");
    expect(policy).not.toContain("*.gstatic.com");
    expectPreservedSecurityDirectives(policy);
  });

  it.each(["production", "test", undefined])(
    "keeps the shared policy strict for NODE_ENV=%s",
    (nodeEnvironment) => {
      const policy = createNextContentSecurityPolicy(nodeEnvironment);

      expect(policy).toContain("script-src 'self' 'unsafe-inline'");
      expect(policy).not.toContain("'unsafe-eval'");
      expectPreservedSecurityDirectives(policy);
    },
  );

  for (const [applicationName, config] of applicationConfigs) {
    it(`${applicationName} permits eval in development and never in production or test`, async () => {
      const developmentPolicy = await contentSecurityPolicyFor(config, "development");
      const productionPolicy = await contentSecurityPolicyFor(config, "production");
      const testPolicy = await contentSecurityPolicyFor(config, "test");

      expect(developmentPolicy).toContain("'unsafe-eval'");
      expect(productionPolicy).not.toContain("'unsafe-eval'");
      expect(testPolicy).not.toContain("'unsafe-eval'");
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
    });
  }
});
