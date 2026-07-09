-- Manager/staff invite flow — Slice 4a: get_invite_preview (SECURITY DEFINER, read-only).
--
-- The accept page must show "You've been invited to <restaurant> as <role>" and
-- pre-fill+lock the signup email BEFORE the invitee authenticates. accept_invite
-- requires auth, so it can't serve that. This RPC is the pre-auth, NON-CONSUMING
-- lookup: keyed on the token (a 256-bit capability), callable by anon.
--
-- Security model (capability-based, same tradeoff already accepted for the token):
--   * DEFINER + anon EXECUTE, but the ONLY way in is sha256(token) matching a stored
--     token_hash. Tokens are 256-bit CSPRNG → unguessable, so effectively only the
--     invitee (who received the token by email) can read the row. No email enumeration:
--     you cannot ask "does <email> have an invite?" — only "what is <token> for?".
--   * NON-CONSUMING: pure SELECT, never mutates status (accept_invite still does the
--     atomic single-use consume).
--   * Minimal disclosure: invited_email (the invitee already knows it), restaurant
--     name (needed to render the accept screen), role, status, expiry. NEVER token_hash
--     or permission flags. Returns 0 rows for a non-matching token → UI treats as invalid.

CREATE OR REPLACE FUNCTION public.get_invite_preview(p_token text)
RETURNS TABLE(
  invited_email   text,
  restaurant_name text,
  role            public.app_role,
  status          public.restaurant_invite_status,
  expires_at      timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT i.invited_email, r.name, i.role, i.status, i.expires_at
  FROM public.restaurant_invites i
  JOIN public.restaurants r ON r.id = i.restaurant_id
  WHERE i.token_hash = sha256(p_token::bytea);
$$;

REVOKE ALL ON FUNCTION public.get_invite_preview(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_invite_preview(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
