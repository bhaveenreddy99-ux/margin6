import { createContext, useContext, useState, useEffect, useRef, useMemo, useCallback, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./AuthContext";

export interface LocationPermissions {
  can_approve_orders: boolean;
  can_see_costs: boolean;
  can_see_food_cost_pct: boolean;
  can_see_inventory_value: boolean;
  can_edit_par: boolean;
  order_approval_threshold: number | null;
}

export interface LocationAssignment {
  location_id: string;
  role: "OWNER" | "MANAGER" | "STAFF";
  is_primary: boolean;
  permissions: LocationPermissions;
}

interface Restaurant {
  id: string;
  name: string;
  role: string;
}

interface Location {
  id: string;
  name: string;
  restaurant_id: string;
  is_default: boolean;
  is_active: boolean;
}

interface RestaurantContextType {
  restaurants: Restaurant[];
  currentRestaurant: Restaurant | null;
  setCurrentRestaurant: (r: Restaurant | null) => void;
  locations: Location[];
  currentLocation: Location | null;
  setCurrentLocation: (l: Location | null) => void;
  locationAssignments: LocationAssignment[];
  activeRestaurantIds: string[];
  loading: boolean;
  refetch: () => Promise<void>;
  refetchLocations: () => Promise<void>;
}

const RestaurantContext = createContext<RestaurantContextType>({
  restaurants: [],
  currentRestaurant: null,
  setCurrentRestaurant: () => {},
  locations: [],
  currentLocation: null,
  setCurrentLocation: () => {},
  locationAssignments: [],
  activeRestaurantIds: [],
  loading: true,
  refetch: async () => {},
  refetchLocations: async () => {},
});

export const useRestaurant = () => useContext(RestaurantContext);

export function RestaurantProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [currentRestaurant, setCurrentRestaurantState] = useState<Restaurant | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [currentLocation, setCurrentLocationState] = useState<Location | null>(null);
  const [locationAssignments, setLocationAssignments] = useState<LocationAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const lastUserId = useRef<string | null>(null);
  const uiStateLoaded = useRef(false);
  // Holds the location ID to restore after fetchLocations completes.
  // undefined = no pending restore; null = uiState loaded but no location selected; string = restore this id.
  const pendingRestoreLocationIdRef = useRef<string | null | undefined>(undefined);

  const activeRestaurantIds = useMemo(
    () =>
      restaurants
        .filter((r) => r.role === "OWNER" || r.role === "MANAGER")
        .map((r) => r.id),
    [restaurants],
  );

  // Synchronously mark loading when user changes
  if (user?.id !== lastUserId.current) {
    lastUserId.current = user?.id ?? null;
    uiStateLoaded.current = false;
    if (user && !loading) {
      setLoading(true);
    }
  }

  const fetchLocations = useCallback(async (restaurantId?: string) => {
    if (!user) { setLocations([]); return; }
    let query = supabase.from("locations").select("*").eq("is_active", true);
    if (restaurantId) {
      query = query.eq("restaurant_id", restaurantId);
    } else {
      // Portfolio mode: get all locations for all user restaurants
      const rids = restaurants.map(r => r.id);
      if (rids.length > 0) query = query.in("restaurant_id", rids);
      else { setLocations([]); return; }
    }
    const { data } = await query.order("name");
    if (data) {
      setLocations(data as Location[]);
      // Restore persisted location selection after first load
      const pending = pendingRestoreLocationIdRef.current;
      if (pending !== undefined) {
        pendingRestoreLocationIdRef.current = undefined;
        if (pending) {
          const found = (data as Location[]).find(l => l.id === pending);
          if (found) setCurrentLocationState(found);
        }
      }
    }
  }, [user, restaurants]);

  const refetchLocations = useCallback(async () => {
    await fetchLocations(currentRestaurant?.id);
  }, [fetchLocations, currentRestaurant?.id]);

  const persistUiState = async (restaurantId: string | null, locationId: string | null) => {
    if (!user) return;
    await supabase.from("user_ui_state").upsert(
      { user_id: user.id, selected_restaurant_id: restaurantId, selected_location_id: locationId, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
  };

  const fetchRestaurants = useCallback(async () => {
    setLoading(true);
    if (!user) {
      setRestaurants([]);
      setCurrentRestaurantState(null);
      setLocations([]);
      setCurrentLocationState(null);
      setLocationAssignments([]);
      setLoading(false);
      return;
    }

    const { data } = await supabase
      .from("restaurant_members")
      .select("restaurant_id, role, restaurants(id, name)")
      .eq("user_id", user.id);

    if (!data) {
      setRestaurants([]);
      setLocationAssignments([]);
      setLoading(false);
      return;
    }

    const mapped = data.map((m: any) => ({
      id: m.restaurants.id,
      name: m.restaurants.name,
      role: m.role,
    }));
    setRestaurants(mapped);

    const needsAssignments = mapped.some(
      (m: Restaurant) => m.role === "MANAGER" || m.role === "STAFF",
    );
    let nextAssignments: LocationAssignment[] = [];
    if (needsAssignments) {
      const { data: ulaRows } = await supabase
        .from("user_location_assignments")
        .select(
          "location_id, role, is_primary, can_approve_orders, can_see_costs, can_see_food_cost_pct, can_see_inventory_value, can_edit_par, order_approval_threshold",
        )
        .eq("user_id", user.id);
      nextAssignments = (ulaRows ?? []).map((row) => ({
        location_id: row.location_id,
        role: row.role as LocationAssignment["role"],
        is_primary: row.is_primary,
        permissions: {
          can_approve_orders: row.can_approve_orders,
          can_see_costs: row.can_see_costs,
          can_see_food_cost_pct: row.can_see_food_cost_pct,
          can_see_inventory_value: row.can_see_inventory_value,
          can_edit_par: row.can_edit_par,
          order_approval_threshold: row.order_approval_threshold,
        },
      }));
    }
    setLocationAssignments(nextAssignments);

    // Load persisted UI state
    if (!uiStateLoaded.current) {
      uiStateLoaded.current = true;
      const { data: uiState } = await supabase
        .from("user_ui_state")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      if (uiState) {
        pendingRestoreLocationIdRef.current = uiState.selected_location_id ?? null;
        const found = mapped.find((r: Restaurant) => r.id === uiState.selected_restaurant_id);
        setCurrentRestaurantState(found || (mapped.length > 0 ? mapped[0] : null));
      } else if (mapped.length > 0) {
        setCurrentRestaurantState(mapped[0]);
      }
    }
    setLoading(false);
  }, [user]);

  // Apply pending user_invites before loading memberships so the new restaurant appears without reload.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (user?.id) {
        const { error } = await supabase.rpc("accept_user_invites");
        if (error) console.error("accept_user_invites", error);
        if (cancelled) return;
      }
      await fetchRestaurants();
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [user?.id, fetchRestaurants]);

  // Fetch locations when restaurant changes
  useEffect(() => {
    if (loading) return;
    void fetchLocations(currentRestaurant?.id);
  }, [currentRestaurant?.id, loading, restaurants, fetchLocations]);

  useEffect(() => {
    if (loading || !user) return;
    if (
      !currentRestaurant ||
      (currentRestaurant.role !== "MANAGER" && currentRestaurant.role !== "STAFF")
    ) {
      return;
    }
    if (locations.length === 0 || locationAssignments.length === 0) return;

    const allowed = locationAssignments.filter((a) =>
      locations.some((l) => l.id === a.location_id && l.restaurant_id === currentRestaurant.id),
    );
    if (allowed.length === 0) return;

    const allowedIds = new Set(allowed.map((a) => a.location_id));
    const ok = currentLocation != null && allowedIds.has(currentLocation.id);
    if (ok) return;

    const pick = allowed.find((a) => a.is_primary) ?? allowed[0];
    const loc = locations.find((l) => l.id === pick.location_id);
    if (loc) {
      setCurrentLocationState(loc);
      void persistUiState(currentRestaurant.id, loc.id);
    }
  }, [
    loading,
    user,
    currentRestaurant?.id,
    currentRestaurant?.role,
    locations,
    locationAssignments,
    currentLocation?.id,
  ]);

  // Auto-select the first active location whenever a restaurant is current but
  // no location is selected. Location is an internal concept — the user never
  // sees a location picker. The MANAGER/STAFF assignment-based effect above
  // runs first and scopes the pick to permitted locations; this is the
  // fallback for OWNERs (and any case where assignments did not yield a pick).
  useEffect(() => {
    if (loading || !user || !currentRestaurant) return;
    if (currentLocation !== null) return;
    if (locations.length === 0) return;
    const scoped = locations.filter((l) => l.restaurant_id === currentRestaurant.id);
    const pool = scoped.length > 0 ? scoped : locations;
    const pick = pool.find((l) => l.is_active) ?? pool[0];
    if (!pick) return;
    setCurrentLocationState(pick);
    void persistUiState(currentRestaurant.id, pick.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user, currentRestaurant?.id, locations.length, currentLocation?.id]);

  const handleSetCurrent = (r: Restaurant | null) => {
    setCurrentRestaurantState(r);
    setCurrentLocationState(null);
    persistUiState(r?.id || null, null);
    // Also update localStorage for backward compat
    if (r) localStorage.setItem("currentRestaurantId", r.id);
    else localStorage.removeItem("currentRestaurantId");
  };

  const handleSetLocation = (l: Location | null) => {
    setCurrentLocationState(l);
    persistUiState(currentRestaurant?.id || null, l?.id || null);
  };

  return (
    <RestaurantContext.Provider
      value={{
        restaurants,
        currentRestaurant,
        setCurrentRestaurant: handleSetCurrent,
        locations,
        currentLocation,
        setCurrentLocation: handleSetLocation,
        locationAssignments,
        activeRestaurantIds,
        loading,
        refetch: fetchRestaurants,
        refetchLocations,
      }}
    >
      {children}
    </RestaurantContext.Provider>
  );
}
