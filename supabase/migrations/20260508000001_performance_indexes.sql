-- =============================================================================
-- Performance indexes (missing only)
--
-- Inspected existing migrations: composite indexes below already exist and are
-- intentionally NOT duplicated here:
--   • waste_log_restaurant_logged_at      ON waste_log (restaurant_id, logged_at DESC)
--     — 20260228000001_waste_log.sql
--     → Dashboard waste metrics, Waste Log page time-range filters.
--   • idx_inventory_session_items_catalog_item_id
--     — 20260307000002_catalog_ids_for_receiving_and_analytics.sql
--     → Inventory count session joins to catalog / PAR resolution.
--   • idx_inventory_session_item_zones_session_item_id
--     — 20260423120000_inventory_session_item_zones.sql
--     → Zone strip loads per session line (inventory count UI).
--   • idx_invoice_items_invoice
--     — 20260329120000 / 20260507000001_production_schema_repair.sql
--     → Invoice review line loads by invoice_id.
--   • idx_delivery_issues_purchase_history_id, idx_delivery_issues_invoice_id
--     — 20260305000001 / 20260506000002 / repair migration
--     → Invoice review delivery_issues fetch by document id.
--   • idx_invoice_line_comparisons_invoice_id
--     — 20260329120000 / repair migration
--     → Invoice review comparisons for invoices path.
--   • idx_ula_user_id ON user_location_assignments(user_id)
--     — 20260503000001_user_location_assignments.sql
--     → Location picker / permissions for current user.
--
-- stock_movements already has idx_stock_movements_restaurant_catalog on
-- (restaurant_id, catalog_item_id); this migration adds a narrow index on
-- catalog_item_id alone for queries that filter only by item (ledger-style).
-- =============================================================================

-- notifications(user_id, read_at)
-- Protects: Notifications page — list + unread counts for auth.uid(), ORDER BY read_at / filter read_at IS NULL.
CREATE INDEX IF NOT EXISTS idx_notifications_user_id_read_at
  ON public.notifications (user_id, read_at DESC NULLS LAST);

-- notifications(restaurant_id, type)
-- Protects: Restaurant-scoped notification queries by type (e.g. DELIVERY_ISSUE,
-- PRICE_INCREASE), edge functions / admin-style filters without user_id prefix.
CREATE INDEX IF NOT EXISTS idx_notifications_restaurant_id_type
  ON public.notifications (restaurant_id, type);

-- alert_recipients(notification_pref_id)
-- Protects: Location Settings / notification prefs CUSTOM recipients —
-- SELECT/DELETE rows for a preference id (FK lookups, no index on child column by default).
CREATE INDEX IF NOT EXISTS idx_alert_recipients_notification_pref_id
  ON public.alert_recipients (notification_pref_id);

-- smart_order_run_items(run_id)
-- Protects: Smart Order page line cards, submit_smart_order RPC — loads all lines for a run_id.
CREATE INDEX IF NOT EXISTS idx_smart_order_run_items_run_id
  ON public.smart_order_run_items (run_id);

-- stock_movements(catalog_item_id)
-- Protects: Future catalog-item-scoped ledger reads (item history across restaurants when permitted),
-- complements composite idx_stock_movements_restaurant_catalog for restaurant-scoped queries only.
CREATE INDEX IF NOT EXISTS idx_stock_movements_catalog_item_id
  ON public.stock_movements (catalog_item_id);

NOTIFY pgrst, 'reload schema';
