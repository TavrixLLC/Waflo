import { readdirSync, readFileSync } from "node:fs";
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
const realProviderRunbook = readFileSync(
  resolve(root, "docs/release/real-provider-configuration.md"),
  "utf8",
);
const bake = readFileSync(resolve(deploymentRoot, "docker-bake.hcl"), "utf8");
const common = readFileSync(resolve(deploymentRoot, "scripts/common.sh"), "utf8");
const deploy = readFileSync(resolve(deploymentRoot, "scripts/deploy.sh"), "utf8");
const prepareHost = readFileSync(resolve(deploymentRoot, "scripts/prepare-host.sh"), "utf8");
const minioInit = readFileSync(resolve(deploymentRoot, "scripts/minio-init.sh"), "utf8");
const publishImages = readFileSync(resolve(deploymentRoot, "scripts/publish-images.sh"), "utf8");
const smokeNodeReleaseImages = readFileSync(
  resolve(deploymentRoot, "scripts/smoke-node-release-images.sh"),
  "utf8",
);
const rollback = readFileSync(resolve(deploymentRoot, "scripts/rollback.sh"), "utf8");
const cloudflareTokenPermissionTest = readFileSync(
  resolve(root, "tests/deployment/cloudflare-token-permissions.test.sh"),
  "utf8",
);
const deployFromGitHub = readFileSync(
  resolve(deploymentRoot, "scripts/deploy-from-github.sh"),
  "utf8",
);
const releaseEntrypoint = readFileSync(
  resolve(deploymentRoot, "scripts/release-deploy-entrypoint.sh"),
  "utf8",
);
const playwrightRunner = readFileSync(resolve(root, "scripts/run-playwright.mjs"), "utf8");
const templateGalleryFixture = readFileSync(
  resolve(root, "tests/e2e/template-gallery-fixtures.ts"),
  "utf8",
);
const deploymentEnvironmentVariable = "$" + "{DEPLOYMENT_ENVIRONMENT}";
const releaseShaVariable = "$" + "{RELEASE_SHA}";
const localReleaseShaVariable = "$" + "{release_sha}";
const postgresBindVariable = "$" + "{postgres_bind}";
const pgdataVariable = "$" + "{pgdata}";
const environmentVariable = "$" + "{environment}";
const mcConfigDirectoryVariable = "$" + "{MC_CONFIG_DIR}";
const cloudflaredContainerGidVariable = "$" + "{CLOUDFLARED_CONTAINER_GID}";
const tokenFileVariable = "$" + "{token_file}";
const referenceVariable = "$" + "{reference}";
const scriptDirectoryVariable = "$" + "{script_directory}";

function deploymentFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return deploymentFiles(path);
    return entry.isFile() ? [path] : [];
  });
}

describe("production deployment platform", () => {
  it("builds browser-test frontends with their active API target in Next production mode", () => {
    expect(playwrightRunner).toContain('NODE_ENV: "production"');
    expect(playwrightRunner).toContain('WAFLO_E2E_NEXT_START: "1"');
    expect(playwrightRunner).toContain("WAFLO_E2E_API_URL: process.env.NEXT_PUBLIC_API_URL");
    expect(playwrightRunner).toContain(
      "runCommand(build.command, build.args, browserBuildEnvironment)",
    );
    expect(playwrightRunner).toContain(
      "runCommand(customer.command, customer.args, browserBuildEnvironment)",
    );
    expect(playwrightRunner).toContain('"start", "-p"');
    expect(playwrightRunner).toContain("stable localhost origins");
    expect(playwrightRunner).toContain("strict CSRF cookie is sent");
    expect(playwrightRunner).toContain('WAFLO_E2E_NEXT_START: "1"');
    expect(playwrightRunner).toContain("PORT: String(command.port)");
    expect(playwrightRunner).not.toContain("await prepareStandaloneFrontends()");
    expect(playwrightRunner).toContain('"@waflo/i18n", "build"');
    expect(playwrightRunner).toContain('"@waflo/ui", "build"');
    expect(playwrightRunner).toContain("process.env.API_INTERNAL_URL");
    expect(playwrightRunner).toContain("await buildBrowserFrontends()");
    expect(playwrightRunner).toContain("prior isolated random API port");
    expect(playwrightRunner).toContain('["chromium", "accessibility"].includes(project)');
  });

  it("keeps browser fixtures bound to every isolated loopback API port", () => {
    expect(templateGalleryFixture).toContain("localhost|127\\.0\\.0\\.1");
    expect(templateGalleryFixture).toContain("isolatedLoopbackApiRoute");
  });

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
    expect(stagingApplication).toContain("STRIPE_PUBLISHABLE_KEY=pk_test_PUBLIC_VALUE");
    expect(productionApplication).toContain("STRIPE_PUBLISHABLE_KEY=pk_live_PUBLIC_VALUE");
  });

  it("documents the same complete Stripe catalog enforced by deployed configuration", () => {
    expect(realProviderRunbook).toMatch(/complete nine-Price\s+catalog/u);
    expect(realProviderRunbook).toContain("USD 79.75 every 3 months");
    expect(realProviderRunbook).toContain("USD 1,290.00 every year");
    expect(realProviderRunbook).toContain("publishable key, webhook secret, and all nine");
    expect(realProviderRunbook).not.toContain("optional quarterly/yearly");
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

  it("prepares the PostgreSQL bind for the pinned image identity before startup", () => {
    const preparationCall = `prepare_postgres_bind "${environmentVariable}"`;
    expect(common).toContain("readonly POSTGRES_CONTAINER_UID=70");
    expect(common).toContain("readonly POSTGRES_CONTAINER_GID=70");
    expect(common).toContain("prepare_postgres_bind()");
    expect(common).toContain(`find "${postgresBindVariable}" -xdev`);
    expect(common).toContain("chown --no-dereference");
    expect(common).toContain(`chmod 0700 "${pgdataVariable}"`);
    expect(prepareHost).toContain(preparationCall);
    expect(deploy).toContain(preparationCall);
    expect(deploy.indexOf(preparationCall)).toBeLessThan(
      deploy.indexOf("compose up -d --no-build postgres redis minio"),
    );
  });

  it("repairs only the Cloudflare token for its pinned non-root container identity", () => {
    const preparationCall = `prepare_cloudflare_tunnel_token "${environmentVariable}"`;
    expect(compose).toContain('user: "65532:65532"');
    expect(compose).toMatch(/cloudflare_tunnel_token\n\s+mode: 0440/u);
    expect(common).toContain("readonly CLOUDFLARED_CONTAINER_UID=65532");
    expect(common).toContain("readonly CLOUDFLARED_CONTAINER_GID=65532");
    expect(common).toContain(`chown --no-dereference "0:${cloudflaredContainerGidVariable}"`);
    expect(common).toContain(`chmod 0440 -- "${tokenFileVariable}"`);
    expect(common).toContain("may not grant permissions to other users");
    expect(common).toContain("! -name cloudflare_tunnel_token ! -perm 0600");
    expect(common).not.toContain("chmod 0644");
    expect(deploy).toContain(preparationCall);
    expect(rollback).toContain(preparationCall);
    expect(prepareHost).toContain(preparationCall);
    expect(common).toContain(
      `export CLOUDFLARE_TUNNEL_TOKEN_FILE="$(cloudflare_tunnel_token_path "${environmentVariable}")"`,
    );
    expect(deploy.indexOf(preparationCall)).toBeLessThan(
      deploy.indexOf("assert_secret_permissions"),
    );
    expect(cloudflareTokenPermissionTest).toContain("cmp --silent");
    expect(cloudflareTokenPermissionTest).toContain("World-readable Cloudflare token was accepted");
    expect(cloudflareTokenPermissionTest).toContain("symlink substitution was accepted");
    expect(cloudflareTokenPermissionTest).toContain("600:0:0");
    expect(workflow).toContain("sudo bash tests/deployment/cloudflare-token-permissions.test.sh");
  });

  it("uses only ephemeral writable MinIO client configuration", () => {
    expect(minioInit).toContain("MC_CONFIG_DIR=/tmp/.mc");
    expect(minioInit).toContain("export MC_CONFIG_DIR");
    expect(minioInit).toContain(`mkdir -p "${mcConfigDirectoryVariable}"`);
    expect(minioInit).toContain(`rm -rf "${mcConfigDirectoryVariable}"`);
    expect(minioInit).toContain("mc_cmd() {");
    expect(minioInit).toContain(`mc --config-dir "${mcConfigDirectoryVariable}" "$@"`);
    expect(minioInit.match(/^mc_cmd /gmu)).toHaveLength(7);
    expect(minioInit.match(/^\s*mc /gmu)).toHaveLength(1);
    expect(compose).not.toContain("target: /root/.mc");
    expect(compose).not.toContain("target: /tmp/.mc");
    expect(compose).not.toContain("privileged: true");
    expect(compose).toContain("security_opt: [no-new-privileges:true]");
  });

  it("recreates only the release-bound MinIO provisioning container", () => {
    const removeMinioInit = "compose rm --force --stop minio-init";
    const runMinioInit = "compose up --no-build minio-init";
    expect(deploy.match(/compose rm --force --stop minio-init/gmu)).toHaveLength(1);
    expect(deploy).not.toContain("compose down");
    expect(deploy).not.toContain("compose rm --volumes");
    expect(deploy.indexOf("compose up -d --no-build postgres redis minio")).toBeLessThan(
      deploy.indexOf(removeMinioInit),
    );
    expect(deploy.indexOf(removeMinioInit)).toBeLessThan(deploy.indexOf(runMinioInit));
    expect(deploy.indexOf(runMinioInit)).toBeLessThan(deploy.indexOf("compose run --rm migrate"));
  });

  it("keeps each hardened tmpfs mount in one Compose argument", () => {
    expect(compose).not.toMatch(/tmpfs:\s*\[/u);
    expect(compose).not.toMatch(/^\s*-\s*(?:noexec|nosuid|nodev)\s*$/mu);
    expect(compose.match(/^\s+- "\/[^"]+:rw,noexec,nosuid,size=\d+m"$/gmu)).toHaveLength(10);
    expect(compose).toContain('      - "/tmp:rw,noexec,nosuid,size=64m"');
    expect(deploy.match(/compose run --rm migrate/gmu)).toHaveLength(1);
  });

  it("uses one authoritative, immutable-action release workflow without duplicated test gates", () => {
    expect(readdirSync(workflowRoot).filter((name) => /\.ya?ml$/u.test(name))).toEqual(["ci.yml"]);
    expect(workflow).toContain("release/production-v1");
    expect(workflow).toContain("needs: verify");
    expect(workflow).toContain("run: pnpm test");
    expect(workflow).not.toMatch(/run: pnpm test:(unit|integration|http|concurrency)/u);
    expect(workflow).toContain("run: pnpm audit:production");
    const audit = readFileSync(resolve(root, "scripts/check-production-audit.mjs"), "utf8");
    expect(audit).toContain('const acceptedPrismaDeepmergeAdvisory = "GHSA-ggr8-5vv4-36mx"');
    expect(audit).not.toContain("acceptedSharpAdvisory");
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

  it("smoke tests the exact final Node release images before staging deployment", () => {
    expect(publishImages).toContain(
      `"${scriptDirectoryVariable}/smoke-node-release-images.sh" staging "${localReleaseShaVariable}"`,
    );
    for (const service of ["api", "operational-worker", "wallet-worker"]) {
      expect(smokeNodeReleaseImages).toContain(service);
    }
    expect(smokeNodeReleaseImages).toContain("docker image inspect");
    expect(smokeNodeReleaseImages).toContain("await import(entry)");
    expect(smokeNodeReleaseImages).toContain("import.meta.resolve(specifier");
    expect(smokeNodeReleaseImages).toContain("startup-reachable bare imports");
    expect(smokeNodeReleaseImages).toContain("parseEnvironment(process.env)");
    expect(smokeNodeReleaseImages).toContain("ERR_MODULE_NOT_FOUND|Cannot find package");
    expect(smokeNodeReleaseImages).toContain(`docker run --rm "${referenceVariable}"`);
    expect(smokeNodeReleaseImages).not.toContain("--privileged");
    expect(smokeNodeReleaseImages).not.toContain("--user root");
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
    expect(deploy).toContain("node dist/readiness.js");
    expect(deploy.indexOf("node dist/readiness.js")).toBeLessThan(
      deploy.indexOf("assert_public_health"),
    );
    expect(deploy.indexOf("assert_public_health")).toBeLessThan(deploy.indexOf("ln -sfn"));
  });
});
