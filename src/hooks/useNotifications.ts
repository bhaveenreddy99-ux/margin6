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
  data: any;
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
  const { currentRestaurant } = useRestaurant();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const restaurantId = currentRestaurant?.id ?? null;

  const fetch = useCallback(async () => {
    if (!user) {
      setNotifications([]);
      setUnreadCount(0);
      setLoading(false);
      return;
    }

    // Feed: latest 100 notifications for the user (across restaurants, so the
    // bell still surfaces something during restaurant switches).
    const feedQ = supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100);

    // Unread count: a server-side COUNT scoped to the current restaurant and
    // the last 30 days. This is the bell badge's source of truth — never
    // computed from the feed slice (which could be smaller or stale).
    let unreadQ = supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("read_at", null)
      .gte("created_at", unreadWindowStartIso());
    if (restaurantId) unreadQ = unreadQ.eq("restaurant_id", restaurantId);

    const [feed, unread] = await Promise.all([feedQ, unreadQ]);

    if (feed.data) setNotifications(feed.data as Notification[]);
    setUnreadCount(unread.count ?? 0);
    setLoading(false);
  }, [user, restaurantId]);

  useEffect(() => {
    void fetch();
  }, [fetch]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("notifications-" + user.id)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        () => {
          void fetch();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user, fetch]);

  const markRead = async (id: string) => {
    await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", id)
      .is("read_at", null);
    void fetch();
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
    void fetch();
  };

  return { notifications, unreadCount, loading, markRead, markAllRead, refetch: fetch };
}
