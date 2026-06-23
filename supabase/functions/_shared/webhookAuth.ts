// Pure helpers for verifying inbound webhook signatures (Svix / "Standard
// Webhooks" scheme used by Resend — S0-3). No Deno / network imports so the
// header-extraction logic is unit-testable under vitest; the cryptographic
// verification itself lives in the Deno handler (it needs the svix library).

export interface SvixHeaders {
  "svix-id": string;
  "svix-timestamp": string;
  "svix-signature": string;
}

/**
 * Pull the three Svix signature headers from a header accessor (e.g.
 * `(name) => req.headers.get(name)`). Returns the header set only when all
 * three are present and non-empty; otherwise null (caller should reject 400).
 * Svix's verifier requires all three to validate a signature.
 */
export function extractSvixHeaders(
  get: (name: string) => string | null | undefined,
): SvixHeaders | null {
  const id = get("svix-id");
  const timestamp = get("svix-timestamp");
  const signature = get("svix-signature");
  if (!id || !timestamp || !signature) return null;
  return {
    "svix-id": id,
    "svix-timestamp": timestamp,
    "svix-signature": signature,
  };
}
