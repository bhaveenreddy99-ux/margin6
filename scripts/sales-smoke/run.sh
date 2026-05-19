#!/usr/bin/env bash
# =============================================================================
# Runs the sales-entry smoke tests against a fresh Postgres 17 container.
# Bootstraps a minimal Supabase-like schema (auth.users, auth.uid, authenticated
# role), applies only the 4 migrations the new sales tables depend on, applies
# the new migration, seeds fixtures, then runs 11 RLS + trigger assertions.
#
# Safe to re-run — drops and recreates the container each time.
# =============================================================================

set -euo pipefail

export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"

CONTAINER=sales_smoke_pg
DB=postgres
USER=postgres
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIG="$ROOT/supabase/migrations"
SMOKE="$ROOT/scripts/sales-smoke"

echo "── Bringing up fresh Postgres 17 container ──"
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB="$DB" \
  postgres:17 >/dev/null

# Wait for readiness
for i in $(seq 1 30); do
  if docker exec "$CONTAINER" pg_isready -U "$USER" >/dev/null 2>&1; then break; fi
  sleep 1
done
echo "   Postgres ready."

PSQL="docker exec -i $CONTAINER psql -U $USER -d $DB -v ON_ERROR_STOP=1"

apply() {
  local file="$1"
  local label="$2"
  echo "── Applying: $label"
  $PSQL < "$file" 2>&1 | grep -vE "^(CREATE|ALTER|GRANT|INSERT|NOTICE|DROP|DO|SET|psql:|BEGIN|COMMIT|ROLLBACK|TABLE|FUNCTION|TYPE|POLICY|INDEX|TRIGGER|NOTIFY|EXTENSION| +.+| +id +.+|-.+| *$)" || true
}

apply "$SMOKE/00_bootstrap.sql" "bootstrap (auth schema + role)"
apply "$MIG/20260212001141_initial_schema_core_rls.sql"  "20260212001141 initial schema"
apply "$MIG/20260214020430_locations_and_settings_tables.sql" "20260214020430 locations"
apply "$MIG/20260503000001_user_location_assignments.sql" "20260503000001 user_location_assignments"
apply "$MIG/20260503000005_location_rls_helpers.sql"  "20260503000005 location RLS helpers"
apply "$MIG/20260518000001_sales_entry.sql"  "20260518000001 sales_entry (NEW)"

apply "$SMOKE/01_seed.sql" "seed test fixtures"

echo ""
echo "── Running 11 smoke tests ──────────────────────────────────────────────"
echo ""
# For tests, we want to see psql output (RAISE NOTICE / \echo) verbatim.
docker exec -i "$CONTAINER" psql -U "$USER" -d "$DB" -v ON_ERROR_STOP=0 < "$SMOKE/02_tests.sql" 2>&1 | \
  grep -E "^── Test|^   PASS|^   FAIL|^NOTICE:|^ERROR:|^── 11 smoke tests"

echo ""
echo "── Cleanup ──"
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
echo "   Container removed."
