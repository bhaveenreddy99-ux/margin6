import { describe, expect, it } from "vitest";
import {
  buildPriceIncreaseAlertRows,
  parsePriceIncreaseNotificationData,
  priceIncreaseDollarImpact,
  sumPriceIncreaseImpactFromNotifications,
} from "@/domain/dashboard/priceIncreaseFromNotifications";

describe("priceIncreaseFromNotifications", () => {
  it("parses PRICE_INCREASE notification payload from confirm_invoice_receipt", () => {
    const parsed = parsePriceIncreaseNotificationData({
      invoice_id: "inv-1",
      items: [
        {
          item_name: "Container Plastic",
          old_cost: 10,
          new_cost: 11.47,
          pct_change: 14.7,
        },
      ],
    });

    expect(parsed.invoice_id).toBe("inv-1");
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items?.[0]?.item_name).toBe("Container Plastic");
    expect(priceIncreaseDollarImpact(parsed.items![0]!)).toBeCloseTo(1.47, 2);
  });

  it("sums notification impacts for dashboard priceIncreaseImpact", () => {
    const total = sumPriceIncreaseImpactFromNotifications([
      {
        id: "n1",
        created_at: "2026-05-28T12:00:00.000Z",
        data: {
          invoice_id: "inv-1",
          items: [
            { item_name: "Container Plastic", old_cost: 10, new_cost: 11.47, pct_change: 14.7 },
          ],
        },
      },
    ]);

    expect(total).toBeCloseTo(1.47, 2);
  });

  it("builds alert rows with pct and dollar impact", () => {
    const rows = buildPriceIncreaseAlertRows(
      [
        {
          id: "n1",
          created_at: "2026-05-28T12:00:00.000Z",
          data: {
            invoice_id: "inv-1",
            items: [
              { item_name: "Container Plastic", old_cost: 10, new_cost: 11.47, pct_change: 14.7 },
            ],
          },
        },
      ],
      new Map([["inv-1", "PFG"]]),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.item_name).toBe("Container Plastic");
    expect(rows[0]?.vendor_name).toBe("PFG");
    expect(rows[0]?.pct_change).toBeCloseTo(14.7, 1);
    expect(rows[0]?.dollar_impact).toBeCloseTo(1.47, 2);
  });
});
