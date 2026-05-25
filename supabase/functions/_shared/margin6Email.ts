export const APP_BASE_URL = "https://margin6.com";

export function formatUsd(n: number, decimals = 0): string {
  const value = Number.isFinite(n) ? n : 0;
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  })}`;
}

export function emailWrapper(
  title: string,
  subtitle: string,
  bodyHtml: string,
  ctaText: string,
  ctaUrl: string,
  restaurantName: string,
): string {
  return `
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#FAFAFA">
      <div style="background:#0F172A;padding:22px 24px;border-radius:12px 12px 0 0">
        <h1 style="color:#FFFFFF;margin:0;font-size:18px;font-weight:700;letter-spacing:-0.01em">
          Margin6 <span style="color:#F97316">·</span> ${title}
        </h1>
        ${subtitle ? `<p style="color:#94A3B8;margin:6px 0 0;font-size:13px">${subtitle}</p>` : ""}
      </div>
      <div style="background:#FFFFFF;border:1px solid #E5E7EB;border-top:none;padding:28px;border-radius:0 0 12px 12px;color:#374151;font-size:14px;line-height:1.6">
        ${bodyHtml}
        <div style="margin-top:28px">
          <a href="${ctaUrl}" style="display:inline-block;background:#F97316;color:#FFFFFF;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">${ctaText}</a>
        </div>
      </div>
      <p style="text-align:center;color:#6B7280;font-size:11px;margin-top:18px;line-height:1.6">
        You're receiving this because you're an owner/manager at ${restaurantName}.<br/>
        Unsubscribe in Settings.
      </p>
    </div>
  `;
}

export async function sendMargin6Email(args: {
  supabaseUrl: string;
  serviceKey: string;
  to: string;
  subject: string;
  html: string;
}): Promise<boolean> {
  try {
    const response = await fetch(`${args.supabaseUrl}/functions/v1/send-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${args.serviceKey}`,
      },
      body: JSON.stringify({
        to: args.to,
        subject: args.subject,
        html: args.html,
      }),
    });
    return response.ok;
  } catch (error) {
    console.error("[margin6Email] send failed:", error);
    return false;
  }
}

export async function resolveOwnerManagerMembers(
  supabase: any,
  restaurantId: string,
): Promise<Array<{ user_id: string; email: string | null; full_name: string | null }>> {
  const { data: members } = await supabase
    .from("restaurant_members")
    .select("user_id")
    .eq("restaurant_id", restaurantId)
    .in("role", ["OWNER", "MANAGER"]);

  const userIds = (members ?? []).map((m: { user_id: string }) => m.user_id);
  if (userIds.length === 0) return [];

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, email, full_name")
    .in("id", userIds);

  return (profiles ?? []).map((p: { id: string; email: string; full_name: string | null }) => ({
    user_id: p.id,
    email: p.email,
    full_name: p.full_name,
  }));
}

export async function userWantsEmail(
  supabase: any,
  restaurantId: string,
  userId: string,
): Promise<boolean> {
  const { data: pref } = await supabase
    .from("notification_preferences")
    .select("channel_email")
    .eq("restaurant_id", restaurantId)
    .eq("user_id", userId)
    .maybeSingle();

  return pref?.channel_email ?? true;
}

export async function invoiceEmailAlreadySent(
  supabase: any,
  restaurantId: string,
  invoiceId: string,
): Promise<boolean> {
  const { data: existing } = await supabase
    .from("notifications")
    .select("id, data")
    .eq("restaurant_id", restaurantId)
    .in("type", ["INVOICE_PARSED", "INVOICE_PARSE_FAILED"])
    .limit(50);

  return (existing ?? []).some((row: { data: { invoice_id?: string; email_sent?: boolean } | null }) =>
    row.data?.invoice_id === invoiceId && row.data?.email_sent === true
  );
}

export function normalizeItemName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
