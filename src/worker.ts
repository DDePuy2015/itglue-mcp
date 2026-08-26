/**
 * Cloudflare Workers entry point for the IT Glue MCP Server.
 *
 * Serves the full MCP server over the Streamable HTTP transport using the SDK's
 * Web Standard transport (Request/Response), which runs natively on Workers.
 * It reuses the exact same `createMcpServer()` factory as the stdio / Node HTTP
 * entrypoints (see `mcp-server.ts`), so there is no second tool implementation
 * to maintain.
 *
 * IT Glue is called directly over the global `fetch` API (no vendor SDK), so
 * the server runs natively on the Workers runtime.
 *
 * Credentials are resolved per request, in order:
 * 1. Gateway headers (when AUTH_MODE=gateway):
 *    - X-ITGlue-API-Key (or X-API-Key)
 *    - X-ITGlue-JWT
 *    - X-ITGlue-Region  (optional; us, eu, au)
 *    - X-ITGlue-Base-URL (optional)
 * 2. Worker secrets / vars (env mode):
 *    - ITGLUE_API_KEY / X_API_KEY
 *    - ITGLUE_JWT
 *    - ITGLUE_REGION (optional)
 *    - ITGLUE_BASE_URL (optional)
 *
 * `tools/list` and `initialize` work without credentials; only `tools/call`
 * requires them.
 */

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  createMcpServer,
  type GatewayCredentials,
} from "./mcp-server.js";
import {
  ITGLUE_BACKEND_TOKEN_HEADER,
  validateBackendToken,
} from "./backend-auth.js";
import { runWithServerRef } from "./utils/server-ref.js";
import {
  backendAuthResponse,
  credentialsFromHeaders,
  credentialsFromVars,
  MISSING_CREDENTIALS_BODY,
} from "./utils/gateway.js";

export interface Env {
  ITGLUE_API_KEY?: string;
  X_API_KEY?: string;
  ITGLUE_JWT?: string;
  ITGLUE_REGION?: string;
  ITGLUE_BASE_URL?: string;
  ITGLUE_BACKEND_TOKEN?: string;
  AUTH_MODE?: string;
  LOG_LEVEL?: string;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Accept, Authorization, Mcp-Session-Id, MCP-Protocol-Version, X-ITGlue-API-Key, X-API-Key, X-ITGlue-JWT, X-ITGlue-Region, X-ITGlue-Base-URL, X-Summit-ITGlue-Backend-Token",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Shallow, unauthenticated liveness probe.
    if (url.pathname === "/health" || url.pathname === "/healthz") {
      return json({ status: "ok" });
    }

    if (url.pathname === "/ready") {
      const ready = Boolean(env.ITGLUE_BACKEND_TOKEN);
      return json({ status: ready ? "ready" : "not_ready" }, ready ? 200 : 503);
    }

    if (url.pathname === "/mcp") {
      const backendAuthFailure = await validateBackendToken(
        env.ITGLUE_BACKEND_TOKEN,
        request.headers.get(ITGLUE_BACKEND_TOKEN_HEADER) ?? undefined
      );
      if (backendAuthFailure) {
        const { status, body } = backendAuthResponse(backendAuthFailure);
        return json(body, status);
      }

      const isGatewayMode = (env.AUTH_MODE ?? "env") === "gateway";

      let credOverrides: GatewayCredentials | undefined;
      if (isGatewayMode) {
        credOverrides =
          credentialsFromHeaders(
            (name) => request.headers.get(name) ?? undefined
          ) ?? undefined;

        if (!credOverrides) {
          return json(MISSING_CREDENTIALS_BODY, 401);
        }
      } else {
        // env mode: build credentials from Worker secrets if present.
        // (Absent creds are fine — tools/list still works, tools/call errors.)
        credOverrides = credentialsFromVars(env);
      }

      // Fresh server + transport per request (stateless). The server is
      // bound to the per-request async context (not a module-level
      // global) so elicitation helpers resolve *this* request's server
      // even after await gaps, and never a concurrent request's — see
      // utils/server-ref.ts.
      const server = createMcpServer(credOverrides);
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });

      return runWithServerRef(server, async () => {
        await server.connect(transport);

        try {
          const response = await transport.handleRequest(request);
          return withCors(response);
        } finally {
          await transport.close();
          await server.close();
        }
      });
    }

    return json({ error: "Not found", endpoints: ["/mcp", "/health", "/ready"] }, 404);
  },
};
