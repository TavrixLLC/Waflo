#!/usr/bin/env bash
set -Eeuo pipefail
umask 022

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd -- "${script_directory}/../.." && pwd)"
scratch="$(mktemp -d)"
postgres_pid=''
cleanup() {
  if [[ -n "${postgres_pid}" ]] && kill -0 "${postgres_pid}" 2>/dev/null; then
    gosu postgres pg_ctl -D "${PGDATA}" -m immediate -w stop >/dev/null 2>&1 || true
    wait "${postgres_pid}" 2>/dev/null || true
  fi
  rm -rf -- "${scratch}"
}
trap cleanup EXIT

export PLATFORM_ROOT="${scratch}/platform"
source "${repository_root}/deploy/vps/scripts/common.sh"

assert_stat() {
  local expected="$1"
  local path="$2"
  local actual
  actual="$(stat -c '%a:%u:%g' "${path}")"
  if [[ "${actual}" != "${expected}" ]]; then
    printf 'Expected %s for %s, got %s.\n' "${expected}" "${path}" "${actual}" >&2
    return 1
  fi
}

prepared_host_root="${scratch}/prepared-host"
env PLATFORM_ROOT="${prepared_host_root}" \
  /bin/bash "${repository_root}/deploy/vps/scripts/prepare-host.sh" >/dev/null
for environment in staging production; do
  assert_stat '750:70:70' "${prepared_host_root}/data/${environment}/postgres"
  assert_stat '700:70:70' "${prepared_host_root}/data/${environment}/postgres/pgdata"
done

start_postgres() {
  local attempt
  /usr/local/bin/docker-entrypoint.sh postgres -c listen_addresses='' \
    >"${scratch}/postgres.log" 2>&1 &
  postgres_pid=$!
  for ((attempt = 1; attempt <= 30; attempt += 1)); do
    if [[ "$(psql --tuples-only --no-align --username="${POSTGRES_USER}" \
      --dbname="${POSTGRES_DB}" --command='SELECT 1' 2>/dev/null || true)" == '1' ]]; then
      return 0
    fi
    if ! kill -0 "${postgres_pid}" 2>/dev/null; then
      cat "${scratch}/postgres.log" >&2
      return 1
    fi
    sleep 1
  done
  cat "${scratch}/postgres.log" >&2
  return 1
}

stop_postgres() {
  gosu postgres pg_ctl -D "${PGDATA}" -m fast -w stop >/dev/null
  wait "${postgres_pid}"
  postgres_pid=''
}

prepare_postgres_bind staging
prepare_postgres_bind production
for environment in staging production; do
  assert_stat '750:70:70' "${PLATFORM_ROOT}/data/${environment}/postgres"
  assert_stat '700:70:70' "${PLATFORM_ROOT}/data/${environment}/postgres/pgdata"
done

staging_bind="${PLATFORM_ROOT}/data/staging/postgres"
staging_pgdata="${staging_bind}/pgdata"
install -d -m 0755 "${staging_pgdata}/base/1"
printf '17\n' >"${staging_pgdata}/PG_VERSION"
printf 'existing database payload\n' >"${staging_pgdata}/base/1/2600"
chown -R 0:0 "${staging_pgdata}"
chmod 0755 "${staging_pgdata}"

outside="${scratch}/outside"
install -d -m 0755 "${outside}"
printf 'outside payload\n' >"${outside}/must-not-change"
chmod 0640 "${outside}/must-not-change"
outside_before="$(stat -c '%a:%u:%g' "${outside}/must-not-change")"
ln -s "${outside}" "${staging_bind}/outside-link"

prepare_postgres_bind staging
assert_stat '750:70:70' "${staging_bind}"
assert_stat '700:70:70' "${staging_pgdata}"
assert_stat '644:70:70' "${staging_pgdata}/PG_VERSION"
assert_stat '644:70:70' "${staging_pgdata}/base/1/2600"
[[ "$(cat "${staging_pgdata}/PG_VERSION")" == '17' ]]
[[ "$(cat "${staging_pgdata}/base/1/2600")" == 'existing database payload' ]]
[[ "$(cat "${outside}/must-not-change")" == 'outside payload' ]]
[[ "$(stat -c '%a:%u:%g' "${outside}/must-not-change")" == "${outside_before}" ]]

first_state="$(find "${staging_bind}" -xdev \
  -exec stat -c '%n|%F|%a|%u|%g|%s|%N' {} + | sort)"
prepare_postgres_bind staging
second_state="$(find "${staging_bind}" -xdev \
  -exec stat -c '%n|%F|%a|%u|%g|%s|%N' {} + | sort)"
[[ "${first_state}" == "${second_state}" ]]

export PGDATA="${PLATFORM_ROOT}/data/production/postgres/pgdata"
export POSTGRES_DB=waflo_bootstrap_smoke
export POSTGRES_USER=waflo_bootstrap_smoke
export POSTGRES_PASSWORD=disposable-bootstrap-smoke-password
chmod 0755 "${scratch}" "${PLATFORM_ROOT}" "${PLATFORM_ROOT}/data" \
  "${PLATFORM_ROOT}/data/production"
start_postgres
psql --quiet --username="${POSTGRES_USER}" --dbname="${POSTGRES_DB}" <<'SQL'
CREATE TABLE bootstrap_preservation (value text PRIMARY KEY);
INSERT INTO bootstrap_preservation VALUES ('preserved');
SQL
stop_postgres

prepare_postgres_bind production
assert_stat '750:70:70' "${PLATFORM_ROOT}/data/production/postgres"
assert_stat '700:70:70' "${PGDATA}"
[[ "$(cat "${PGDATA}/PG_VERSION")" == '17' ]]
start_postgres
[[ "$(psql --tuples-only --no-align --username="${POSTGRES_USER}" \
  --dbname="${POSTGRES_DB}" --command='SELECT value FROM bootstrap_preservation')" == 'preserved' ]]
stop_postgres

printf '%s\n' 'PostgreSQL fresh-host, existing-data, idempotency, and scope regressions passed.'
