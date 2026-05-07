-- Add columns to track how counts were entered and converted
ALTER TABLE inventory_session_items
  ADD COLUMN IF NOT EXISTS counted_as TEXT,
  ADD COLUMN IF NOT EXISTS counted_value NUMERIC,
  ADD COLUMN IF NOT EXISTS conversion_formula TEXT;

COMMENT ON COLUMN inventory_session_items.counted_as IS
  'Unit used for counting: cases, units (bags/bottles), or weight (lbs/gal)';

COMMENT ON COLUMN inventory_session_items.counted_value IS
  'Raw value entered by user (e.g., 33 if counted 33 bags)';

COMMENT ON COLUMN inventory_session_items.conversion_formula IS
  'Audit trail showing conversion math (e.g., "33 bags ÷ 6 = 5.5 CS")';
