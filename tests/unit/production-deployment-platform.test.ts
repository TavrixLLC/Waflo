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
const workflowRoot = resolve(root, ".github/workflows");
const workflow = readFileSync(resolve(workflowRoot, "ci.yml"), "utf8");
const bake = readFileSync(resolve(deploymentRoot, "docker-bake.hcl"), "utf8");
const common = readFileSync(resolve(deploymentRoot, "scripts/common.sh"), "utf8");
const deploy = readFileSync(resolve(deploymentRoot, "scripts/deploy.sh"), "utf8");
const publishImages = readFileSync(resolve(deploymentRoot, "scripts/publish-images.sh"), "utf8");
const rollback = readFileSync(resolve(deploymentRoot, "scripts/rollback.sh"), "utf8");
const deployFromGitHub = readFileSync(
  resolve(deploymentRoot, "scripts/deploy-from-github.sh"),
  "utf8",
);
const releaseEntrypoint = readFileSync(
  resolve(deploymentRoot, "scripts/release-deploy-entrypoint.sh"),
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

  it("uses one authoritative, immutable-action release workflow without duplicated test gates", () => {
    expect(readdirSync(workflowRoot).filter((name) => /\.ya?ml$/u.test(name))).toEqual(["ci.yml"]);
    expect(workflow).toContain("release/production-v1");
    expect(workflow).toContain("needs: verify");
    expect(workflow).toContain("run: pnpm test");
    expect(workflow).not.toMatch(/run: pnpm test:(unit|integration|http|concurrency)/u);
    expect(workflow).toContain("run: pnpm audit:production");
    expect(workflow).toContain("run: pnpm deploy:validate");
    expect(workflow).not.toMatch(/uses:\s+[^\s]+@v\d/u);
    expect(workflow).not.toContain("artifacts/");
    expect(workflow).toContain("retention-days: 3");
  });

  it("builds invariant services once and preserves distinct Web environment outputs", () => {
    for (const target of ["migrate", "api", "operational-worker", "wallet-worker"]) {
      const section = bake.slice(bake.indexOf(`target "${target}"`));
      expect(section.slice(0, section.indexOf("\n}"))).toContain("-staging");
      expect(section.slice(0, section.indexOf("\n}"))).toContain("-production");
    }
    expect(bake).toContain('target "merchant-staging"');
    expect(bake).toContain('target "merchant-production"');
    expect(bake).toContain('DEPLOYMENT_ENVIRONMENT          = "staging"');
    expect(bake).toContain('DEPLOYMENT_ENVIRONMENT          = "production"');
    expect(bake).toContain('"type=provenance,mode=max"');
    expect(bake).toContain('"type=sbom"');
    expect(bake).not.toMatch(/SECRET|PASSWORD|PRIVATE_KEY|SERVICE_ACCOUNT/u);
  });

  it("keeps legal approval runtime-scoped and fails closed before production mutation", () => {
    expect(workflow).not.toContain("NEXT_PUBLIC_LEGAL_EFFECTIVE_DATE");
    expect(bake).not.toContain("LEGAL_EFFECTIVE_DATE");
    expect(publishImages).not.toContain("LEGAL_EFFECTIVE_DATE");
    expect(stagingApplication).toContain("LEGAL_EFFECTIVE_DATE=");
    expect(productionApplication).toContain("LEGAL_EFFECTIVE_DATE=");
    expect(common).toContain("assert_legal_release_state");
    expect(common).toContain("Production requires the counsel-approved LEGAL_EFFECTIVE_DATE");
    expect(deploy.indexOf("assert_legal_release_state")).toBeLessThan(
      deploy.indexOf("pull_release_images"),
    );
    expect(rollback.indexOf("assert_legal_release_state")).toBeLessThan(
      rollback.indexOf("compose pull"),
    );
  });

  it("serializes deployments and promotes production without rebuilding", () => {
    expect(workflow).toContain("group: waflo-deploy-staging");
    expect(workflow).toContain("group: waflo-deploy-production");
    expect(workflow.match(/cancel-in-progress: false/g)).toHaveLength(2);
    expect(workflow).toContain("verify-release-images.sh production");
    const productionJob = workflow.slice(workflow.indexOf("  deploy_production:"));
    expect(productionJob).not.toContain("publish-images.sh");
    expect(productionJob).not.toContain("pnpm test");
  });

  it("uses pinned SSH identity and advances the release only after migration and health", () => {
    expect(deployFromGitHub).toContain("StrictHostKeyChecking=yes");
    expect(deployFromGitHub).not.toContain("StrictHostKeyChecking=no");
    expect(deployFromGitHub).toContain("VPS_SSH_HOST_KEY");
    expect(releaseEntrypoint).toContain('expected_sudo_user="waflo-deploy-$' + '{environment}"');
    expect(deploy.indexOf("pull_release_images")).toBeLessThan(
      deploy.indexOf("compose run --rm migrate"),
    );
    expect(deploy.indexOf("compose run --rm migrate")).toBeLessThan(
      deploy.indexOf("compose up -d --no-build --wait"),
    );
    expect(deploy.indexOf("assert_public_health")).toBeLessThan(deploy.indexOf("ln -sfn"));
  });
});
