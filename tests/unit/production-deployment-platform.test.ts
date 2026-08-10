import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const deploymentRoot = resolve(root, "deploy/vps");
const compose = readFileSync(resolve(deploymentRoot, "compose.yml"), "utf8");
const dockerfile = readFileSync(resolve(deploymentRoot, "Dockerfile"), "utf8");
const stagingApplication = readFileSync(
  resolve(deploymentRoot, "templates/staging/application.env.example"),
  "utf8",
);
const productionApplication = readFileSync(
  resolve(deploymentRoot, "templates/production/application.env.example"),
  "utf8",
);
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

  it("mounts provider files read-only only into the API and Wallet worker", () => {
    expect(compose.match(/target: \/run\/waflo-provider-secrets/g)).toHaveLength(2);
    expect(compose.match(/read_only: true/g)?.length).toBeGreaterThanOrEqual(2);
    expect(stagingApplication).toContain(
      "GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_PATH_OR_BASE64=/run/waflo-provider-secrets/google-wallet-service-account.json",
    );
    expect(stagingApplication).toContain(
      "APPLE_PASS_CERTIFICATE_PATH_OR_BASE64=/run/waflo-provider-secrets/apple-wallet-pass.p12",
    );
    expect(productionApplication).toContain(
      "APPLE_WWDR_CERTIFICATE_PATH_OR_BASE64=/run/waflo-provider-secrets/apple-wwdr.pem",
    );
  });

  it("uses real provider modes with isolated staging and production boundaries", () => {
    expect(stagingApplication).toContain("GOOGLE_WALLET_MODE=REAL");
    expect(stagingApplication).toContain("GOOGLE_WALLET_PUBLISHING_MODE=DEMO");
    expect(stagingApplication).toContain("APPLE_WALLET_MODE=REAL");
    expect(stagingApplication).toContain("APPLE_APNS_ENVIRONMENT=production");
    expect(productionApplication).toContain("GOOGLE_WALLET_PUBLISHING_MODE=PUBLISHING");
    expect(stagingApplication).not.toContain("STRIPE_PUBLISHABLE_KEY");
    expect(productionApplication).not.toContain("STRIPE_PUBLISHABLE_KEY");
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
