/**
 * Transport-agnostic HTTP entrypoint helpers.
 *
 * The Node HTTP entrypoint (`index.ts`) and the Cloudflare Workers entrypoint
 * (`worker.ts`) expose the same endpoint contract — same gateway credential
 * headers, same backend-auth failures, same error bodies — over two different
 * request types. Both read headers through a lookup function so the contract
 * is defined once here.
 */

import type { GatewayCredentials, ITGlueRegion } from "../mcp-server.js";
import type { BackendAuthFailure } from "../backend-auth.js";

/** Reads a single request header by lowercase name. */
export type HeaderLookup = (name: string) => string | undefined;

/** Body returned when gateway mode gets a request without any credential header. */
export const MISSING_CREDENTIALS_BODY = {
  error: "Missing credentials",
  message: "Gateway mode requires X-ITGlue-API-Key or X-ITGlue-JWT header",
  required: ["X-ITGlue-API-Key OR X-ITGlue-JWT"],
  optional: ["X-ITGlue-Region", "X-ITGlue-Base-URL"],
} as const;

/**
 * Build gateway-mode credential overrides from request headers.
 *
 * Returns null when neither an API key nor a JWT was supplied — gateway mode
 * cannot serve `tools/call` without one, so the caller answers 401 with
 * `MISSING_CREDENTIALS_BODY`.
 */
export function credentialsFromHeaders(
  header: HeaderLookup
): GatewayCredentials | null {
  const apiKey = header("x-itglue-api-key") || header("x-api-key");
  const jwt = header("x-itglue-jwt");
  if (!apiKey && !jwt) return null;
  return {
    apiKey,
    jwt,
    region: (header("x-itglue-region") || "us") as ITGlueRegion,
    baseUrl: header("x-itglue-base-url") || undefined,
  };
}

/** Build env-mode credential overrides, or undefined when none are configured. */
export function credentialsFromVars(vars: {
  ITGLUE_API_KEY?: string;
  X_API_KEY?: string;
  ITGLUE_JWT?: string;
  ITGLUE_REGION?: string;
  ITGLUE_BASE_URL?: string;
}): GatewayCredentials | undefined {
  const apiKey = vars.ITGLUE_API_KEY || vars.X_API_KEY;
  const jwt = vars.ITGLUE_JWT;
  if (!apiKey && !jwt) return undefined;
  return {
    apiKey,
    jwt,
    region: (vars.ITGLUE_REGION || "us") as ITGlueRegion,
    baseUrl: vars.ITGLUE_BASE_URL,
  };
}

/** HTTP status + body for a backend-auth failure, identical on both transports. */
export function backendAuthResponse(failure: BackendAuthFailure): {
  status: number;
  body: { error: string };
} {
  const notConfigured = failure === "not_configured";
  return {
    status: notConfigured ? 503 : 401,
    body: {
      error: notConfigured
        ? "Backend authentication is not configured."
        : "Backend authentication failed.",
    },
  };
}
