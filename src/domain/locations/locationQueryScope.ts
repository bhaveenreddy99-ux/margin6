/**
 * Scope queries to a location while still including restaurant-wide rows (location_id IS NULL).
 * PAR guides are restaurant-scoped — do not use this for par_guides.
 */
export function withLocationOrNull<T>(query: T, locationId: string | null | undefined): T {
  if (!locationId) return query;
  return (query as { or: (filters: string) => T }).or(`location_id.eq.${locationId},location_id.is.null`);
}
