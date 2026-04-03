
ALTER TABLE public.par_guides DROP CONSTRAINT par_guides_inventory_list_id_fkey;
ALTER TABLE public.par_guides ADD CONSTRAINT par_guides_inventory_list_id_fkey FOREIGN KEY (inventory_list_id) REFERENCES public.inventory_lists(id) ON DELETE CASCADE;

ALTER TABLE public.inventory_catalog_items DROP CONSTRAINT inventory_catalog_items_inventory_list_id_fkey;
ALTER TABLE public.inventory_catalog_items ADD CONSTRAINT inventory_catalog_items_inventory_list_id_fkey FOREIGN KEY (inventory_list_id) REFERENCES public.inventory_lists(id) ON DELETE CASCADE;

ALTER TABLE public.inventory_sessions DROP CONSTRAINT inventory_sessions_inventory_list_id_fkey;
ALTER TABLE public.inventory_sessions ADD CONSTRAINT inventory_sessions_inventory_list_id_fkey FOREIGN KEY (inventory_list_id) REFERENCES public.inventory_lists(id) ON DELETE CASCADE;

ALTER TABLE public.inventory_import_files DROP CONSTRAINT inventory_import_files_inventory_list_id_fkey;
ALTER TABLE public.inventory_import_files ADD CONSTRAINT inventory_import_files_inventory_list_id_fkey FOREIGN KEY (inventory_list_id) REFERENCES public.inventory_lists(id) ON DELETE CASCADE;

ALTER TABLE public.import_runs DROP CONSTRAINT import_runs_inventory_list_id_fkey;
ALTER TABLE public.import_runs ADD CONSTRAINT import_runs_inventory_list_id_fkey FOREIGN KEY (inventory_list_id) REFERENCES public.inventory_lists(id) ON DELETE CASCADE;

ALTER TABLE public.import_templates DROP CONSTRAINT import_templates_inventory_list_id_fkey;
ALTER TABLE public.import_templates ADD CONSTRAINT import_templates_inventory_list_id_fkey FOREIGN KEY (inventory_list_id) REFERENCES public.inventory_lists(id) ON DELETE CASCADE;

ALTER TABLE public.smart_order_runs DROP CONSTRAINT smart_order_runs_inventory_list_id_fkey;
ALTER TABLE public.smart_order_runs ADD CONSTRAINT smart_order_runs_inventory_list_id_fkey FOREIGN KEY (inventory_list_id) REFERENCES public.inventory_lists(id) ON DELETE CASCADE;

ALTER TABLE public.purchase_history DROP CONSTRAINT purchase_history_inventory_list_id_fkey;
ALTER TABLE public.purchase_history ADD CONSTRAINT purchase_history_inventory_list_id_fkey FOREIGN KEY (inventory_list_id) REFERENCES public.inventory_lists(id) ON DELETE CASCADE;

NOTIFY pgrst, 'reload schema';
