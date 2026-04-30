#!/bin/sh
# docker-entrypoint.sh — runtime orchestrator for OpenCauldron self-host.
#
# POSIX sh (alpine `ash`-compatible). No bashisms.
#
# Sequence:
#   1. Ensure NEXTAUTH_SECRET (read from /app/.state/auth-secret, else gen + persist).
#   2. Wait for Postgres to accept TCP.
#   3. Apply Drizzle migrations (scripts/migrate-runtime.mjs).
#   4. Bootstrap admin workspace if none exists (scripts/bootstrap-runtime.mjs).
#   5. exec node server.js.
#
# All steps log with the [entrypoint] prefix. Any failure is fatal.

set -eu

STATE_DIR="/app/.state"
SECRET_FILE="${STATE_DIR}/auth-secret"
DB_WAIT_TIMEOUT="${DB_WAIT_TIMEOUT:-60}"

# NextAuth v5 refuses requests for hosts it doesn't trust unless told otherwise.
# Self-host installs always serve their own host, so default to trusted unless
# the user has set the variable explicitly.
export AUTH_TRUST_HOST="${AUTH_TRUST_HOST:-true}"

# Self-hosted mode toggles the in-app workspace switcher and the bootstrap
# path. Default to self_hosted in the container — self-hosters running this
# image never need the SaaS multi-tenant code paths.
export WORKSPACE_MODE="${WORKSPACE_MODE:-self_hosted}"

log() {
  echo "[entrypoint] $*"
}

# ---------------------------------------------------------------------------
# 1. NEXTAUTH_SECRET
# ---------------------------------------------------------------------------
ensure_secret() {
  mkdir -p "${STATE_DIR}"

  # Persisted file always wins — survives image upgrades.
  if [ -s "${SECRET_FILE}" ]; then
    NEXTAUTH_SECRET="$(cat "${SECRET_FILE}")"
    export NEXTAUTH_SECRET
    log "reusing persisted NEXTAUTH_SECRET from ${SECRET_FILE}"
    return
  fi

  # Env value wins next — user explicitly set one.
  if [ -n "${NEXTAUTH_SECRET:-}" ]; then
    printf '%s' "${NEXTAUTH_SECRET}" > "${SECRET_FILE}"
    chmod 600 "${SECRET_FILE}"
    log "persisted env-provided NEXTAUTH_SECRET to ${SECRET_FILE}"
    return
  fi

  # Generate a new one.
  GEN="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")"
  printf '%s' "${GEN}" > "${SECRET_FILE}"
  chmod 600 "${SECRET_FILE}"
  NEXTAUTH_SECRET="${GEN}"
  export NEXTAUTH_SECRET
  log "generated and persisted a new NEXTAUTH_SECRET (32 bytes, base64)"
}

# ---------------------------------------------------------------------------
# 2. Wait for Postgres
# ---------------------------------------------------------------------------
wait_for_db() {
  if [ -z "${DATABASE_URL:-}" ]; then
    log "DATABASE_URL is not set — cannot start"
    exit 1
  fi

  log "waiting up to ${DB_WAIT_TIMEOUT}s for Postgres to accept connections"
  i=0
  while [ "${i}" -lt "${DB_WAIT_TIMEOUT}" ]; do
    if node -e "
      const { Client } = require('pg');
      const c = new Client({ connectionString: process.env.DATABASE_URL });
      c.connect().then(() => c.end()).then(() => process.exit(0)).catch(() => process.exit(1));
    " >/dev/null 2>&1; then
      log "database is ready (after ${i}s)"
      return
    fi
    i=$((i + 1))
    sleep 1
  done

  log "database did not become ready within ${DB_WAIT_TIMEOUT}s — giving up"
  exit 1
}

# ---------------------------------------------------------------------------
# 3. Migrations
# ---------------------------------------------------------------------------
run_migrations() {
  log "running migrations"
  node scripts/migrate-runtime.mjs
}

# ---------------------------------------------------------------------------
# 4. Bootstrap (idempotent)
# ---------------------------------------------------------------------------
run_bootstrap() {
  log "checking for existing workspace; bootstrapping if absent"
  node scripts/bootstrap-runtime.mjs
}

# ---------------------------------------------------------------------------
# 5. Hand off to the Next server
# ---------------------------------------------------------------------------
main() {
  ensure_secret
  wait_for_db
  run_migrations
  run_bootstrap
  log "starting Next.js server"
  exec node server.js
}

main "$@"
