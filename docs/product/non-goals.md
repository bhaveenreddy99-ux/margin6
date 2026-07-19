# Non-goals

**Status:** Authoritative (founder decisions 2026-07-11)

Margin6 **does not** aim to build the following in the current product phase:

---

## Product categories

| Category | Reason |
|----------|--------|
| POS | Out of scope; integrate later if ever |
| Recipes / menu engineering | Removed from schema; not competing on menu profitability |
| Theoretical food cost | Requires recipes and sales mix we do not own |
| Menu profitability | Same |
| Payroll / scheduling | HR systems, not inventory intelligence |
| Full accounting / GL | Compete on operations trust, not ERP |

---

## Trusted KPI surfaces (current pilot)

These are **outside trusted pilot scope** until repair epics complete:

- Food Cost %
- Sales-driven P&L views
- **Money Lost** as a single blended aggregate
- Blended **Profit Risk** dollar total
- Shrinkage as a **confident dollar** figure

They may appear in demo UI with low confidence — do not treat as contractual or pilot success metrics.

---

## Role products (deferred)

- Dedicated **manager operations dashboard** (worklist)
- **Employee task system** beyond count entry
- **Exception Inbox** as a product surface
- **Credit recovery** workflows

---

## Infrastructure shortcuts (never acceptable as “done”)

- Frontend-only permission hiding without RLS/API enforcement
- Silent `$0` on failed dashboard queries
- Manual production schema edits without migrations
- Dropping legacy systems before production dependency proof

---

## Related

- [`product-definition.md`](product-definition.md)
- [`../decisions/0001-product-scope.md`](../decisions/0001-product-scope.md)
