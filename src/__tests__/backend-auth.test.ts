import { describe, expect, it } from "vitest";
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
});
