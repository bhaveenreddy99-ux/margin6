-- Order tickets are operational workflow, not actual consumption.
-- Remove legacy order-linked usage events so analytics only rely on
-- stock-count deltas and received purchases.

DELETE FROM public.usage_events
WHERE order_id IS NOT NULL;
