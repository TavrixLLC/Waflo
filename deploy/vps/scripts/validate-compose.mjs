import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repository = resolve(import.meta.dirname, "../../..");
const composeFile = join(repository, "deploy", "vps", "compose.yml");
const scratch = mkdtempSync(join(tmpdir(), "waflo-compose-validation-"));
const applicationEnvironment = join(scratch, "application.env");
const secretEnvironment = join(scratch, "application.secret.env");
writeFileSync(applicationEnvironment, "NODE_ENV=production\n", { mode: 0o600 });
writeFileSync(secretEnvironment, "DATABASE_URL=postgresql://dummy:dummy@postgres:5432/dummy\n", {
  mode: 0o600,
});

const secretNames = [
  "postgres_password",
  "redis_password",
  "minio_root_user",
  "minio_root_password",
  "object_storage_access_key",
  "object_storage_secret_key",
  "cloudflare_tunnel_token",
];
const secretPaths = Object.fromEntries(
  secretNames.map((name) => {
    const path = join(scratch, name);
    writeFileSync(path, "dummy-value-at-least-32-characters-long", { mode: 0o600 });
    return [name, path];
  }),
);

function render(environment) {
  const staging = environment === "staging";
  const childEnvironment = {
    ...process.env,
    DEPLOYMENT_ENVIRONMENT: environment,
    RELEASE_SHA: "4357675fad87bc8371e7832b6c0beee22b5caf61",
    PLATFORM_ROOT: scratch,
    WAFLO_ENV_FILE: applicationEnvironment,
    WAFLO_SECRET_ENV_FILE: secretEnvironment,
    POSTGRES_PASSWORD_FILE: secretPaths.postgres_password,
    REDIS_PASSWORD_FILE: secretPaths.redis_password,
    MINIO_ROOT_USER_FILE: secretPaths.minio_root_user,
    MINIO_ROOT_PASSWORD_FILE: secretPaths.minio_root_password,
    OBJECT_STORAGE_ACCESS_KEY_FILE: secretPaths.object_storage_access_key,
    OBJECT_STORAGE_SECRET_KEY_FILE: secretPaths.object_storage_secret_key,
    CLOUDFLARE_TUNNEL_TOKEN_FILE: secretPaths.cloudflare_tunnel_token,
    POSTGRES_DB: staging ? "waflo_staging" : "waflo_production",
    POSTGRES_USER: staging ? "waflo_staging" : "waflo_production",
    OBJECT_STORAGE_BUCKET: staging ? "waflo-staging-private" : "waflo-production-private",
    WAFLO_EDGE_SUBNET: staging ? "10.210.10.0/24" : "10.210.20.0/24",
    WAFLO_BACKEND_SUBNET: staging ? "10.210.11.0/24" : "10.210.21.0/24",
    NEXT_PUBLIC_API_URL: staging ? "https://api.staging.waflo.app" : "https://api.waflo.app",
    NEXT_PUBLIC_DASHBOARD_URL: staging ? "https://app.staging.waflo.app" : "https://app.waflo.app",
    NEXT_PUBLIC_MARKETING_URL: staging ? "https://app.staging.waflo.app" : "https://waflo.app",
    NEXT_PUBLIC_LEGAL_EFFECTIVE_DATE: "2026-08-10",
  };
  const result = spawnSync(
    "docker",
    ["compose", "-f", composeFile, "--profile", "tools", "config", "--format", "json"],
    { cwd: repository, env: childEnvironment, encoding: "utf8", shell: false },
  );
  if (result.status !== 0) {
    throw new Error(`${environment} Compose rendering failed: ${result.stderr.trim()}`);
  }
  return JSON.parse(result.stdout);
}

for (const environment of ["staging", "production"]) {
  const model = render(environment);
  if (model.name !== `waflo-${environment}`) throw new Error("Compose project isolation failed.");
  for (const [name, service] of Object.entries(model.services)) {
    if (service.ports?.length) throw new Error(`${name} unexpectedly publishes a host port.`);
  }
  for (const name of ["postgres", "redis", "minio"]) {
    const networks = Object.keys(model.services[name].networks ?? {});
    if (networks.length !== 1 || !networks[0].endsWith("backend")) {
      throw new Error(`${name} is not isolated on the backend network.`);
    }
  }
  if (!model.services.migrate.profiles?.includes("tools")) {
    throw new Error("Migrations are not an explicit one-shot tool service.");
  }
  if (!model.services.api.image.includes("4357675fad87bc8371e7832b6c0beee22b5caf61")) {
    throw new Error("The release SHA is missing from application image identity.");
  }
  if (model.services.cloudflared.environment?.TUNNEL_TOKEN) {
    throw new Error("Cloudflare token must not be an environment value.");
  }
  process.stdout.write(`${environment} Compose: valid, private, release-addressed\n`);
}
