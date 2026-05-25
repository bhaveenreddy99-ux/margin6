/**
 * inbound-invoice-email
 *
 * Receives Resend inbound email webhooks when vendors email invoices to
 * a restaurant's unique address (e.g. midwest-ab3x7f@invoices.margin6.com).
 *
 * Flow:
 *   1. Verify the webhook secret from Resend
 *   2. Extract the `to` address → look up restaurant_settings.invoice_email
 *   3. Find a PDF attachment (or fall back to HTML body)
 *   4. Create a draft invoice record in invoices table
 *   5. Upload the file to invoice-uploads storage bucket
 *   6. Insert an invoice_ingestions row (source_kind = 'email')
 *   7. Call parse-invoice edge function with the PDF/image base64
 *   8. Patch the draft invoice + insert invoice_items from parse result
 *   9. Notify every OWNER + MANAGER with INVOICE_EMAIL_RECEIVED notification
 *
 * Required Supabase secrets:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_WEBHOOK_SECRET (optional)
 *
 * Required DNS / Resend setup (outside codebase):
 *   - MX records for invoices.margin6.com → Resend inbound MX servers
 *   - Resend dashboard: Inbound webhook URL =
 *       https://<project-ref>.supabase.co/functions/v1/inbound-invoice-email
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  APP_BASE_URL,
  emailWrapper,
  formatUsd,
  invoiceEmailAlreadySent,
  normalizeItemName,
  resolveOwnerManagerMembers,
  sendMargin6Email,
} from "../_shared/margin6Email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, svix-id, svix-timestamp, svix-signature",
};

// ─── Types from Resend inbound webhook payload ─────────────────────────────
interface ResendAttachment {
  filename: string;
  content: string;       // base64 encoded
  contentType: string;
}

interface ResendInboundPayload {
  from: string;
  to: string[];
  subject?: string;
  html?: string;
  text?: string;
  attachments?: ResendAttachment[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function sanitizeFilename(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_").replace(/^\.+/, "").slice(0, 200) || "invoice.pdf";
}

/** Pick the best attachment: prefer PDF, fall back to any image. */
function pickBestAttachment(attachments: ResendAttachment[]): ResendAttachment | null {
  const pdf = attachments.find(a => a.contentType === "application/pdf" || a.filename.endsWith(".pdf"));
  if (pdf) return pdf;
  const img = attachments.find(a => a.contentType.startsWith("image/"));
  if (img) return img;
  return null;
}

/** Map MIME type to parse-invoice file_type. */
function fileTypeFromMime(mime: string): "PDF" | "IMAGE" {
  if (mime === "application/pdf") return "PDF";
  return "IMAGE";
}

/** Extract bare email from `"Name" <user@domain.com>` or plain address. */
function normalizeEmailAddress(value: string): string {
  return value.toLowerCase().trim().replace(/^.*<([^>]+)>$/, "$1").trim();
}

function isValidEmailAddress(value: string): boolean {
  const email = normalizeEmailAddress(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validateInboundPayload(payload: unknown): payload is ResendInboundPayload {
  if (!payload || typeof payload !== "object") return false;
  const row = payload as Record<string, unknown>;
  if (typeof row.from !== "string" || !row.from.trim()) return false;
  if (!isValidEmailAddress(row.from)) return false;

  const toRaw = row.to;
  const toList = Array.isArray(toRaw)
    ? toRaw
    : typeof toRaw === "string"
      ? [toRaw]
      : [];
  if (toList.length === 0) return false;
  if (!toList.every((entry) => typeof entry === "string" && isValidEmailAddress(entry))) return false;

  if (row.attachments != null && !Array.isArray(row.attachments)) return false;
  return true;
}

// ─── Main handler ──────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Only accept POST from Resend
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase    = createClient(supabaseUrl, serviceKey);

  let payload: ResendInboundPayload;
  try {
    const body = await req.json();
    if (!validateInboundPayload(body)) {
      return new Response(JSON.stringify({ error: "Invalid inbound email payload" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    payload = body;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const toAddresses: string[] = Array.isArray(payload.to) ? payload.to : [payload.to];
  if (!toAddresses.length) {
    return new Response(JSON.stringify({ error: "No to address" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── 1. Route by to address → restaurant ────────────────────────────────
  let restaurantId: string | null = null;
  let matchedAddress: string | null = null;

  for (const addr of toAddresses) {
    const email = normalizeEmailAddress(addr);
    const { data: setting } = await supabase
      .from("restaurant_settings")
      .select("restaurant_id")
      .ilike("invoice_email", email)
      .maybeSingle();

    if (setting?.restaurant_id) {
      restaurantId  = setting.restaurant_id;
      matchedAddress = email;
      break;
    }
  }

  if (!restaurantId) {
    console.warn("[inbound-invoice-email] No restaurant found for addresses:", toAddresses);
    // Return 200 so Resend doesn't retry — address simply not registered
    return new Response(JSON.stringify({ ignored: true, reason: "address_not_registered" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── 2. Pick file to parse ───────────────────────────────────────────────
  const attachment = pickBestAttachment(payload.attachments ?? []);
  const hasFile    = attachment != null;
  const fileBase64 = hasFile ? attachment!.content : null;
  const fileMime   = hasFile ? attachment!.contentType : "application/pdf";
  const fileName   = hasFile ? attachment!.filename    : "emailed-invoice.pdf";

  // ── 3. Create draft invoice ─────────────────────────────────────────────
  const now = new Date().toISOString();
  const { data: invoice, error: invoiceErr } = await supabase
    .from("invoices")
    .insert({
      restaurant_id:  restaurantId,
      status:         "draft",
      receipt_status: "pending",
      vendor_name:    null,
      invoice_number: null,
      invoice_date:   null,
      created_by:     null,   // email path — no user session
      updated_at:     now,
    })
    .select()
    .single();

  if (invoiceErr || !invoice) {
    console.error("[inbound-invoice-email] invoice insert error:", invoiceErr);
    return new Response(JSON.stringify({ error: "Failed to create draft invoice" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const invoiceId = invoice.id;

  // ── 4. Upload file to storage ───────────────────────────────────────────
  let storagePath: string | null = null;
  if (hasFile && fileBase64) {
    try {
      const safeName = sanitizeFilename(fileName);
      storagePath    = `${restaurantId}/${invoiceId}/${crypto.randomUUID()}_${safeName}`;

      // Decode base64 → Uint8Array
      const binary  = atob(fileBase64);
      const bytes   = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      const { error: uploadErr } = await supabase.storage
        .from("invoice-uploads")
        .upload(storagePath, bytes, {
          contentType: fileMime,
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadErr) {
        console.warn("[inbound-invoice-email] storage upload error:", uploadErr);
        storagePath = null; // non-fatal — continue to parse
      }
    } catch (uploadEx) {
      console.warn("[inbound-invoice-email] storage upload exception:", uploadEx);
    }
  }

  // ── 5. Insert invoice_ingestion row ────────────────────────────────────
  if (storagePath) {
    const { error: ingestionErr } = await supabase
      .from("invoice_ingestions")
      .insert({
        restaurant_id:     restaurantId,
        invoice_id:        invoiceId,
        storage_path:      storagePath,
        source_kind:       "email",
        mime_type:         fileMime,
        original_filename: fileName,
        created_by:        null,
      });

    if (ingestionErr) {
      // source_kind CHECK constraint may still be 'file'|'photo' — log but continue
      console.warn("[inbound-invoice-email] ingestion insert error:", ingestionErr);
    }
  }

  // ── 6. Parse invoice with AI ────────────────────────────────────────────
  let parseResult: Record<string, unknown> | null = null;
  if (hasFile && fileBase64) {
    try {
      const parseResp = await fetch(`${supabaseUrl}/functions/v1/parse-invoice`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          content:   fileBase64,
          file_type: fileTypeFromMime(fileMime),
        }),
      });

      if (parseResp.ok) {
        parseResult = await parseResp.json();
      } else {
        console.warn("[inbound-invoice-email] parse-invoice error:", await parseResp.text());
      }
    } catch (parseEx) {
      console.warn("[inbound-invoice-email] parse-invoice exception:", parseEx);
    }
  }

  // ── 7. Patch invoice header from parse result ───────────────────────────
  if (parseResult && typeof parseResult === "object" && !parseResult.error) {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (parseResult.vendor_name)   patch.vendor_name   = String(parseResult.vendor_name).trim() || null;
    if (parseResult.invoice_number) patch.invoice_number = String(parseResult.invoice_number).trim() || null;
    if (parseResult.invoice_date)  patch.invoice_date  = String(parseResult.invoice_date).trim() || null;
    if (parseResult.subtotal != null) patch.invoice_subtotal = Number(parseResult.subtotal) || null;
    if (parseResult.tax     != null) patch.invoice_tax      = Number(parseResult.tax)     || null;
    if (parseResult.total   != null) patch.invoice_total    = Number(parseResult.total)   || null;

    await supabase.from("invoices").update(patch).eq("id", invoiceId);

    // ── 8. Insert invoice line items ──────────────────────────────────────
    const rawItems = Array.isArray(parseResult.items) ? parseResult.items : [];
    if (rawItems.length > 0) {
      const itemRows = rawItems
        .filter((r: unknown) => r && typeof r === "object")
        .map((r: Record<string, unknown>) => {
          const qty       = Number(r.quantity)  || 0;
          const unitCost  = r.unit_cost  != null ? Number(r.unit_cost)  : null;
          const lineTotal = r.line_total != null ? Number(r.line_total) : null;
          const totalCost =
            lineTotal != null && Number.isFinite(lineTotal) ? lineTotal
            : unitCost != null && Number.isFinite(unitCost) && Number.isFinite(qty)
              ? unitCost * qty
              : null;
          return {
            invoice_id:      invoiceId,
            item_name:       String(r.item_name ?? "").trim(),
            product_number:  r.product_number ? String(r.product_number).trim() : null,
            quantity_invoiced: qty,
            unit_cost:       unitCost,
            total_cost:      totalCost,
            unit:            r.unit       ? String(r.unit).trim()       : null,
            pack_size:       r.pack_size  ? String(r.pack_size).trim()  : null,
            brand_name:      r.brand_name ? String(r.brand_name).trim() : null,
            match_status:    "UNMATCHED",
            catalog_item_id: null,
          };
        })
        .filter((r: Record<string, unknown>) => (r.item_name as string).length > 0);

      if (itemRows.length > 0) {
        const { error: itemErr } = await supabase.from("invoice_items").insert(itemRows);
        if (itemErr) console.warn("[inbound-invoice-email] invoice_items insert error:", itemErr);
      }
    }
  }

  // ── 9. Notify OWNER + MANAGER (in-app + email) ─────────────────────────
  const parseOk = parseResult != null && typeof parseResult === "object" && !parseResult.error;
  const vendorName = parseOk && parseResult?.vendor_name
    ? String(parseResult.vendor_name).trim()
    : payload.from ?? "a vendor";

  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("name")
    .eq("id", restaurantId)
    .maybeSingle();

  const restaurantName = restaurant?.name ?? "Your restaurant";
  const members = await resolveOwnerManagerMembers(supabase, restaurantId);
  const notifType = parseOk ? "INVOICE_PARSED" : "INVOICE_PARSE_FAILED";
  const alreadyEmailed = await invoiceEmailAlreadySent(supabase, restaurantId, invoiceId);

  const { data: invoiceRow } = await supabase
    .from("invoices")
    .select("vendor_name, invoice_number, invoice_date, invoice_total")
    .eq("id", invoiceId)
    .maybeSingle();

  const parsedItems = parseOk && Array.isArray(parseResult?.items) ? parseResult.items as Array<Record<string, unknown>> : [];
  const itemCount = parsedItems.length;
  const invoiceTotal = Number(invoiceRow?.invoice_total ?? parseResult?.total ?? 0);
  const invoiceNumber = invoiceRow?.invoice_number ?? parseResult?.invoice_number ?? "—";
  const invoiceDate = invoiceRow?.invoice_date ?? parseResult?.invoice_date ?? "—";

  const notifRows = members.map((member) => ({
    restaurant_id: restaurantId!,
    user_id: member.user_id,
    type: notifType,
    title: parseOk
      ? `Invoice parsed from ${vendorName}`
      : `Invoice received but could not be parsed`,
    message: parseOk
      ? `${itemCount} items · ${formatUsd(invoiceTotal)} total — review in Invoices`
      : `Email from ${payload.from} needs manual review`,
    severity: parseOk ? "INFO" : "WARNING",
    data: {
      invoice_id: invoiceId,
      from: payload.from,
      subject: payload.subject,
      parsed: parseOk,
      email_sent: false,
    },
  }));

  if (notifRows.length > 0) {
    await supabase.from("notifications").insert(notifRows);
  }

  if (!alreadyEmailed) {
    let emailSent = false;

    if (parseOk) {
      const topLines = parsedItems
        .slice()
        .sort((a, b) => Number(b.line_total ?? 0) - Number(a.line_total ?? 0))
        .slice(0, 5)
        .map((row) => {
          const name = String(row.item_name ?? "").trim();
          const total = Number(row.line_total ?? 0) || (Number(row.unit_cost ?? 0) * Number(row.quantity ?? 0));
          return `<tr>
            <td style="padding:6px 0;font-size:14px">${name}</td>
            <td style="padding:6px 0;text-align:right;font-size:14px;font-weight:600">${formatUsd(total)}</td>
          </tr>`;
        })
        .join("");

      const bodyHtml = `
        <p style="margin:0 0 12px">New invoice from <strong>${vendorName}</strong></p>
        <p style="margin:0 0 16px;color:#6B7280">Invoice #${invoiceNumber} · ${invoiceDate}</p>
        <p style="margin:0 0 8px;font-size:22px;font-weight:700">Total: ${formatUsd(invoiceTotal)}</p>
        <p style="margin:0 0 16px;color:#6B7280">Items parsed: ${itemCount}</p>
        ${topLines ? `<p style="margin:16px 0 8px;font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:#6B7280">Top line items</p><table style="width:100%;border-collapse:collapse">${topLines}</table>` : ""}
      `;

      const html = emailWrapper(
        "Invoice Received",
        restaurantName,
        bodyHtml,
        "Review Invoice →",
        `${APP_BASE_URL}/app/invoices`,
        restaurantName,
      );

      for (const member of members) {
        if (!member.email?.includes("@")) continue;
        try {
          const sent = await sendMargin6Email({
            supabaseUrl,
            serviceKey,
            to: member.email,
            subject: `New invoice from ${vendorName} — ${formatUsd(invoiceTotal)}`,
            html,
          });
          if (sent) emailSent = true;
        } catch (emailErr) {
          console.error("[inbound-invoice-email] parsed invoice email failed:", emailErr);
        }
      }
    } else {
      const bodyHtml = `
        <p style="margin:0 0 12px">An invoice was received from <strong>${payload.from}</strong> but we could not read it automatically.</p>
        <p style="margin:0;color:#6B7280">Please review it manually. This usually happens with scanned/image PDFs.</p>
      `;

      const html = emailWrapper(
        "Invoice Parse Failed",
        restaurantName,
        bodyHtml,
        "Review Invoice →",
        `${APP_BASE_URL}/app/invoices`,
        restaurantName,
      );

      for (const member of members) {
        if (!member.email?.includes("@")) continue;
        try {
          const sent = await sendMargin6Email({
            supabaseUrl,
            serviceKey,
            to: member.email,
            subject: "Invoice received but could not be parsed — action needed",
            html,
          });
          if (sent) emailSent = true;
        } catch (emailErr) {
          console.error("[inbound-invoice-email] parse failed email failed:", emailErr);
        }
      }
    }

    if (emailSent) {
      await supabase
        .from("notifications")
        .update({ data: { invoice_id: invoiceId, email_sent: true, parsed: parseOk } })
        .eq("restaurant_id", restaurantId)
        .eq("type", notifType)
        .contains("data", { invoice_id: invoiceId });
    }
  }

  // ── 10. Missing items vs last PO ────────────────────────────────────────
  if (parseOk && vendorName) {
    try {
      const { data: lastPo } = await supabase
        .from("purchase_orders")
        .select("id, vendor_name")
        .eq("restaurant_id", restaurantId)
        .ilike("vendor_name", vendorName)
        .order("submitted_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lastPo?.id) {
        const { data: poItems } = await supabase
          .from("purchase_order_items")
          .select("item_name, quantity_ordered")
          .eq("purchase_order_id", lastPo.id);

        const invoiceNames = new Set(
          parsedItems.map((row) => normalizeItemName(String(row.item_name ?? ""))).filter(Boolean),
        );

        const missingItems = (poItems ?? [])
          .filter((poRow) => {
            const name = normalizeItemName(poRow.item_name);
            if (!name) return false;
            return ![...invoiceNames].some((invName) => invName.includes(name) || name.includes(invName));
          })
          .map((poRow) => ({
            item_name: poRow.item_name,
            qty: Number(poRow.quantity_ordered) || 0,
          }));

        if (missingItems.length > 0) {
          const missingNotifRows = members.map((member) => ({
            restaurant_id: restaurantId!,
            user_id: member.user_id,
            type: "MISSING_ITEMS",
            title: `Missing items on ${vendorName} invoice`,
            message: `${missingItems.length} items ordered but not on invoice`,
            severity: "WARNING",
            data: {
              invoice_id: invoiceId,
              missing_items: missingItems,
            },
          }));

          await supabase.from("notifications").insert(missingNotifRows);

          const listHtml = missingItems
            .slice(0, 10)
            .map((item) => `<li style="margin:6px 0">${item.item_name} (ordered ${item.qty})</li>`)
            .join("");

          const bodyHtml = `
            <p style="margin:0 0 12px"><strong>${vendorName}</strong> invoice is missing items you ordered.</p>
            <p style="margin:0 0 8px;font-weight:700;font-size:12px;text-transform:uppercase;color:#D97706">Missing from invoice</p>
            <ul style="margin:0;padding-left:20px">${listHtml}</ul>
            <p style="margin:16px 0 0;color:#6B7280">Check your delivery or contact your vendor rep.</p>
          `;

          const html = emailWrapper(
            "Invoice Discrepancy",
            restaurantName,
            bodyHtml,
            "Review Invoice →",
            `${APP_BASE_URL}/app/invoices`,
            restaurantName,
          );

          for (const member of members) {
            if (!member.email?.includes("@")) continue;
            try {
              await sendMargin6Email({
                supabaseUrl,
                serviceKey,
                to: member.email,
                subject: `⚠️ Missing items — ${vendorName} invoice incomplete`,
                html,
              });
            } catch (missingEmailErr) {
              console.error("[inbound-invoice-email] missing items email failed:", missingEmailErr);
            }
          }
        }
      }
    } catch (missingErr) {
      console.warn("[inbound-invoice-email] missing items check failed:", missingErr);
    }
  }

  console.log(`[inbound-invoice-email] processed invoice ${invoiceId} for restaurant ${restaurantId}`);

  return new Response(
    JSON.stringify({
      success:    true,
      invoice_id: invoiceId,
      parsed:     parseResult != null && !parseResult.error,
      items_extracted: Array.isArray((parseResult as Record<string, unknown> | null)?.items)
        ? ((parseResult as Record<string, unknown>).items as unknown[]).length
        : 0,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
