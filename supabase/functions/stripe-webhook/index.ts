import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@17.7.0?target=denonext";

// Stripe webhooks must be reachable without Supabase JWT. Deploy with
//   supabase functions deploy stripe-webhook --no-verify-jwt
// Required secrets:
//   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, stripe-signature",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!stripeSecret || !webhookSecret || !supabaseUrl || !serviceKey) {
    console.error("stripe-webhook: missing required env vars");
    return new Response(JSON.stringify({ error: "Server not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const stripe = new Stripe(stripeSecret, { apiVersion: "2024-12-18.acacia" });
  const supabase = createClient(supabaseUrl, serviceKey);

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response(JSON.stringify({ error: "Missing stripe-signature" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const rawBody = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      webhookSecret,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Webhook signature verification failed:", msg);
    return new Response(JSON.stringify({ error: `Invalid signature: ${msg}` }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const restaurantId = session.metadata?.restaurant_id;
        if (!restaurantId) {
          console.error("checkout.session.completed missing restaurant_id metadata");
          break;
        }
        const customerId =
          typeof session.customer === "string"
            ? session.customer
            : session.customer?.id ?? null;
        const subscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id ?? null;

        const { error } = await supabase
          .from("restaurants")
          .update({
            subscription_status: "active",
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
          })
          .eq("id", restaurantId);
        if (error) throw error;
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const { error } = await supabase
          .from("restaurants")
          .update({ subscription_status: "canceled" })
          .eq("stripe_subscription_id", sub.id);
        if (error) throw error;
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId =
          typeof invoice.customer === "string"
            ? invoice.customer
            : invoice.customer?.id ?? null;
        if (!customerId) break;
        const { error } = await supabase
          .from("restaurants")
          .update({ subscription_status: "past_due" })
          .eq("stripe_customer_id", customerId);
        if (error) throw error;
        break;
      }

      default:
        // ignore unhandled events
        break;
    }

    return new Response(JSON.stringify({ received: true, type: event.type }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Webhook handler error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
