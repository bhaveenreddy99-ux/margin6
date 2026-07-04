import { describe, it, expect } from "vitest";
import {
  classifyParseInvoiceToken,
  extractBearerToken,
} from "../../supabase/functions/_shared/parseInvoiceAuth";

// S0-1: parse-invoice membership auth. These cover the synchronous token
// triage that decides whether a request does paid Anthropic work at all.
// The async user-validation + restaurant_members check stays in the handler
// (verified manually — see docs/test-results/s0-1-parse-invoice-auth-results.md).

describe("extractBearerToken", () => {
  it("returns the token from a well-formed Bearer header", () => {
    expect(extractBearerToken("Bearer abc.def.ghi")).toBe("abc.def.ghi");
  });

  it("returns empty string for a missing header", () => {
    expect(extractBearerToken(null)).toBe("");
    expect(extractBearerToken(undefined)).toBe("");
  });

  it("returns empty string when the scheme is not Bearer", () => {
    expect(extractBearerToken("Basic abc")).toBe("");
    expect(extractBearerToken("abc")).toBe("");
  });

  it("returns empty string for a bare 'Bearer ' with no token", () => {
    expect(extractBearerToken("Bearer ")).toBe("");
  });
});

describe("classifyParseInvoiceToken", () => {
  const SERVICE_KEY = "service-role-secret-key";

  it("rejects an empty token (no auth)", () => {
    expect(classifyParseInvoiceToken("", SERVICE_KEY)).toBe("reject");
  });

  it("treats the exact service-role key as a trusted server caller", () => {
    expect(classifyParseInvoiceToken(SERVICE_KEY, SERVICE_KEY)).toBe("service");
  });

  it("treats the public anon key as a user (must pass membership check)", () => {
    // The anon key is a valid project JWT shipped in the client bundle. It must
    // NOT be allowed to bypass — this is the S0-1 hole.
    const anonKey = "eyJ-anon-key-not-the-service-key";
    expect(classifyParseInvoiceToken(anonKey, SERVICE_KEY)).toBe("user");
  });

  it("treats any arbitrary non-service token as a user", () => {
    expect(classifyParseInvoiceToken("garbage", SERVICE_KEY)).toBe("user");
  });

  it("does not grant service bypass when the service key is unset", () => {
    expect(classifyParseInvoiceToken("anything", undefined)).toBe("user");
    expect(classifyParseInvoiceToken("", undefined)).toBe("reject");
  });

  it("requires an exact match for the service bypass (no substring/prefix)", () => {
    expect(classifyParseInvoiceToken(SERVICE_KEY + "x", SERVICE_KEY)).toBe("user");
    expect(classifyParseInvoiceToken(SERVICE_KEY.slice(0, -1), SERVICE_KEY)).toBe("user");
  });
});
