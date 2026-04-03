import { createContext, useContext, useState, useEffect, useRef, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./AuthContext";

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
  isPortfolioMode: boolean;
  locations: Location[];
  currentLocation: Location | null;
  setCurrentLocation: (l: Location | null) => void;
  loading: boolean;
  refetch: () => Promise<void>;
}

const RestaurantContext = createContext<RestaurantContextType>({
  restaurants: [],
  currentRestaurant: null,
  setCurrentRestaurant: () => {},
  isPortfolioMode: false,
  locations: [],
  currentLocation: null,
  setCurrentLocation: () => {},
  loading: true,
  refetch: async () => {},
});

export const useRestaurant = () => useContext(RestaurantContext);

export function RestaurantProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [currentRestaurant, setCurrentRestaurantState] = useState<Restaurant | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [currentLocation, setCurrentLocationState] = useState<Location | null>(null);
  const [loading, setLoading] = useState(true);
  const lastUserId = useRef<string | null>(null);
  const uiStateLoaded = useRef(false);

  const isPortfolioMode = currentRestaurant === null && restaurants.length > 0 && !loading;

  // Synchronously mark loading when user changes
  if (user?.id !== lastUserId.current) {
    lastUserId.current = user?.id ?? null;
    uiStateLoaded.current = false;
    if (user && !loading) {
      setLoading(true);
    }
  }

  const fetchLocations = async (restaurantId?: string) => {
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
    if (data) setLocations(data as Location[]);
  };

  const persistUiState = async (restaurantId: string | null, locationId: string | null) => {
    if (!user) return;
    await supabase.from("user_ui_state").upsert(
      { user_id: user.id, selected_restaurant_id: restaurantId, selected_location_id: locationId, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
  };

  const fetchRestaurants = async () => {
    setLoading(true);
    if (!user) {
      setRestaurants([]);
      setCurrentRestaurantState(null);
      setLocations([]);
      setCurrentLocationState(null);
      setLoading(false);
      return;
    }

    const { data } = await supabase
      .from("restaurant_members")
      .select("restaurant_id, role, restaurants(id, name)")
      .eq("user_id", user.id);

    if (data) {
      const mapped = data.map((m: any) => ({
        id: m.restaurants.id,
        name: m.restaurants.name,
        role: m.role,
      }));
      setRestaurants(mapped);

      // Load persisted UI state
      if (!uiStateLoaded.current) {
        uiStateLoaded.current = true;
        const { data: uiState } = await supabase
          .from("user_ui_state")
          .select("*")
          .eq("user_id", user.id)
          .maybeSingle();

        if (uiState) {
          if (uiState.selected_restaurant_id === null && mapped.length > 1) {
            // Portfolio mode — only valid with multiple restaurants
            setCurrentRestaurantState(null);
          } else {
            const found = mapped.find((r: Restaurant) => r.id === uiState.selected_restaurant_id);
            setCurrentRestaurantState(found || (mapped.length > 0 ? mapped[0] : null));
          }
        } else if (mapped.length > 0) {
          setCurrentRestaurantState(mapped[0]);
        }
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchRestaurants();
  }, [user?.id]);

  // Fetch locations when restaurant changes
  useEffect(() => {
    if (loading) return;
    fetchLocations(currentRestaurant?.id);
  }, [currentRestaurant?.id, loading, restaurants]);

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
        isPortfolioMode,
        locations,
        currentLocation,
        setCurrentLocation: handleSetLocation,
        loading,
        refetch: fetchRestaurants,
      }}
    >
      {children}
    </RestaurantContext.Provider>
  );
}
