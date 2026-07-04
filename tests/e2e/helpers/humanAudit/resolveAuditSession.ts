import type { SupabaseClient } from "@supabase/supabase-js";
import { createAuditSupabaseClient } from "./auditSupabase";
import type { BrowserAuditSession } from "./auditSession";
import {
  pickAuditLocationId,
  pickAuditRestaurantId,
  type AuditLocation,
  type AuditLocationAssignment,
  type AuditMembership,
  type AuditUiState,
} from "./resolveAuditSessionCore";

export type ResolvedAuditSession = BrowserAuditSession & {
  localStorageRestaurantId: string | null;
  localStorageLocationId: string | null;
};

async function loadMemberships(
  supabase: SupabaseClient,
  userId: string,
): Promise<AuditMembership[]> {
  const { data } = await supabase
    .from("restaurant_members")
    .select("restaurant_id, role")
    .eq("user_id", userId);

  return (data ?? []).map((row) => ({
    restaurantId: row.restaurant_id,
    role: row.role,
  }));
}

async function loadUiState(
  supabase: SupabaseClient,
  userId: string,
): Promise<AuditUiState | null> {
  const { data } = await supabase
    .from("user_ui_state")
    .select("selected_restaurant_id, selected_location_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (!data) return null;
  return {
    selectedRestaurantId: data.selected_restaurant_id,
    selectedLocationId: data.selected_location_id,
  };
}

async function loadLocationsForRestaurant(
  supabase: SupabaseClient,
  restaurantId: string,
): Promise<AuditLocation[]> {
  const { data } = await supabase
    .from("locations")
    .select("id, restaurant_id, is_default, is_active")
    .eq("restaurant_id", restaurantId)
    .eq("is_active", true);

  return (data ?? []).map((row) => ({
    id: row.id,
    restaurantId: row.restaurant_id,
    isActive: row.is_active,
    isDefault: row.is_default,
  }));
}

async function loadLocationAssignments(
  supabase: SupabaseClient,
  userId: string,
): Promise<AuditLocationAssignment[]> {
  const { data } = await supabase
    .from("user_location_assignments")
    .select("location_id, is_primary")
    .eq("user_id", userId);

  return (data ?? []).map((row) => ({
    locationId: row.location_id,
    isPrimary: row.is_primary,
  }));
}

export async function resolveAuditRestaurantAndLocation(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ restaurantId: string | null; locationId: string | null }> {
  const [memberships, uiState] = await Promise.all([
    loadMemberships(supabase, userId),
    loadUiState(supabase, userId),
  ]);

  const restaurantId = pickAuditRestaurantId(memberships, uiState);
  if (!restaurantId) {
    return { restaurantId: null, locationId: null };
  }

  const role = memberships.find((m) => m.restaurantId === restaurantId)?.role ?? "OWNER";
  const needsAssignments = role === "MANAGER" || role === "STAFF";

  const [locations, assignments] = await Promise.all([
    loadLocationsForRestaurant(supabase, restaurantId),
    needsAssignments ? loadLocationAssignments(supabase, userId) : Promise.resolve([]),
  ]);

  const locationId = pickAuditLocationId(
    restaurantId,
    locations,
    uiState,
    assignments,
    role,
  );

  return { restaurantId, locationId };
}

export async function resolveAuditSession(
  accessToken: string | null,
  userId: string | null,
  localStorageRestaurantId: string | null,
  localStorageLocationId: string | null,
  supabaseUrl: string | null,
): Promise<ResolvedAuditSession> {
  const base: ResolvedAuditSession = {
    restaurantId: null,
    locationId: null,
    userId,
    accessToken,
    supabaseUrl,
    localStorageRestaurantId,
    localStorageLocationId,
  };

  if (!accessToken || !userId) return base;

  const supabase = createAuditSupabaseClient(accessToken);
  if (!supabase) return base;

  const resolved = await resolveAuditRestaurantAndLocation(supabase, userId);
  return {
    ...base,
    restaurantId: resolved.restaurantId,
    locationId: resolved.locationId,
  };
}
