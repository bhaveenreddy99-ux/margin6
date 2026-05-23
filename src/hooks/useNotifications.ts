import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRestaurant } from "@/contexts/RestaurantContext";

export interface Notification {
  id: string;
  restaurant_id: string;
  location_id: string | null;
  user_id: string;
  type: string;
  title: string;
  message: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  data: Record<string, unknown> | null;
  created_at: string;
  read_at: string | null;
  emailed_at: string | null;
}

const UNREAD_WINDOW_DAYS = 30;

function unreadWindowStartIso(): string {
  const d = new Date();
  d.setDate(d.getDate() - UNREAD_WINDOW_DAYS);
  return d.toISOString();
}

export function useNotifications() {
  const { user } = useAuth();
  const { currentRestaurant, activeRestaurantIds } = useRestaurant();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [currentRestaurantUnreadCount, setCurrentRestaurantUnreadCount] = useState(0);
  const [totalUnreadLoading, setTotalUnreadLoading] = useState(true);
  const [loading, setLoading] = useState(true);

  const restaurantId = currentRestaurant?.id ?? null;
  const activeIdsKey = activeRestaurantIds.join(",");

  const fetchFeed = useCallback(async () => {
    if (!user) {
      setNotifications([]);
      setLoading(false);
      return;
    }

    const feedQ = supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100);

    const { data } = await feedQ;
    if (data) setNotifications(data as Notification[]);
    setLoading(false);
  }, [user]);

  const fetchUnreadCounts = useCallback(async () => {
    if (!user) {
      setUnreadCount(0);
      setCurrentRestaurantUnreadCount(0);
      setTotalUnreadLoading(false);
      return;
    }

    setTotalUnreadLoading(true);

    let totalUnreadQ = supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("read_at", null)
      .gte("created_at", unreadWindowStartIso());

    if (activeRestaurantIds.length > 0) {
      totalUnreadQ = totalUnreadQ.in("restaurant_id", activeRestaurantIds);
    }

    let currentUnreadQ = supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("read_at", null)
      .gte("created_at", unreadWindowStartIso());
    if (restaurantId) currentUnreadQ = currentUnreadQ.eq("restaurant_id", restaurantId);

    const [totalUnread, currentUnread] = await Promise.all([totalUnreadQ, currentUnreadQ]);

    setUnreadCount(totalUnread.count ?? 0);
    setCurrentRestaurantUnreadCount(currentUnread.count ?? 0);
    setTotalUnreadLoading(false);
  }, [user, restaurantId, activeIdsKey, activeRestaurantIds]);

  const refetch = useCallback(async () => {
    await Promise.all([fetchFeed(), fetchUnreadCounts()]);
  }, [fetchFeed, fetchUnreadCounts]);

  useEffect(() => {
    void fetchFeed();
  }, [fetchFeed]);

  useEffect(() => {
    void fetchUnreadCounts();
  }, [fetchUnreadCounts]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("notifications-" + user.id)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        () => {
          void refetch();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user, refetch]);

  const markRead = async (id: string) => {
    await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", id)
      .is("read_at", null);
    void refetch();
  };

  const markAllRead = async () => {
    if (!user) return;
    let q = supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .is("read_at", null);
    if (restaurantId) q = q.eq("restaurant_id", restaurantId);
    await q;
    void refetch();
  };

  return {
    notifications,
    unreadCount,
    currentRestaurantUnreadCount,
    totalUnreadLoading,
    loading,
    markRead,
    markAllRead,
    refetch,
  };
}
