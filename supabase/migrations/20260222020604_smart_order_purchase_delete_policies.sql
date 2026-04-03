-- Add DELETE policies for smart order cleanup

CREATE POLICY "Members can delete run items"
ON public.smart_order_run_items
FOR DELETE
USING (is_member_of(smart_order_run_restaurant_id(run_id)));

CREATE POLICY "Members can delete smart order runs"
ON public.smart_order_runs
FOR DELETE
USING (is_member_of(restaurant_id));

CREATE POLICY "Manager+ can delete purchase history items"
ON public.purchase_history_items
FOR DELETE
USING (is_member_of(purchase_history_restaurant_id(purchase_history_id)));