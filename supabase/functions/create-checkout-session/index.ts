import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

// Creates a Stripe Checkout Session for the caller's currently-selected
// restaurant. Required secrets:
//   STRIPE_SECRET_KEY, STRIPE_PRICE_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  console.log("STRIPE_SECRET_KEY exists:", !!Deno.env.get("STRIPE_SECRET_KEY"));
  console.log("STRIPE_PRICE_ID exists:", !!Deno.env.get("STRIPE_PRICE_ID"));

  const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
  const priceId = Deno.env.get("STRIPE_PRICE_ID");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!stripeSecret) {
    console.error("create-checkout-session: STRIPE_SECRET_KEY not set");
    return new Response(JSON.stringify({ error: "Server not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!priceId) {
    console.error("create-checkout-session: STRIPE_PRICE_ID not set");
    return new Response(JSON.stringify({ error: "STRIPE_PRICE_ID not set" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!supabaseUrl || !serviceKey) {
    console.error("create-checkout-session: missing Supabase env vars");
    return new Response(JSON.stringify({ error: "Server not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userClient = createClient(supabaseUrl, serviceKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser(token);
  if (userErr || !userData?.user) {
    console.error("create-checkout-session: auth failed", userErr?.message);
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userId = userData.user.id;
  const userEmail = userData.user.email ?? undefined;

  let restaurantId: string | undefined;
  try {
    const body = (await req.json().catch(() => null)) as
      | { restaurant_id?: string }
      | null;
    if (body?.restaurant_id) restaurantId = body.restaurant_id;
  } catch {
    // body optional
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  if (!restaurantId) {
    const { data: ownerships } = await admin
      .from("restaurant_members")
      .select("restaurant_id")
      .eq("user_id", userId)
      .eq("role", "OWNER")
      .limit(1);
    restaurantId = ownerships?.[0]?.restaurant_id ?? undefined;
  } else {
    const { data: ownership } = await admin
      .from("restaurant_members")
      .select("restaurant_id")
      .eq("user_id", userId)
      .eq("restaurant_id", restaurantId)
      .eq("role", "OWNER")
      .limit(1);
    if (!ownership?.length) {
      return new Response(JSON.stringify({ error: "Only the OWNER can upgrade billing" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  if (!restaurantId) {
    return new Response(JSON.stringify({ error: "No restaurant found for this user" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: restaurant } = await admin
    .from("restaurants")
    .select("id, name, stripe_customer_id")
    .eq("id", restaurantId)
    .maybeSingle();

  if (!restaurant) {
    return new Response(JSON.stringify({ error: "Restaurant not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const stripe = new Stripe(stripeSecret, {
    apiVersion: "2024-04-10",
    httpClient: Stripe.createFetchHttpClient(),
  });

  try {
    const customerId = (restaurant as { stripe_customer_id?: string | null })
      .stripe_customer_id;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: "https://margin6.com/app/billing?success=true",
      cancel_url: "https://margin6.com/app/billing?canceled=true",
      ...(customerId
        ? { customer: customerId }
        : userEmail
          ? { customer_email: userEmail }
          : {}),
      client_reference_id: restaurantId,
      metadata: {
        restaurant_id: restaurantId,
        restaurant_name: restaurant.name ?? "",
        user_id: userId,
      },
      subscription_data: {
        metadata: {
          restaurant_id: restaurantId,
        },
      },
      allow_promotion_codes: true,
    });

    if (!session.url) {
      return new Response(JSON.stringify({ error: "Stripe did not return a checkout URL" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("create-checkout-session error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
