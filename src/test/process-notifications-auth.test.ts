import { describe, it, expect } from "vitest";
import {
  extractBearerToken,
  bearerHasServiceRole,
} from "../../supabase/functions/_shared/serviceAuth";

// S0-2: process-notifications service-role gate. The function is deployed with
// verify_jwt = true, so Supabase's gateway cryptographically validates the JWT
// before the handler runs; bearerHasServiceRole then enforces role = service_role.
// The trusted caller (pg_cron) presents a service_role token in the bearer.
// See docs/test-results/s0-2-process-notifications-auth-results.md.

// Build an UNSIGNED JWT (header.payload.sig) with the given claims. The signature
// is a placeholder — bearerHasServiceRole never checks it (verify_jwt=true means
// the gateway already validated the real signature before the handler runs).
function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.sig`;
}

describe("extractBearerToken", () => {
  it("returns the token from a well-formed Bearer header", () => {
    expect(extractBearerToken("Bearer abc.def.ghi")).toBe("abc.def.ghi");
  });

  it("returns empty string for missing/non-Bearer/bare headers", () => {
    expect(extractBearerToken(null)).toBe("");
    expect(extractBearerToken(undefined)).toBe("");
    expect(extractBearerToken("Basic abc")).toBe("");
    expect(extractBearerToken("Bearer ")).toBe("");
  });
});

describe("bearerHasServiceRole", () => {
  it("accepts a validly-shaped service_role token (the cron caller)", () => {
    expect(bearerHasServiceRole(`Bearer ${jwt({ role: "service_role", ref: "proj" })}`)).toBe(true);
  });

  it("rejects a missing Authorization header (no auth)", () => {
    expect(bearerHasServiceRole(null)).toBe(false);
    expect(bearerHasServiceRole(undefined)).toBe(false);
  });

  it("rejects the public anon token (wrong role)", () => {
    expect(bearerHasServiceRole(`Bearer ${jwt({ role: "anon" })}`)).toBe(false);
  });

  it("rejects a normal authenticated user token (wrong role)", () => {
    expect(bearerHasServiceRole(`Bearer ${jwt({ role: "authenticated", sub: "user-123" })}`)).toBe(false);
  });

  it("rejects a token with no role claim", () => {
    expect(bearerHasServiceRole(`Bearer ${jwt({ sub: "x" })}`)).toBe(false);
  });

  it("rejects the empty bearer the cron would send if its key is unset", () => {
    expect(bearerHasServiceRole("Bearer ")).toBe(false);
  });

  it("rejects a non-JWT / malformed bearer (fails closed)", () => {
    expect(bearerHasServiceRole("Bearer not-a-jwt")).toBe(false);
    expect(bearerHasServiceRole("Bearer a.b")).toBe(false);
    expect(bearerHasServiceRole("Bearer ...")).toBe(false);
  });
});
