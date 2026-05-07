/**
 * One-off backfill: parse every inventory_catalog_items.pack_size and set parsed columns.
 *
 * Required environment (set in .env or export):
 *   SUPABASE_URL              — project URL
 *   SUPABASE_SERVICE_ROLE_KEY — service role key (bypasses RLS for full-table updates)
 *
 * Run manually: npx tsx scripts/parse-existing-packs.ts
 * Do not run in CI or postinstall.
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvFromFiles } from "./load-env";
import { parsePackSize } from "../src/lib/pack-parser";
import type { Database } from "../src/integrations/supabase/types";

loadEnvFromFiles();

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const supabase = createClient<Database>(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PAGE = 1000;

async function main() {
  let from = 0;
  let total = 0;
  let success = 0;
  let failed = 0;

  for (;;) {
    const { data, error, count } = await supabase
      .from("inventory_catalog_items")
      .select("id, pack_size", { count: "exact" })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      console.error("select error", error);
      process.exit(1);
    }
    const rows = data ?? [];
    if (rows.length === 0) break;

    for (const row of rows) {
      total++;
      const p = parsePackSize(row.pack_size ?? "");
      const update = {
        units_per_case: p.unitsPerCase,
        unit_size: p.unitSize,
        unit_type: p.unitType,
        total_per_case: p.totalPerCase,
        pack_parse_success: p.parseSuccess,
      } satisfies Database["public"]["Tables"]["inventory_catalog_items"]["Update"];

      if (!p.parseSuccess) {
        console.warn(
          `parse fail id=${row.id} pack_size=${JSON.stringify(row.pack_size)} err=${p.parseError ?? "?"}`,
        );
        failed++;
      } else {
        success++;
      }

      const { error: uerr } = await supabase
        .from("inventory_catalog_items")
        .update(update)
        .eq("id", row.id);
      if (uerr) {
        console.error("update error", row.id, uerr);
        process.exit(1);
      }
    }

    if (count != null && from + rows.length >= count) break;
    if (rows.length < PAGE) break;
    from += PAGE;
  }

  console.log("— summary —");
  console.log(`Total rows updated: ${total}`);
  console.log(`parseSuccess: ${success}`);
  console.log(`parse failed (logged above): ${failed}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
