// Pure service-role auth helper for privileged, non-user edge functions
// (e.g. the process-notifications cron worker — S0-2). No Deno / network
// imports so the logic is unit-testable under vitest while Deno functions
// import it directly.

/** Extract the bearer token from an Authorization header, or "" if absent/malformed. */
export function extractBearerToken(authHeader: string | null | undefined): string {
  const header = authHeader ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

/** Decode a JWT's payload segment WITHOUT verifying its signature. Returns null
 *  for anything that isn't a well-formed three-part JWT with a JSON payload. */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64.padEnd(Math.ceil(b64.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * True only when the bearer token is a JWT whose `role` claim is `service_role`.
 *
 * SECURITY CONTRACT: this decodes the token but does NOT verify its signature, so
 * it is ONLY safe when the function is deployed with `verify_jwt = true`. In that
 * mode Supabase's gateway cryptographically validates the JWT before the request
 * reaches the handler — a forged/tampered token is rejected with 401 at the edge
 * and never gets here. This then rejects any validly-signed-but-wrong-role token
 * (anon, or a normal user JWT). Unlike an exact service-role-key string match, it
 * accepts ANY validly-signed service_role token, so it survives JWT-key rotation
 * and the legacy↔new-API-key drift that broke the old gate.
 */
export function bearerHasServiceRole(authHeader: string | null | undefined): boolean {
  const token = extractBearerToken(authHeader);
  if (!token) return false;
  const payload = decodeJwtPayload(token);
  return payload?.role === "service_role";
}
