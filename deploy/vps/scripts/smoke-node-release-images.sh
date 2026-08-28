#!/usr/bin/env bash
set -Eeuo pipefail

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "${script_directory}/common.sh"

environment="${1:-}"
release_sha="${2:-}"
registry="${IMAGE_REGISTRY:-}"

require_environment "${environment}"
require_release_sha "${release_sha}"
if [[ -z "${registry}" ]]; then
  printf 'IMAGE_REGISTRY is required.\n' >&2
  exit 2
fi

module_probe='const service = process.env.WAFLO_SMOKE_SERVICE;
const entry = service === "api" ? "./dist/app.js" : "./dist/main.js";
await import(entry);
console.log(`Startup import graph resolved for ${service}.`);'

reachable_import_probe='import { existsSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const queue = [realpathSync("/app/dist/main.js")];
const visited = new Set();
let bareImportCount = 0;
const patterns = [
  /\bfrom\s+"([^"]+)"/g,
  /^\s*import\s*"([^"]+)"/gm,
  /\bimport\s*\(\s*"([^"]+)"/g,
  /\brequire\s*\(\s*"([^"]+)"/g,
];
while (queue.length > 0) {
  const file = queue.shift();
  if (visited.has(file)) continue;
  visited.add(file);
  const source = readFileSync(file, "utf8");
  const specifiers = new Set(
    patterns.flatMap((pattern) => [...source.matchAll(pattern)].map((match) => match[1])),
  );
  for (const specifier of specifiers) {
    if (!specifier || specifier.startsWith("node:")) continue;
    const resolved = import.meta.resolve(specifier, pathToFileURL(file).href);
    if (!specifier.startsWith(".") && !specifier.startsWith("/")) bareImportCount += 1;
    if (!resolved.startsWith("file:")) continue;
    const resolvedPath = fileURLToPath(resolved);
    if (!resolvedPath.endsWith(".js") || !existsSync(resolvedPath)) continue;
    const realPath = realpathSync(resolvedPath);
    if (
      realPath.startsWith("/app/dist/") ||
      realPath.includes("/node_modules/.pnpm/@waflo+")
    ) {
      queue.push(realPath);
    }
  }
}
console.log(`Resolved ${bareImportCount} startup-reachable bare imports across ${visited.size} first-party modules.`);'

configuration_probe='const { parseEnvironment } = await import("@waflo/config");
parseEnvironment(process.env);
console.log("Synthetic deployed configuration passed validation.");'

smoke_environment="${script_directory}/../fixtures/release-smoke/${environment}.env.fixture"
if [[ ! -f "${smoke_environment}" ]]; then
  printf 'Missing synthetic %s release-image smoke environment.\n' "${environment}" >&2
  exit 2
fi

for service in api operational-worker wallet-worker admin; do
  reference="${registry}/waflo-${service}:${release_sha}-${environment}"
  printf 'Smoke testing final image %s.\n' "${reference}"
  if ! docker image inspect "${reference}" >/dev/null 2>&1; then
    docker pull "${reference}" >/dev/null
  fi

  metadata="$(docker image inspect "${reference}" \
    --format '{{.Config.User}}|{{.Config.WorkingDir}}|{{json .Config.Entrypoint}}|{{json .Config.Cmd}}')"
  case "${service}" in
    admin) expected_metadata='waflo|/app/apps/admin-dashboard|["docker-entrypoint.sh"]|["node","server.js"]' ;;
    *) expected_metadata='waflo|/app|["docker-entrypoint.sh"]|["node","dist/main.js"]' ;;
  esac
  if [[ "${metadata}" != "${expected_metadata}" ]]; then
    printf 'Unexpected final image metadata for %s: %s\n' "${reference}" "${metadata}" >&2
    exit 4
  fi

  docker run --rm --env "WAFLO_SMOKE_SERVICE=${service}" --entrypoint sh "${reference}" -ec '
    case "${WAFLO_SMOKE_SERVICE}" in
      admin) test -f /app/apps/admin-dashboard/package.json ;;
      *) test -f /app/package.json ;;
    esac
    test -d /app/node_modules/.pnpm
    test ! -e /app/.env
    test ! -e /app/.env.production
  '
  package_name="$(docker run --rm --entrypoint node "${reference}" \
    --eval 'process.stdout.write(JSON.parse(require("node:fs").readFileSync("./package.json", "utf8")).name)')"
  case "${service}" in
    admin) expected_package='@waflo/admin-dashboard' ;;
    *) expected_package="@waflo/${service}" ;;
  esac
  if [[ "${package_name}" != "${expected_package}" ]]; then
    printf 'Unexpected package in %s: %s\n' "${reference}" "${package_name}" >&2
    exit 4
  fi

  if [[ "${service}" == "admin" ]]; then
    docker run --rm --entrypoint node "${reference}" --check server.js
    printf 'Admin standalone runtime entrypoint is syntactically valid.\n'
    continue
  fi

  docker run --rm \
    --env-file "${smoke_environment}" \
    --env "WAFLO_SMOKE_SERVICE=${service}" \
    --entrypoint node \
    "${reference}" \
    --input-type=module \
    --eval "${module_probe}"

  docker run --rm \
    --entrypoint node \
    "${reference}" \
    --experimental-import-meta-resolve \
    --input-type=module \
    --eval "${reachable_import_probe}"

  docker run --rm \
    --env-file "${smoke_environment}" \
    --entrypoint node \
    "${reference}" \
    --input-type=module \
    --eval "${configuration_probe}"

  # Keep the original runtime-entrypoint check: with no configuration the
  # executable must reach strict environment validation before any external
  # dependency can be contacted. The preceding probe proves the canonical
  # synthetic deployed configuration itself is valid.
  if startup_output="$(docker run --rm "${reference}" 2>&1)"; then
    printf 'Empty-environment startup unexpectedly succeeded for %s.\n' "${reference}" >&2
    exit 4
  fi
  if grep -Eq 'ERR_MODULE_NOT_FOUND|Cannot find package' <<<"${startup_output}"; then
    printf 'A runtime package is missing from %s:\n%s\n' "${reference}" "${startup_output}" >&2
    exit 4
  fi
  case "${service}" in
    api) expected_failure='Waflo API failed to start' ;;
    operational-worker) expected_failure='Operational worker failed.' ;;
    wallet-worker) expected_failure='Wallet worker failed.' ;;
  esac
  if [[ "${startup_output}" != *"${expected_failure}"* ]]; then
    printf 'Unexpected startup boundary for %s:\n%s\n' "${reference}" "${startup_output}" >&2
    exit 4
  fi
done

printf 'Final Node release image smoke tests passed for %s at %s.\n' \
  "${environment}" "${release_sha}"
