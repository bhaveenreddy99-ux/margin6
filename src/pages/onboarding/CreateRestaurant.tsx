import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ChefHat, CheckCircle2, Mail, Copy, Check } from "lucide-react";

const INVOICE_EMAIL_DOMAIN = "invoices.restaurantiq.com";

function slugifyRestaurantNameForInvoice(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 20);
  return slug || "restaurant";
}

function randomInvoiceSuffix(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const arr = new Uint8Array(6);
  crypto.getRandomValues(arr);
  return Array.from(arr, (x) => chars[x % chars.length]).join("");
}

export default function CreateRestaurantPage() {
  const { user } = useAuth();
  const { refetch } = useRestaurant();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [invoiceEmail, setInvoiceEmail] = useState<string | null>(null);
  const [restaurantName, setRestaurantName] = useState<string>("");
  const [copied, setCopied] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setLoading(true);

    try {
      const { data: newRestaurant, error } = await supabase.rpc("create_restaurant_with_owner", {
        p_name: name,
        p_is_demo: false,
      });
      if (error) throw error;
      if (!newRestaurant?.id) throw new Error("Restaurant was not created");

      const slug = slugifyRestaurantNameForInvoice(name);
      let savedInvoiceEmail: string | null = null;
      for (let attempt = 0; attempt < 8; attempt++) {
        const candidate = `${slug}-${randomInvoiceSuffix()}@${INVOICE_EMAIL_DOMAIN}`;
        const { error: settingsError } = await supabase.from("restaurant_settings").upsert(
          {
            restaurant_id: newRestaurant.id,
            invoice_email: candidate,
            currency: "USD",
            timezone: "America/New_York",
            date_format: "MM/DD/YYYY",
          },
          { onConflict: "restaurant_id" },
        );
        if (!settingsError) {
          savedInvoiceEmail = candidate;
          break;
        }
        const code = (settingsError as { code?: string }).code;
        if (code === "23505") continue;
        throw settingsError;
      }
      if (!savedInvoiceEmail) {
        throw new Error("Could not assign a unique invoice email. Please try again.");
      }

      // Auto-create a default location for the new restaurant. Single-location
      // operators (the majority) should never see a "create location" step.
      // Non-blocking: backfill migration catches missed rows on next deploy.
      const { error: locationError } = await supabase.from("locations").insert({
        restaurant_id: newRestaurant.id,
        name,
        is_active: true,
      });
      if (locationError) {
        console.error("Failed to create default location:", locationError);
        toast.error("Default location creation failed. You can add one in Settings.");
      }

      await refetch();

      const { data: settings } = await supabase
        .from("restaurant_settings")
        .select("invoice_email")
        .eq("restaurant_id", newRestaurant.id)
        .single();

      setRestaurantName(name);
      setInvoiceEmail(settings?.invoice_email ?? savedInvoiceEmail);
    } catch (err: any) {
      toast.error(err.message);
    }
    setLoading(false);
  };

  const handleCopy = async () => {
    if (!invoiceEmail) return;
    try {
      await navigator.clipboard.writeText(invoiceEmail);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy to clipboard");
    }
  };

  if (invoiceEmail) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-md space-y-7 animate-fade-in">
          <div className="text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-success mb-3" />
            <h1 className="text-2xl font-bold">Your restaurant is ready!</h1>
            <p className="text-sm text-muted-foreground mt-1">{restaurantName}</p>
          </div>

          <div className="rounded-xl border border-amber-200/70 bg-amber-50/80 p-5 dark:border-amber-800/50 dark:bg-amber-950/30">
            <div className="flex items-center gap-2 text-amber-900 dark:text-amber-100">
              <Mail className="h-4 w-4" />
              <p className="text-xs font-semibold uppercase tracking-wider">
                Forward your invoices to this address
              </p>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <p className="flex-1 break-all rounded-lg bg-white/70 px-3 py-2 font-mono text-base sm:text-lg font-bold text-amber-950 dark:bg-amber-900/40 dark:text-amber-50">
                {invoiceEmail}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCopy}
                className="shrink-0 gap-1.5"
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    Copy
                  </>
                )}
              </Button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Vendors email invoices here → we parse them automatically
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Button
              type="button"
              className="w-full bg-gradient-amber"
              onClick={() => navigate("/app/dashboard")}
            >
              Go to Dashboard
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() =>
                window.open("https://docs.restaurantiq.com", "_blank", "noopener,noreferrer")
              }
            >
              Learn how it works
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-8 animate-fade-in">
        <div className="text-center">
          <ChefHat className="mx-auto h-10 w-10 text-primary mb-3" />
          <h1 className="text-2xl font-bold">Create Your Restaurant</h1>
          <p className="text-sm text-muted-foreground mt-1">Get started with RestaurantIQ</p>
        </div>
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Restaurant Name</Label>
            <Input id="name" value={name} onChange={e => setName(e.target.value)} required placeholder="My Restaurant" />
          </div>
          <Button type="submit" className="w-full bg-gradient-amber" disabled={loading}>
            {loading ? "Creating..." : "Create Restaurant"}
          </Button>
        </form>
      </div>
    </div>
  );
}
