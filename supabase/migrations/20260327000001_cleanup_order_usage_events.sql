-- Orders were incorrectly recorded as usage events.
-- Remove those polluted rows so reporting no longer treats order creation as consumption.

DELETE FROM public.usage_events
WHERE order_id IS NOT NULL;
