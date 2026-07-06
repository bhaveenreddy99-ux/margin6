-- Manager/staff invite flow — Slice 1: the `restaurant_invites` table (pure DB, no
-- create/accept logic yet). Clean single-source table; the two legacy half-built
-- tables (invitations, user_invites) are retired in a later slice.
--
-- Security posture (writes come via SECURITY DEFINER RPCs in later slices):
--   * token is NEVER stored in plaintext — only token_hash (sha256, 32 bytes), UNIQUE.
--   * role can only ever be MANAGER or STAFF (CHECK) — an invite can NEVER grant OWNER.
--   * role / restaurant_id / location_id / email live on the row; the accept RPC will
--     read them server-side (the invitee never supplies them).
--   * single-use + expiry are enforced at accept time; the columns live here.
--   * RLS: OWNER/MANAGER of the restaurant may SELECT invites; there is NO client
--     INSERT/UPDATE/DELETE policy or grant — all writes go through DEFINER RPCs, same
--     discipline as restaurant_members.

CREATE TYPE public.restaurant_invite_status AS ENUM ('pending', 'accepted', 'revoked', 'expired');

CREATE TABLE public.restaurant_invites (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id  uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  -- the grant: MANAGER or STAFF only, never OWNER
  role           public.app_role NOT NULL,
  location_id    uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  invited_email  text NOT NULL,
  -- sha256(token); the plaintext token exists only in the emailed link
  token_hash     bytea NOT NULL,
  expires_at     timestamptz NOT NULL,
  status         public.restaurant_invite_status NOT NULL DEFAULT 'pending',
  -- per-location permissions carried onto the membership at accept time
  can_see_costs           boolean NOT NULL DEFAULT false,
  can_see_food_cost_pct   boolean NOT NULL DEFAULT false,
  can_see_inventory_value boolean NOT NULL DEFAULT false,
  can_approve_orders      boolean NOT NULL DEFAULT false,
  can_edit_par            boolean NOT NULL DEFAULT false,
  order_approval_threshold numeric,
  invited_by     uuid NOT NULL REFERENCES auth.users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  accepted_at    timestamptz,
  accepted_by    uuid REFERENCES auth.users(id),

  CONSTRAINT restaurant_invites_role_not_owner CHECK (role IN ('MANAGER'::public.app_role, 'STAFF'::public.app_role)),
  CONSTRAINT restaurant_invites_email_lowercased CHECK (invited_email = lower(invited_email)),
  CONSTRAINT restaurant_invites_token_hash_key UNIQUE (token_hash)
);

-- No two LIVE (pending) invites for the same person to the same restaurant.
CREATE UNIQUE INDEX restaurant_invites_one_pending_per_email
  ON public.restaurant_invites (restaurant_id, invited_email)
  WHERE status = 'pending';

-- Owner/manager listing of a restaurant's invites.
CREATE INDEX restaurant_invites_restaurant_status_idx
  ON public.restaurant_invites (restaurant_id, status);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.restaurant_invites ENABLE ROW LEVEL SECURITY;

-- Writes are DEFINER-only: grant SELECT to authenticated (RLS-gated), nothing else.
REVOKE ALL ON public.restaurant_invites FROM anon, authenticated;
GRANT SELECT ON public.restaurant_invites TO authenticated;

-- OWNER or MANAGER of the restaurant can view its invites. No INSERT/UPDATE/DELETE
-- policy exists → the create-invite / accept RPCs (SECURITY DEFINER) are the only writers.
CREATE POLICY "Owner/Manager can view restaurant invites"
  ON public.restaurant_invites
  FOR SELECT
  TO authenticated
  USING (
    has_restaurant_role_any(
      restaurant_id,
      ARRAY['OWNER'::public.app_role, 'MANAGER'::public.app_role]
    )
  );

NOTIFY pgrst, 'reload schema';
