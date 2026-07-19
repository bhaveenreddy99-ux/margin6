# Documentation conflict map

**Audit date:** 2026-07-11

Conflicts between **authoritative new docs**, **system-audit**, **archived docs**, and **README/marketing** claims.

---

## Product naming

| Source | Claim | Resolution |
|--------|-------|------------|
| `.cursor/.cursorrules` (removed) | RestaurantIQ, 3–50 locations, Next.js | **Obsolete** — archived/removed |
| `docs/RESTAURANTIQ_PLAN.md` | RestaurantIQ master plan | **Archived** |
| `AGENTS.md` | Margin6, 2–10 locations | **Authoritative** |

---

## Test counts

| Source | Claim | Resolution |
|--------|-------|------------|
| `docs/system-audit/00-executive-summary.md` | 604 Vitest pass @ audit date | **Dated fact** — re-verify with `npm run test` |
| `.cursor/.cursorrules` | 218 tests | **Obsolete** |
| `docs/system-audit/17-roadmap-reconciliation.md` | 613 pass (uncommitted work) | **Not on main** — do not cite as main baseline |
| Missing CI artifacts | Historical Playwright run JSON | **Do not reconstruct** — note evidence unavailable |

---

## Security / RLS

| Source | Claim | Resolution |
|--------|-------|------------|
| Old README | "Complete data isolation" | **False for prod** — manager location leak |
| `docs/system-audit/09-database-security.md` | Partial permission enforcement | **Current** |
| `docs/status/known-blockers.md` | P1 location + cost gaps | **Authoritative for status** |

---

## Migration / deploy

| Source | Claim | Resolution |
|--------|-------|------------|
| `docs/testing/staging/03-migration-execution-plan.md` | `supabase db push` steps | **Operational reference** — requires review banner; prod needs approval |
| `docs/status/production-drift.md` | Timestamp drift, no blind push | **Authoritative** |

---

## Invite system

| Source | Claim | Resolution |
|--------|-------|------------|
| Roadmap BUILD tickets | AcceptInvite / Team UI missing | **Wrong** — implemented; see `17-roadmap-reconciliation.md` |
| `docs/status/production-drift.md` | Legacy rows on prod | **Authoritative** — blocks legacy DROP |

---

## Dashboard trust

| Source | Claim | Resolution |
|--------|-------|------------|
| `MARGIN6_MASTER_STATUS.md` | LoadOutcome open | **Stale** — loaders migrated; UI gaps remain |
| Founder decision | Food Cost/P&L/Money Lost untrusted | **Authoritative** — `non-goals.md` |

---

## Broken / missing evidence links

| Link target | Status |
|-------------|--------|
| Some local baseline PNG/evidence paths | May exist under `docs/testing/local/` — treat as **point-in-time** |
| Historical CI Playwright reports | **Unavailable** — do not recreate |

After archive moves, internal links from `docs/plans/*` to `../architecture/t0-*` may break — **expected**; use archive index.

---

## Remaining conflicts to resolve in code (not this PR)

1. Production location RLS vs documented intent  
2. Price double-count vs dashboard display  
3. Legacy + secure invite dual paths  
4. Generated types vs live schema  
