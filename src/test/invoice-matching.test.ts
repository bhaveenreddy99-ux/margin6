import { describe, expect, it } from "vitest";
import { matchInvoiceItems } from "@/components/invoices/useInvoiceMatching";

describe("invoice matching", () => {
  it("matches by exact SKU before name matching", () => {
    const matched = matchInvoiceItems(
      [{ product_number: "SKU-42", item_name: "Anything", quantity: 1 }],
      [{ id: "cat-1", item_name: "Roma Tomatoes", vendor_sku: "sku42" }],
    );

    expect(matched[0].catalog_item_id).toBe("cat-1");
    expect(matched[0].match_status).toBe("MATCHED");
  });

  it("matches exact normalized names when the candidate is unique", () => {
    const matched = matchInvoiceItems(
      [{ item_name: "Chicken Breast", quantity: 2 }],
      [{ id: "cat-1", item_name: "Chicken-Breast" }],
    );

    expect(matched[0].catalog_item_id).toBe("cat-1");
    expect(matched[0].catalog_match_name).toBe("Chicken-Breast");
  });

  it("does not auto-match substring-only names", () => {
    const matched = matchInvoiceItems(
      [{ item_name: "Tomato", quantity: 1 }],
      [
        { id: "cat-1", item_name: "Tomato Sauce" },
        { id: "cat-2", item_name: "Fire Roasted Tomatoes" },
      ],
    );

    expect(matched[0].catalog_item_id).toBeNull();
    expect(matched[0].match_status).toBe("UNMATCHED");
  });

  it("uses pack size to safely narrow duplicate exact-name candidates", () => {
    const matched = matchInvoiceItems(
      [{ item_name: "Milk", pack_size: "1 gal", quantity: 1 }],
      [
        { id: "cat-1", item_name: "Milk", pack_size: "0.5 gal" },
        { id: "cat-2", item_name: "Milk", pack_size: "1 gal" },
      ],
    );

    expect(matched[0].catalog_item_id).toBe("cat-2");
    expect(matched[0].match_status).toBe("MATCHED");
  });

  it("leaves ambiguous duplicate exact-name candidates unmatched", () => {
    const matched = matchInvoiceItems(
      [{ item_name: "Milk", quantity: 1 }],
      [
        { id: "cat-1", item_name: "Milk", pack_size: "0.5 gal" },
        { id: "cat-2", item_name: "Milk", pack_size: "1 gal" },
      ],
    );

    expect(matched[0].catalog_item_id).toBeNull();
    expect(matched[0].match_status).toBe("UNMATCHED");
  });
});
