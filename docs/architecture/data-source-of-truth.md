# Data source of truth

**Status:** Architecture authority (2026-07-11)

Distinguishes **current behavior**, **intended behavior**, **known defects**, and **future decisions**.

---

## Inventory on-hand

| | |
|--|--|
| **Current** | Latest **APPROVED** inventory session lines (`inventory_sessions` + `inventory_session_items`) |
| **Intended** | Same for operational dashboard and ordering until continuous on-hand approved |
| **Not** | In-progress counts, zone-only partials without approval, or silent `$0` on query failure |
| **Defect** | Dashboard value may not match DB in all cases (trust epic) |

---

## Unit and cost

| | |
|--|--|
| **Current** | Session line `current_stock` in **cases**; `unit_cost` per case; catalog `default_unit_cost` on receipt |
| **Intended** | Single canonical case engine (`casePlanningEngine.ts`); pack parser for conversions |
| **Future** | Unit/pack mismatch **blocks** catalog cost update (repair epic — not implemented) |

---

## Orders

| | |
|--|--|
| **Current** | Smart order creates/submits via `submit_smart_order`; **`purchase_orders`** and **`purchase_history`** both exist in prod paths |
| **Intended (founder)** | **`purchase_orders`** becomes authoritative order record |
| **Defect** | Fragmentation — do not assume one table in all UI/RPC paths |

---

## Invoices and receipt

| | |
|--|--|
| **Current** | `invoices` + line items; receipt via `confirm_invoice_receipt` (Manager+) |
| **Intended** | Receipt drives last paid cost; comparison rows for price/delivery issues |
| **Defect** | Trust and legacy RPC exposure documented in system audit |

---

## Stock movements

| | |
|--|--|
| **Current** | `stock_movements` (and related) as **audit ledger** |
| **Intended** | Remain ledger until continuous on-hand explicitly approved |
| **Future decision** | Whether movements become live on-hand source |

---

## Location scoping

| | |
|--|--|
| **Current** | Many child tables use `user_can_access_location`; **`locations` table may not** on prod |
| **Intended** | Managers/staff see **assigned locations only**; null-`location_id` operational rows **owner-only** |
| **Defect** | Manager location leak (P1) |

---

## Financial KPIs (dashboard)

| | |
|--|--|
| **Current** | Loaders in `src/domain/dashboard/*` return `LoadOutcome<T>` |
| **Intended** | Error ≠ zero; missing cost ≠ trustworthy zero |
| **Out of pilot trust scope** | Food Cost, P&L, Money Lost aggregate, shrinkage dollar |

---

## Invites and membership

| | |
|--|--|
| **Current** | **`restaurant_invites`** (secure) + legacy **`invitations`** / **`user_invites`** |
| **Intended** | Single secure path; legacy retired after verification |
| **Defect** | Dual systems; production legacy rows present |
