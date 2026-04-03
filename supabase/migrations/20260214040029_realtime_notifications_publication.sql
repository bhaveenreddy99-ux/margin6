ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
NOTIFY pgrst, 'reload schema';