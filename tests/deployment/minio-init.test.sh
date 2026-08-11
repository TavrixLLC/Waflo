#!/bin/sh
set -eu

if [ "${WAFLO_CONTAINER_SMOKE:-}" != '1' ]; then
  printf '%s\n' 'Run this isolated smoke in the pinned minio/mc container.' >&2
  exit 2
fi

script_directory="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
repository_root="$(CDPATH= cd -- "${script_directory}/../.." && pwd)"
scratch="$(mktemp -d)"
real_mc_config="/tmp/.mc-real-smoke"
created_secret_directory=false
cleanup() {
  rm -rf "${scratch}"
  rm -rf "${real_mc_config}"
  rm -f \
    /run/secrets/minio_root_user \
    /run/secrets/minio_root_password \
    /run/secrets/object_storage_access_key \
    /run/secrets/object_storage_secret_key
  if [ "${created_secret_directory}" = true ]; then
    rmdir /run/secrets 2>/dev/null || true
  fi
}
trap cleanup EXIT

cap_eff=''
no_new_privs=''
while IFS=: read -r key value; do
  case "${key}" in
    CapEff)
      set -- ${value}
      cap_eff="${1:-}"
      ;;
    NoNewPrivs)
      set -- ${value}
      no_new_privs="${1:-}"
      ;;
  esac
done </proc/self/status
[ "${cap_eff}" = '0000000000000000' ]
[ "${no_new_privs}" = '1' ]
case "$(mc --version)" in
  *'RELEASE.2025-08-13T08-35-41Z'*) ;;
  *)
    printf '%s\n' 'The MinIO smoke is not running the pinned mc release.' >&2
    exit 1
    ;;
esac
[ ! -e /root/.mc ]
mkdir -p "${real_mc_config}"
chmod 0700 "${real_mc_config}"
mc --config-dir "${real_mc_config}" alias list >/dev/null
[ -f "${real_mc_config}/config.json" ]
[ ! -e /root/.mc ]
rm -rf "${real_mc_config}"

if [ ! -d /run/secrets ]; then
  mkdir -p /run/secrets
  created_secret_directory=true
fi
printf '%s\n' 'smoke-root-user' >/run/secrets/minio_root_user
printf '%s\n' 'smoke-root-password' >/run/secrets/minio_root_password
printf '%s\n' 'smoke-application-user' >/run/secrets/object_storage_access_key
printf '%s\n' 'smoke-application-password' >/run/secrets/object_storage_secret_key

fake_bin="${scratch}/bin"
call_log="${scratch}/mc-calls.log"
output_log="${scratch}/output.log"
mkdir -p "${fake_bin}"
cat >"${fake_bin}/mc" <<'EOF'
#!/bin/sh
set -eu

[ "$1" = '--config-dir' ]
[ "$2" = '/tmp/.mc' ]
shift 2
[ "${MC_CONFIG_DIR:-}" = '/tmp/.mc' ]
[ -d "${MC_CONFIG_DIR}" ]
[ -w "${MC_CONFIG_DIR}" ]
printf '%s\n' configured >"${MC_CONFIG_DIR}/config.json"

case "$1 $2 $3" in
  'alias set local')
    [ "$3" = local ]
    [ "$4" = 'http://minio:9000' ]
    [ "$5" = 'smoke-root-user' ]
    [ "$6" = 'smoke-root-password' ]
    printf '%s\n' 'alias set local http://minio:9000 <redacted> <redacted>' >>"${MC_CALL_LOG}"
    ;;
  'mb --ignore-existing local/waflo-smoke-private')
    [ "$3" = 'local/waflo-smoke-private' ]
    printf '%s\n' 'mb --ignore-existing local/waflo-smoke-private' >>"${MC_CALL_LOG}"
    ;;
  'anonymous set none')
    [ "$3" = none ]
    [ "$4" = 'local/waflo-smoke-private' ]
    printf '%s\n' 'anonymous set none local/waflo-smoke-private' >>"${MC_CALL_LOG}"
    ;;
  'admin policy create')
    [ "$4" = local ]
    [ "$5" = 'waflo-staging' ]
    [ -f "$6" ]
    case "$(cat "$6")" in
      *'arn:aws:s3:::waflo-smoke-private'*) ;;
      *) exit 1 ;;
    esac
    printf '%s\n' 'admin policy create local waflo-staging <ephemeral-policy>' >>"${MC_CALL_LOG}"
    ;;
  'admin user add')
    [ "$4" = local ]
    [ "$5" = 'smoke-application-user' ]
    [ "$6" = 'smoke-application-password' ]
    printf '%s\n' 'admin user add local <redacted> <redacted>' >>"${MC_CALL_LOG}"
    ;;
  'admin user enable')
    [ "$4" = local ]
    [ "$5" = 'smoke-application-user' ]
    printf '%s\n' 'admin user enable local <redacted>' >>"${MC_CALL_LOG}"
    ;;
  'admin policy attach')
    [ "$4" = local ]
    [ "$5" = 'waflo-staging' ]
    [ "$6" = --user ]
    [ "$7" = 'smoke-application-user' ]
    printf '%s\n' 'admin policy attach local waflo-staging --user <redacted>' >>"${MC_CALL_LOG}"
    ;;
  *) exit 1 ;;
esac
EOF
chmod 0700 "${fake_bin}/mc"

run=1
while [ "${run}" -le 2 ]; do
  MC_CALL_LOG="${call_log}" \
  MC_CONFIG_DIR=/root/.mc \
  PATH="${fake_bin}:${PATH}" \
  DEPLOYMENT_ENVIRONMENT=staging \
  OBJECT_STORAGE_BUCKET=waflo-smoke-private \
    /bin/sh "${repository_root}/deploy/vps/scripts/minio-init.sh" >>"${output_log}" 2>&1
  run=$((run + 1))
done

expected_calls="${scratch}/expected-calls.log"
cat >"${expected_calls}" <<'EOF'
alias set local http://minio:9000 <redacted> <redacted>
mb --ignore-existing local/waflo-smoke-private
anonymous set none local/waflo-smoke-private
admin policy create local waflo-staging <ephemeral-policy>
admin user add local <redacted> <redacted>
admin user enable local <redacted>
admin policy attach local waflo-staging --user <redacted>
alias set local http://minio:9000 <redacted> <redacted>
mb --ignore-existing local/waflo-smoke-private
anonymous set none local/waflo-smoke-private
admin policy create local waflo-staging <ephemeral-policy>
admin user add local <redacted> <redacted>
admin user enable local <redacted>
admin policy attach local waflo-staging --user <redacted>
EOF
actual_calls="$(cat "${call_log}")"
expected_call_contents="$(cat "${expected_calls}")"
[ "${actual_calls}" = "${expected_call_contents}" ]

combined_output="$(cat "${output_log}" "${call_log}")"
for credential in \
  smoke-root-user smoke-root-password smoke-application-user smoke-application-password; do
  case "${combined_output}" in
    *"${credential}"*)
      printf 'Credential appeared in MinIO initialization output: %s\n' "${credential}" >&2
      exit 1
      ;;
  esac
done

[ "$(cat "${output_log}")" = "$(printf '%s\n%s' \
  'MinIO bucket and private application policy are ready.' \
  'MinIO bucket and private application policy are ready.')" ]
[ ! -e /root/.mc ]
[ ! -e /tmp/.mc ]
[ ! -e /tmp/waflo-staging-policy.json ]

printf '%s\n' 'Pinned mc explicit config, security options, repeated command order, credential redaction, and ephemerality smoke passed.'
