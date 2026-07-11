# Deploy Reconciliation — Known Issues (reconcile later, do NOT fix piecemeal)

These are prod↔repo drift issues discovered during the confirm_invoice_receipt hotfix
(2026-07-01). None are urgent; batch them into a dedicated reconciliation pass.

## 1. Migration ledger drift
The 7 P0 security migrations + this hotfix were applied to prod via MCP `apply_migration`,
which recorded them under regenerated `20260630…` / new version numbers — NOT the repo's
`20260623…/20260624…/20260701…` versions. A future `supabase db push` would see the repo
files as "pending" and try to re-run them.
- Fix later: `supabase migration repair --status applied <version> …` to align the ledger.

## 2. confirm_invoice_receipt BODY drift (prod ≠ repo)
Prod's deployed `confirm_invoice_receipt` / `_legacy` are NOT byte-identical to the repo
migration `20260623000007` — they differ even after whitespace normalization (likely the
S0-9 deploy was applied from a hand-pasted copy that drifted). The hotfix was deliberately
applied to prod's OWN definition (only-parens change) to avoid overwriting prod with the
repo body. So prod and repo still differ in the (functionally equivalent) body.
- Fix later: decide the canonical version, regenerate `20260623000007` from prod (or vice
  versa), and re-sync so repo == prod.

## 3. RETURN payload quirk (investigate, low priority)
In the prod behavioral test, `confirm_invoice_receipt` returned `price_changes: []` (length 0)
even though the catalog cost updated (100→115) AND a PRICE_INCREASE notification was created.
The dashboard "price increase impact" may read `price_changes`; if so it could under-report.
- Investigate later whether the returned `price_changes` array is populated as intended in
  prod's (drifted) version.
