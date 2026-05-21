// Public, unauthenticated leak-audit endpoint. Accepts up to 2 invoice files,
// fans them out to parse-invoice using the service-role key (kept server-side),
// aggregates line items, and returns an estimated weekly food-cost leak.
// Stateless — nothing is written to the database.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MAX_FILES = 2;
const MAX_BYTES_PER_FILE = 5 * 1024 * 1024;
const LOSS_RATE = 0.08;

type FileType = "PDF" | "IMAGE";

interface IncomingFile {
  content: string;
  file_type: FileType;
  filename?: string;
}

interface ParsedItem {
  item_name?: string;
  quantity?: number;
  unit_cost?: number;
  line_total?: number;
  unit?: string;
  pack_size?: string;
  brand_name?: string;
  product_number?: string;
}

interface ParsedInvoice {
  vendor_name?: string;
  invoice_number?: string;
  invoice_date?: string;
  subtotal?: number;
  tax?: number;
  total?: number;
  items?: ParsedItem[];
  error?: string;
}

interface TopItem {
  item_name: string;
  line_total: number;
  vendor_name: string;
}

function approxBase64Bytes(b64: string): number {
  const len = b64.replace(/\s/g, "").length;
  // base64 → 3 bytes per 4 chars, minus padding
  return Math.floor((len * 3) / 4);
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      return new Response(JSON.stringify({ error: "Server not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json().catch(() => null)) as
      | { files?: IncomingFile[] }
      | null;

    const files = Array.isArray(body?.files) ? body!.files! : [];
    if (files.length === 0) {
      return new Response(JSON.stringify({ error: "No files provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (files.length > MAX_FILES) {
      return new Response(
        JSON.stringify({ error: `Too many files — max ${MAX_FILES}` }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    for (const f of files) {
      if (!f?.content || typeof f.content !== "string") {
        return new Response(JSON.stringify({ error: "Each file needs base64 `content`" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (f.file_type !== "PDF" && f.file_type !== "IMAGE") {
        return new Response(JSON.stringify({ error: "file_type must be PDF or IMAGE" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (approxBase64Bytes(f.content) > MAX_BYTES_PER_FILE) {
        return new Response(JSON.stringify({ error: "File too large — 5MB max per invoice" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Parse each invoice in parallel via the existing parse-invoice function.
    const parseResults = await Promise.all(
      files.map(async (f) => {
        try {
          const res = await fetch(`${supabaseUrl}/functions/v1/parse-invoice`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${serviceKey}`,
            },
            body: JSON.stringify({ content: f.content, file_type: f.file_type }),
          });
          const data = (await res.json().catch(() => ({}))) as ParsedInvoice;
          if (!res.ok) {
            return { ok: false as const, error: data?.error || "Parse failed" };
          }
          return { ok: true as const, data, filename: f.filename };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { ok: false as const, error: message };
        }
      }),
    );

    const okResults = parseResults.filter(
      (r): r is { ok: true; data: ParsedInvoice; filename?: string } => r.ok,
    );

    if (okResults.length === 0) {
      const firstError =
        parseResults.find((r) => !r.ok)?.error ?? "Could not read invoice";
      return new Response(JSON.stringify({ error: firstError }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Aggregate: sum line totals, collect items + vendors.
    const allItems: TopItem[] = [];
    const vendors = new Set<string>();
    const perInvoiceSpend: number[] = [];

    for (const r of okResults) {
      const invoice = r.data;
      const vendor = (invoice.vendor_name ?? "Unknown vendor").toString().trim() || "Unknown vendor";
      vendors.add(vendor);

      const items = Array.isArray(invoice.items) ? invoice.items : [];
      let invoiceSpend = 0;
      for (const it of items) {
        const lineTotalRaw = num(it.line_total);
        const fallback = num(it.unit_cost) * num(it.quantity);
        const lineTotal = lineTotalRaw > 0 ? lineTotalRaw : fallback;
        if (lineTotal <= 0) continue;
        const itemName = (it.item_name ?? "").toString().trim() || "Item";
        invoiceSpend += lineTotal;
        allItems.push({ item_name: itemName, line_total: lineTotal, vendor_name: vendor });
      }
      // Prefer subtotal as the spend basis when present (already excludes tax),
      // fall back to summed line totals.
      const subtotal = num(invoice.subtotal);
      perInvoiceSpend.push(subtotal > 0 ? subtotal : invoiceSpend);
    }

    const totalSpend = perInvoiceSpend.reduce((a, b) => a + b, 0);
    // Spec: if 2 invoices, average the two estimates. Per-invoice leak = spend × 8%.
    const averageInvoiceSpend =
      perInvoiceSpend.length > 0
        ? perInvoiceSpend.reduce((a, b) => a + b, 0) / perInvoiceSpend.length
        : 0;
    const estimatedWeeklyLeak =
      perInvoiceSpend.length > 1
        ? averageInvoiceSpend * LOSS_RATE
        : totalSpend * LOSS_RATE;

    const topItems = allItems
      .sort((a, b) => b.line_total - a.line_total)
      .slice(0, 5);

    return new Response(
      JSON.stringify({
        total_spend: Math.round(totalSpend * 100) / 100,
        estimated_weekly_leak: Math.round(estimatedWeeklyLeak * 100) / 100,
        loss_rate: LOSS_RATE,
        top_items: topItems,
        vendor_names: Array.from(vendors),
        item_count: allItems.length,
        invoices_parsed: okResults.length,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("audit-invoice-anon error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
