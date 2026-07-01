/**
 * Discriminated result for dashboard loaders.
 *
 * Distinguishes a real query/compute FAILURE from a genuine zero/empty result, so
 * the UI can show "couldn't calculate — tap to retry" instead of a confident $0.
 * (Silent-$0 trust fix — piloted on `loadShrinkageValue`, to roll across all loaders.)
 *
 *   { status: "ok",    value }  → trustworthy result (a real 0 is still ok)
 *   { status: "error", error }  → the underlying query failed; do NOT render as a number
 */
export type LoadOutcome<T> =
  | { status: "ok"; value: T }
  | { status: "error"; error: unknown };

export const ok = <T>(value: T): LoadOutcome<T> => ({ status: "ok", value });
export const failed = (error: unknown): LoadOutcome<never> => ({ status: "error", error });
