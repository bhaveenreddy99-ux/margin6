/** PFG weight-sold items: per-lb rate in unit_cost, case price in line_total. */
export function resolveUnitCost(
  unitCost: number | null,
  lineTotal: number | null,
  quantity: number,
  _packSize: string | null,
): number | null {
  if (unitCost == null) {
    return lineTotal && quantity > 0 ? lineTotal / quantity : null;
  }

  if (lineTotal == null || lineTotal <= 0) return unitCost;

  const expectedLineTotal = unitCost * quantity;
  if (expectedLineTotal <= 0) return unitCost;

  const ratio = lineTotal / expectedLineTotal;

  // Per-lb rate stored as unit_cost — true case price is line_total / quantity.
  if (ratio > 3 && quantity > 0) {
    return Math.round((lineTotal / quantity) * 100) / 100;
  }

  return unitCost;
}

export function applyWeightItemUnitCostCorrection(
  items: unknown[],
): Record<string, unknown>[] {
  return items.map((raw) => {
    if (!raw || typeof raw !== "object") return raw as Record<string, unknown>;
    const row = raw as Record<string, unknown>;
    const qty = Number(row.quantity) || 0;
    const unitCost = row.unit_cost != null ? Number(row.unit_cost) : null;
    const lineTotal = row.line_total != null ? Number(row.line_total) : null;
    const packSize = row.pack_size != null ? String(row.pack_size) : null;
    const correctedUnitCost = resolveUnitCost(
      Number.isFinite(unitCost as number) ? unitCost : null,
      Number.isFinite(lineTotal as number) ? lineTotal : null,
      qty,
      packSize,
    );

    const totalCost =
      lineTotal != null && Number.isFinite(lineTotal)
        ? lineTotal
        : correctedUnitCost != null && qty > 0
          ? Math.round(correctedUnitCost * qty * 100) / 100
          : row.line_total;

    return {
      ...row,
      unit_cost: correctedUnitCost,
      line_total: totalCost,
    };
  });
}
