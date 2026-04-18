-- Intake pipeline: uploaded files + link to draft invoice (parsing comes later)

CREATE TABLE public.invoice_ingestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('file', 'photo')),
  mime_type text,
  original_filename text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX invoice_ingestions_restaurant_id_idx ON public.invoice_ingestions (restaurant_id);
CREATE INDEX invoice_ingestions_invoice_id_idx ON public.invoice_ingestions (invoice_id);

ALTER TABLE public.invoice_ingestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invoice_ingestions select"
  ON public.invoice_ingestions FOR SELECT
  TO authenticated
  USING (public.is_member_of(restaurant_id));

CREATE POLICY "invoice_ingestions insert"
  ON public.invoice_ingestions FOR INSERT
  TO authenticated
  WITH CHECK (public.is_member_of(restaurant_id));

CREATE POLICY "invoice_ingestions update"
  ON public.invoice_ingestions FOR UPDATE
  TO authenticated
  USING (public.is_member_of(restaurant_id))
  WITH CHECK (public.is_member_of(restaurant_id));

CREATE POLICY "invoice_ingestions delete"
  ON public.invoice_ingestions FOR DELETE
  TO authenticated
  USING (public.is_member_of(restaurant_id));

INSERT INTO storage.buckets (id, name, public)
VALUES ('invoice-uploads', 'invoice-uploads', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "invoice-uploads select" ON storage.objects;
DROP POLICY IF EXISTS "invoice-uploads insert" ON storage.objects;
DROP POLICY IF EXISTS "invoice-uploads update" ON storage.objects;
DROP POLICY IF EXISTS "invoice-uploads delete" ON storage.objects;

CREATE POLICY "invoice-uploads select"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'invoice-uploads' AND public.is_member_of((storage.foldername(name))[1]::uuid));

CREATE POLICY "invoice-uploads insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'invoice-uploads' AND public.is_member_of((storage.foldername(name))[1]::uuid));

CREATE POLICY "invoice-uploads update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'invoice-uploads' AND public.is_member_of((storage.foldername(name))[1]::uuid));

CREATE POLICY "invoice-uploads delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'invoice-uploads' AND public.is_member_of((storage.foldername(name))[1]::uuid));

NOTIFY pgrst, 'reload schema';
