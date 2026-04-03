-- Add logo_url to restaurant_settings
ALTER TABLE public.restaurant_settings ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- Create storage bucket for restaurant logos
INSERT INTO storage.buckets (id, name, public)
VALUES ('restaurant-logos', 'restaurant-logos', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for restaurant logos
CREATE POLICY "Restaurant logos are publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'restaurant-logos');

CREATE POLICY "Managers can upload restaurant logos"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'restaurant-logos'
  AND auth.uid() IS NOT NULL
);

CREATE POLICY "Managers can update restaurant logos"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'restaurant-logos'
  AND auth.uid() IS NOT NULL
);

CREATE POLICY "Managers can delete restaurant logos"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'restaurant-logos'
  AND auth.uid() IS NOT NULL
);