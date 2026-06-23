import { describe, it, expect } from "vitest";
import { extractSvixHeaders } from "../../supabase/functions/_shared/webhookAuth";

// S0-3: inbound-invoice-email Resend/Svix webhook auth. These cover the
// synchronous header-extraction step that gates verification. The cryptographic
// Svix signature verification itself runs in the Deno handler (it needs the svix
// library and a real signature) and is covered by the manual/deploy matrix in
// docs/completed/s0-3-inbound-invoice-email-auth-summary.md.

/** Build a header accessor from a plain object (case-sensitive, like req.headers.get). */
function getter(headers: Record<string, string | null | undefined>) {
  return (name: string) => headers[name] ?? null;
}

const VALID = {
  "svix-id": "msg_2a3b4c",
  "svix-timestamp": "1700000000",
  "svix-signature": "v1,g0hM9SsE+OT8JmLJU8oM2lQVwQ==",
};

describe("extractSvixHeaders", () => {
  it("returns all three headers when present", () => {
    expect(extractSvixHeaders(getter(VALID))).toEqual(VALID);
  });

  it("returns null when svix-id is missing", () => {
    expect(extractSvixHeaders(getter({ ...VALID, "svix-id": null }))).toBeNull();
  });

  it("returns null when svix-timestamp is missing", () => {
    expect(extractSvixHeaders(getter({ ...VALID, "svix-timestamp": undefined }))).toBeNull();
  });

  it("returns null when svix-signature is missing", () => {
    const { "svix-signature": _omit, ...withoutSig } = VALID;
    expect(extractSvixHeaders(getter(withoutSig))).toBeNull();
  });

  it("returns null when a header is present but empty", () => {
    expect(extractSvixHeaders(getter({ ...VALID, "svix-id": "" }))).toBeNull();
    expect(extractSvixHeaders(getter({ ...VALID, "svix-signature": "" }))).toBeNull();
  });

  it("returns null when no svix headers exist at all", () => {
    expect(extractSvixHeaders(getter({}))).toBeNull();
  });
});
