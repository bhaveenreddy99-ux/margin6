
-- Invitation statuses
CREATE TYPE public.invitation_status AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');

-- Invitations table
CREATE TABLE public.invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  email text NOT NULL,
  role public.app_role NOT NULL DEFAULT 'STAFF',
  token uuid NOT NULL DEFAULT gen_random_uuid(),
  status public.invitation_status NOT NULL DEFAULT 'PENDING',
  invited_by uuid NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  UNIQUE(restaurant_id, email, status)
);

-- Index for quick token lookup
CREATE INDEX idx_invitations_token ON public.invitations(token);
CREATE INDEX idx_invitations_email ON public.invitations(email);

-- RLS
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

-- Helper function
CREATE OR REPLACE FUNCTION public.invitation_restaurant_id(inv_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$ SELECT restaurant_id FROM public.invitations WHERE id = inv_id $$;

-- Owners can manage invitations
CREATE POLICY "Owners can insert invitations"
ON public.invitations FOR INSERT
WITH CHECK (has_restaurant_role(restaurant_id, 'OWNER'::app_role));

CREATE POLICY "Members can view invitations"
ON public.invitations FOR SELECT
USING (is_member_of(restaurant_id));

CREATE POLICY "Owners can update invitations"
ON public.invitations FOR UPDATE
USING (has_restaurant_role(restaurant_id, 'OWNER'::app_role));

CREATE POLICY "Owners can delete invitations"
ON public.invitations FOR DELETE
USING (has_restaurant_role(restaurant_id, 'OWNER'::app_role));

-- Function to auto-accept invitations when a user signs up
CREATE OR REPLACE FUNCTION public.accept_pending_invitations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  inv RECORD;
BEGIN
  FOR inv IN
    SELECT id, restaurant_id, role
    FROM public.invitations
    WHERE email = NEW.email
      AND status = 'PENDING'
      AND expires_at > now()
  LOOP
    -- Add user to restaurant
    INSERT INTO public.restaurant_members (restaurant_id, user_id, role)
    VALUES (inv.restaurant_id, NEW.id, inv.role)
    ON CONFLICT DO NOTHING;

    -- Mark invitation as accepted
    UPDATE public.invitations
    SET status = 'ACCEPTED', accepted_at = now()
    WHERE id = inv.id;
  END LOOP;

  RETURN NEW;
END;
$$;

-- Trigger on new user creation (fires after profile is created)
CREATE TRIGGER on_user_created_accept_invitations
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.accept_pending_invitations();

-- Grant necessary permissions
GRANT ALL ON public.invitations TO authenticated;
GRANT ALL ON public.invitations TO anon;
