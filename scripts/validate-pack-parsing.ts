/**
 * Report: catalog pack parsing coverage and unique pack_size strings.
 *
 * Required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (same as parse-existing-packs.ts)
 *
 * Run: npx tsx scripts/validate-pack-parsing.ts
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvFromFiles } from "./load-env";
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

const PAGE = 2000;

type Row = {
  id: string;
  pack_size: string | null;
  pack_parse_success: boolean;
};

function sortByCountDesc(m: Map<string, number>): [string, number][] {
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

async function main() {
  const all: Row[] = [];
  let from = 0;
  for (;;) {
    const { data, error, count } = await supabase
      .from("inventory_catalog_items")
      .select("id, pack_size, pack_parse_success", { count: "exact" })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      console.error(error);
      process.exit(1);
    }
    const rows = (data ?? []) as Row[];
    if (rows.length === 0) break;
    all.push(...rows);
    if (count != null && from + rows.length >= count) break;
    if (rows.length < PAGE) break;
    from += PAGE;
  }

  const total = all.length;
  const okCount = all.filter((r) => r.pack_parse_success).length;
  const failCount = total - okCount;
  const pct = (n: number) => (total === 0 ? 0 : (100 * n) / total);

  const formatFreq = new Map<string, number>();
  const failFormats = new Map<string, number>();

  for (const r of all) {
    const key = (r.pack_size ?? "").trim() || "(empty)";
    formatFreq.set(key, (formatFreq.get(key) ?? 0) + 1);
    if (!r.pack_parse_success) {
      failFormats.set(key, (failFormats.get(key) ?? 0) + 1);
    }
  }

  console.log("=== Pack parse validation report ===\n");
  console.log(`Total catalog items: ${total}`);
  console.log(
    `Successfully parsed (DB flag): ${okCount} (${pct(okCount).toFixed(1)}%)`,
  );
  console.log(
    `Not successful / false:       ${failCount} (${pct(failCount).toFixed(1)}%)`,
  );
  console.log("\n--- Unique pack_size values (trimmed), by frequency ---\n");
  for (const [k, n] of sortByCountDesc(formatFreq)) {
    console.log(`${n}\t${JSON.stringify(k)}`);
  }
  console.log("\n--- Failed pack_size values (for manual review), by frequency ---\n");
  if (failFormats.size === 0) {
    console.log("(none)");
  } else {
    for (const [k, n] of sortByCountDesc(failFormats)) {
      console.log(`${n}\t${JSON.stringify(k)}`);
    }
  }
  console.log("\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
