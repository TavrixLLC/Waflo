import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Kurdish Sirwan font coverage", () => {
  const marketingLayout = source("apps/marketing-web/app/[locale]/layout.tsx");
  const dashboardLayout = source("apps/merchant-dashboard/app/[locale]/layout.tsx");
  const customerLayout = source("apps/customer-web/app/layout.tsx");
  const dashboardStyles = source("apps/merchant-dashboard/app/globals.css");
  const marketingStyles = source("apps/marketing-web/app/globals.css");
  const customerStyles = source("apps/customer-web/app/globals.css");

  it("ships the supplied browser-safe font with every Kurdish-capable surface", () => {
    const font = resolve(process.cwd(), "packages/brand/assets/fonts/Sirwan.ttf");

    expect(existsSync(font)).toBe(true);
    expect(statSync(font).size).toBeGreaterThan(0);
    for (const layout of [marketingLayout, dashboardLayout, customerLayout]) {
      expect(layout).toContain("localFont");
      expect(layout).toContain("Sirwan.ttf");
      expect(layout).toContain('variable: "--font-sirwan"');
    }
  });

  it("uses Sirwan for both configured Arabic-script Kurdish variants without replacing Arabic", () => {
    for (const styles of [dashboardStyles, marketingStyles]) {
      expect(styles).toContain("kmr-Arab-IQ");
      expect(styles).toContain("ckb-Arab-IQ");
      expect(styles).toContain("var(--font-sirwan)");
      expect(styles).toContain("var(--font-cairo)");
    }
    expect(customerStyles).toContain(":lang(ckb)");
    expect(customerStyles).toContain(":lang(kmr)");
    expect(customerStyles).toContain("var(--font-sirwan)");
    expect(dashboardStyles).toContain('html[data-interface-typography="cairo"]');
  });
});
