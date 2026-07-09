import { supabase } from "@/integrations/supabase/client";
import type { LocationPermissions } from "@/contexts/RestaurantContext";

export type TeamInviteRole = "MANAGER" | "STAFF";

export type CreateTeamInviteInput = {
  restaurantId: string;
  email: string;
  role: TeamInviteRole;
  locationId: string;
  permissions?: Partial<LocationPermissions>;
};

type SendInviteResult = {
  success?: boolean;
  invite_id?: string;
  email_sent?: boolean;
  error?: string;
};

async function invokeSendInvite(body: Record<string, unknown>): Promise<SendInviteResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error("Please sign in again to send invites");
  }

  const { data, error } = await supabase.functions.invoke("send-invite", {
    body,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
  });

  if (error) throw error;

  const payload = (data ?? {}) as SendInviteResult;
  if (!payload.success) {
    throw new Error(payload.error ?? "Could not send the invite");
  }
  return payload;
}

/** Mint + email via edge function — never calls create_invite from the browser. */
export async function sendTeamInviteEmail(input: CreateTeamInviteInput): Promise<SendInviteResult> {
  const perms = input.permissions;
  return invokeSendInvite({
    action: "create",
    restaurant_id: input.restaurantId,
    email: input.email.trim().toLowerCase(),
    role: input.role,
    location_id: input.locationId,
    can_see_costs: perms?.can_see_costs ?? false,
    can_see_food_cost_pct: perms?.can_see_food_cost_pct ?? true,
    can_see_inventory_value: perms?.can_see_inventory_value ?? false,
    can_approve_orders: perms?.can_approve_orders ?? true,
    can_edit_par: perms?.can_edit_par ?? true,
    order_approval_threshold: perms?.order_approval_threshold ?? null,
  });
}

/** Resend (rotate token + email) via edge function — never calls resend_invite from the browser. */
export async function resendTeamInviteEmail(inviteId: string): Promise<SendInviteResult> {
  return invokeSendInvite({
    action: "resend",
    invite_id: inviteId,
  });
}
