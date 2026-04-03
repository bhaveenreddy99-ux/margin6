-- Smart Order to Invoice Matching schema
-- Adds PO tracking, receipt status, and comparison tables

-- 1. Add po_number to smart_order_runs
ALTER TABLE smart_order_runs
  ADD COLUMN IF NOT EXISTS po_number text UNIQUE;

-- 2. Add invoice matching columns to purchase_history
ALTER TABLE purchase_history
  ADD COLUMN IF NOT EXISTS purchase_order_id uuid REFERENCES smart_order_runs(id),
  ADD COLUMN IF NOT EXISTS po_number text,
  ADD COLUMN IF NOT EXISTS receipt_status text DEFAULT 'pending'
    CHECK (receipt_status IN ('pending', 'reviewing', 'confirmed', 'issues_reported'));

-- 3. invoice_line_comparisons: line-by-line diff between PO and invoice
CREATE TABLE IF NOT EXISTS invoice_line_comparisons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_history_id uuid NOT NULL REFERENCES purchase_history(id) ON DELETE CASCADE,
  purchase_history_item_id uuid REFERENCES purchase_history_items(id) ON DELETE SET NULL,
  smart_order_run_id uuid REFERENCES smart_order_runs(id) ON DELETE SET NULL,
  catalog_item_id uuid REFERENCES inventory_catalog_items(id) ON DELETE SET NULL,
  item_name text NOT NULL,
  po_qty numeric,
  po_unit_cost numeric,
  invoiced_qty numeric,
  invoiced_unit_cost numeric,
  qty_diff numeric GENERATED ALWAYS AS (invoiced_qty - po_qty) STORED,
  cost_diff numeric GENERATED ALWAYS AS (invoiced_unit_cost - po_unit_cost) STORED,
  status text DEFAULT 'ok'
    CHECK (status IN ('ok', 'qty_mismatch', 'price_mismatch', 'missing_from_invoice', 'extra_on_invoice')),
  created_at timestamptz DEFAULT now()
);

-- 4. delivery_issues: user-reported issues during receipt confirmation
CREATE TABLE IF NOT EXISTS delivery_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_history_id uuid NOT NULL REFERENCES purchase_history(id) ON DELETE CASCADE,
  invoice_line_comparison_id uuid REFERENCES invoice_line_comparisons(id) ON DELETE SET NULL,
  catalog_item_id uuid REFERENCES inventory_catalog_items(id) ON DELETE SET NULL,
  item_name text NOT NULL,
  issue_type text NOT NULL
    CHECK (issue_type IN ('short_shipped', 'damaged', 'wrong_item', 'price_discrepancy', 'other')),
  notes text,
  reported_at timestamptz DEFAULT now(),
  resolved_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Indexes for common lookups
CREATE INDEX IF NOT EXISTS idx_purchase_history_po_number ON purchase_history(po_number);
CREATE INDEX IF NOT EXISTS idx_purchase_history_purchase_order_id ON purchase_history(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_invoice_line_comparisons_purchase_history_id ON invoice_line_comparisons(purchase_history_id);
CREATE INDEX IF NOT EXISTS idx_delivery_issues_purchase_history_id ON delivery_issues(purchase_history_id);

-- RLS policies
ALTER TABLE invoice_line_comparisons ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_issues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage invoice_line_comparisons for their restaurant"
  ON invoice_line_comparisons
  USING (
    purchase_history_id IN (
      SELECT id FROM purchase_history WHERE restaurant_id IN (
        SELECT restaurant_id FROM restaurant_members WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can manage delivery_issues for their restaurant"
  ON delivery_issues
  USING (
    purchase_history_id IN (
      SELECT id FROM purchase_history WHERE restaurant_id IN (
        SELECT restaurant_id FROM restaurant_members WHERE user_id = auth.uid()
      )
    )
  );
