# 13 — Product Gap Analysis

**Target product:** Restaurant purchasing control and inventory exception management — *not* POS, recipes, accounting, or generic RMS.

---

## Intended capability vs current state

| Capability | Intended | Current | Gap |
|------------|----------|---------|-----|
| Fast counts | Mobile-first, zone-aware | Enter UI exists; E2E entry blocked | **Complete count UX** |
| Count approval | Manager queue | Review page; no queue dashboard | **Manager ops surface** |
| Smart ordering | PAR-driven suggestions | Approval creates run; submit → PO | **Open PO deduction unverified** |
| Order approval | Threshold + owner override | RPC + UI in SmartOrder | **Working code; untested E2E** |
| Receiving | Trusted qty confirmation | Phase 4 UI + RPC | **E2E not executed** |
| Three-way matching | PO / delivery / invoice | `buildComparisonRows` + statuses | **Real; credit recovery missing** |
| Vendor price monitoring | Alerts + dashboard | PRICE_INCREASE notifications | **Dashboard card broken in baseline** |
| Invoice exceptions | Review + issues | delivery_issues + comparison statuses | **Partial** |
| Credit recovery | Track unresolved credits | **Not found in codebase** | **Missing** |
| Manager accountability | Did they fix it? | No resolution workflow | **Missing** |
| Owner oversight | Trusted KPIs + exceptions | Rich dashboard; trust broken | **Fix aggregation + exception inbox** |
| Multi-location | Scoped access | Owner OK; manager leak | **RLS fix** |
| Onboarding | Restaurant + invite + list | create_restaurant + invite flow | **Working** |
| Daily restaurant use | Role-specific daily flows | Owner/manager share dashboard | **Role product gaps** |

---

## Explicitly out of scope (correctly absent or removed)

| Feature | Status |
|---------|--------|
| POS | `orders` table legacy; no POS UI |
| Recipe costing | Tables **dropped**; dead hooks remain |
| Menu profitability | Not present |
| Payroll / scheduling | Not present |
| Full accounting | Not present |

---

## Keep (working foundation)

- Supabase multi-tenant schema + RLS foundation
- Domain module extraction (`src/domain/`)
- Count workflow + atomic approval RPC
- Smart order → PO RPC chain
- Invoice intake + AI parse + comparison model
- STAFF dashboard isolation pattern
- New secure invite system (`restaurant_invites`)
- Unit test investment (604 tests)
- E2E safety guards

---

## Complete (before pilot)

1. Dashboard inventory value / location scope
2. Locations RLS for assigned managers
3. Employee count entry verification
4. Receipt confirm E2E + idempotency
5. Price alert surfacing on dashboard
6. Type regeneration + CI typecheck fix
7. Playwright smoke aligned to current UI

---

## Refactor (don't rebuild)

- Consolidate invite tables
- Retire purchase_history path
- Split Settings.tsx / Dashboard.tsx incrementally
- Unify order qty functions under casePlanningEngine
- Enforce permission flags at loader level not just KPI cards

---

## Remove

- Recipe hooks/domain/tests
- Mock vendor import UI **or** clearly label demo-only
- Dead `/app/recipes` E2E
- Duplicate KPISnapshot type definition

---

## Postpone (post-pilot)

- Cross-location owner comparison dashboards
- Credit recovery ledger
- Manager performance scoring
- Portfolio edge function productization
- Real vendor API integrations

---

## Competitive positioning readiness

| Margin6 win vector | Ready? |
|--------------------|--------|
| Faster counting | **No** — entry UX unverified |
| Simpler UI | **Partial** — employee OK; manager cluttered |
| Better alerts | **Partial** — engine exists; surfacing broken |
| Trusted dashboard | **No** — baseline failure |
| Easier onboarding | **Yes** — restaurant + invite path works |

---

## Pilot readiness statement

**Not ready** for paying design partners until P1 trust defects resolved and receipt workflow proven.

**Ready** for internal continued development on existing architecture without greenfield rewrite.
