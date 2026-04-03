const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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

    const { content, file_type } = await req.json();

    if (!content) {
      return new Response(JSON.stringify({ error: "No content provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: "AI not configured — add ANTHROPIC_API_KEY to Supabase secrets" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build message content based on file type
    let messageContent: any[];
    if (file_type === "PDF") {
      messageContent = [
        {
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: content,
          },
        },
        {
          type: "text",
          text: "Extract all invoice line items from this invoice PDF. Use the extract_invoice tool. Include every product line item with its SKU/product number, description, brand, quantity shipped (use SHIP qty not ORDER qty), unit price, and line total. For Performance Foodservice invoices: vendor_name='Performance Foodservice', invoice_number is the INVOICE field, invoice_date is the DELV DATE field in YYYY-MM-DD format. Skip rows that are headers, subtotals, tax lines, or freight unless they have a product SKU.",
        },
      ];
    } else {
      messageContent = [
        {
          type: "text",
          text: `Extract all invoice line items from this ${file_type || "invoice"} content. Use the extract_invoice tool.\n\n${content}`,
        },
      ];
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "pdfs-2024-09-25",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        tools: [
          {
            name: "extract_invoice",
            description: "Extract structured invoice data with header info and line items",
            input_schema: {
              type: "object",
              properties: {
                vendor_name: { type: "string", description: "Vendor/supplier name" },
                invoice_number: { type: "string", description: "Invoice number" },
                invoice_date: { type: "string", description: "Invoice date in YYYY-MM-DD format" },
                po_number: { type: "string", description: "Purchase order number referenced on the invoice, if present (e.g. PO-123456)" },
                subtotal: { type: "number", description: "Invoice subtotal before tax (no currency symbols)" },
                tax: { type: "number", description: "Tax amount (no currency symbols)" },
                total: { type: "number", description: "Invoice grand total including tax (no currency symbols)" },
                items: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      product_number: { type: "string", description: "Vendor product/SKU number" },
                      item_name: { type: "string", description: "Item description" },
                      quantity: { type: "number", description: "Quantity shipped" },
                      unit_cost: { type: "number", description: "Unit price (no currency symbols)" },
                      line_total: { type: "number", description: "Line total (no currency symbols)" },
                      unit: { type: "string", description: "Unit of measure e.g. CS, EA, LB" },
                      pack_size: { type: "string", description: "Pack size e.g. 6/10# or 4/1GAL" },
                      brand_name: { type: "string", description: "Brand/manufacturer name e.g. SCHLTZ, FLEISH" },
                    },
                    required: ["item_name", "quantity"],
                  },
                },
              },
              required: ["items"],
            },
          },
        ],
        tool_choice: { type: "tool", name: "extract_invoice" },
        messages: [
          {
            role: "user",
            content: messageContent,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Claude API error:", response.status, errText);
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: `AI parsing failed: ${response.status} ${errText}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiResult = await response.json();
    const toolUse = aiResult.content?.find((c: any) => c.type === "tool_use");

    if (!toolUse?.input) {
      return new Response(JSON.stringify({ error: "AI could not parse invoice" }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(toolUse.input), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Parse invoice error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
