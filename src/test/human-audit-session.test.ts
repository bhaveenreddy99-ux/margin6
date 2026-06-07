import { describe, expect, it } from "vitest";
import { HumanAuditCollector } from "../../tests/e2e/helpers/humanAudit/auditCollector";
import {
  pickAuditLocationId,
  pickAuditRestaurantId,
  type AuditLocation,
  type AuditLocationAssignment,
  type AuditMembership,
} from "../../tests/e2e/helpers/humanAudit/resolveAuditSessionCore";

const STALE_RESTAURANT = "38042aa9-4aea-45f7-8e80-143ba8385016";
const MEMBER_RESTAURANT = "a45f9dd2-56c2-499b-a89e-15a42d96ae23";
const UI_LOCATION = "3699bbe8-cbde-4045-a3c0-99cc1ff171cc";
const DEFAULT_LOCATION = "11111111-1111-1111-1111-111111111111";

const memberships: AuditMembership[] = [{ restaurantId: MEMBER_RESTAURANT, role: "OWNER" }];

const locations: AuditLocation[] = [
  {
    id: UI_LOCATION,
    restaurantId: MEMBER_RESTAURANT,
    isActive: true,
    isDefault: false,
  },
  {
    id: DEFAULT_LOCATION,
    restaurantId: MEMBER_RESTAURANT,
    isActive: true,
    isDefault: true,
  },
];

describe("pickAuditRestaurantId", () => {
  it("ignores stale localStorage restaurant id when it is not in restaurant_members", () => {
    const picked = pickAuditRestaurantId(memberships, {
      selectedRestaurantId: STALE_RESTAURANT,
      selectedLocationId: UI_LOCATION,
    });
    expect(picked).toBe(MEMBER_RESTAURANT);
  });

  it("uses user_ui_state restaurant when it is a valid membership", () => {
    const membershipsWithTwo: AuditMembership[] = [
      { restaurantId: MEMBER_RESTAURANT, role: "OWNER" },
      { restaurantId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", role: "MANAGER" },
    ];
    const picked = pickAuditRestaurantId(membershipsWithTwo, {
      selectedRestaurantId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      selectedLocationId: null,
    });
    expect(picked).toBe("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
  });

  it("falls back to first membership when ui_state restaurant is null", () => {
    const picked = pickAuditRestaurantId(memberships, {
      selectedRestaurantId: null,
      selectedLocationId: UI_LOCATION,
    });
    expect(picked).toBe(MEMBER_RESTAURANT);
  });
});

describe("pickAuditLocationId", () => {
  it("prefers user_ui_state location when it belongs to the resolved restaurant", () => {
    const picked = pickAuditLocationId(
      MEMBER_RESTAURANT,
      locations,
      { selectedRestaurantId: null, selectedLocationId: UI_LOCATION },
      [],
      "OWNER",
    );
    expect(picked).toBe(UI_LOCATION);
  });

  it("falls back to default active location for owners", () => {
    const picked = pickAuditLocationId(
      MEMBER_RESTAURANT,
      locations,
      { selectedRestaurantId: MEMBER_RESTAURANT, selectedLocationId: null },
      [],
      "OWNER",
    );
    expect(picked).toBe(DEFAULT_LOCATION);
  });

  it("scopes manager picks to assigned locations", () => {
    const assignments: AuditLocationAssignment[] = [
      { locationId: UI_LOCATION, isPrimary: true },
    ];
    const picked = pickAuditLocationId(
      MEMBER_RESTAURANT,
      locations,
      { selectedRestaurantId: MEMBER_RESTAURANT, selectedLocationId: DEFAULT_LOCATION },
      assignments,
      "MANAGER",
    );
    expect(picked).toBe(UI_LOCATION);
  });
});

describe("HumanAuditCollector compareNumber", () => {
  it("formats integer counts without percent signs even when formula mentions %", () => {
    const collector = new HumanAuditCollector();
    collector.compareNumber({
      page: "Dashboard",
      label: "Critical low stock items",
      uiValue: "18",
      uiNumeric: 18,
      expectedNumeric: 18,
      sourceData: "session items",
      formula: "count items where stock/par < red threshold (default 50%)",
      valueKind: "count",
    });
    const check = collector.buildReport().checks[0]!;
    expect(check.expectedValue).toBe("18");
    expect(check.pass).toBe(true);
  });

  it("requires exact matches for invoice count KPIs", () => {
    const collector = new HumanAuditCollector();
    collector.compareNumber({
      page: "Invoices",
      label: "Total Invoices",
      uiValue: "1",
      uiNumeric: 1,
      expectedNumeric: 0,
      sourceData: "invoices",
      formula: "count(all invoices)",
      valueKind: "count",
    });
    expect(collector.buildReport().checks[0]!.pass).toBe(false);
  });
});
