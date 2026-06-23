// Pure service-role auth helper for privileged, non-user edge functions
// (e.g. the process-notifications cron worker — S0-2). No Deno / network
// imports so the logic is unit-testable under vitest while Deno functions
// import it directly.

/** Extract the bearer token from an Authorization header, or "" if absent/malformed. */
export function extractBearerToken(authHeader: string | null | undefined): string {
  const header = authHeader ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

/**
 * True only when the request carries exactly the service-role key as a bearer
 * token. Fails closed when the key is unset/empty. Used to gate cron/server-only
 * functions that have no user JWT — the trusted caller (pg_cron) presents the
 * service-role key in the Authorization header.
 *
 * Exact-token match (stricter than a substring `includes`) avoids prefix/
 * substring edge cases while still accepting the standard `Bearer <key>` shape.
 */
export function isServiceRoleAuthorized(
  authHeader: string | null | undefined,
  serviceKey: string | undefined | null,
): boolean {
  if (!serviceKey) return false;
  return extractBearerToken(authHeader) === serviceKey;
}
