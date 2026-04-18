# RestaurantIQ Stabilization Plan

## Product decisions
- Product wedge: Count -> Approve -> Suggested Order -> Invoice Review -> Alerts -> Dashboard
- On-hand truth: approved count + receiving + waste + adjustments
- Price truth: confirmed invoice receipt should drive last paid cost
- Procurement truth: purchase_orders + invoices is the primary future path
- Counts should be treated as locked after approval

## Open issues
- [ ] EnterInventory.tsx lint/type cleanup
- [ ] InvoiceReview.tsx lint/type cleanup
- [ ] Invoices.tsx lint/type cleanup
- [ ] Dashboard.tsx lint/type cleanup
- [ ] Create shared domain rules
- [ ] Centralize alert logic
- [ ] Centralize dashboard metrics
- [ ] Plan inventory ledger
- [ ] Tighten catalog item identity usage

## In progress
- [ ] Current issue:

## Done
- [x] prefer-const fix in EnterInventory.tsx
- [x] first no-explicit-any fix in EnterInventory.tsx for reminder schedule typing

## Deferred
- POS integrations
- recipes
- theoretical depletion
- AI forecasting
- accounting integrations