import type { Page } from "@playwright/test";
import { getSupabaseEnv } from "./auditSupabase";

export type BrowserAuditSession = {
  restaurantId: string | null;
  locationId: string | null;
  userId: string | null;
  accessToken: string | null;
  supabaseUrl: string | null;
};

export async function readBrowserAuditSession(
  page: Page,
  supabaseUrlHint?: string | null,
): Promise<BrowserAuditSession> {
  return page.evaluate((supabaseUrl) => {
    const restaurantId = localStorage.getItem("currentRestaurantId");
    const locationId = localStorage.getItem("currentLocationId");

    let accessToken: string | null = null;
    let userId: string | null = null;

    const storageKeys = [...Object.keys(localStorage), ...Object.keys(sessionStorage)];
    for (const key of storageKeys) {
      if (!key.includes("auth")) continue;
      const raw = localStorage.getItem(key) ?? sessionStorage.getItem(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as {
          access_token?: string;
          user?: { id?: string };
        };
        if (typeof parsed?.access_token === "string") {
          accessToken = parsed.access_token;
          userId = parsed.user?.id ?? userId;
          break;
        }
      } catch {
        // not JSON — skip
      }
    }

    return {
      restaurantId,
      locationId,
      userId,
      accessToken,
      supabaseUrl: supabaseUrl ?? null,
    };
  }, supabaseUrlHint ?? getSupabaseEnv()?.url ?? null);
}
