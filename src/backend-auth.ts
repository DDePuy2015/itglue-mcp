export const ITGLUE_BACKEND_TOKEN_HEADER = "x-summit-itglue-backend-token";

export type BackendAuthFailure = "not_configured" | "missing_or_invalid";

function constantTimeEqual(expected: Uint8Array, actual: Uint8Array): boolean {
  if (expected.length !== actual.length) return false;

  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected[index] ^ actual[index];
  }
  return difference === 0;
}

async function digest(value: string): Promise<Uint8Array> {
  const input = new TextEncoder().encode(value);
  const hash = await globalThis.crypto.subtle.digest("SHA-256", input);
  return new Uint8Array(hash);
}

/**
 * Validate the proxy-to-provider token without logging or returning its value.
 * The provider fails closed when the token is not configured.
 *
 * Web Crypto is used so the same check works in the Node and Worker entrypoints.
 */
export async function validateBackendToken(
  configuredToken: string | undefined,
  suppliedToken: string | undefined
): Promise<BackendAuthFailure | undefined> {
  if (!configuredToken) return "not_configured";
  if (!suppliedToken) return "missing_or_invalid";

  try {
    const [expected, actual] = await Promise.all([
      digest(configuredToken),
      digest(suppliedToken),
    ]);
    return constantTimeEqual(expected, actual) ? undefined : "missing_or_invalid";
  } catch (err) {
    // Fail closed, but say so: a digest failure means Web Crypto is
    // unavailable in this runtime, which rejects *every* request and is
    // otherwise indistinguishable from a caller sending a wrong token. Only
    // the failure reason is logged — never a token value.
    console.error(
      `[itglue-mcp] Backend token validation could not run (rejecting request): ` +
        `${err instanceof Error ? err.message : String(err)}`
    );
    return "missing_or_invalid";
  }
}
