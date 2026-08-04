/**
 * Tests for the Cloudflare Workers entrypoint.
 *
 * Drives the exported `fetch` handler directly with Web Standard Request objects
 * (available natively in Node 18+), exercising the same WebStandardStreamableHTTP
 * transport the Worker uses in production.
 */

import { describe, it, expect } from "vitest";
import worker, { type Env } from "../worker.js";

const MCP_HEADERS = {
  Accept: "application/json, text/event-stream",
  "Content-Type": "application/json",
  "X-Summit-ITGlue-Backend-Token": "backend-secret",
};

const DEFAULT_ENV: Env = {
  ITGLUE_BACKEND_TOKEN: "backend-secret",
};

async function mcp(
  body: unknown,
  env: Env = DEFAULT_ENV,
  headers: Record<string, string> = {}
): Promise<Response> {
  return worker.fetch(
    new Request("http://worker.local/mcp", {
      method: "POST",
      headers: { ...MCP_HEADERS, ...headers },
      body: JSON.stringify(body),
    }),
    env
  );
}

describe("Cloudflare Worker entrypoint", () => {
  it("serves a shallow health probe", async () => {
    const res = await worker.fetch(new Request("http://worker.local/health"), {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("reports readiness only when the backend token is configured", async () => {
    const notReady = await worker.fetch(
      new Request("http://worker.local/ready"),
      {}
    );
    expect(notReady.status).toBe(503);

    const ready = await worker.fetch(
      new Request("http://worker.local/ready"),
      DEFAULT_ENV
    );
    expect(ready.status).toBe(200);
  });

  it("rejects MCP requests when the backend token is missing", async () => {
    const res = await mcp(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {},
      },
      { ITGLUE_BACKEND_TOKEN: "" }
    );
    expect(res.status).toBe(503);
  });

  it("rejects MCP requests with an invalid backend token", async () => {
    const res = await worker.fetch(
      new Request("http://worker.local/mcp", {
        method: "POST",
        headers: {
          ...MCP_HEADERS,
          "x-summit-itglue-backend-token": "wrong-token",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {},
        }),
      }),
      DEFAULT_ENV
    );
    expect(res.status).toBe(401);
  });

  it("answers CORS preflight", async () => {
    const res = await worker.fetch(
      new Request("http://worker.local/mcp", { method: "OPTIONS" }),
      {}
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("404s unknown paths", async () => {
    const res = await worker.fetch(new Request("http://worker.local/nope"), {});
    expect(res.status).toBe(404);
  });

  it("handles MCP initialize", async () => {
    const res = await mcp({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "vitest", version: "0" },
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result?: { serverInfo?: { name?: string } };
    };
    expect(body.result?.serverInfo?.name).toBe("itglue-mcp");
  });

  it("lists all tools without credentials", async () => {
    const res = await mcp({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result?: { tools?: { name: string }[] };
    };
    const names = (body.result?.tools ?? []).map((t) => t.name);
    expect(names).toContain("search_organizations");
    expect(names).toContain("itglue_health_check");
    expect(names.length).toBeGreaterThan(10);
  });

  it("returns a graceful error for a credential-requiring tool when unconfigured", async () => {
    const res = await mcp({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "search_organizations", arguments: {} },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result?: { isError?: boolean; content?: { text?: string }[] };
    };
    expect(body.result?.isError).toBe(true);
    expect(body.result?.content?.[0]?.text).toMatch(/credentials/i);
  });

  it("rejects /mcp in gateway mode without credential headers", async () => {
    const res = await mcp(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "search_organizations", arguments: {} },
      },
      { ...DEFAULT_ENV, AUTH_MODE: "gateway" }
    );
    expect(res.status).toBe(401);
  });
});
