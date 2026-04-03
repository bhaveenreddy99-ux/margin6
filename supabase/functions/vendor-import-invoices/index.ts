import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Mock invoice data for demo mode
const MOCK_INVOICES: Record<string, any[]> = {
  Sysco: [
    { invoice_number: "SYS-2026-44821", invoice_date: "2026-02-18", vendor_name: "Sysco", total: 1284.50, item_count: 12, status: "delivered" },
    { invoice_number: "SYS-2026-44790", invoice_date: "2026-02-14", vendor_name: "Sysco", total: 978.25, item_count: 9, status: "delivered" },
    { invoice_number: "SYS-2026-44712", invoice_date: "2026-02-07", vendor_name: "Sysco", total: 1450.00, item_count: 15, status: "delivered" },
  ],
  "US Foods": [
    { invoice_number: "USF-88321", invoice_date: "2026-02-19", vendor_name: "US Foods", total: 2105.75, item_count: 18, status: "delivered" },
    { invoice_number: "USF-88290", invoice_date: "2026-02-12", vendor_name: "US Foods", total: 1620.00, item_count: 14, status: "delivered" },
  ],
  PFG: [
    { invoice_number: "PFG-110455", invoice_date: "2026-02-17", vendor_name: "PFG", total: 890.30, item_count: 8, status: "delivered" },
    { invoice_number: "PFG-110401", invoice_date: "2026-02-10", vendor_name: "PFG", total: 1125.60, item_count: 11, status: "delivered" },
  ],
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: authError } = await supabase.auth.getClaims(token);
    if (authError || !claims?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { vendor_name, integration_id, date_range_days } = await req.json();

    if (!vendor_name) {
      return new Response(JSON.stringify({ error: "vendor_name is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // In production, we'd use the integration_id to fetch real API credentials
    // and call the vendor's API. For now, return mock data.
    const days = date_range_days || 30;
    const cutoff = new Date(Date.now() - days * 86400000);

    const allInvoices = MOCK_INVOICES[vendor_name] || MOCK_INVOICES["Sysco"]!;
    const filtered = allInvoices.filter(inv => new Date(inv.invoice_date) >= cutoff);

    return new Response(JSON.stringify({ invoices: filtered, is_mock: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("vendor-import-invoices error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
