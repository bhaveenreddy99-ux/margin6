import { describe, it, expect } from "vitest";
import {
  extractBearerToken,
  isServiceRoleAuthorized,
} from "../../supabase/functions/_shared/serviceAuth";

// S0-2: process-notifications service-role gate. These cover the synchronous
// authorization decision that determines whether the cron engine runs at all.
// The trusted caller (pg_cron) presents the service-role key in the bearer.
// See docs/test-results/s0-2-process-notifications-auth-results.md.

const SERVICE_KEY = "service-role-secret-key";

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

describe("isServiceRoleAuthorized", () => {
  it("rejects a missing Authorization header (no auth)", () => {
    expect(isServiceRoleAuthorized(null, SERVICE_KEY)).toBe(false);
    expect(isServiceRoleAuthorized(undefined, SERVICE_KEY)).toBe(false);
  });

  it("accepts the exact service-role key as a bearer (the cron caller)", () => {
    expect(isServiceRoleAuthorized(`Bearer ${SERVICE_KEY}`, SERVICE_KEY)).toBe(true);
  });

  it("rejects an arbitrary / wrong bearer token", () => {
    expect(isServiceRoleAuthorized("Bearer wrong-token", SERVICE_KEY)).toBe(false);
  });

  it("rejects the public anon key (not the service key)", () => {
    expect(isServiceRoleAuthorized("Bearer eyJ-anon-key-not-the-service-key", SERVICE_KEY)).toBe(false);
  });

  it("fails closed when the service key is unset/empty", () => {
    expect(isServiceRoleAuthorized(`Bearer ${SERVICE_KEY}`, undefined)).toBe(false);
    expect(isServiceRoleAuthorized(`Bearer ${SERVICE_KEY}`, "")).toBe(false);
    expect(isServiceRoleAuthorized(null, undefined)).toBe(false);
  });

  it("rejects the empty bearer the cron sends when its GUC is unset (R1)", () => {
    // pg_cron falls back to `Bearer ` (empty) if app.settings.service_role_key
    // is not set — this MUST be rejected, hence the deploy co-requisite.
    expect(isServiceRoleAuthorized("Bearer ", SERVICE_KEY)).toBe(false);
  });

  it("requires an exact match (no substring/prefix bypass)", () => {
    expect(isServiceRoleAuthorized(`Bearer ${SERVICE_KEY}x`, SERVICE_KEY)).toBe(false);
    expect(isServiceRoleAuthorized(`Bearer ${SERVICE_KEY.slice(0, -1)}`, SERVICE_KEY)).toBe(false);
  });
});
