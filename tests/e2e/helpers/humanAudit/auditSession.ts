import type { Page } from "@playwright/test";
import { getSupabaseEnv } from "./auditSupabase";
import { resolveAuditSession, type ResolvedAuditSession } from "./resolveAuditSession";

export type BrowserAuditSession = {
  restaurantId: string | null;
  locationId: string | null;
  userId: string | null;
  accessToken: string | null;
  supabaseUrl: string | null;
};

type BrowserAuthSnapshot = {
  userId: string | null;
  accessToken: string | null;
  localStorageRestaurantId: string | null;
  localStorageLocationId: string | null;
  supabaseUrl: string | null;
};

async function readBrowserAuthSnapshot(
  page: Page,
  supabaseUrlHint?: string | null,
): Promise<BrowserAuthSnapshot> {
  return page.evaluate((supabaseUrl) => {
    const localStorageRestaurantId = localStorage.getItem("currentRestaurantId");
    const localStorageLocationId = localStorage.getItem("currentLocationId");

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
      userId,
      accessToken,
      localStorageRestaurantId,
      localStorageLocationId,
      supabaseUrl: supabaseUrl ?? null,
    };
  }, supabaseUrlHint ?? getSupabaseEnv()?.url ?? null);
}

/** Wait until RestaurantProvider and dashboard KPIs finished loading. */
export async function waitForRestaurantContextSettled(
  page: Page,
  timeout = 30_000,
): Promise<void> {
  await page
    .waitForFunction(
      () => {
        const hasAuth = Object.keys(localStorage).some((key) => {
          if (!key.includes("auth")) return false;
          const raw = localStorage.getItem(key);
          return Boolean(raw && raw.includes("access_token"));
        });
        if (!hasAuth) return false;

        const pulseSkeletons = document.querySelectorAll(".animate-pulse");
        if (pulseSkeletons.length > 0) return false;

        const kpiValue = document.querySelector(
          "div.rounded-lg.border p.font-bold.tabular-nums, div.rounded-lg.border p.text-2xl.font-bold",
        );
        return Boolean(kpiValue && kpiValue.textContent?.trim());
      },
      undefined,
      { timeout },
    )
    .catch(() => undefined);

  await page.waitForTimeout(500);
}

/**
 * Resolve restaurant/location from user_ui_state + restaurant_members (same as RestaurantContext),
 * not from potentially stale localStorage.currentRestaurantId.
 */
export async function buildResolvedAuditSession(page: Page): Promise<ResolvedAuditSession> {
  const auth = await readBrowserAuthSnapshot(page);
  return resolveAuditSession(
    auth.accessToken,
    auth.userId,
    auth.localStorageRestaurantId,
    auth.localStorageLocationId,
    auth.supabaseUrl,
  );
}

/** @deprecated Prefer buildResolvedAuditSession — reads stale localStorage restaurant id. */
export async function readBrowserAuditSession(
  page: Page,
  supabaseUrlHint?: string | null,
): Promise<BrowserAuditSession> {
  const auth = await readBrowserAuthSnapshot(page, supabaseUrlHint);
  return {
    restaurantId: auth.localStorageRestaurantId,
    locationId: auth.localStorageLocationId,
    userId: auth.userId,
    accessToken: auth.accessToken,
    supabaseUrl: auth.supabaseUrl,
  };
}
