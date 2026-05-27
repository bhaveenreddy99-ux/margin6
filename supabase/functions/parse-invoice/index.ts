const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/** Same instructions for PDF document + invoice photo (vision). */
const EXTRACT_INVOICE_PROMPT = `
Extract all invoice line items from this vendor invoice.
Use the extract_invoice tool.

GENERAL RULES:
- Include EVERY product line item
- Use SHIPPED quantity not ORDERED quantity
- Skip headers, subtotals, tax lines unless they have a product SKU
- For unit_cost: use the per-unit price (not extended price)
- For line_total: use the extended/total price for that line

VENDOR-SPECIFIC RULES:
Performance Foodservice / PFG:
  - vendor_name = "Performance Foodservice"
  - invoice_number = the INVOICE field (e.g. 108666)
  - invoice_date = DELV DATE field in YYYY-MM-DD format
  - quantity = SHIP column (not ORDER column)
  - brand_name = brand code before item description (e.g. SCHLTZ, CAMPBL)
  - product_number = item number (e.g. HT664, AW706)

Sysco:
  - vendor_name = "Sysco"
  - invoice_number = the Invoice Number field
  - invoice_date = Invoice Date in YYYY-MM-DD format
  - quantity = Shipped QTY
  - brand_name = brand name in description

US Foods:
  - vendor_name = "US Foods"
  - invoice_number = Invoice # field
  - quantity = Shipped quantity

Restaurant Depot / Jetro:
  - vendor_name = "Restaurant Depot"
  - Extract all items with quantities and prices

For any other vendor:
  - Extract vendor name from header
  - Extract all line items with best available data
`.trim();

/** Max decoded image size (bytes) — aligns with typical vision API limits. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function decodeBase64ToBytes(b64: string): Uint8Array {
  const normalized = b64.replace(/\s/g, "");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function detectImageMediaType(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return "image/gif";
  }
  return null;
}

function validateExtractedInvoice(input: Record<string, unknown>): Record<string, unknown> {
  if (!input || typeof input !== "object") {
    return { items: [], error: "no_items" };
  }

  let items = Array.isArray(input.items) ? input.items : [];
  if (items.length === 0) {
    return { ...input, items: [], error: input.error ?? "no_items" };
  }

  items = items.filter((item) => {
    if (!item || typeof item !== "object") return false;
    return String((item as Record<string, unknown>).item_name ?? "").trim().length > 0;
  });

  let total = Number(input.total);
  if ((!Number.isFinite(total) || total <= 0) && items.length > 0) {
    const summed = items.reduce((sum, raw) => {
      const row = raw as Record<string, unknown>;
      const lineTotal = Number(row.line_total);
      if (Number.isFinite(lineTotal) && lineTotal > 0) return sum + lineTotal;
      const qty = Number(row.quantity);
      const unitCost = Number(row.unit_cost);
      if (Number.isFinite(qty) && Number.isFinite(unitCost) && qty > 0 && unitCost > 0) {
        return sum + qty * unitCost;
      }
      return sum;
    }, 0);
    if (summed > 0) total = Math.round(summed * 100) / 100;
  }

  return {
    ...input,
    items,
    total: Number.isFinite(total) && total > 0 ? total : input.total,
  };
}

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
    let messageContent: unknown[];
    if (file_type === "PDF") {
      // Multi-page PDFs: Claude document source preserves all pages (not image tiles).
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
          text: EXTRACT_INVOICE_PROMPT,
        },
      ];
    } else if (file_type === "IMAGE") {
      let imageBytes: Uint8Array;
      try {
        imageBytes = decodeBase64ToBytes(String(content));
      } catch {
        return new Response(JSON.stringify({ error: "Invalid image — could not decode base64" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (imageBytes.length === 0) {
        return new Response(JSON.stringify({ error: "Invalid image — empty file" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (imageBytes.length > MAX_IMAGE_BYTES) {
        return new Response(
          JSON.stringify({ error: `Image too large — max ${Math.floor(MAX_IMAGE_BYTES / (1024 * 1024))}MB` }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      const mediaType = detectImageMediaType(imageBytes);
      if (!mediaType) {
        return new Response(
          JSON.stringify({ error: "Invalid image — use JPEG, PNG, WebP, or GIF" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      const normalizedB64 = String(content).replace(/\s/g, "");
      messageContent = [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: mediaType,
            data: normalizedB64,
          },
        },
        {
          type: "text",
          text: EXTRACT_INVOICE_PROMPT,
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

    const validated = validateExtractedInvoice(toolUse.input as Record<string, unknown>);

    return new Response(JSON.stringify(validated), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Parse invoice error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
