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
try {
  parseEnvironment(process.env);
  throw new Error("Empty release-image environment unexpectedly passed validation.");
} catch (error) {
  if (!(error instanceof Error) || !error.message.startsWith("Invalid Waflo environment configuration:")) {
    throw error;
  }
  console.log("Startup reached expected configuration validation.");
}'

for service in api operational-worker wallet-worker; do
  reference="${registry}/waflo-${service}:${release_sha}-${environment}"
  printf 'Smoke testing final image %s.\n' "${reference}"
  if ! docker image inspect "${reference}" >/dev/null 2>&1; then
    docker pull "${reference}" >/dev/null
  fi

  metadata="$(docker image inspect "${reference}" \
    --format '{{.Config.User}}|{{.Config.WorkingDir}}|{{json .Config.Entrypoint}}|{{json .Config.Cmd}}')"
  if [[ "${metadata}" != 'waflo|/app|["docker-entrypoint.sh"]|["node","dist/main.js"]' ]]; then
    printf 'Unexpected final image metadata for %s: %s\n' "${reference}" "${metadata}" >&2
    exit 4
  fi

  docker run --rm --entrypoint /bin/sh "${reference}" -ec '
    test -f /app/package.json
    test -d /app/node_modules/.pnpm
    test ! -e /app/.env
    test ! -e /app/.env.production
  '
  package_name="$(docker run --rm --entrypoint node "${reference}" \
    --eval 'process.stdout.write(JSON.parse(require("node:fs").readFileSync("/app/package.json", "utf8")).name)')"
  if [[ "${package_name}" != "@waflo/${service}" ]]; then
    printf 'Unexpected package in %s: %s\n' "${reference}" "${package_name}" >&2
    exit 4
  fi

  docker run --rm \
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
    --entrypoint node \
    "${reference}" \
    --input-type=module \
    --eval "${configuration_probe}"

  if startup_output="$(docker run --rm "${reference}" 2>&1)"; then
    printf 'Empty-environment startup unexpectedly succeeded for %s.\n' "${reference}" >&2
    exit 4
  fi
  if grep -Eq 'ERR_MODULE_NOT_FOUND|Cannot find package' <<<"${startup_output}"; then
    printf 'A runtime package is missing from %s:\n%s\n' "${reference}" "${startup_output}" >&2
    exit 4
  fi
  case "${service}" in
    api) expected_failure='Waflo API failed to start.' ;;
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
