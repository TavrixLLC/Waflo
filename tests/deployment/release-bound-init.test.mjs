import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repository = resolve(import.meta.dirname, "../..");
const deployScript = readFileSync(
  join(repository, "deploy", "vps", "scripts", "deploy.sh"),
  "utf8",
);
const image = "bash:5.2@sha256:9aa57a67d0f7d1448ba24f2afa8ec3bd5d9b594ebb780947787f4c4006db0d4e";
const scratch = mkdtempSync(join(tmpdir(), "waflo-release-bound-init-"));
const successProject = `waflo-init-success-${process.pid}-${Date.now()}`;
const failureProject = `waflo-init-failure-${process.pid}-${Date.now()}`;
const objectStorageData = join(scratch, "object-storage");
const persistentMarker = join(objectStorageData, "must-survive-release-refresh");
const objectStorageDataVariable = "$" + "{OBJECT_STORAGE_DATA:?OBJECT_STORAGE_DATA is required}";

function docker(args) {
  return spawnSync("docker", args, {
    cwd: repository,
    encoding: "utf8",
    shell: false,
  });
}

function requireSuccess(label, result) {
  if (result.status !== 0) {
    throw new Error(
      `${label} failed (${result.status ?? "no status"}):\n${result.stdout}${result.stderr}`,
    );
  }
  return result;
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function writeRelease(name, marker, exitStatus = 0) {
  const directory = join(scratch, name);
  mkdirSync(join(directory, "scripts"), { recursive: true });
  writeFileSync(
    join(directory, "compose.yml"),
    [
      "services:",
      "  postgres:",
      `    image: ${image}`,
      '    command: [sleep, "300"]',
      "  redis:",
      `    image: ${image}`,
      '    command: [sleep, "300"]',
      "  minio:",
      `    image: ${image}`,
      '    command: [sleep, "300"]',
      "    volumes:",
      "      - type: bind",
      `        source: "${objectStorageDataVariable}"`,
      "        target: /data",
      "  minio-init:",
      `    image: ${image}`,
      '    restart: "no"',
      "    environment:",
      "      DEPLOYMENT_ENVIRONMENT: staging",
      "    entrypoint: [/usr/local/bin/bash, /opt/waflo-platform/minio-init.sh]",
      "    configs:",
      "      - source: minio_init_script",
      "        target: /opt/waflo-platform/minio-init.sh",
      "        mode: 0550",
      "    depends_on:",
      "      minio:",
      "        condition: service_started",
      "  application:",
      `    image: ${image}`,
      '    command: [sleep, "300"]',
      "    depends_on:",
      "      minio-init:",
      "        condition: service_completed_successfully",
      "configs:",
      "  minio_init_script:",
      "    file: ./scripts/minio-init.sh",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(directory, "scripts", "minio-init.sh"),
    [
      "#!/usr/bin/env bash",
      "set -Eeuo pipefail",
      `printf '%s\\n' ${JSON.stringify(`${marker}:\${DEPLOYMENT_ENVIRONMENT}`)}`,
      `exit ${exitStatus}`,
      "",
    ].join("\n"),
  );
  return {
    composeFile: join(directory, "compose.yml"),
    directory,
    script: join(directory, "scripts", "minio-init.sh"),
  };
}

function compose(project, release, ...args) {
  return spawnSync(
    "docker",
    ["compose", "--project-name", project, "--file", release.composeFile, ...args],
    {
      cwd: repository,
      env: { ...process.env, OBJECT_STORAGE_DATA: objectStorageData },
      encoding: "utf8",
      shell: false,
    },
  );
}

function serviceContainer(project, service) {
  const result = requireSuccess(
    `${project}/${service} lookup`,
    docker([
      "ps",
      "--all",
      "--quiet",
      "--filter",
      `label=com.docker.compose.project=${project}`,
      "--filter",
      `label=com.docker.compose.service=${service}`,
    ]),
  );
  const ids = result.stdout.trim().split(/\s+/u).filter(Boolean);
  requireCondition(ids.length === 1, `expected exactly one ${project}/${service} container`);
  return ids[0];
}

function inspect(container) {
  const result = requireSuccess(`${container} inspection`, docker(["inspect", container]));
  return JSON.parse(result.stdout)[0];
}

function normalized(path) {
  return path.replaceAll("\\", "/").toLowerCase();
}

function assertReleaseContainer(container, release, marker) {
  const state = inspect(container);
  const mount = state.Mounts.find(
    (candidate) => candidate.Destination === "/opt/waflo-platform/minio-init.sh",
  );
  requireCondition(mount !== undefined, "minio-init script mount is missing");
  requireCondition(mount.RW === false, "minio-init script mount must remain read-only");
  requireCondition(
    normalized(mount.Source).endsWith(
      normalized(`/${release.script.slice(release.directory.length + 1)}`),
    ) &&
      normalized(mount.Source).includes(
        normalized(`/${release.directory.split(/[\\/]/u).at(-1)}/`),
      ),
    `minio-init mount did not use ${release.script}: ${mount.Source}`,
  );
  const configFiles = state.Config.Labels["com.docker.compose.project.config_files"];
  requireCondition(
    normalized(configFiles).endsWith(
      normalized(`/${release.composeFile.slice(release.directory.length + 1)}`),
    ) &&
      normalized(configFiles).includes(normalized(`/${release.directory.split(/[\\/]/u).at(-1)}/`)),
    `minio-init Compose label did not use ${release.composeFile}: ${configFiles}`,
  );
  const logs = requireSuccess(`${container} logs`, docker(["logs", container])).stdout.trim();
  requireCondition(logs === `${marker}:staging`, `unexpected minio-init marker: ${logs}`);
}

function refreshMinioInit(project, release) {
  requireSuccess(
    `${project} minio-init removal`,
    compose(project, release, "rm", "--force", "--stop", "minio-init"),
  );
  return compose(project, release, "up", "--no-build", "minio-init");
}

function cleanupProject(project) {
  const ids = docker([
    "ps",
    "--all",
    "--quiet",
    "--filter",
    `label=com.docker.compose.project=${project}`,
  ])
    .stdout.trim()
    .split(/\s+/u)
    .filter(Boolean);
  if (ids.length > 0) docker(["rm", "--force", ...ids]);
  const networks = docker([
    "network",
    "ls",
    "--quiet",
    "--filter",
    `label=com.docker.compose.project=${project}`,
  ])
    .stdout.trim()
    .split(/\s+/u)
    .filter(Boolean);
  for (const network of networks) docker(["network", "rm", network]);
}

const lifecycle = ["compose rm --force --stop minio-init", "compose up --no-build minio-init"].join(
  "\n",
);
requireCondition(
  deployScript.includes(lifecycle),
  "deploy.sh lost the explicit minio-init refresh",
);
requireCondition(!deployScript.includes("compose down"), "deploy.sh must not use compose down");
requireCondition(
  !deployScript.includes("compose rm --volumes"),
  "the one-shot refresh must not remove volumes",
);
requireCondition(
  deployScript.indexOf(lifecycle) < deployScript.indexOf("compose run --rm migrate"),
  "minio-init must complete before migration and application startup",
);

mkdirSync(objectStorageData, { recursive: true });
writeFileSync(persistentMarker, "preserved object-storage payload\n");
const releaseA = writeRelease("release-a", "release-a-marker");
const releaseB = writeRelease("release-b", "release-b-marker");
const failedRelease = writeRelease("release-failure", "release-failure-marker", 23);

try {
  requireSuccess(
    "release A infrastructure startup",
    compose(successProject, releaseA, "up", "--detach", "--no-build", "postgres", "redis", "minio"),
  );
  const infrastructureBefore = Object.fromEntries(
    ["postgres", "redis", "minio"].map((service) => [
      service,
      serviceContainer(successProject, service),
    ]),
  );

  requireSuccess("release A minio-init", refreshMinioInit(successProject, releaseA));
  const releaseAContainer = serviceContainer(successProject, "minio-init");
  assertReleaseContainer(releaseAContainer, releaseA, "release-a-marker");

  requireSuccess("release B minio-init", refreshMinioInit(successProject, releaseB));
  const releaseBContainer = serviceContainer(successProject, "minio-init");
  requireCondition(
    releaseBContainer !== releaseAContainer,
    "release B reused release A's minio-init container",
  );
  assertReleaseContainer(releaseBContainer, releaseB, "release-b-marker");

  requireSuccess("repeated release B minio-init", refreshMinioInit(successProject, releaseB));
  const repeatedContainer = serviceContainer(successProject, "minio-init");
  requireCondition(
    repeatedContainer !== releaseBContainer,
    "repeated provisioning did not recreate the one-shot container",
  );
  assertReleaseContainer(repeatedContainer, releaseB, "release-b-marker");

  for (const [service, container] of Object.entries(infrastructureBefore)) {
    requireCondition(
      serviceContainer(successProject, service) === container,
      `${service} was replaced by the minio-init refresh`,
    );
    requireCondition(inspect(container).State.Running === true, `${service} is no longer running`);
  }
  requireCondition(
    readFileSync(persistentMarker, "utf8") === "preserved object-storage payload\n",
    "MinIO persistent data changed during one-shot refresh",
  );

  requireSuccess(
    "normal application startup",
    compose(successProject, releaseB, "up", "--detach", "--no-build", "application"),
  );
  requireCondition(
    inspect(serviceContainer(successProject, "application")).State.Running === true,
    "successful minio-init did not allow application startup",
  );

  requireSuccess(
    "failure-case MinIO startup",
    compose(failureProject, failedRelease, "up", "--detach", "--no-build", "minio"),
  );
  refreshMinioInit(failureProject, failedRelease);
  const failedStartup = compose(
    failureProject,
    failedRelease,
    "up",
    "--detach",
    "--no-build",
    "application",
  );
  requireCondition(
    failedStartup.status !== 0,
    "application startup ignored the failed minio-init dependency",
  );
  const failedApplication = docker([
    "ps",
    "--quiet",
    "--filter",
    `label=com.docker.compose.project=${failureProject}`,
    "--filter",
    "label=com.docker.compose.service=application",
  ]).stdout.trim();
  requireCondition(
    failedApplication === "",
    "application startup continued after minio-init failed",
  );

  process.stdout.write(
    "Release A-to-B recreation, current mounts/marker, repeated provisioning, persistent-service preservation, fail-closed behavior, and application startup passed.\n",
  );
} finally {
  cleanupProject(successProject);
  cleanupProject(failureProject);
  rmSync(scratch, { recursive: true, force: true });
}
