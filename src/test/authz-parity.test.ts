import { describe, it, expect } from "vitest";

// S0-INFRA (Phase A) — parity matrix.
//
// The new SQL helpers (supabase/migrations/20260623000005_authz_helpers.sql) must
// return the SAME answers the client already computes in
// src/hooks/useLocationPermissions.ts, or the UI would offer what the server
// denies (broken UX) or hide what the server allows (false lock).
//
// This file pins that contract in CI by encoding BOTH sides independently:
//   * `sql*`    mirrors the migration's logic.
//   * `client*` mirrors useLocationPermissions.ts.
// and asserting sql === client === hand-verified expectation across a matrix.
// (The runtime SQL==spec check runs against a DB — see
//  docs/test-results/s0-infra-phase-a-results.md.)

type Role = "OWNER" | "MANAGER" | "STAFF";

type Flag =
  | "can_approve_orders"
  | "can_see_costs"
  | "can_see_food_cost_pct"
  | "can_see_inventory_value"
  | "can_edit_par";

interface Assignment {
  can_approve_orders: boolean;
  can_see_costs: boolean;
  can_see_food_cost_pct: boolean;
  can_see_inventory_value: boolean;
  can_edit_par: boolean;
  order_approval_threshold: number | null;
}

// Mirror of useLocationPermissions.ts:3-10 — the "no assignment" result.
const allDenied: Assignment = {
  can_approve_orders: false,
  can_see_costs: false,
  can_see_food_cost_pct: false,
  can_see_inventory_value: false,
  can_edit_par: false,
  order_approval_threshold: null,
};

// ── Client mirror (useLocationPermissions.ts) ──────────────────────────────
// OWNER → all true, threshold null. Else → the assignment, or allDenied.
function clientPerms(role: Role, assignment: Assignment | null): Assignment {
  if (role === "OWNER") {
    return {
      can_approve_orders: true,
      can_see_costs: true,
      can_see_food_cost_pct: true,
      can_see_inventory_value: true,
      can_edit_par: true,
      order_approval_threshold: null,
    };
  }
  return assignment ?? allDenied;
}

// Client SmartOrder submit gate (SmartOrder.tsx:476-489, 670):
// can_approve_orders AND (threshold null ⇒ unlimited; else amount <= threshold).
function clientCanApprove(role: Role, assignment: Assignment | null, amount: number): boolean {
  const p = clientPerms(role, assignment);
  return p.can_approve_orders && (p.order_approval_threshold === null || amount <= p.order_approval_threshold);
}

// ── SQL mirror (20260623000005_authz_helpers.sql) ──────────────────────────
function sqlHasLocationPermission(role: Role, assignment: Assignment | null, flag: Flag): boolean {
  if (role === "OWNER") return true;            // OWNER short-circuit
  if (!assignment) return false;                // no assignment ⇒ false
  return assignment[flag];
}

function sqlCanApproveOrderAmount(role: Role, assignment: Assignment | null, amount: number): boolean {
  if (role === "OWNER") return true;            // OWNER ⇒ unlimited
  if (!assignment || !assignment.can_approve_orders) return false;
  const t = assignment.order_approval_threshold;
  return t === null || amount <= t;             // == threshold passes
}

function sqlCanConfirmReceipt(role: Role): boolean {
  return role === "OWNER" || role === "MANAGER"; // pure Manager+ role rule
}

// ── Fixtures ───────────────────────────────────────────────────────────────
const A = (over: Partial<Assignment> = {}): Assignment => ({ ...allDenied, ...over });

const FLAGS: Flag[] = [
  "can_approve_orders",
  "can_see_costs",
  "can_see_food_cost_pct",
  "can_see_inventory_value",
  "can_edit_par",
];

const SCENARIOS: Array<{ name: string; role: Role; assignment: Assignment | null }> = [
  { name: "OWNER (no assignment)", role: "OWNER", assignment: null },
  { name: "OWNER (with restrictive assignment — ignored)", role: "OWNER", assignment: A() },
  { name: "MANAGER no assignment", role: "MANAGER", assignment: null },
  { name: "STAFF no assignment", role: "STAFF", assignment: null },
  { name: "MANAGER all-true assignment", role: "MANAGER", assignment: A({ can_approve_orders: true, can_see_costs: true, can_see_food_cost_pct: true, can_see_inventory_value: true, can_edit_par: true }) },
  { name: "STAFF default-ish (approve+par+foodcost true, costs/value false)", role: "STAFF", assignment: A({ can_approve_orders: true, can_edit_par: true, can_see_food_cost_pct: true }) },
  { name: "STAFF cost-hidden", role: "STAFF", assignment: A({ can_see_costs: false }) },
];

describe("S0-INFRA parity — has_location_permission vs useLocationPermissions", () => {
  for (const s of SCENARIOS) {
    for (const flag of FLAGS) {
      it(`${s.name} · ${flag}`, () => {
        const sql = sqlHasLocationPermission(s.role, s.assignment, flag);
        const client = clientPerms(s.role, s.assignment)[flag] as boolean;
        expect(sql).toBe(client); // SQL helper agrees with the client hook
      });
    }
  }

  it("OWNER ⇒ every flag true regardless of assignment", () => {
    for (const flag of FLAGS) {
      expect(sqlHasLocationPermission("OWNER", A(), flag)).toBe(true);
      expect(sqlHasLocationPermission("OWNER", null, flag)).toBe(true);
    }
  });

  it("non-owner with no assignment ⇒ every flag false (allDenied)", () => {
    for (const flag of FLAGS) {
      expect(sqlHasLocationPermission("STAFF", null, flag)).toBe(false);
      expect(sqlHasLocationPermission("MANAGER", null, flag)).toBe(false);
    }
  });
});

describe("S0-INFRA parity — can_approve_order_amount vs SmartOrder gate", () => {
  const amounts = [0, 500, 1000, 1000.01, 5000];
  const cases: Array<{ name: string; role: Role; assignment: Assignment | null }> = [
    { name: "OWNER", role: "OWNER", assignment: null },
    { name: "MANAGER no-flag", role: "MANAGER", assignment: A({ can_approve_orders: false }) },
    { name: "STAFF approve, no threshold (unlimited)", role: "STAFF", assignment: A({ can_approve_orders: true, order_approval_threshold: null }) },
    { name: "STAFF approve, threshold 1000", role: "STAFF", assignment: A({ can_approve_orders: true, order_approval_threshold: 1000 }) },
    { name: "STAFF no approve", role: "STAFF", assignment: A({ can_approve_orders: false }) },
    { name: "STAFF no assignment", role: "STAFF", assignment: null },
  ];
  for (const c of cases) {
    for (const amount of amounts) {
      it(`${c.name} · $${amount}`, () => {
        expect(sqlCanApproveOrderAmount(c.role, c.assignment, amount)).toBe(
          clientCanApprove(c.role, c.assignment, amount),
        );
      });
    }
  }

  it("threshold boundary: amount == threshold is allowed; just over is denied", () => {
    const asn = A({ can_approve_orders: true, order_approval_threshold: 1000 });
    expect(sqlCanApproveOrderAmount("STAFF", asn, 1000)).toBe(true);
    expect(sqlCanApproveOrderAmount("STAFF", asn, 1000.01)).toBe(false);
  });

  it("OWNER approves any amount", () => {
    expect(sqlCanApproveOrderAmount("OWNER", null, 1_000_000)).toBe(true);
  });
});

describe("S0-INFRA — can_confirm_receipt (Manager+ role rule)", () => {
  it("OWNER and MANAGER may confirm; STAFF may not", () => {
    expect(sqlCanConfirmReceipt("OWNER")).toBe(true);
    expect(sqlCanConfirmReceipt("MANAGER")).toBe(true);
    expect(sqlCanConfirmReceipt("STAFF")).toBe(false);
  });
});
