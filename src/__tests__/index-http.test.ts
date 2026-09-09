/**
 * Tests for the Node HTTP transport in src/index.ts (`startHttpTransport`).
 *
 * Boots the real HTTP listener on an ephemeral port and drives it with
 * fetch, covering the health/readiness probes, method and auth gating on
 * /mcp (backend token, gateway credentials, S2S), and a full stateless
 * initialize round trip.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHmac } from "node:crypto";
import type { Server as NodeHttpServer } from "node:http";
import type { AddressInfo } from "node:net";

const originalEnv = { ...process.env };
const startedServers: NodeHttpServer[] = [];

const MCP_HEADERS = {
  Accept: "application/json, text/event-stream",
  "Content-Type": "application/json",
  "X-Summit-ITGlue-Backend-Token": "backend-secret",
};

const INITIALIZE_BODY = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "index-http-test", version: "1.0.0" },
  },
});

async function startServer(): Promise<string> {
  const { startHttpTransport } = await import("../index.js");
  const server = await startHttpTransport();
  startedServers.push(server);
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

// startHttpTransport registers SIGINT/SIGTERM shutdown handlers on each
// call; snapshot the listeners so afterEach can drop the ones added by the
// server under test (avoids MaxListenersExceededWarning across tests).
let sigintListeners: NodeJS.SignalsListener[] = [];
let sigtermListeners: NodeJS.SignalsListener[] = [];

beforeEach(() => {
  vi.resetModules();
  sigintListeners = process.listeners("SIGINT");
  sigtermListeners = process.listeners("SIGTERM");
  process.env.MCP_HTTP_PORT = "0";
  process.env.MCP_HTTP_HOST = "127.0.0.1";
  delete process.env.AUTH_MODE;
  delete process.env.CONDUIT_S2S_SECRET;
  process.env.ITGLUE_BACKEND_TOKEN = "backend-secret";
});

afterEach(async () => {
  await Promise.all(
    startedServers.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve()))
    )
  );
  process.env = { ...originalEnv };
  for (const listener of process.listeners("SIGINT")) {
    if (!sigintListeners.includes(listener)) process.removeListener("SIGINT", listener);
  }
  for (const listener of process.listeners("SIGTERM")) {
    if (!sigtermListeners.includes(listener)) process.removeListener("SIGTERM", listener);
  }
});

describe("startHttpTransport", () => {
  it("serves the health probe without auth and reports the auth mode", async () => {
    const base = await startServer();
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.transport).toBe("http");
    expect(body.authMode).toBe("env");
  });

  it("reports gateway auth mode when AUTH_MODE=gateway", async () => {
    process.env.AUTH_MODE = "gateway";
    const base = await startServer();
    const res = await fetch(`${base}/health`);
    expect((await res.json()).authMode).toBe("gateway");
  });

  it("reports readiness only when the backend token is configured", async () => {
    const base = await startServer();

    const ready = await fetch(`${base}/ready`);
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ status: "ready" });

    delete process.env.ITGLUE_BACKEND_TOKEN;
    const notReady = await fetch(`${base}/ready`);
    expect(notReady.status).toBe(503);
    expect(await notReady.json()).toEqual({ status: "not_ready" });
  });

  it("returns 404 with the endpoint list for unknown paths", async () => {
    const base = await startServer();
    const res = await fetch(`${base}/nope`);
    expect(res.status).toBe(404);
    expect((await res.json()).endpoints).toEqual(["/mcp", "/health", "/ready"]);
  });

  it("rejects non-POST requests to /mcp with 405", async () => {
    const base = await startServer();
    const res = await fetch(`${base}/mcp`, { headers: MCP_HEADERS });
    expect(res.status).toBe(405);
    expect((await res.json()).error.code).toBe(-32000);
  });

  it("fails closed with 503 when no backend token is configured", async () => {
    delete process.env.ITGLUE_BACKEND_TOKEN;
    const base = await startServer();
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: MCP_HEADERS,
      body: INITIALIZE_BODY,
    });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("Backend authentication is not configured.");
  });

  it("rejects an invalid backend token with 401", async () => {
    const base = await startServer();
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { ...MCP_HEADERS, "X-Summit-ITGlue-Backend-Token": "wrong-token" },
      body: INITIALIZE_BODY,
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Backend authentication failed.");
  });

  it("requires gateway credential headers in gateway mode", async () => {
    process.env.AUTH_MODE = "gateway";
    const base = await startServer();
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: MCP_HEADERS,
      body: INITIALIZE_BODY,
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Missing credentials");
    expect(body.required).toEqual(["X-ITGlue-API-Key OR X-ITGlue-JWT"]);
  });

  it("completes a stateless initialize round trip in gateway mode", async () => {
    process.env.AUTH_MODE = "gateway";
    const base = await startServer();
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { ...MCP_HEADERS, "X-ITGlue-API-Key": "test-api-key" },
      body: INITIALIZE_BODY,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.serverInfo.name).toBe("itglue-mcp");
    expect(body.result.capabilities).toMatchObject({
      tools: {},
      prompts: {},
      resources: {},
    });
  });

  describe("S2S enforcement (CONDUIT_S2S_SECRET set)", () => {
    const S2S_SECRET = "test-s2s-secret";

    function signedS2sHeader(secret: string): string {
      const t = Math.floor(Date.now() / 1000);
      const signature = createHmac("sha256", secret).update(`t=${t}`).digest("hex");
      return `t=${t},v1=${signature}`;
    }

    beforeEach(() => {
      // The module reads CONDUIT_S2S_SECRET at import time; vi.resetModules()
      // in the outer beforeEach ensures each test gets a fresh import.
      process.env.CONDUIT_S2S_SECRET = S2S_SECRET;
    });

    it("rejects /mcp requests without an S2S header", async () => {
      const base = await startServer();
      const res = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: MCP_HEADERS,
        body: INITIALIZE_BODY,
      });
      expect(res.status).toBe(401);
      expect((await res.json()).error).toMatch(/X-Gateway-S2S/);
    });

    it("rejects /mcp requests signed with the wrong secret", async () => {
      const base = await startServer();
      const res = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: { ...MCP_HEADERS, "X-Gateway-S2S": signedS2sHeader("some-other-secret") },
        body: INITIALIZE_BODY,
      });
      expect(res.status).toBe(401);
    });

    it("accepts /mcp requests carrying a valid S2S signature", async () => {
      process.env.AUTH_MODE = "gateway";
      const base = await startServer();
      const res = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: {
          ...MCP_HEADERS,
          "X-Gateway-S2S": signedS2sHeader(S2S_SECRET),
          "X-ITGlue-API-Key": "test-api-key",
        },
        body: INITIALIZE_BODY,
      });
      expect(res.status).toBe(200);
      expect((await res.json()).result.serverInfo.name).toBe("itglue-mcp");
    });
  });
});
