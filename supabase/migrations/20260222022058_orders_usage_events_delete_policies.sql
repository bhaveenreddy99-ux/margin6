
-- Allow members to delete orders
CREATE POLICY "Members can delete orders"
ON public.orders
FOR DELETE
USING (is_member_of(restaurant_id));

-- Allow members to delete order items
CREATE POLICY "Members can delete order items"
ON public.order_items
FOR DELETE
USING (is_member_of(order_restaurant_id(order_id)));

-- Also allow deleting related usage_events
CREATE POLICY "Members can delete usage events"
ON public.usage_events
FOR DELETE
USING (is_member_of(restaurant_id));
