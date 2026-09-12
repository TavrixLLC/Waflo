import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("release image runtime dependency declarations", () => {
  it("declares dotenv in the operational worker production dependency graph", () => {
    const manifest = JSON.parse(
      readFileSync(resolve("apps/operational-worker/package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    const entrypoint = readFileSync(resolve("apps/operational-worker/src/main.ts"), "utf8");

    expect(entrypoint).toContain('import "dotenv/config"');
    expect(manifest.dependencies?.dotenv).toBe("17.4.2");
  });

  it("includes the standalone Admin runtime in the release image and Compose matrix", () => {
    const dockerfile = readFileSync(resolve("deploy/vps/Dockerfile"), "utf8");
    const compose = readFileSync(resolve("deploy/vps/compose.yml"), "utf8");

    expect(dockerfile).toContain("FROM runtime AS admin-web");
    expect(dockerfile).toContain("/workspace/apps/admin-dashboard/.next/standalone");
    expect(dockerfile).toContain("EXPOSE 3003");
    expect(compose).toContain("  admin-web:");
    expect(compose).toContain("target: admin-web");
    expect(compose).toContain("NEXT_PUBLIC_ADMIN_URL");
  });
});
