import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectTestClient, jsonResponse, toolPayload } from "./test-harness.js";

let sessions: Awaited<ReturnType<typeof connectTestClient>>[];
beforeEach(() => {
  sessions = [];
  vi.stubEnv("ITGLUE_API_KEY", "synthetic-ambient-key");
  vi.stubEnv("ITGLUE_JWT", "synthetic-ambient-jwt");
  vi.stubEnv("ITGLUE_REGION", "au");
});
afterEach(async () => {
  await Promise.all(sessions.map((session) => session.close()));
  vi.unstubAllGlobals(); vi.unstubAllEnvs();
});

describe("request-scoped credential isolation", () => {
  it.each([false, true])("isolates keys, JWTs and region through a forced interleave (JWT=%s)", async (jwt) => {
    const a = await connectTestClient({ apiKey: "synthetic-a-key", region: "us", ...(jwt ? { jwt: "synthetic-a-jwt" } : {}) });
    const b = await connectTestClient({ apiKey: "synthetic-b-key", region: "eu" });
    sessions.push(a, b);
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const requests: Array<{ url: URL; headers: Headers }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url: new URL(url), headers: new Headers(init.headers) });
      if (new URL(url).hostname === "api.itglue.com") { entered(); await gate; }
      return jsonResponse({ id: new URL(url).hostname === "api.itglue.com" ? "101" : "202", type: "organizations", attributes: {} });
    }));
    const pendingA = a.client.callTool({ name: "get_organization", arguments: { id: 101 } });
    try {
      await started;
      const resultB = await b.client.callTool({ name: "get_organization", arguments: { id: 202 } });
      expect(toolPayload(resultB).id).toBe("202");
      release();
      expect(toolPayload(await pendingA).id).toBe("101");
      expect(requests).toHaveLength(2);
      expect(requests.map((request) => request.url.hostname)).toEqual(["api.itglue.com", "api.eu.itglue.com"]);
      expect(requests[0].headers.get("Authorization")).toBe(jwt ? "Bearer synthetic-a-jwt" : null);
      expect(requests[0].headers.get("x-api-key")).toBe(jwt ? null : "synthetic-a-key");
      expect(requests[1].headers.get("x-api-key")).toBe("synthetic-b-key");
      expect(requests[1].headers.get("Authorization")).toBeNull();
      for (const request of requests) {
        expect(Array.from(request.headers.values()).join(" ")).not.toContain("ambient");
        expect(request.url.hostname).not.toBe("api.au.itglue.com");
      }
    } finally { release(); await pendingA; }
  });

  it("resolves three instances independently when invoked out of construction order", async () => {
    for (const suffix of ["a", "b", "c"]) sessions.push(await connectTestClient({ apiKey: `synthetic-${suffix}-key`, baseUrl: `https://${suffix}.example.test` }));
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => jsonResponse({ id: "101", type: "organizations", attributes: {} }));
    vi.stubGlobal("fetch", fetchMock);
    for (const index of [1, 0, 2, 0]) await sessions[index].client.callTool({ name: "get_organization", arguments: { id: 101 } });
    expect(fetchMock.mock.calls.map((call) => new URL(call[0]).hostname)).toEqual(["b.example.test", "a.example.test", "c.example.test", "a.example.test"]);
    expect(fetchMock.mock.calls.map((call) => new Headers(call[1].headers).get("x-api-key"))).toEqual(["synthetic-b-key", "synthetic-a-key", "synthetic-c-key", "synthetic-a-key"]);
  });
});
