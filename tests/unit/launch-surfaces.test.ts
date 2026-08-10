import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import customerRobots from "../../apps/customer-web/app/robots";
import customerConfig from "../../apps/customer-web/next.config";
import sitemap from "../../apps/marketing-web/app/sitemap";
import { marketingRobots } from "../../apps/marketing-web/app/robots";
import marketingConfig from "../../apps/marketing-web/next.config";
import { proxy as marketingProxy } from "../../apps/marketing-web/proxy";
import {
  configuredSupportEmail,
  configuredLegalEffectiveDate,
  createMarketingMetadata,
  marketingOrigin,
  marketingStructuredData,
  publicMarketingPaths,
} from "../../apps/marketing-web/lib/seo";
import merchantRobots from "../../apps/merchant-dashboard/app/robots";
import merchantConfig from "../../apps/merchant-dashboard/next.config";

const root = resolve(import.meta.dirname, "../..");
const originalDeploymentEnvironment = process.env.DEPLOYMENT_ENVIRONMENT;

afterEach(() => {
  if (originalDeploymentEnvironment === undefined) delete process.env.DEPLOYMENT_ENVIRONMENT;
  else process.env.DEPLOYMENT_ENVIRONMENT = originalDeploymentEnvironment;
});

async function responseHeaders(config: typeof marketingConfig): Promise<Map<string, string>> {
  const groups = (await config.headers?.()) ?? [];
  return new Map(
    groups.flatMap((group) => group.headers).map((header) => [header.key, header.value]),
  );
}

describe("public launch surfaces", () => {
  it("generates unique localized metadata with canonical and language alternates", () => {
    const pages = {
      home: "",
      pricing: "/pricing",
      contact: "/contact",
      privacy: "/privacy",
      terms: "/terms",
    } as const;
    const titles = new Set<string>();

    for (const locale of ["en", "ar"] as const) {
      for (const [page, path] of Object.entries(pages)) {
        const metadata = createMarketingMetadata(locale, page as keyof typeof pages);
        const serialized = JSON.stringify(metadata);
        titles.add(String(metadata.title));
        expect(metadata.description).toBeTruthy();
        expect(serialized).toContain(`${marketingOrigin}/${locale}${path}`);
        expect(serialized).toContain(`${marketingOrigin}/en${path}`);
        expect(serialized).toContain(`${marketingOrigin}/ar${path}`);
        expect(serialized).toContain("summary_large_image");
        expect(serialized).not.toContain("localhost");
        expect(serialized).not.toContain("staging.waflo.app");
      }
    }

    expect(titles).toHaveLength(10);
  });

  it("limits the sitemap to canonical localized Marketing URLs", () => {
    const entries = sitemap();
    expect(entries).toHaveLength(publicMarketingPaths.length * 2);
    expect(new Set(entries.map((entry) => entry.url)).size).toBe(entries.length);
    for (const entry of entries) {
      expect(entry.url.startsWith(`${marketingOrigin}/`)).toBe(true);
      expect(entry.url).toMatch(/\/(en|ar)(?:\/|$)/);
      expect(entry.url).not.toContain("localhost");
      expect(entry.url).not.toContain("staging");
      expect(entry.url).not.toContain("app.waflo.app");
      expect(entry.url).not.toContain("card.waflo.app");
      expect(entry.url).not.toContain("api.waflo.app");
    }
  });

  it("allows production Marketing crawling and disallows every private or staging surface", async () => {
    expect(marketingRobots("production")).toMatchObject({
      rules: { userAgent: "*", allow: "/" },
      sitemap: `${marketingOrigin}/sitemap.xml`,
    });
    expect(marketingRobots("staging")).toEqual({
      rules: { userAgent: "*", disallow: "/" },
    });
    expect(customerRobots()).toEqual({ rules: { userAgent: "*", disallow: "/" } });
    expect(merchantRobots()).toEqual({ rules: { userAgent: "*", disallow: "/" } });

    process.env.DEPLOYMENT_ENVIRONMENT = "staging";
    expect((await responseHeaders(marketingConfig)).get("X-Robots-Tag")).toBe(
      "noindex, nofollow, noarchive",
    );
    expect((await responseHeaders(customerConfig)).get("X-Robots-Tag")).toBe(
      "noindex, nofollow, noarchive",
    );
    expect((await responseHeaders(merchantConfig)).get("X-Robots-Tag")).toBe(
      "noindex, nofollow, noarchive",
    );

    process.env.DEPLOYMENT_ENVIRONMENT = "production";
    expect((await responseHeaders(marketingConfig)).has("X-Robots-Tag")).toBe(false);
  });

  it("publishes only truthful Organization and WebSite structured data", () => {
    const structured = JSON.stringify(marketingStructuredData());
    expect(structured).toContain('"@type":"Organization"');
    expect(structured).toContain('"@type":"WebSite"');
    expect(structured).toContain('"legalName":"Tavrix LLC"');
    expect(structured).not.toMatch(/aggregateRating|Review|LocalBusiness|PostalAddress/);
  });

  it("permanently redirects www to the canonical host while preserving the route", () => {
    const wwwUrl = new URL("https://www.waflo.app/ar/pricing?source=share") as URL & {
      clone: () => URL;
    };
    wwwUrl.clone = () => new URL(wwwUrl);
    const response = marketingProxy({
      nextUrl: wwwUrl,
      headers: new Headers({ host: "www.waflo.app" }),
    } as never);
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://waflo.app/ar/pricing?source=share");

    const rootUrl = new URL("https://waflo.app/") as URL & { clone: () => URL };
    rootUrl.clone = () => new URL(rootUrl);
    const rootResponse = marketingProxy({
      nextUrl: rootUrl,
      headers: new Headers({ host: "waflo.app" }),
    } as never);
    expect(rootResponse.status).toBe(308);
    expect(rootResponse.headers.get("location")).toBe("https://waflo.app/en");
  });

  it("keeps FAQ and locale-aware public/legal links discoverable", () => {
    const home = readFileSync(resolve(root, "apps/marketing-web/app/[locale]/page.tsx"), "utf8");
    const shell = readFileSync(
      resolve(root, "apps/marketing-web/components/marketing-shell.tsx"),
      "utf8",
    );
    expect(home).toContain('id="features"');
    expect(home).toContain('id="faq"');
    for (const route of ["/pricing", "/contact", "/privacy", "/terms"]) {
      expect(shell).toContain(route);
    }
    expect(shell).toContain("/" + "$" + "{alternate}" + "$" + "{path}");
  });

  it("removes obsolete implementation-phase promises from launch-facing copy", () => {
    const sources = [
      "apps/marketing-web/app/[locale]/page.tsx",
      "apps/marketing-web/app/[locale]/pricing/page.tsx",
      "apps/merchant-dashboard/components/dashboard-screens.tsx",
      "apps/merchant-dashboard/components/onboarding.tsx",
      "apps/merchant-dashboard/components/program-studio-editor.tsx",
    ]
      .map((path) => readFileSync(resolve(root, path), "utf8"))
      .join("\n");
    expect(sources).not.toMatch(/\bW[1-4]\b|coming soon|قريباً/);
  });

  it("routes unknown localized URLs through the branded 404 boundaries", () => {
    for (const route of [
      "apps/marketing-web/app/[locale]/[...notFound]/page.tsx",
      "apps/merchant-dashboard/app/[locale]/[...notFound]/page.tsx",
    ]) {
      const source = readFileSync(resolve(root, route), "utf8");
      expect(source).toContain("notFound()");
    }
  });

  it("rejects absent and placeholder support addresses", () => {
    expect(configuredSupportEmail("")).toBeNull();
    expect(configuredSupportEmail("REPLACE_WITH_VERIFIED_SUPPORT_EMAIL")).toBeNull();
    expect(configuredSupportEmail("not-an-email")).toBeNull();
    expect(configuredSupportEmail("support@example.test")).toBe("support@example.test");
    expect(configuredLegalEffectiveDate("en", "REPLACE_AFTER_LEGAL_REVIEW")).toBe(
      "To be confirmed after legal review",
    );
    expect(configuredLegalEffectiveDate("ar", "REPLACE_AFTER_LEGAL_REVIEW")).toBe(
      "يُحدد بعد المراجعة القانونية",
    );
    expect(configuredLegalEffectiveDate("en", "2026-09-01")).toBe("2026-09-01");
  });

  it("ships valid icon and social-image references without recreating artifacts", () => {
    for (const app of ["marketing-web", "customer-web", "merchant-dashboard"]) {
      const publicRoot = resolve(root, "apps", app, "public");
      const manifest = JSON.parse(
        readFileSync(resolve(publicRoot, "site.webmanifest"), "utf8"),
      ) as { icons: { sizes: string; src: string }[] };
      for (const icon of manifest.icons) {
        const iconPath = resolve(publicRoot, icon.src.slice(1));
        expect(existsSync(iconPath)).toBe(true);
        const image = readFileSync(iconPath);
        expect(`${image.readUInt32BE(16)}x${image.readUInt32BE(20)}`).toBe(icon.sizes);
      }
    }

    const socialImage = readFileSync(
      resolve(root, "apps/marketing-web/public/brand/waflo-open-graph-1200x630.png"),
    );
    expect(socialImage.readUInt32BE(16)).toBe(1200);
    expect(socialImage.readUInt32BE(20)).toBe(630);
    expect(existsSync(resolve(root, "artifacts"))).toBe(false);
  });

  it("passes the deployment environment into immutable Web builds", () => {
    const dockerfile = readFileSync(resolve(root, "deploy/vps/Dockerfile"), "utf8");
    const compose = readFileSync(resolve(root, "deploy/vps/compose.yml"), "utf8");
    const deploymentEnvironment = "$" + "{DEPLOYMENT_ENVIRONMENT}";
    const requiredDeploymentEnvironment =
      "$" + "{DEPLOYMENT_ENVIRONMENT:?DEPLOYMENT_ENVIRONMENT is required}";
    expect(dockerfile).toContain("ARG DEPLOYMENT_ENVIRONMENT");
    expect(dockerfile).toContain(`ENV DEPLOYMENT_ENVIRONMENT=${deploymentEnvironment}`);
    expect(compose).toContain(`DEPLOYMENT_ENVIRONMENT: "${requiredDeploymentEnvironment}"`);
  });
});
