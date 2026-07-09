import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { LocationPermissions } from "@/contexts/RestaurantContext";
import type { Tables } from "@/integrations/supabase/types";
import { resendTeamInviteEmail, sendTeamInviteEmail } from "@/domain/invites/sendTeamInvite";

export interface LocationWithSettings {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  is_active: boolean;
  is_default: boolean;
  brand: string | null;
  food_cost_target_pct: number;
  count_frequency_days: number;
  count_overdue_alert_hrs: number;
}

export interface TeamMemberAssignment {
  assignment_id: string;
  location_id: string;
  location_name: string;
  role: "MANAGER" | "STAFF" | "OWNER";
  is_primary: boolean;
  permissions: LocationPermissions;
}

export interface TeamMember {
  member_id: string;
  user_id: string;
  full_name: string | null;
  email: string;
  role: "OWNER" | "MANAGER" | "STAFF";
  assignments: TeamMemberAssignment[];
}

export interface Invitation {
  id: string;
  email: string;
  role: string;
  status: string;
  created_at: string;
  location_id?: string;
  location_name?: string;
  /** Which backend this row came from (revoke/resend use the matching API). */
  source: "invitation" | "restaurant_invite";
}

export interface NewLocationData {
  name: string;
  address: string;
  city: string;
  state: string;
  brand: string | null;
  food_cost_target_pct: number;
  count_frequency_days: number;
  count_overdue_alert_hrs: number;
}

export interface InviteData {
  email: string;
  role: "MANAGER" | "STAFF";
  location_id: string;
}

const DEFAULT_STORAGE_TYPES = ["Cooler", "Freezer", "Dry Storage", "Bar"];

export const DEFAULT_ASSIGNMENT_PERMISSIONS: LocationPermissions = {
  can_approve_orders: true,
  can_see_costs: false,
  can_see_food_cost_pct: true,
  can_see_inventory_value: false,
  can_edit_par: true,
  order_approval_threshold: null,
};

function logSupabaseError(context: string, error: unknown) {
  console.error(`[useLocationSettings] ${context}`, error);
}

function formatPostgrestError(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    const o = e as { message: string; code?: string; details?: string; hint?: string };
    return [o.message, o.code ? `code=${o.code}` : null, o.details, o.hint].filter(Boolean).join(" · ");
  }
  return e instanceof Error ? e.message : String(e);
}

const isDev = import.meta.env.DEV;

export function useLocationSettings(restaurantId: string | undefined) {
  const { user } = useAuth();
  const [locations, setLocations] = useState<LocationWithSettings[]>([]);
  const [inactiveLocations, setInactiveLocations] = useState<LocationWithSettings[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [pendingInvitations, setPendingInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!restaurantId || !user) {
      setLocations([]);
      setInactiveLocations([]);
      setTeamMembers([]);
      setPendingInvitations([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        // Fetch locations
        const [{ data: locActive, error: e1 }, { data: locInactive, error: e2 }] = await Promise.all([
          supabase
            .from("locations")
            .select("id, name, address, city, state, is_active, is_default, restaurant_id")
            .eq("restaurant_id", restaurantId)
            .eq("is_active", true)
            .order("name"),
          supabase
            .from("locations")
            .select("id, name, address, city, state, is_active, is_default, restaurant_id")
            .eq("restaurant_id", restaurantId)
            .eq("is_active", false)
            .order("name"),
        ]);

        if (e1) throw e1;
        if (e2) throw e2;

        // Fetch members with profiles separately to avoid FK issues
        const { data: membersRows, error: e3 } = await supabase
          .from("restaurant_members")
          .select("id, user_id, role")
          .eq("restaurant_id", restaurantId);

        if (e3) throw e3;

        // Fetch profiles separately
        const memberUserIds = (membersRows ?? []).map((m) => m.user_id);
        let profilesMap = new Map<string, { email: string; full_name: string | null }>();
        if (memberUserIds.length > 0) {
          const { data: profilesData } = await supabase
            .from("profiles")
            .select("id, email, full_name")
            .in("id", memberUserIds);
          
          for (const p of profilesData ?? []) {
            profilesMap.set(p.id, { email: p.email ?? "", full_name: p.full_name });
          }
        }

        const activeRaw = (locActive ?? []) as Record<string, unknown>[];
        const inactiveRaw = (locInactive ?? []) as Record<string, unknown>[];
        const allLocIds = [...activeRaw, ...inactiveRaw].map((r) => r.id as string);

        const settingsByLocationId = new Map<
          string,
          {
            brand: string | null;
            food_cost_target_pct: number;
            count_frequency_days: number;
            count_overdue_alert_hrs: number;
          }
        >();
        if (allLocIds.length > 0) {
          const { data: settingsRows, error: sErr } = await supabase
            .from("location_settings")
            .select("location_id, brand, food_cost_target_pct, count_frequency_days, count_overdue_alert_hrs")
            .in("location_id", allLocIds);
          if (sErr) throw sErr;
          for (const s of settingsRows ?? []) {
            settingsByLocationId.set(s.location_id, {
              brand: s.brand,
              food_cost_target_pct: Number(s.food_cost_target_pct ?? 30),
              count_frequency_days: Math.max(1, Number(s.count_frequency_days ?? 3)),
              count_overdue_alert_hrs: Number(s.count_overdue_alert_hrs ?? 72),
            });
          }
        }

        const mapLoc = (row: Record<string, unknown>): LocationWithSettings => {
          const st = settingsByLocationId.get(row.id as string);
          return {
            id: row.id as string,
            name: row.name as string,
            address: (row.address as string | null) ?? null,
            city: (row.city as string | null) ?? null,
            state: (row.state as string | null) ?? null,
            is_active: row.is_active as boolean,
            is_default: row.is_default as boolean,
            brand: st?.brand ?? null,
            food_cost_target_pct: Number(st?.food_cost_target_pct ?? 30),
            count_frequency_days: Math.max(1, Number(st?.count_frequency_days ?? 3)),
            count_overdue_alert_hrs: Number(st?.count_overdue_alert_hrs ?? 72),
          };
        };

        const activeList = activeRaw.map(mapLoc);
        const inactiveList = inactiveRaw.map(mapLoc);
        const restaurantLocationIds = [...activeList, ...inactiveList].map((l) => l.id);

        let ulaRows: Tables<"user_location_assignments">[] = [];
        if (memberUserIds.length > 0 && restaurantLocationIds.length > 0) {
          const { data: ula, error: ulaErr } = await supabase
            .from("user_location_assignments")
            .select("*")
            .in("user_id", memberUserIds)
            .in("location_id", restaurantLocationIds);
          if (ulaErr) throw ulaErr;
          ulaRows = ula ?? [];
        }

        const locNameById = new Map<string, string>();
        for (const l of [...activeList, ...inactiveList]) {
          locNameById.set(l.id, l.name);
        }

        const team: TeamMember[] = (membersRows ?? []).map((m) => {
          const uid = m.user_id as string;
          const prof = profilesMap.get(uid);
          const mids = ulaRows.filter((u) => u.user_id === uid);
          const assignments: TeamMemberAssignment[] = mids.map((row) => ({
            assignment_id: row.id,
            location_id: row.location_id,
            location_name: locNameById.get(row.location_id) ?? "Location",
            role: row.role as TeamMemberAssignment["role"],
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

          return {
            member_id: m.id as string,
            user_id: uid,
            full_name: prof?.full_name ?? null,
            email: prof?.email ?? "",
            role: m.role as TeamMember["role"],
            assignments,
          };
        });

        const [{ data: secureRows, error: eSecure }, { data: invRows, error: e4 }] = await Promise.all([
          supabase.rpc("list_invites", { p_restaurant_id: restaurantId }),
          supabase
            .from("invitations")
            .select("id, email, role, status, created_at")
            .eq("restaurant_id", restaurantId)
            .eq("status", "PENDING")
            .order("created_at", { ascending: false }),
        ]);

        if (eSecure) {
          logSupabaseError("list_invites", eSecure);
          if (isDev) toast.error(`Locations load: invites · ${formatPostgrestError(eSecure)}`);
        }
        if (e4) {
          logSupabaseError("invitations", e4);
          if (isDev) toast.error(`Locations load: invitations · ${formatPostgrestError(e4)}`);
        }

        const secureInvites: Invitation[] = (secureRows ?? []).map((r) => ({
          id: r.invite_id,
          email: r.invited_email,
          role: r.role,
          status: r.status,
          created_at: r.created_at,
          location_id: r.location_id,
          location_name: locNameById.get(r.location_id) ?? "Location",
          source: "restaurant_invite" as const,
        }));

        const legacyInvites: Invitation[] = (invRows ?? []).map((r) => ({
          id: r.id as string,
          email: r.email as string,
          role: r.role as string,
          status: r.status as string,
          created_at: r.created_at as string,
          source: "invitation" as const,
        }));

        const invitations = [...secureInvites, ...legacyInvites].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        );

        if (!cancelled) {
          setLocations(activeList);
          setInactiveLocations(inactiveList);
          setTeamMembers(team);
          setPendingInvitations(invitations);
        }
      } catch (e) {
        logSupabaseError("load", e);
        const msg = formatPostgrestError(e);
        if (!cancelled) {
          setError(msg);
          setLocations([]);
          setInactiveLocations([]);
          setTeamMembers([]);
          setPendingInvitations([]);
        }
        if (isDev) toast.error(`Locations & Team failed to load · ${msg}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [restaurantId, user, tick]);

  const addLocation = useCallback(
    async (data: NewLocationData) => {
      if (!restaurantId || !user) return;
      const { data: inserted, error: insErr } = await supabase
        .from("locations")
        .insert({
          restaurant_id: restaurantId,
          name: data.name.trim(),
          address: data.address.trim() || null,
          city: data.city.trim(),
          state: data.state.trim(),
          is_active: true,
          is_default: false,
          storage_types: DEFAULT_STORAGE_TYPES,
        })
        .select("id")
        .single();
      if (insErr) {
        logSupabaseError("addLocation", insErr);
        throw insErr;
      }
      const lid = inserted?.id as string;
      const { error: setErr } = await supabase.from("location_settings").insert({
        location_id: lid,
        brand: data.brand,
        food_cost_target_pct: data.food_cost_target_pct,
        count_frequency_days: data.count_frequency_days,
        count_overdue_alert_hrs: data.count_overdue_alert_hrs,
      });
      if (setErr) {
        logSupabaseError("addLocation settings", setErr);
        throw setErr;
      }
      refetch();
    },
    [restaurantId, user, refetch],
  );

  const updateLocation = useCallback(
    async (id: string, data: Partial<Pick<LocationWithSettings, "name" | "address" | "city" | "state" | "is_active" | "is_default" | "brand" | "food_cost_target_pct" | "count_frequency_days" | "count_overdue_alert_hrs">>) => {
      const locPatch: Record<string, unknown> = {};
      if (data.name !== undefined) locPatch.name = data.name;
      if (data.address !== undefined) locPatch.address = data.address;
      if (data.city !== undefined) locPatch.city = data.city;
      if (data.state !== undefined) locPatch.state = data.state;
      if (data.is_active !== undefined) locPatch.is_active = data.is_active;
      if (data.is_default !== undefined) locPatch.is_default = data.is_default;

      if (Object.keys(locPatch).length > 0) {
        const { error: e1 } = await supabase.from("locations").update(locPatch).eq("id", id);
        if (e1) {
          logSupabaseError("updateLocation", e1);
          throw e1;
        }
      }

      const setPatch: Record<string, unknown> = {};
      if (data.brand !== undefined) setPatch.brand = data.brand;
      if (data.food_cost_target_pct !== undefined) setPatch.food_cost_target_pct = data.food_cost_target_pct;
      if (data.count_frequency_days !== undefined) setPatch.count_frequency_days = data.count_frequency_days;
      if (data.count_overdue_alert_hrs !== undefined) setPatch.count_overdue_alert_hrs = data.count_overdue_alert_hrs;

      if (Object.keys(setPatch).length > 0) {
        const { error: e2 } = await supabase.from("location_settings").update(setPatch).eq("location_id", id);
        if (e2) {
          logSupabaseError("updateLocation settings", e2);
          throw e2;
        }
      }
      refetch();
    },
    [refetch],
  );

  const deactivateLocation = useCallback(
    async (id: string) => {
      const { error: e1 } = await supabase.from("locations").update({ is_active: false }).eq("id", id);
      if (e1) {
        logSupabaseError("deactivateLocation", e1);
        throw e1;
      }
      refetch();
    },
    [refetch],
  );

  const inviteMember = useCallback(
    async (data: InviteData) => {
      if (!restaurantId || !user) return;
      const result = await sendTeamInviteEmail({
        restaurantId,
        email: data.email,
        role: data.role,
        locationId: data.location_id,
        permissions: DEFAULT_ASSIGNMENT_PERMISSIONS,
      });
      if (result.email_sent === false) {
        throw new Error("Invite created but the email could not be sent — try Resend");
      }
      refetch();
    },
    [restaurantId, user, refetch],
  );

  const resendInvitation = useCallback(
    async (invitationId: string, source: Invitation["source"]) => {
      if (source !== "restaurant_invite") {
        throw new Error("Only email invites can be resent — cancel and create a new invite");
      }
      const result = await resendTeamInviteEmail(invitationId);
      if (result.email_sent === false) {
        throw new Error("Could not resend the invite email");
      }
      refetch();
    },
    [refetch],
  );

  const assignMember = useCallback(
    async (userId: string, locationId: string, role: "MANAGER" | "STAFF", permissions: LocationPermissions) => {
      const { error: e1 } = await supabase.from("user_location_assignments").insert({
        user_id: userId,
        location_id: locationId,
        role,
        is_primary: false,
        can_approve_orders: permissions.can_approve_orders,
        can_see_costs: permissions.can_see_costs,
        can_see_food_cost_pct: permissions.can_see_food_cost_pct,
        can_see_inventory_value: permissions.can_see_inventory_value,
        can_edit_par: permissions.can_edit_par,
        order_approval_threshold: permissions.order_approval_threshold,
      });
      if (e1) {
        logSupabaseError("assignMember", e1);
        throw e1;
      }
      refetch();
    },
    [refetch],
  );

  const removeMemberFromLocation = useCallback(
    async (userId: string, locationId: string) => {
      const { error: e1 } = await supabase
        .from("user_location_assignments")
        .delete()
        .eq("user_id", userId)
        .eq("location_id", locationId);
      if (e1) {
        logSupabaseError("removeMemberFromLocation", e1);
        throw e1;
      }
      refetch();
    },
    [refetch],
  );

  const cancelInvitation = useCallback(
    async (invitationId: string, source: Invitation["source"]) => {
      if (source === "restaurant_invite") {
        const { error: e1 } = await supabase.rpc("revoke_invite", { p_invite_id: invitationId });
        if (e1) {
          logSupabaseError("revoke_invite", e1);
          if (isDev) toast.error(formatPostgrestError(e1));
          throw e1;
        }
      } else {
        const { error: e1 } = await supabase.from("invitations").update({ status: "REVOKED" }).eq("id", invitationId);
        if (e1) {
          logSupabaseError("cancelInvitation", e1);
          if (isDev) toast.error(formatPostgrestError(e1));
          throw e1;
        }
      }
      refetch();
    },
    [refetch],
  );

  const updatePermissions = useCallback(
    async (userId: string, locationId: string, permissions: Partial<LocationPermissions>) => {
      const patch: Record<string, unknown> = {};
      if (permissions.can_approve_orders !== undefined) patch.can_approve_orders = permissions.can_approve_orders;
      if (permissions.can_see_costs !== undefined) patch.can_see_costs = permissions.can_see_costs;
      if (permissions.can_see_food_cost_pct !== undefined) patch.can_see_food_cost_pct = permissions.can_see_food_cost_pct;
      if (permissions.can_see_inventory_value !== undefined) patch.can_see_inventory_value = permissions.can_see_inventory_value;
      if (permissions.can_edit_par !== undefined) patch.can_edit_par = permissions.can_edit_par;
      if (permissions.order_approval_threshold !== undefined) patch.order_approval_threshold = permissions.order_approval_threshold;

      if (Object.keys(patch).length === 0) return;

      const { error: e1 } = await supabase
        .from("user_location_assignments")
        .update(patch)
        .eq("user_id", userId)
        .eq("location_id", locationId);
      if (e1) {
        logSupabaseError("updatePermissions", e1);
        throw e1;
      }
      refetch();
    },
    [refetch],
  );

  return {
    locations,
    inactiveLocations,
    teamMembers,
    pendingInvitations,
    addLocation,
    updateLocation,
    deactivateLocation,
    inviteMember,
    resendInvitation,
    assignMember,
    removeMemberFromLocation,
    cancelInvitation,
    updatePermissions,
    loading,
    error,
    refetch,
  };
}
