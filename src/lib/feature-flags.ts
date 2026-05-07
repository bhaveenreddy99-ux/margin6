/**
 * Client-side feature flags. Env vars use the Vite prefix `VITE_` and are read via `import.meta.env`.
 */

export type FeatureFlags = {
  useUniversalCountInput: boolean;
};

/** @deprecated Category scoping removed; universal input is on for all rows unless env forces legacy. */
export const UNIVERSAL_COUNT_INPUT_CATEGORY = "DRY";

/**
 * @param _userId Reserved for future per-user / per-restaurant flags (unused).
 * @param _category Unused; per-item count unit is chosen on each row.
 */
export function getFeatureFlags(_userId: string, _category?: string | null): FeatureFlags {
  if (import.meta.env.VITE_FORCE_OLD_COUNT_UI === "true") {
    return { useUniversalCountInput: false };
  }
  return { useUniversalCountInput: true };
}
