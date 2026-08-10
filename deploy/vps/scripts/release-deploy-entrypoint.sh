#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly PLATFORM_ROOT="${PLATFORM_ROOT:-/opt/waflo-platform}"
environment="${1:-}"
release_sha="${2:-}"

if [[ "${EUID}" -ne 0 ]]; then
  printf 'The release deployment entrypoint must run through sudo as root.\n' >&2
  exit 2
fi
case "${environment}" in
  staging|production) ;;
  *) printf 'Environment must be staging or production.\n' >&2; exit 2 ;;
esac
if [[ ! "${release_sha}" =~ ^[0-9a-f]{40}$ ]]; then
  printf 'Release must be a full 40-character lowercase Git SHA.\n' >&2
  exit 2
fi
expected_sudo_user="waflo-deploy-${environment}"
if [[ "${SUDO_USER:-}" != "${expected_sudo_user}" ]]; then
  printf '%s deployments require the dedicated %s SSH identity.\n' \
    "${environment}" "${expected_sudo_user}" >&2
  exit 2
fi

release_directory="${PLATFORM_ROOT}/releases/${release_sha}"
archive="$(mktemp "${PLATFORM_ROOT}/releases/.${release_sha}.XXXXXX.tar.gz")"
incoming="$(mktemp -d "${PLATFORM_ROOT}/releases/.${release_sha}.XXXXXX")"
cleanup() {
  rm -f -- "${archive}"
  rm -rf -- "${incoming}"
}
trap cleanup EXIT

cat >"${archive}"
if (( $(stat -c '%s' "${archive}") > 5242880 )); then
  printf 'Release descriptor exceeds the 5 MiB safety limit.\n' >&2
  exit 2
fi

while IFS= read -r entry; do
  if [[ "${entry}" == /* || "/${entry}/" == *"/../"* ]]; then
    printf 'Unsafe archive path: %s\n' "${entry}" >&2
    exit 2
  fi
  case "${entry}" in
    deploy/vps|deploy/vps/*) ;;
    *) printf 'Unexpected release archive path: %s\n' "${entry}" >&2; exit 2 ;;
  esac
done < <(tar -tzf "${archive}")
if tar -tvzf "${archive}" | grep -Eq '^[lh]'; then
  printf 'Release descriptor may not contain symbolic or hard links.\n' >&2
  exit 2
fi

if [[ ! -d "${release_directory}" ]]; then
  tar -xzf "${archive}" --no-same-owner --no-same-permissions --directory "${incoming}"
  for required in compose.yml scripts/common.sh scripts/deploy.sh scripts/minio-init.sh; do
    if [[ ! -f "${incoming}/deploy/vps/${required}" ]]; then
      printf 'Release descriptor is missing deploy/vps/%s.\n' "${required}" >&2
      exit 2
    fi
  done
  chown -R root:root "${incoming}"
  find "${incoming}" -type d -exec chmod 0755 {} +
  find "${incoming}" -type f -exec chmod 0644 {} +
  find "${incoming}/deploy/vps/scripts" -type f -name '*.sh' -exec chmod 0755 {} +
  mv -- "${incoming}" "${release_directory}"
  incoming="${PLATFORM_ROOT}/releases/.installed-${release_sha}"
else
  printf 'Release descriptor %s already exists and will not be overwritten.\n' "${release_sha}"
fi

rm -f -- "${archive}"
exec "${release_directory}/deploy/vps/scripts/deploy.sh" "${environment}" "${release_sha}"
