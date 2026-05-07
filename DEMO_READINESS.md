# Demo readiness — gap tracker

Generated from the codebase audit. Update checkboxes and estimates as you fix items.

---

## CRITICAL ISSUES (must fix)

> **Definition:** Would embarrass the pilot, show **wrong business numbers**, or create **security/data** exposure if demo hits that path.

### 1. Multi-location portfolio rollup not trustworthy

| Field | Detail |
|--------|--------|
| **File:line** | `supabase/functions/portfolio-dashboard/index.ts` (full edge fn; session branch **~115-127**, spend **~188-242**); **contrast** `src/domain/dashboard/loadInventoryMetrics.ts` **~72-79**, **~126-133** (single-site uses same “latest approved” + optional `location_id`) |
| **What breaks** | **R/Y/G and spend** on portfolio view can **diverge** from per-location / single restaurant dashboard. Mixed **`location_id` NULL** vs per-location rows affects “latest session” pick. **N×M** sequential queries can **time out** or return **stale** feel with many sites. |
| **Fix** | Short term: **do not** present portfolio as source of truth. Code: add banner + link, or feature-flag portfolio off. Medium: single RPC/SQL roll-up + composite index on `inventory_sessions (restaurant_id, status, location_id, approved_at DESC)` after measuring. |
| **Current code** | Nested loops: per membership → per location → `await sessionQuery` + items + spend assembly. |
| **Fixed code (pilot-level)** | **Done (pilot).** **Client:** `Dashboard.tsx` portfolio branch — Beta alert “not for operational truth” + CTA to open a restaurant. **Edge:** `portfolio-dashboard` — when a restaurant has `locations` rows, added a pass for latest approved session with `location_id IS NULL` (Unassigned: `locationId: "__unassigned__"` in breakdown), matching unscoped / null session handling vs only filtering named locations. **Still optional:** monolithic SQL/RPC + composite index. |
| **Test** | 1) Set **same** time filter on **single** dashboard vs **portfolio** row; R/Y/G and period spend for **one** restaurant should match (± rounding). 2) Network tab: `portfolio-dashboard` **<5s** with pilot-sized data. |
| **Time** | **4h** (copy + gating + manual reconcile script); **1–3d** for aligned queries + index. |
| **Status** | [x] Pilot (banner + unassigned `location_id` pass). Medium-term RPC/index TBD. |

### 2. `anon` role has DML grants on all public tables

| Field | Detail |
|--------|--------|
| **File:line** | `supabase/migrations/20260212010647_grant_public_tables_anon_authenticated.sql` **4-8** |
| **What breaks** | **Security is 100% RLS.** Any **new** table with RLS off or a bad policy = **broad** exposure for unauthenticated key usage. |
| **Fix** | `REVOKE` insert/update/delete on sensitive tables from `anon` (keep as needed for auth-only public flows); re-verify with Supabase “RLS enabled” for **every** table. Add CI check or migration template that **always** `ENABLE ROW LEVEL SECURITY`. |
| **Current code** | `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon;` |
| **Fixed code (pattern)** | New migration, e.g. `REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM anon;` — then **re-grant** only what `anon` needs (often **none** for this app if all traffic is `authenticated`). **Validate** in staging: signup, anon health routes. |
| **Test** | As **anon** key (or no JWT), `insert` into `restaurants` / `inventory_sessions` must **fail** with RLS; confirm no table without RLS. |
| **Time** | **4–8h** (staged revoke + retest) |
| **Status** | [ ] |

### 3. Double inventory lines (same `catalog_item_id` in one session) — wrong totals

| Field | Detail |
|--------|--------|
| **File:line** | `src/features/inventory-count/inventoryZoneWritePipeline.ts` **1-6** (doc); risk is **duplicates** in `inventory_session_items` |
| **What breaks** | **Duplicate** parent rows → **double-counted** stock **value / PAR / reorder** in `buildLatestInventorySnapshot` (iterates every line) — **not merged** in pipeline. |
| **Fix** | **DB (preferred if product allows):** `UNIQUE (session_id, catalog_item_id)` (nullable catalog ids need a rule) **or** merge in import/loader. **App:** on session open, **warn** and block approve if duplicate `catalog_item_id` count >1. |
| **Current** | No merge: “callers should fix … or accept independent totals per row.” |
| **Fixed (guard example)** | Before approve RPC (client or small RPC check): `SELECT catalog_item_id, count(*) FROM inventory_session_items WHERE session_id = $1 AND catalog_item_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1` → block + toast. |
| **Test** | Seed two `inventory_session_items` for same `catalog_item_id` in one `IN_REVIEW` session; dashboard `inventoryValue` = sum of **both** lines (likely wrong for pilot expectation). |
| **Time** | **4–8h** guard; **1–2d** with UNIQUE + data cleanup. |
| **Status** | [ ] |

---

## HIGH PRIORITY (this week)

### 4. `missingCostCount` treats `unit_cost === 0` as “missing”

| Field | Detail |
|--------|--------|
| **File:line** | `src/domain/dashboard/dashboardSelectors.ts` **193** |
| **What breaks** | Items with **legit $0** cost inflate **“missing cost”** KPI and any copy that says “add cost.” |
| **Fix** | Count **null/undefined** only, not falsy. |
| **Current** | `const missingCostCount = items.filter((item) => !item.unit_cost).length;` |
| **Fixed** | `const missingCostCount = items.filter((item) => item.unit_cost == null).length;` |
| **Test** | Session line with `unit_cost: 0` → `missingCostCount` must **not** increment. `null` → increments. |
| **Time** | **0.5h** |
| **Status** | [ ] |

### 5. Edge function error handler assumes `Error` shape

| Field | Detail |
|--------|--------|
| **File:line** | `supabase/functions/portfolio-dashboard/index.ts` **286-288** |
| **What breaks** | Non-`Error` throw → `err.message` may be **undefined**; **JSON** may serialize poorly or hide failure reason. |
| **Fix** | Safe stringify. |
| **Current** | `return new Response(JSON.stringify({ error: err.message }), {` |
| **Fixed** | `const message = err instanceof Error ? err.message : String(err);` / use `message` in JSON. |
| **Test** | Mock throw `"string throw"`; response body includes readable error. |
| **Time** | **0.5h** |
| **Status** | [ ] |

### 6. `computeRiskLevel` ignores restaurant thresholds

| Field | Detail |
|--------|--------|
| **File:line** | `src/lib/inventory-utils.ts` **208-213** |
| **What breaks** | Callers that use **`computeRiskLevel`** get **default** 50/100% bands, not **`smart_order_settings`**, → **inconsistent** with dashboard/ Smart Order. |
| **Fix** | Add optional `thresholds?: RiskThresholds` and pass through to `getRisk(…, thresholds)` **or** delete/replace callers to always pass settings. |
| **Current** | `return getRisk(currentStock, parLevel).level;` |
| **Fixed** | `export function computeRiskLevel(…, thresholds?: RiskThresholds): RiskLevel { return getRisk(currentStock, parLevel, thresholds).level; }` and update call sites. |
| **Test** | Unit test: set red=30%, stock at 40% of PAR → YELLOW with custom thresholds, not default. |
| **Time** | **1–2h** |
| **Status** | [ ] |

### 7. Process-notifications: delivery not proven in static audit

| Field | Detail |
|--------|--------|
| **File:line** | `supabase/functions/process-notifications/index.ts` (entry **~1-80+**); **Supabase Dashboard** crons (not in repo) |
| **What breaks** | **Email low-stock** may **never run** if **no schedule** triggers the edge function. |
| **Fix** | Confirm **pg_cron** / **Supabase scheduled function** / external cron hits `process-notifications` with service auth as designed. Document **schedule** in runbook. |
| **Test** | Lower one item below PAR, run function manually, confirm `notifications` row + email in Resend. |
| **Time** | **1–2h** verify + document |
| **Status** | [ ] |

---

## MEDIUM (post-pilot)

### 8. Portfolio N+1 / spend query volume

| **File:line** | `supabase/functions/portfolio-dashboard/index.ts` (nested `await` throughout) |
| **What breaks** | Latency, timeouts at scale. |
| **Fix** | Batch queries; materialized view; or SQL RPC. |
| **Time** | **1–3d** |
| **Status** | [ ] |

### 9. Large `select("*")` on hot paths

| **File:line** | e.g. `src/pages/app/PurchaseHistory.tsx` **~180-212**; `inventoryCountQueries.ts` multiple `select("*")` |
| **What breaks** | Payload size, memory, slower UI on large orgs. |
| **Fix** | Column lists + pagination. |
| **Time** | **4–8h** per page |
| **Status** | [ ] |

### 10. Send-email auth pattern (service key in `Authorization` substring)

| **File:line** | `supabase/functions/send-email/index.ts` **12-19** |
| **What breaks** | If URL is public and key leaks, high blast radius (key is already full access). |
| **Fix** | **Internal-only** invocations; **HMAC** or **Supabase** restricted “secret” header; no client. |
| **Time** | **2–4h** |
| **Status** | [ ] |

### 11. Planned KPIs in registry (not built)

| **File:line** | `src/domain/metrics/KPIRegistry.ts` **38-43** (`waste_pct`, `labor_food_ratio`, etc.) |
| **What breaks** | Marketing/roadmap can be mistaken for live product. |
| **Fix** | Hide in UI or label “Coming soon” until implemented. |
| **Time** | **1h** |
| **Status** | [ ] |

---

## FEATURE STATUS TABLE

| Feature | Works? | Can demo? | Fix time (to “demo-safe”) |
|--------|--------|-----------|---------------------------|
| Inventory count (single location) | Yes / partial | **Safe** (happy path) | 0.5d if add duplicate guard |
| Zone counting | Partial | **With warning** (explain zones vs floor) | 0.5d |
| Session submit → review → approve | Yes / partial | **Safe** (rehearse) | — |
| Smart order (suggested qty) | Partial | **Safe** (same math as `computeOrderQty`) | 0.5d polish |
| Single-restaurant dashboard KPIs | Partial | **Safe** (disclaim: last approved session) | 0.5h fix #4 |
| Multi-location **portfolio** | No / partial | **Don’t show** or **With warning** | 4h–3d (see #1) |
| Invoices / comparison / receive | Partial | **With warning** (don’t claim full 3-way) | 1–2d verify path |
| Purchase history | Partial | **With warning** (perf on big data) | 4h |
| Waste log + waste $ on dashboard | Partial | **Safe** (explain fallback costing) | — |
| P&L / revenue | **No** (not in `src` as product) | **Don’t show** as “P&L” | N/A (product gap) |
| Low-stock **email** alerts | Unverified | **Don’t show** until #7 checked | 1–2h |
| In-app stock bands (R/Y/G) | Yes | **Safe** (thresholds in settings) | 1h if fix #6 |
| Recipes | Partial | **With warning** | E2E dependent |
| Auth / multi-restaurant | Yes | **Safe** | — |
| Settings (Owner-only) | Yes | **Safe** (Owner route) | — |

---

## DEMO SCRIPT

### Safe to show

- Login → **one** restaurant, **one** location.
- **Inventory** → enter / edit counts → **submit for review** (if role allows) → open **Review** and **approve** (Manager).
- **Single** dashboard: inventory value, R/Y/G, spend range (say: “tied to **last approved** count and **posted** spend logic”).
- **Smart order** screen: show suggested order math aligned with **PAR** (no need to place real vendor order).
- **Waste log** entry (if in pilot scope).
- **Catalog / list** browse (if stable).

### Show with warning

- **Any** screen that says **“total company”** or **“all locations”** — say: “**Portfolio is beta;** use single-store for decisions.”
- **Invoice** matching — “We’re piloting; numbers depend on your ingest quality.”
- **PAR suggestions** (Reports) — “Recommendation engine, not a promise.”
- **Missing cost** count — after fixing #4, or say “falsy zero edge case in flight.”

### Don’t show

- **Multi-location portfolio** as the **source of truth** (until #1 fixed or reconciled).
- **P&L / profit / labor ratio** as **shipped** (KPIs are **heuristics** + **planned** items in `KPIRegistry`).
- **Email alerts** as **reliable** until #7 verified.
- **“Full” 3-way match** as **guaranteed** — say **pilot** / **WIP** instead.

---

## SQL CHECKS (run before demo on staging / pilot DB)

**Duplicate session items (same catalog, same session)**

```sql
SELECT session_id, catalog_item_id, count(*) AS n
FROM public.inventory_session_items
WHERE catalog_item_id IS NOT NULL
GROUP BY 1, 2
HAVING count(*) > 1
LIMIT 50;
```

**Sessions stuck or inconsistent (quick sanity)**

```sql
SELECT id, name, status, restaurant_id, location_id, updated_at
FROM public.inventory_sessions
ORDER BY updated_at DESC
LIMIT 20;
```

**Latest approved per restaurant (for manual reconcile vs dashboard)**

```sql
SELECT id, restaurant_id, location_id, name, approved_at, status
FROM public.inventory_sessions
WHERE status = 'APPROVED'
ORDER BY restaurant_id, approved_at DESC;
```

**RLS: ensure no public table without RLS (Supabase SQL)**

```sql
SELECT c.relname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND NOT c.relrowsecurity
LIMIT 100;
```

**Waste in window (if demoing waste $)**

```sql
SELECT count(*), coalesce(sum(total_cost),0) AS sum_total_cost
FROM public.waste_log
WHERE restaurant_id = '<pilot_restaurant_id>'
  AND logged_at >= now() - interval '7 days';
```

**Spend sanity: confirmed invoices in last 7 days (ids only)**

```sql
SELECT i.id, i.restaurant_id, i.status, i.invoice_date, i.created_at
FROM public.invoices i
WHERE i.restaurant_id = '<pilot_restaurant_id>'
  AND i.status = 'confirmed'
  AND i.invoice_date >= (current_date - 7)
ORDER BY i.invoice_date DESC
LIMIT 30;
```

---

## End-to-end cycle (honest)

| Step | Path | Blocker? |
|------|------|----------|
| Count | `/app/inventory/enter` | #3 if duplicates |
| Submit | Session → `IN_REVIEW` | Rehearse role |
| Approve | Review + `approve_inventory_session_atomic` | RPC + RLS |
| Smart order | `/app/smart-order` | Data must exist post-approve |
| Order submit / vendor | smart order submit flow | **Verify** in staging |
| Receive / stock | Invoices + receiving migrations | **Partial** — verify per pilot |
| Match invoice | Invoice review | **Partial** — don’t overclaim |

---

## Changelog

| Date | Change |
|------|--------|
| (add rows as you close gaps) | |
