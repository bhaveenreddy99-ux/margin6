# Human Dashboard Trust Audit — Root Cause Report

Generated from investigation of `human-dashboard-trust-flow.spec.ts` skipping all KPI comparisons (`dataSourceAvailable: false`).

## Symptom

`dashboard-trust-human-audit-report.json` shows:

- `restaurantId`: present (e.g. `38042aa9-4aea-45f7-8e80-143ba8385016`)
- `locationId`: `null`
- `dataSourceAvailable`: `false`
- Setup check **SKIP**: "Could not load Supabase expected values…"
- All KPI checks **SKIP**: "No live expected metrics — UI captured only."

The dashboard UI loads real data (inventory value, profit risk hero, etc.) but the audit cannot compute Supabase-backed expected values.

---

## Investigation checklist

| # | Check | Result |
|---|--------|--------|
| 1 | `E2E_SUPABASE_SERVICE_ROLE_KEY` present? | **No** — not in `.env.local` or process env |
| 2 | `auditSupabase.ts` reads service role correctly? | **Yes** — uses `process.env.E2E_SUPABASE_SERVICE_ROLE_KEY` when set |
| 3 | `VITE_SUPABASE_URL` loaded in Playwright Node? | **Was No** — only in `.env.local`, not loaded by audit helper |
| 4 | Playwright authenticating? | **Yes** — `playwright/.auth/user.json` exists; JWT in `sb-*-auth-token` |
| 5 | `currentRestaurantId` detected? | **Yes** — in auth storage state + runtime localStorage |
| 6 | Why SKIP instead of expected values? | **Primary:** `getSupabaseEnv()` returned `null`, so `fetchLiveExpectedMetrics` never ran |

---

## Root cause (primary)

### Playwright Node env ≠ Vite browser env

| Layer | Supabase config source | Status |
|-------|------------------------|--------|
| **Browser app** (Vite dev server) | `.env.local` → `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | Works — UI shows live data |
| **Playwright audit helpers** (`auditSupabase.ts`) | Previously loaded **`.env` only** | **Failed** — no `.env` file exists; `.env.local` was ignored |

Flow in `human-dashboard-trust-flow.spec.ts`:

```typescript
const supabaseEnv = getSupabaseEnv();
const expected = supabaseEnv
  ? await fetchLiveExpectedMetrics(browserSession, locationId, "this_week")
  : null;  // ← never called when supabaseEnv is null
```

When `getSupabaseEnv()` is `null`, the entire expected-metrics pipeline is skipped — even if:

- Browser has a valid JWT (`access_token` in localStorage)
- `currentRestaurantId` is set
- Dashboard displays correct KPIs

**Fix applied:** `auditSupabase.ts` now loads `.env.local` after `.env` (matching Vite behavior).

---

## Secondary findings

### A. No service role key

Without `E2E_SUPABASE_SERVICE_ROLE_KEY`, the audit falls back to the logged-in user's JWT:

```typescript
createAuditSupabaseClient(accessToken) // anon key + Authorization: Bearer <jwt>
```

This works for RLS-scoped reads when the user owns the restaurant. Service role is optional but recommended for CI strict mode (bypasses RLS edge cases).

### B. `locationId` is null in report

`readBrowserAuditSession()` reads `localStorage.currentLocationId`, but `RestaurantContext` only persists:

```typescript
localStorage.setItem("currentRestaurantId", r.id);
```

Location selection lives in React state, not localStorage. The spec already compensates:

```typescript
if (browserSession.accessToken && browserSession.restaurantId && !locationId) {
  locationId = await resolvePrimaryLocationId(client, browserSession.restaurantId);
}
```

This only runs when `createAuditSupabaseClient` succeeds (requires `getSupabaseEnv()` first).

### C. `fetchLiveExpectedMetrics` does not return SKIP

It returns either `LiveExpectedMetrics` or `null`. SKIP is produced by the spec when:

1. `getSupabaseEnv()` is falsy → `expected = null` (never calls fetch), or
2. `fetchLiveExpectedMetrics` returns `null` because:
   - `!session.restaurantId`, or
   - `createAuditSupabaseClient()` returns `null`

---

## Files involved

| File | Role |
|------|------|
| `tests/e2e/helpers/humanAudit/auditSupabase.ts` | Loads env, builds Supabase client |
| `tests/e2e/helpers/humanAudit/auditSession.ts` | Reads browser JWT + restaurant/location IDs |
| `tests/e2e/helpers/humanAudit/auditExpectedMetrics.ts` | Computes expected KPIs from Supabase |
| `tests/e2e/human-dashboard-trust-flow.spec.ts` | Gates fetch on `getSupabaseEnv()` |
| `.env.local` | Actual Supabase URL + anon key (gitignored) |
| `playwright/.auth/user.json` | Saved login session |

---

## How to verify the fix

```bash
# 1. Ensure .env.local has VITE_SUPABASE_* (copy from .env.example if needed)
# 2. Optional for CI strict mode:
#    E2E_SUPABASE_SERVICE_ROLE_KEY=<service role from Supabase dashboard>

npm run test:e2e:human-audit
```

After fix, console should show diagnostic with `getSupabaseEnvOk: true` and `dataSourceAvailable: true` in the report.

Optional strict CI:

```bash
E2E_STRICT_AUDIT=1 npm run test:e2e:human-audit
```

---

## Recommended setup (production audit)

Add to `.env.local` (or CI secrets):

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJ...

# Optional — bypasses RLS for deterministic CI reads
E2E_SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

Or explicit E2E-prefixed overrides:

```env
E2E_SUPABASE_URL=...
E2E_SUPABASE_ANON_KEY=...
```

---

## Diagnostic logging

When expected metrics fail to load, the spec now prints:

```
=== Human audit — live expected metrics diagnostic ===
{ env: {...}, auth: {...}, client: {...}, blockers: [...] }
```

See `tests/e2e/helpers/humanAudit/diagnoseLiveMetrics.ts`.
