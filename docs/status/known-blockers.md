# Known blockers (repair priority)

Ordered list for engineering focus. **Not** a feature roadmap.

---

## 1. Backend financial and location authorization

- Managers can read unassigned **locations** on production (`locations` SELECT policy).
- Per-location cost flags (`can_see_costs`, etc.) enforced in UI; **not** consistently in RLS or API responses.
- Anon EXECUTE grant drift on sensitive RPCs.

**Target:** RLS + RPC grants + API withholding — not card hiding alone.

---

## 2. Receipt confirmation trust

- Receipt RPC exists with Manager+ gate; end-to-end trust (quantities, cost updates, unit mismatch handling) not fully verified in baseline runs.
- Legacy `confirm_invoice_receipt_legacy` still exposed.

---

## 3. Counted-zero versus uncounted

- Dashboard and count workflows must distinguish **uncounted**, **counted zero**, and **missing cost** — not collapse to one display state.

---

## 4. Incomplete-count submission

- Employee count entry and submission paths need reliable E2E and policy verification (Playwright gaps documented).

---

## 5. Order-record fragmentation

- **`purchase_orders`** is the intended authoritative future model.
- **`purchase_history`** and related paths remain in production behavior — document and reconcile; do not silently migrate in unrelated PRs.

---

## 6. GitHub / Supabase reproducibility

- Migration timestamp drift (invite slice).
- Possible edge-function drift (`send-invite`, receipt functions).
- Stale generated types.

---

## 7. Dashboard and Audit Center formula alignment

- Price-increase double-count suspected.
- Money Lost mixes period and point-in-time figures.
- Profit Risk / P&L sections outside trusted pilot scope until fixed.

---

## 8. CI and role-identity verification

- Playwright not fully in CI.
- Role routing tests exist in Vitest; expand location/financial isolation coverage after RLS fixes land.

---

## 9. Security-advisor backlog

- Mutable `search_path` on some functions.
- Storage policies (e.g. `restaurant-logos` listing).
- `failed_inbound_emails` insert policy breadth.
- Leaked-password protection disabled in Auth settings.

Verify each finding before changing grants or policies.

---

## Founder rule

**No new product features** (manager dashboard, employee tasks, Exception Inbox, etc.) until items **1–3** and reproducibility (**6**) are addressed for the approved epic scope.
