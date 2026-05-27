import { readFileSync, existsSync } from "node:fs";

const SUPABASE_URL = "https://ogbnctyctoujzdcfphad.supabase.co";
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  "your-service-role-key";

if (SERVICE_ROLE_KEY === "your-service-role-key") {
  console.error(
    "Set SUPABASE_SERVICE_ROLE_KEY (or VITE_SUPABASE_PUBLISHABLE_KEY) before running.",
  );
  process.exit(1);
}

const PDF_PATH = "/Users/bhaveenreddy/Downloads/108666.pdf";

if (!existsSync(PDF_PATH)) {
  console.error("PDF not found:", PDF_PATH);
  process.exit(1);
}

const PDF_BASE64 = readFileSync(PDF_PATH).toString("base64");
console.log("Using PDF:", PDF_PATH, `(${PDF_BASE64.length} base64 chars)`);

const resendPayload = {
  type: "email.received",
  data: {
    from: "bhaveenreddy99@gmail.com",
    to: ["napervilletest1-mbsm5s@narauphaep.resend.app"],
    subject: "PFG Invoice 108666",
    html: "<p>Please find attached invoice</p>",
    text: "Please find attached invoice",
    attachments: [
      {
        filename: "108666.pdf",
        content_type: "application/pdf",
        content: PDF_BASE64,
      },
    ],
  },
};

const response = await fetch(`${SUPABASE_URL}/functions/v1/inbound-invoice-email`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    apikey: SERVICE_ROLE_KEY,
  },
  body: JSON.stringify(resendPayload),
});

const result = await response.json();
console.log("Status:", response.status);
console.log("Result:", JSON.stringify(result, null, 2));

const invoiceId = (result as { invoice_id?: string }).invoice_id;
if (invoiceId) {
  const invoiceResp = await fetch(
    `${SUPABASE_URL}/rest/v1/invoices?id=eq.${invoiceId}&select=vendor_name,invoice_number,invoice_total,status`,
    {
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
    },
  );
  const rows = await invoiceResp.json();
  const invoice = Array.isArray(rows) ? rows[0] : null;
  console.log("Parsed invoice:");
  console.log("  vendor_name:", invoice?.vendor_name ?? "—");
  console.log("  invoice_number:", invoice?.invoice_number ?? "—");
  console.log("  invoice_total:", invoice?.invoice_total ?? "—");
  console.log("  items_extracted:", (result as { items_extracted?: number }).items_extracted ?? 0);
}
