import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repository = resolve(import.meta.dirname, "../../..");
const composeFile = join(repository, "deploy", "vps", "compose.yml");
const scratch = mkdtempSync(join(tmpdir(), "waflo-compose-validation-"));
mkdirSync(join(scratch, "secrets", "staging", "provider-files"), { recursive: true });
mkdirSync(join(scratch, "secrets", "production", "provider-files"), { recursive: true });
for (const environment of ["staging", "production"]) {
  const providerDirectory = join(scratch, "secrets", environment, "provider-files");
  writeFileSync(
    join(providerDirectory, "google-wallet-service-account.json"),
    '{"client_email":"dummy@example.invalid","private_key":"DUMMY"}\n',
    { mode: 0o440 },
  );
  writeFileSync(join(providerDirectory, "apple-wallet-pass.p12"), "DUMMY-P12\n", {
    mode: 0o440,
  });
  writeFileSync(join(providerDirectory, "apple-wwdr.pem"), "DUMMY-WWDR\n", { mode: 0o440 });
}

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
  const apiOrigin = staging ? "https://api.staging.waflo.app" : "https://api.waflo.app";
  const customerOrigin = staging ? "https://card.staging.waflo.app" : "https://card.waflo.app";
  const applicationEnvironment = join(scratch, `application-${environment}.env`);
  const secretEnvironment = join(scratch, `application-${environment}.secret.env`);
  writeFileSync(
    applicationEnvironment,
    [
      "NODE_ENV=production",
      `DEPLOYMENT_ENVIRONMENT=${environment}`,
      "SUPPORT_EMAIL=support@example.invalid",
      "GOOGLE_WALLET_MODE=REAL",
      "GOOGLE_WALLET_ISSUER_ID=1234567890123456789",
      "GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_PATH_OR_BASE64=/run/waflo-provider-secrets/google-wallet-service-account.json",
      `GOOGLE_WALLET_ALLOWED_ORIGINS=${customerOrigin}`,
      `GOOGLE_WALLET_PUBLIC_ASSET_BASE_URL=${apiOrigin}/v1/public/wallet-assets`,
      `GOOGLE_WALLET_PUBLISHING_MODE=${staging ? "DEMO" : "PUBLISHING"}`,
      "APPLE_WALLET_MODE=REAL",
      "APPLE_PASS_TYPE_IDENTIFIER=pass.app.waflo.compose-validation",
      "APPLE_TEAM_IDENTIFIER=TEAM123456",
      "APPLE_PASS_CERTIFICATE_PATH_OR_BASE64=/run/waflo-provider-secrets/apple-wallet-pass.p12",
      "APPLE_WWDR_CERTIFICATE_PATH_OR_BASE64=/run/waflo-provider-secrets/apple-wwdr.pem",
      `APPLE_PASS_WEB_SERVICE_URL=${apiOrigin}/v1/apple-wallet`,
      "APPLE_APNS_ENVIRONMENT=production",
      "STRIPE_STARTER_MONTHLY_PRICE_ID=price_dummy_starter",
      "STRIPE_GROWTH_MONTHLY_PRICE_ID=price_dummy_growth",
      "STRIPE_SCALE_MONTHLY_PRICE_ID=price_dummy_scale",
      "STRIPE_CUSTOMER_PORTAL_CONFIGURATION_ID=bpc_dummy",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  writeFileSync(
    secretEnvironment,
    [
      "DATABASE_URL=postgresql://dummy:dummy@postgres:5432/dummy",
      "APPLE_PASS_CERTIFICATE_PASSWORD=dummy-password",
      'APPLE_PASS_AUTH_SECRETS_JSON={"1":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}',
      "APPLE_PASS_AUTH_ACTIVE_SECRET_VERSION=1",
      "APPLE_PASS_AUTH_SECRET_V1=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      `STRIPE_SECRET_KEY=${staging ? "sk_test_dummy" : "sk_live_dummy"}`,
      "STRIPE_WEBHOOK_SECRET=whsec_dummy",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
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
    NEXT_PUBLIC_MARKETING_URL: "https://waflo.app",
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
  for (const serviceName of ["merchant-web", "customer-web", "marketing-web"]) {
    if (model.services[serviceName].build?.args?.DEPLOYMENT_ENVIRONMENT !== environment) {
      throw new Error(`${serviceName} did not receive the environment-qualified Web build flag.`);
    }
  }
  if (model.services.cloudflared.environment?.TUNNEL_TOKEN) {
    throw new Error("Cloudflare token must not be an environment value.");
  }
  for (const serviceName of ["api", "wallet-worker"]) {
    const providerMount = model.services[serviceName].volumes?.find(
      (volume) => volume.target === "/run/waflo-provider-secrets",
    );
    if (providerMount?.read_only !== true) {
      throw new Error(`${serviceName} is missing the read-only provider secret-file mount.`);
    }
    if (
      model.services[serviceName].environment.GOOGLE_WALLET_MODE !== "REAL" ||
      model.services[serviceName].environment.APPLE_WALLET_MODE !== "REAL" ||
      model.services[serviceName].environment.APPLE_APNS_ENVIRONMENT !== "production"
    ) {
      throw new Error(`${serviceName} did not render the safe dummy Wallet provider contract.`);
    }
  }
  const expectedStripePrefix = environment === "staging" ? "sk_test_" : "sk_live_";
  if (!model.services.api.environment.STRIPE_SECRET_KEY.startsWith(expectedStripePrefix)) {
    throw new Error(`${environment} did not render the isolated dummy Stripe mode.`);
  }
  for (const serviceName of [
    "merchant-web",
    "customer-web",
    "marketing-web",
    "operational-worker",
  ]) {
    if (
      model.services[serviceName].volumes?.some(
        (volume) => volume.target === "/run/waflo-provider-secrets",
      )
    ) {
      throw new Error(`${serviceName} must not receive provider secret files.`);
    }
  }
  process.stdout.write(`${environment} Compose: valid, private, release-addressed\n`);
}
