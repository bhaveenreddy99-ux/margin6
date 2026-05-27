/** Match parsed invoice_items to inventory_catalog_items for price comparison. */
export async function matchInvoiceCatalogItems(
  supabase: {
    from: (table: string) => {
      select: (cols: string) => unknown;
      update: (row: Record<string, unknown>) => unknown;
    };
  },
  restaurantId: string,
  invoiceId: string,
): Promise<number> {
  const { data: items } = await (supabase as ReturnType<typeof import("https://esm.sh/@supabase/supabase-js@2").createClient>)
    .from("invoice_items")
    .select("id, item_name, product_number, match_status, catalog_item_id")
    .eq("invoice_id", invoiceId);

  let matched = 0;

  for (const item of items ?? []) {
    if (item.match_status === "MATCHED" || item.match_status === "MANUAL") continue;

    let catalogId: string | null = null;
    const productNumber = item.product_number ? String(item.product_number).trim() : "";

    if (productNumber) {
      const { data: skuRows } = await (supabase as ReturnType<typeof import("https://esm.sh/@supabase/supabase-js@2").createClient>)
        .from("inventory_catalog_items")
        .select("id")
        .eq("restaurant_id", restaurantId)
        .eq("vendor_sku", productNumber)
        .limit(2);

      if (skuRows?.length === 1) {
        catalogId = skuRows[0].id as string;
      }
    }

    if (!catalogId) {
      const itemName = String(item.item_name ?? "").trim();
      if (itemName.length >= 3) {
        const { data: nameRows } = await (supabase as ReturnType<typeof import("https://esm.sh/@supabase/supabase-js@2").createClient>)
          .from("inventory_catalog_items")
          .select("id")
          .eq("restaurant_id", restaurantId)
          .ilike("item_name", `%${itemName}%`)
          .limit(2);

        if (nameRows?.length === 1) {
          catalogId = nameRows[0].id as string;
        }
      }
    }

    if (catalogId) {
      await (supabase as ReturnType<typeof import("https://esm.sh/@supabase/supabase-js@2").createClient>)
        .from("invoice_items")
        .update({
          catalog_item_id: catalogId,
          match_status: "MATCHED",
        })
        .eq("id", item.id);

      matched += 1;
    }
  }

  return matched;
}
