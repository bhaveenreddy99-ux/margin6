import fs from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function loadDotEnv(): void {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadDotEnv();

export function getSupabaseEnv(): { url: string; anonKey: string } | null {
  const url =
    process.env.E2E_SUPABASE_URL?.trim() ||
    process.env.VITE_SUPABASE_URL?.trim() ||
    "";
  const anonKey =
    process.env.E2E_SUPABASE_ANON_KEY?.trim() ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    "";
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export function createAuditSupabaseClient(accessToken?: string | null): SupabaseClient | null {
  const env = getSupabaseEnv();
  if (!env) return null;

  const serviceRole = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (serviceRole) {
    return createClient(env.url, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  if (!accessToken) return null;

  return createClient(env.url, env.anonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function resolvePrimaryLocationId(
  supabase: SupabaseClient,
  restaurantId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("locations")
    .select("id, is_default")
    .eq("restaurant_id", restaurantId)
    .eq("is_active", true)
    .order("is_default", { ascending: false });

  if (!data?.length) return null;
  const preferred = data.find((row) => row.is_default) ?? data[0];
  return preferred?.id ?? null;
}
