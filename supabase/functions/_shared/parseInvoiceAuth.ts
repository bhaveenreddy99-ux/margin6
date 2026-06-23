// Pure auth-triage helpers for the parse-invoice edge function (S0-1).
// No Deno / network imports so the logic is unit-testable under vitest while
// the Deno function imports it directly. The async user-validation and
// restaurant_members membership check stay in the handler; this module only
// decides which path a request takes based on its bearer token.

/** Extract the bearer token from an Authorization header, or "" if absent/malformed. */
export function extractBearerToken(authHeader: string | null | undefined): string {
  const header = authHeader ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

/**
 * Triage a request's bearer token:
 * - "reject"  → no/empty token; caller must return 401 without doing any work.
 * - "service" → the server-only service-role key (trusted server-to-server
 *               callers: inbound-invoice-email, audit-invoice-anon). Membership
 *               check is skipped.
 * - "user"    → any other token; caller MUST validate the user and confirm
 *               restaurant membership before doing paid work.
 *
 * The anon key (public in the client bundle) is NOT the service key, so it is
 * classified "user" and forced through the membership check — closing the
 * unbounded-spend hole (S0-1).
 */
export function classifyParseInvoiceToken(
  token: string,
  serviceKey: string | undefined,
): "reject" | "service" | "user" {
  if (!token) return "reject";
  if (serviceKey && token === serviceKey) return "service";
  return "user";
}
