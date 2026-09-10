/**
 * Origin allow-listing for the HTTP transports.
 *
 * The MCP Streamable HTTP transport spec requires servers to validate the
 * `Origin` header so a page in a victim's browser cannot drive a locally- or
 * privately-reachable MCP server (DNS rebinding). Only requests that carry an
 * `Origin` are checked: the gateway, container health probes, and CLI callers
 * send none, so server-to-server traffic is unaffected.
 *
 * `ALLOWED_ORIGINS` is a comma-separated list of exact origins (e.g.
 * "https://app.example.com,http://localhost:3000"). Unset, or empty, means no
 * browser origin is allowed. The single value "*" opts back in to allowing any
 * origin, for deployments that intentionally serve browser clients.
 */

export function parseAllowedOrigins(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin !== "");
}

/** True when a request carrying `origin` may be served. */
export function isOriginAllowed(
  origin: string | undefined | null,
  allowed: readonly string[]
): boolean {
  if (!origin) return true; // non-browser caller
  if (allowed.includes("*")) return true;
  return allowed.includes(origin);
}

export const ORIGIN_REJECTED_MESSAGE =
  "Origin not allowed. Set ALLOWED_ORIGINS to the browser origins permitted to " +
  "reach this server.";
