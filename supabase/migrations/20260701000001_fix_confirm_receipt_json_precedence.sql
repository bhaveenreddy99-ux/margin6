-- HOTFIX: Postgres-17 operator-precedence crash in confirm_invoice_receipt.
-- `||` binds tighter than `->>`, so  ' (+' || item->>'pct_change' || '%)'
-- parsed as (text || jsonb) -> Postgres tried to parse ' (+' as json ->
-- 'invalid input syntax for type json: Token "(" is invalid'. This made
-- confirming ANY invoice with a >5% price change throw and roll back.
--
-- Fix: parenthesize every (item->>'x') so ->> binds first. Applied to each
-- function's OWN current definition (regexp_replace of pg_get_functiondef),
-- so the ONLY change is the added parentheses -- immune to any prior drift
-- between the deployed function and this repo. No logic/alert-content change.
-- Verified on prod: pre/post differ ONLY by parentheses; a +15% invoice now
-- posts cleanly and creates its PRICE_INCREASE notification.
DO $$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.confirm_invoice_receipt(uuid,uuid)'::regprocedure);
  EXECUTE regexp_replace(d, 'item->>''([a-z_]+)''', '(item->>''\1'')', 'g');
  d := pg_get_functiondef('public.confirm_invoice_receipt_legacy(uuid,uuid)'::regprocedure);
  EXECUTE regexp_replace(d, 'item->>''([a-z_]+)''', '(item->>''\1'')', 'g');
END $$;
NOTIFY pgrst, 'reload schema';
