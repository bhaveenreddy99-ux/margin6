import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ error: "RESEND_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub as string;

    const { email, role, restaurant_id, app_url } = await req.json();

    if (!email || !role || !restaurant_id) {
      return new Response(JSON.stringify({ error: "Missing required fields: email, role, restaurant_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify caller is OWNER of the restaurant
    const { data: membership } = await supabase
      .from("restaurant_members")
      .select("role")
      .eq("restaurant_id", restaurant_id)
      .eq("user_id", userId)
      .single();

    if (!membership || membership.role !== "OWNER") {
      return new Response(JSON.stringify({ error: "Only restaurant owners can send invitations" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check for existing pending invitation
    const { data: existingInvite } = await supabase
      .from("invitations")
      .select("id")
      .eq("restaurant_id", restaurant_id)
      .eq("email", email)
      .eq("status", "PENDING");

    if (existingInvite && existingInvite.length > 0) {
      return new Response(JSON.stringify({ error: "An invitation is already pending for this email" }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get restaurant name
    const { data: restaurant } = await supabase
      .from("restaurants")
      .select("name")
      .eq("id", restaurant_id)
      .single();

    const restaurantName = restaurant?.name || "a restaurant";

    // Get inviter name
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", userId)
      .single();

    const inviterName = profile?.full_name || profile?.email || "Someone";

    // Create invitation record
    const { data: invitation, error: invError } = await supabase
      .from("invitations")
      .insert({
        restaurant_id,
        email,
        role,
        invited_by: userId,
      })
      .select()
      .single();

    if (invError) {
      console.error("Invitation insert error:", invError);
      return new Response(JSON.stringify({ error: invError.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build signup URL with invitation token
    const signupUrl = `${app_url || "https://id-preview--becfa30f-14a6-440a-b0ac-ad6fd5044b5b.lovable.app"}/signup?invite=${invitation.token}`;

    // Send email via Resend
    const emailHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #1a1a1a;">You've been invited!</h2>
        <p style="color: #4a4a4a; font-size: 16px; line-height: 1.5;">
          <strong>${inviterName}</strong> has invited you to join <strong>${restaurantName}</strong> on RestaurantIQ as a <strong>${role}</strong>.
        </p>
        <div style="margin: 30px 0;">
          <a href="${signupUrl}" 
             style="background: linear-gradient(135deg, #f59e0b, #d97706); color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; display: inline-block;">
            Accept Invitation
          </a>
        </div>
        <p style="color: #888; font-size: 13px;">
          This invitation expires in 7 days. If you already have an account, you can ignore this email — you'll be added automatically.
        </p>
      </div>
    `;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "RestaurantIQ <onboarding@resend.dev>",
        to: [email],
        subject: `${inviterName} invited you to join ${restaurantName}`,
        html: emailHtml,
      }),
    });

    const emailData = await res.json();

    if (!res.ok) {
      console.error("Resend error:", emailData);
      // Invitation still created, just email failed
      return new Response(JSON.stringify({ 
        success: true, 
        invitation_id: invitation.id,
        email_sent: false,
        email_error: emailData 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ 
      success: true, 
      invitation_id: invitation.id,
      email_sent: true 
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Send invite error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
