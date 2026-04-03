import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Mock line items keyed by invoice_number
const MOCK_DETAILS: Record<string, any> = {
  "SYS-2026-44821": {
    vendor_name: "Sysco",
    invoice_number: "SYS-2026-44821",
    invoice_date: "2026-02-18",
    items: [
      { product_number: "1234567", item_name: "Chicken Breast 10lb", quantity: 5, unit_cost: 42.50, line_total: 212.50, unit: "CS", pack_size: "2/10lb" },
      { product_number: "2345678", item_name: "Ground Beef 80/20", quantity: 4, unit_cost: 55.00, line_total: 220.00, unit: "CS", pack_size: "4/5lb" },
      { product_number: "3456789", item_name: "French Fries Crinkle Cut", quantity: 6, unit_cost: 28.00, line_total: 168.00, unit: "CS", pack_size: "6/5lb" },
      { product_number: "4567890", item_name: "Burger Buns Sesame", quantity: 8, unit_cost: 18.50, line_total: 148.00, unit: "CS", pack_size: "12ct" },
      { product_number: "5678901", item_name: "Iceberg Lettuce", quantity: 3, unit_cost: 24.00, line_total: 72.00, unit: "CS", pack_size: "24ct" },
      { product_number: "6789012", item_name: "Roma Tomatoes", quantity: 4, unit_cost: 32.00, line_total: 128.00, unit: "CS", pack_size: "25lb" },
      { product_number: "7890123", item_name: "Canola Oil", quantity: 2, unit_cost: 38.00, line_total: 76.00, unit: "CS", pack_size: "6/1GAL" },
      { product_number: "8901234", item_name: "Vanilla Ice Cream", quantity: 3, unit_cost: 45.00, line_total: 135.00, unit: "TUB", pack_size: "3GAL" },
      { product_number: "9012345", item_name: "Mozzarella Shredded", quantity: 2, unit_cost: 28.50, line_total: 57.00, unit: "CS", pack_size: "4/5lb" },
      { product_number: "0123456", item_name: "Bacon Sliced", quantity: 1, unit_cost: 42.00, line_total: 42.00, unit: "CS", pack_size: "15lb" },
      { product_number: "1122334", item_name: "Ranch Dressing", quantity: 2, unit_cost: 13.00, line_total: 26.00, unit: "CS", pack_size: "4/1GAL" },
    ],
  },
  "SYS-2026-44790": {
    vendor_name: "Sysco",
    invoice_number: "SYS-2026-44790",
    invoice_date: "2026-02-14",
    items: [
      { product_number: "1234567", item_name: "Chicken Breast 10lb", quantity: 4, unit_cost: 42.50, line_total: 170.00, unit: "CS", pack_size: "2/10lb" },
      { product_number: "3456789", item_name: "French Fries Crinkle Cut", quantity: 8, unit_cost: 28.00, line_total: 224.00, unit: "CS", pack_size: "6/5lb" },
      { product_number: "5678901", item_name: "Iceberg Lettuce", quantity: 5, unit_cost: 24.00, line_total: 120.00, unit: "CS", pack_size: "24ct" },
      { product_number: "7890123", item_name: "Canola Oil", quantity: 3, unit_cost: 38.00, line_total: 114.00, unit: "CS", pack_size: "6/1GAL" },
      { product_number: "8901234", item_name: "Vanilla Ice Cream", quantity: 5, unit_cost: 45.00, line_total: 225.00, unit: "TUB", pack_size: "3GAL" },
    ],
  },
  "SYS-2026-44712": {
    vendor_name: "Sysco",
    invoice_number: "SYS-2026-44712",
    invoice_date: "2026-02-07",
    items: [
      { product_number: "2345678", item_name: "Ground Beef 80/20", quantity: 6, unit_cost: 55.00, line_total: 330.00, unit: "CS", pack_size: "4/5lb" },
      { product_number: "4567890", item_name: "Burger Buns Sesame", quantity: 10, unit_cost: 18.50, line_total: 185.00, unit: "CS", pack_size: "12ct" },
      { product_number: "6789012", item_name: "Roma Tomatoes", quantity: 6, unit_cost: 32.00, line_total: 192.00, unit: "CS", pack_size: "25lb" },
      { product_number: "9012345", item_name: "Mozzarella Shredded", quantity: 4, unit_cost: 28.50, line_total: 114.00, unit: "CS", pack_size: "4/5lb" },
    ],
  },
  "USF-88321": {
    vendor_name: "US Foods",
    invoice_number: "USF-88321",
    invoice_date: "2026-02-19",
    items: [
      { product_number: "USF-001", item_name: "Premium Vodka 1.75L", quantity: 6, unit_cost: 22.00, line_total: 132.00, unit: "BTL", pack_size: "1.75L" },
      { product_number: "USF-002", item_name: "Captain Morgan Rum", quantity: 4, unit_cost: 18.00, line_total: 72.00, unit: "BTL", pack_size: "1.75L" },
      { product_number: "USF-003", item_name: "Orange Juice Premium", quantity: 8, unit_cost: 6.50, line_total: 52.00, unit: "GAL", pack_size: "1GAL" },
      { product_number: "USF-004", item_name: "Fresh Limes", quantity: 5, unit_cost: 18.00, line_total: 90.00, unit: "CS", pack_size: "200ct" },
      { product_number: "USF-005", item_name: "Bagged Ice", quantity: 20, unit_cost: 3.50, line_total: 70.00, unit: "BAG", pack_size: "20lb" },
    ],
  },
  "USF-88290": {
    vendor_name: "US Foods",
    invoice_number: "USF-88290",
    invoice_date: "2026-02-12",
    items: [
      { product_number: "USF-001", item_name: "Premium Vodka 1.75L", quantity: 4, unit_cost: 22.00, line_total: 88.00, unit: "BTL", pack_size: "1.75L" },
      { product_number: "USF-003", item_name: "Orange Juice Premium", quantity: 6, unit_cost: 6.50, line_total: 39.00, unit: "GAL", pack_size: "1GAL" },
      { product_number: "USF-005", item_name: "Bagged Ice", quantity: 15, unit_cost: 3.50, line_total: 52.50, unit: "BAG", pack_size: "20lb" },
    ],
  },
  "PFG-110455": {
    vendor_name: "PFG",
    invoice_number: "PFG-110455",
    invoice_date: "2026-02-17",
    items: [
      { product_number: "PFG-A1", item_name: "Cooking Oil Blend", quantity: 4, unit_cost: 35.00, line_total: 140.00, unit: "CS", pack_size: "6/1GAL" },
      { product_number: "PFG-A2", item_name: "All Purpose Flour", quantity: 3, unit_cost: 22.00, line_total: 66.00, unit: "BAG", pack_size: "50lb" },
      { product_number: "PFG-A3", item_name: "Sugar Granulated", quantity: 2, unit_cost: 28.00, line_total: 56.00, unit: "BAG", pack_size: "50lb" },
    ],
  },
  "PFG-110401": {
    vendor_name: "PFG",
    invoice_number: "PFG-110401",
    invoice_date: "2026-02-10",
    items: [
      { product_number: "PFG-A1", item_name: "Cooking Oil Blend", quantity: 6, unit_cost: 35.00, line_total: 210.00, unit: "CS", pack_size: "6/1GAL" },
      { product_number: "PFG-A4", item_name: "Paper Towels", quantity: 4, unit_cost: 45.00, line_total: 180.00, unit: "CS", pack_size: "12ct" },
      { product_number: "PFG-A5", item_name: "Disposable Gloves L", quantity: 5, unit_cost: 12.00, line_total: 60.00, unit: "BX", pack_size: "100ct" },
    ],
  },
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

    const { invoice_number } = await req.json();

    if (!invoice_number) {
      return new Response(JSON.stringify({ error: "invoice_number is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const details = MOCK_DETAILS[invoice_number];
    if (!details) {
      return new Response(JSON.stringify({ error: "Invoice not found", invoice_number }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ...details, is_mock: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("vendor-import-invoice-details error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
