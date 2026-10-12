import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../worker.js";

const token = "synthetic-sdk-backend-token";
const env: Env = { ITGLUE_BACKEND_TOKEN: token, ITGLUE_API_KEY: "synthetic-key" };
const upstream = vi.fn();

function request(method: string, params: unknown, version: string, suppliedToken = token) {
  return worker.fetch(new Request("http://fixture.invalid/mcp", {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": version,
      ...(suppliedToken ? { "x-summit-itglue-backend-token": suppliedToken } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }), env);
}

describe("SDK transport compatibility with Summit authentication", () => {
  beforeEach(() => {
    upstream.mockReset().mockResolvedValue(new Response(JSON.stringify({
      data: [{ type: "organizations", id: "42", attributes: { name: "Fixture" } }],
      meta: { "current-page": 1, "total-pages": 1, "total-count": 1 },
    }), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", upstream);
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each(["2025-06-18", "2025-11-25"])("preserves initialize, tool discovery and a mocked read on %s", async (version) => {
    const init = await request("initialize", { protocolVersion: version, capabilities: {}, clientInfo: { name: "fixture", version: "0" } }, version);
    expect(init.status).toBe(200);
    expect((await init.json()).result.protocolVersion).toBe(version);
    const list = await request("tools/list", {}, version);
    expect(list.status).toBe(200);
    expect((await list.json()).result.tools.map((tool: { name: string }) => tool.name)).toContain("search_organizations");
    const read = await request("tools/call", { name: "search_organizations", arguments: { name: "Fixture" } }, version);
    expect(read.status).toBe(200);
    const result = (await read.json()).result;
    expect(result.isError).not.toBe(true);
    expect(result.content[0].text).toContain("Fixture");
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it.each(["", "wrong-synthetic-token"])("rejects unauthenticated reads before the mocked provider (%s)", async (suppliedToken) => {
    const response = await request("tools/call", { name: "search_organizations", arguments: { name: "Fixture" } }, "2025-06-18", suppliedToken);
    expect(response.status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });
});
