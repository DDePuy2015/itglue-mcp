import { describe, expect, it, vi } from "vitest";
import { validateBackendToken } from "../backend-auth.js";

describe("IT Glue proxy backend authentication", () => {
  it("fails closed when the provider token is not configured", async () => {
    await expect(validateBackendToken(undefined, "token")).resolves.toBe(
      "not_configured"
    );
  });

  it("rejects missing and incorrect tokens", async () => {
    await expect(validateBackendToken("expected", undefined)).resolves.toBe(
      "missing_or_invalid"
    );
    await expect(validateBackendToken("expected", "wrong")).resolves.toBe(
      "missing_or_invalid"
    );
  });

  it("accepts the configured token", async () => {
    await expect(validateBackendToken("expected", "expected")).resolves.toBeUndefined();
  });

  it("fails closed and says so when the digest itself cannot run", async () => {
    // A digest failure rejects every request; without a diagnostic it is
    // indistinguishable from callers sending the wrong token.
    const digest = vi
      .spyOn(globalThis.crypto.subtle, "digest")
      .mockRejectedValue(new Error("unsupported algorithm"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(validateBackendToken("expected", "expected")).resolves.toBe(
        "missing_or_invalid"
      );
      expect(logged).toHaveBeenCalledTimes(1);
      const message = String(logged.mock.calls[0][0]);
      expect(message).toContain("unsupported algorithm");
      // The diagnostic never carries a token value.
      expect(message).not.toContain("expected");
    } finally {
      digest.mockRestore();
      logged.mockRestore();
    }
  });
});
