export type AuditMembership = {
  restaurantId: string;
  role: string;
};

export type AuditUiState = {
  selectedRestaurantId: string | null;
  selectedLocationId: string | null;
};

export type AuditLocation = {
  id: string;
  restaurantId: string;
  isActive: boolean;
  isDefault: boolean;
};

export type AuditLocationAssignment = {
  locationId: string;
  isPrimary: boolean;
};

/** Mirrors RestaurantContext restaurant pick: user_ui_state, then first membership. */
export function pickAuditRestaurantId(
  memberships: AuditMembership[],
  uiState: AuditUiState | null,
): string | null {
  if (memberships.length === 0) return null;

  const selected = uiState?.selectedRestaurantId?.trim();
  if (selected && memberships.some((m) => m.restaurantId === selected)) {
    return selected;
  }

  return memberships[0]!.restaurantId;
}

/** Mirrors RestaurantContext location pick: ui_state, assignments, then default/first active. */
export function pickAuditLocationId(
  restaurantId: string,
  locations: AuditLocation[],
  uiState: AuditUiState | null,
  assignments: AuditLocationAssignment[],
  role: string,
): string | null {
  const scoped = locations.filter(
    (loc) => loc.restaurantId === restaurantId && loc.isActive,
  );
  if (scoped.length === 0) return null;

  if (role === "MANAGER" || role === "STAFF") {
    const allowedIds = new Set(
      assignments
        .filter((a) => scoped.some((loc) => loc.id === a.locationId))
        .map((a) => a.locationId),
    );
    if (allowedIds.size > 0) {
      const uiLocation = uiState?.selectedLocationId?.trim();
      if (uiLocation && allowedIds.has(uiLocation)) {
        return uiLocation;
      }
      const primary = assignments.find((a) => a.isPrimary && allowedIds.has(a.locationId));
      return primary?.locationId ?? [...allowedIds][0] ?? null;
    }
  }

  const uiLocation = uiState?.selectedLocationId?.trim();
  if (uiLocation && scoped.some((loc) => loc.id === uiLocation)) {
    return uiLocation;
  }

  const preferred = scoped.find((loc) => loc.isDefault) ?? scoped[0];
  return preferred?.id ?? null;
}
