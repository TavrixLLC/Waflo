import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const deploymentRoot = resolve(root, "deploy/vps");
const compose = readFileSync(resolve(deploymentRoot, "compose.yml"), "utf8");
const dockerfile = readFileSync(resolve(deploymentRoot, "Dockerfile"), "utf8");
const deploymentEnvironmentVariable = "$" + "{DEPLOYMENT_ENVIRONMENT}";
const releaseShaVariable = "$" + "{RELEASE_SHA}";

function deploymentFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return deploymentFiles(path);
    return entry.isFile() ? [path] : [];
  });
}

describe("production deployment platform", () => {
  it("keeps every service private at the host boundary", () => {
    expect(compose).not.toMatch(/^\s+ports:/m);
    expect(compose).toContain("internal: true");
    expect(compose).toContain("networks: [backend]");
    expect(compose).not.toContain("network_mode: host");
  });

  it("uses shared state and a separate migration operation", () => {
    expect(compose).toContain("API_INTERNAL_URL: http://api:4000");
    expect(compose).toContain("OBJECT_STORAGE_BUCKET");
    expect(compose).toContain("profiles: [tools]");
    expect(dockerfile).toContain('CMD ["./node_modules/.bin/prisma", "migrate", "deploy"]');
    expect(`${compose}\n${dockerfile}`).not.toContain("migrate:dev");
  });

  it("externalizes secrets and immutable release identity", () => {
    expect(compose).toContain("/opt/waflo-platform/secrets/");
    expect(compose).toContain("cloudflare_tunnel_token");
    expect(compose).toContain("--token-file");
    expect(compose).not.toMatch(/TUNNEL_TOKEN\s*:/);
    expect(compose).toContain(`${releaseShaVariable}-${deploymentEnvironmentVariable}`);
    expect(dockerfile).toContain("org.opencontainers.image.revision");
  });

  it("contains no legacy deployment root or inter-container localhost dependency", () => {
    const contents = deploymentFiles(deploymentRoot)
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    expect(contents).not.toMatch(/\/opt\/waflo(?!-platform)/);
    expect(contents).not.toMatch(/https?:\/\/localhost/);
    expect(contents).toContain("/opt/waflo-platform");
  });

  it("keeps staging and production state namespaces configurable and separate", () => {
    expect(compose).toContain('name: "waflo-${DEPLOYMENT_ENVIRONMENT:');
    expect(compose).toContain(`data/${deploymentEnvironmentVariable}/postgres`);
    expect(compose).toContain(`data/${deploymentEnvironmentVariable}/redis`);
    expect(compose).toContain(`data/${deploymentEnvironmentVariable}/object-storage`);
    expect(compose).toContain(`secrets/${deploymentEnvironmentVariable}`);
  });
});
