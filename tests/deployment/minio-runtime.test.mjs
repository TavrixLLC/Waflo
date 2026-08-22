import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repository = resolve(import.meta.dirname, "../..");
const mcImage =
  "minio/mc:RELEASE.2025-08-13T08-35-41Z@sha256:a7fe349ef4bd8521fb8497f55c6042871b2ae640607cf99d9bede5e9bdf11727";
const minioImage =
  "minio/minio:RELEASE.2025-09-07T16-13-09Z@sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e";
const identifier = `waflo-minio-runtime-${process.pid}-${Date.now()}`;
const network = `${identifier}-network`;
const server = `${identifier}-server`;
const scratch = mkdtempSync(join(tmpdir(), "waflo-minio-runtime-"));

const credentials = {
  minio_root_user: "smoke-root-user",
  minio_root_password: "smoke-root-password-32-characters",
  object_storage_access_key: "smoke-application-user",
  object_storage_secret_key: "smoke-application-password-32-chars",
};
const secretPaths = Object.fromEntries(
  Object.entries(credentials).map(([name, value]) => {
    const path = join(scratch, name);
    writeFileSync(path, `${value}\n`, { mode: 0o600 });
    return [name, path];
  }),
);

function docker(args, options = {}) {
  return spawnSync("docker", args, {
    cwd: repository,
    encoding: "utf8",
    shell: false,
    ...options,
  });
}

function requireSuccess(label, result) {
  if (result.status !== 0) {
    throw new Error(
      `${label} failed (${result.status ?? "no status"}):\n${result.stdout}${result.stderr}`,
    );
  }
}

function readOnlyMount(source, target) {
  return ["--mount", `type=bind,source=${source},target=${target},readonly`];
}

function runProvisioning() {
  const args = [
    "run",
    "--rm",
    "--network",
    network,
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--env",
    "DEPLOYMENT_ENVIRONMENT=staging",
    "--env",
    "OBJECT_STORAGE_BUCKET=waflo-smoke-private",
  ];
  for (const [name, path] of Object.entries(secretPaths)) {
    args.push(...readOnlyMount(path, `/run/secrets/${name}`));
  }
  args.push(
    ...readOnlyMount(
      join(repository, "deploy", "vps", "scripts", "minio-init.sh"),
      "/opt/waflo-platform/minio-init.sh",
    ),
    "--entrypoint",
    "/bin/sh",
    mcImage,
    "/opt/waflo-platform/minio-init.sh",
  );
  return docker(args);
}

let networkCreated = false;
let serverCreated = false;
try {
  const cliSmoke = docker([
    "run",
    "--rm",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--env",
    "WAFLO_CONTAINER_SMOKE=1",
    ...readOnlyMount(repository, "/workspace"),
    "--entrypoint",
    "/bin/sh",
    mcImage,
    "/workspace/tests/deployment/minio-init.test.sh",
  ]);
  requireSuccess("pinned mc CLI smoke", cliSmoke);
  process.stdout.write(cliSmoke.stdout);

  requireSuccess("temporary MinIO network creation", docker(["network", "create", network]));
  networkCreated = true;
  const started = docker([
    "run",
    "--detach",
    "--name",
    server,
    "--network",
    network,
    "--network-alias",
    "minio",
    "--env",
    `MINIO_ROOT_USER=${credentials.minio_root_user}`,
    "--env",
    `MINIO_ROOT_PASSWORD=${credentials.minio_root_password}`,
    minioImage,
    "server",
    "/data",
    "--address",
    ":9000",
    "--console-address",
    ":9001",
  ]);
  requireSuccess("temporary MinIO startup", started);
  serverCreated = true;

  let ready = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const health = docker([
      "exec",
      server,
      "curl",
      "--fail",
      "--silent",
      "http://127.0.0.1:9000/minio/health/ready",
    ]);
    if (health.status === 0) {
      ready = true;
      break;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  if (!ready) {
    const logs = docker(["logs", server]);
    throw new Error(`temporary MinIO did not become ready:\n${logs.stdout}${logs.stderr}`);
  }

  const outputs = [];
  for (let run = 1; run <= 2; run += 1) {
    const provisioned = runProvisioning();
    requireSuccess(`MinIO provisioning run ${run}`, provisioned);
    outputs.push(provisioned.stdout, provisioned.stderr);
    if (provisioned.stdout.trim() !== "MinIO bucket and private application policy are ready.") {
      throw new Error(`unexpected provisioning output on run ${run}: ${provisioned.stdout}`);
    }
  }
  const combined = outputs.join("");
  for (const credential of Object.values(credentials)) {
    if (combined.includes(credential)) {
      throw new Error("a smoke credential appeared in MinIO provisioning output");
    }
  }
  if (combined.includes("/root/.mc")) {
    throw new Error("the pinned mc runtime attempted to access /root/.mc");
  }
  process.stdout.write(
    "Pinned MinIO provisioning succeeded twice with explicit ephemeral mc configuration.\n",
  );
} finally {
  if (serverCreated && server.startsWith("waflo-minio-runtime-")) {
    docker(["rm", "--force", server]);
  }
  if (networkCreated && network.startsWith("waflo-minio-runtime-")) {
    docker(["network", "rm", network]);
  }
  rmSync(scratch, { recursive: true, force: true });
}
