INSERT INTO public.location_settings (
  location_id,
  food_cost_target_pct,
  count_frequency_days,
  count_overdue_alert_hrs
)
SELECT l.id, 30.0, 3, 72
FROM public.locations l
WHERE NOT EXISTS (
  SELECT 1 FROM public.location_settings ls
  WHERE ls.location_id = l.id
)
AND l.is_active = true;
