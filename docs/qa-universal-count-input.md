# QA: Universal count input (feature-flagged)

## Env (Vite)

- `VITE_FORCE_OLD_COUNT_UI=true` — Disables the new UI everywhere (roll back to legacy `CountSheetItemStockField`). Restart the dev server after changing `.env.local`.
- The new UI is only offered for the **DRY** category (case-insensitive section label) when the flag is not set. See `UNIVERSAL_COUNT_INPUT_CATEGORY` in `src/lib/feature-flags.ts`.

## UI layout (manual screenshot)

- **Header (desktop on-hand column)**: read-only `sr-only` line with item + pack; table row item name is in the left column. **Card (mobile)**: no duplicate item title in the count control (name stays in the card header).
- **Unit group**: `Cases` plus dynamic **Items / Bags / Bottles** when applicable, plus **Weight** for weight- or volume-based packs.
- **Number field**: single quantity in the active unit, `min-h-11` touch target.
- **Below**: live conversion (explanation + three-way summary), then PAR line (`X cs vs Y par`).
- **Status**: “…” while saving, checkmark when saved.

## Checklist

- [ ] New UI appears only for items under a **DRY** section (same label as the category header).
- [ ] **COOLER**, **FREEZER**, etc. still use the legacy count field (Cases/Pounds or single cases).
- [ ] Conversions match expectations for cases / sell-units / weight (spot-check against `inventory-conversions` tests).
- [ ] Layout is usable on a narrow viewport (buttons and input at least 44px tall).
- [ ] **Tab** moves through unit toggles then the number field; **Enter** commits save on the number field.
- [ ] **Auto-save** runs on blur and ~1s after last keystroke; no duplicate error toasts.
- [ ] No new **console** errors on count or save.
- [ ] `VITE_FORCE_OLD_COUNT_UI=true` restores legacy UI even for DRY.
- [ ] **Zone strip** (multi-zone count) rows: legacy count field still used when a zone config exists for that line.

## Performance (manual)

- Open **Chrome DevTools** → **Performance**; type quickly in the quantity field for several seconds. Confirm frames stay near 60fps (or main-thread tasks stay short) with no long tasks on each keypress. Optional: **React DevTools** Profiler to confirm `UniversalCountInput` does not show excessive re-renders.

## Notes

- Conversion audit fields (`counted_as`, `counted_value`, `conversion_formula`) are written on save when using the universal path; legacy saves do not clear those unless `current_stock` is cleared.
