#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño
# SPDX-License-Identifier: EUPL-1.2
#
# Restore drill (spec §10 "quarterly restore drill"; runbook §4): restores a
# pgBackRest backup of the OECP PostgreSQL cluster into a scratch container,
# lets PostgreSQL replay the archived WAL, runs sanity checks and prints a
# report. Production is not touched: the scratch container has no network,
# mounts the repository read-only and runs with archive_mode=off, so it never
# pushes WAL of its own into the repository.
#
# Usage (from deploy/compose; the `backup` profile need not be running):
#   scripts/restore-drill.sh                      latest backup + all archived WAL
#   scripts/restore-drill.sh --target-time '2026-10-15 05:30:00+00'   point in time
#   scripts/restore-drill.sh --set 20261015-052418F                   one backup set, no WAL past its end
#   scripts/restore-drill.sh --keep               leave the container running to inspect it
#   scripts/restore-drill.sh --repo 2 --env-file .env.pgbackrest      from the second site
#
# Options:
#   --target-time TS   PITR target (PostgreSQL timestamp with time zone)
#   --set LABEL        backup set to restore (default: the newest)
#   --repo N           repository to restore from (default: pgBackRest's choice, repo1 first)
#   --env-file FILE    PGBACKREST_* variables for --repo 2 (container gets network
#                      `oecp-egress` and the files secrets/pgbackrest_* and secrets/pgbackrest-*)
#   --keep             keep the scratch container and volume (removed on the next run)
#   --no-compare       do not query the live `postgres` service for comparison
#   --timeout SECONDS  maximum wait for recovery (default 900)
#   -h, --help
# Environment: COMPOSE_PROJECT_NAME (default oecp), OECP_IMAGE_TAG (default dev),
#   OECP_DRILL_IMAGE (default: the image of the running postgres service).
# Exit status: 0 when every check passed, 1 otherwise.

set -Eeuo pipefail

cd "$(dirname "$0")/.."

project=${COMPOSE_PROJECT_NAME:-oecp}
name="${project}-restore-drill"
scratch_volume="${project}_restore-drill-pgdata"
repo_volume="${project}_pgbackrest-repo"
conf="$PWD/postgres/pgbackrest.conf"
target_time="" set_label="" repo="" env_file="" keep="" compare=1 timeout=900

usage() { sed -n '/^# Usage/,/^# Exit status/p' "$0" | sed 's/^# \{0,1\}//'; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target-time) target_time=${2:?--target-time needs a value}; shift 2 ;;
    --set) set_label=${2:?--set needs a value}; shift 2 ;;
    --repo) repo=${2:?--repo needs a value}; shift 2 ;;
    --env-file) env_file=${2:?--env-file needs a value}; shift 2 ;;
    --keep) keep=1; shift ;;
    --no-compare) compare=""; shift ;;
    --timeout) timeout=${2:?--timeout needs a value}; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "restore-drill: unknown option $1 (--help)" >&2; exit 2 ;;
  esac
done
[[ -n $target_time && -n $set_label ]] && { echo "restore-drill: --target-time and --set are exclusive" >&2; exit 2; }
[[ -z $env_file || -f $env_file ]] || { echo "restore-drill: env file $env_file not found" >&2; exit 2; }

log() { printf '%s restore-drill: %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }

live_container=$(docker ps -q --filter "label=com.docker.compose.project=$project" --filter "label=com.docker.compose.service=postgres" | head -n1)
image=${OECP_DRILL_IMAGE:-}
if [[ -z $image ]]; then
  if [[ -n $live_container ]]; then
    image=$(docker inspect --format '{{.Config.Image}}' "$live_container")
  else
    image="oecp/postgres:${OECP_IMAGE_TAG:-dev}"
  fi
fi
docker volume inspect "$repo_volume" >/dev/null 2>&1 || { echo "restore-drill: volume $repo_volume not found (has the backup profile run?)" >&2; exit 1; }

# Leftovers of an earlier --keep run.
if docker container inspect "$name" >/dev/null 2>&1; then
  log "removing the scratch container of an earlier drill (its volume is reused: delta restore)"
  # A clean shutdown: a killed server leaves postmaster.pid, and pgBackRest
  # then refuses to restore into the directory.
  docker stop -t 60 "$name" >/dev/null 2>&1 || true
  docker rm -f "$name" >/dev/null
fi

# shellcheck disable=SC2329  # invoked by the EXIT trap
cleanup() {
  if [[ -z $keep ]]; then
    docker rm -f "$name" >/dev/null 2>&1 || true
    docker volume rm "$scratch_volume" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# Common docker run arguments: no network (repo1 is a volume), repository
# read-only, the same pgBackRest configuration as production.
run_args=(--user postgres
  -v "$scratch_volume:/var/lib/postgresql/data"
  -v "$repo_volume:/var/lib/pgbackrest:ro"
  -v "$conf:/etc/pgbackrest/pgbackrest.conf:ro")
if [[ -n $env_file ]]; then
  run_args+=(--env-file "$env_file" --network "${project}-egress")
  # repo2 secrets (cipher pass, S3 key secret, SFTP key), as in compose.yaml.
  for f in secrets/pgbackrest_* secrets/pgbackrest-*; do
    [[ -f $f ]] && run_args+=(-v "$PWD/$f:/run/secrets/${f#secrets/}:ro")
  done
else
  run_args+=(--network none)
fi

pgbr_opts=(--stanza=oecp)
[[ -n $repo ]] && pgbr_opts+=(--repo="$repo")

log "image $image, repository volume $repo_volume, scratch volume $scratch_volume"
info=$(docker run --rm "${run_args[@]}" "$image" pgbackrest "${pgbr_opts[@]}" --log-level-console=warn info)
restore_opts=("${pgbr_opts[@]}" --delta)
mode="latest backup, then all archived WAL (end of archive)"
if [[ -n $target_time ]]; then
  restore_opts+=(--type=time "--target=$target_time" --target-action=promote)
  mode="point in time $target_time"
elif [[ -n $set_label ]]; then
  restore_opts+=("--set=$set_label" --type=immediate --target-action=promote)
  mode="backup set $set_label, consistent point only"
fi

t0=$(date +%s)
log "pgbackrest restore (${mode})"
restore_log=$(docker run --rm "${run_args[@]}" "$image" pgbackrest "${restore_opts[@]}" restore 2>&1) || {
  echo "$restore_log" >&2; echo "restore-drill: pgbackrest restore failed" >&2; exit 1; }
echo "$restore_log" >&2
backup_set=$(sed -n 's/.*restore backup set \([^,]*\),.*/\1/p' <<<"$restore_log" | head -n1)
t_restore=$(date +%s)

# PostgreSQL on the restored data directory: WAL replay through
# restore_command (written by pgBackRest), no archiving, socket only.
log "starting PostgreSQL in the scratch container $name"
docker run -d --name "$name" --shm-size 256m "${run_args[@]}" "$image" \
  postgres -c archive_mode=off -c archive_command= -c listen_addresses= >/dev/null

psql_drill() { docker exec "$name" psql -h /var/run/postgresql -U postgres -AtX -v ON_ERROR_STOP=1 "$@"; }

log "waiting for recovery to finish (timeout ${timeout} s)"
state=""
while (( $(date +%s) - t0 < timeout )); do
  if [[ $(docker inspect --format '{{.State.Running}}' "$name" 2>/dev/null) != true ]]; then
    docker logs --tail 30 "$name" >&2 || true
    echo "restore-drill: the scratch PostgreSQL stopped during recovery" >&2
    exit 1
  fi
  state=$(psql_drill -d postgres -c "SELECT pg_is_in_recovery()" 2>/dev/null || true)
  [[ $state == f ]] && break
  sleep 2
done
if [[ $state != f ]]; then
  docker logs --tail 30 "$name" >&2 || true
  echo "restore-drill: recovery did not finish within $timeout s" >&2
  exit 1
fi
t_ready=$(date +%s)

# --- sanity checks ------------------------------------------------------------------

failures=0
check() { # description, command...; prints PASS/FAIL
  local desc=$1; shift
  if out=$("$@" 2>&1); then
    printf '  PASS  %-46s %s\n' "$desc" "$(tr '\n' ' ' <<<"$out" | sed 's/ $//')"
  else
    printf '  FAIL  %-46s %s\n' "$desc" "$(tr '\n' ' ' <<<"$out" | cut -c1-160)"
    failures=$((failures + 1))
  fi
}

count_sql="SELECT 'courses', count(*) FROM courses
  UNION ALL SELECT 'organizations', count(*) FROM organizations
  UNION ALL SELECT 'maintenance_runs', count(*) FROM maintenance_runs"
restored_counts=$(psql_drill -d oecp -F ' ' -c "$count_sql" 2>/dev/null || true)
live_counts=""
if [[ -n $compare && -n $live_container ]]; then
  live_counts=$(docker exec "$live_container" psql -h /var/run/postgresql -U postgres -d oecp -AtX -F ' ' -c "$count_sql" 2>/dev/null || true)
fi

replay_ts=$(psql_drill -d postgres -c "SELECT coalesce(pg_last_xact_replay_timestamp()::text, 'n/a')" 2>/dev/null || echo n/a)

{
  echo
  echo "================ OECP restore drill report ================"
  echo "Date (UTC):          $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "Host:                $(hostname)"
  echo "Image:               $image"
  echo "Mode:                $mode"
  [[ -n $repo ]] && echo "Repository:          repo$repo"
  [[ -n $backup_set ]] && echo "Backup set:          $backup_set"
  echo "Last replayed xact:  $replay_ts"
  echo "Restore (files):     $(( t_restore - t0 )) s"
  echo "Recovery (WAL):      $(( t_ready - t_restore )) s"
  echo "Total (RTO, DB):     $(( t_ready - t0 )) s"
  echo
  echo "Repository:"
  # shellcheck disable=SC2001
  sed 's/^/  /' <<<"$info"
  echo
  echo "Checks:"
  check "database oecp reachable" psql_drill -d oecp -c "SELECT current_database()"
  check "database keycloak exists" psql_drill -d postgres -c "SELECT datname FROM pg_database WHERE datname = 'keycloak'"
  check "keycloak realm oecp present" psql_drill -d keycloak -c "SELECT name FROM realm WHERE name = 'oecp'"
  check "keycloak users (count)" psql_drill -d keycloak -c "SELECT count(*) FROM user_entity"
  check "oecp schema: latest migration" psql_drill -d oecp -c "SELECT name FROM pgmigrations ORDER BY id DESC LIMIT 1"
  check "page checksums enabled" bash -c "[[ \$(docker exec $name psql -h /var/run/postgresql -U postgres -AtX -c 'SHOW data_checksums') == on ]] && echo on"
  check "no checksum failures" bash -c "n=\$(docker exec $name psql -h /var/run/postgresql -U postgres -AtX -c 'SELECT coalesce(sum(checksum_failures),0) FROM pg_stat_database'); [[ \$n == 0 ]] && echo 0"
  for table in courses organizations maintenance_runs; do
    restored=$(awk -v t="$table" '$1 == t {print $2}' <<<"$restored_counts")
    live=$(awk -v t="$table" '$1 == t {print $2}' <<<"$live_counts")
    if [[ -n $restored ]]; then
      printf '  PASS  %-46s %s\n' "row count $table" "restored $restored${live:+, live now $live}"
    else
      printf '  FAIL  %-46s %s\n' "row count $table" "table not readable"
      failures=$((failures + 1))
    fi
  done
  echo
  if (( failures == 0 )); then echo "Result:              PASS"; else echo "Result:              FAIL ($failures check(s))"; fi
  echo "Live counts may be higher than restored ones: rows written after the restore target."
  if [[ -n $keep ]]; then
    echo "Kept: container $name, volume $scratch_volume."
    echo "  docker exec -it $name psql -h /var/run/postgresql -U postgres -d oecp"
    echo "  docker rm -f $name && docker volume rm $scratch_volume"
  else
    echo "Scratch container and volume removed."
  fi
  echo "==========================================================="
}

exit $(( failures == 0 ? 0 : 1 ))
