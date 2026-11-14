import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ITGlueClient } from "../mcp-server.js";
import { connectTestClient, jsonResponse } from "./test-harness.js";

const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset().mockResolvedValue(jsonResponse([])); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());

describe("page size at the outbound serialization boundary", () => {
  it.each([
    [5000, "1000"], [1000, "1000"], [17.9, "17"], [1, "1"],
    [0, null], [-1, null], [0.9, null], [NaN, null], [Infinity, null],
    ["5000", null], [undefined, null], [null, null],
  ])("serializes size %s as %s through ITGlueClient", async (size, expected) => {
    await new ITGlueClient({ apiKey: "synthetic-test-key" }).request("/organizations", { page: { size, number: 2 } });
    const params = new URL(fetchMock.mock.calls[0][0]).searchParams;
    expect(params.get("page[size]")).toBe(expected);
    expect(params.get("page[number]")).toBe("2");
  });

  it("clamps a tool caller's oversized page without relying on schema descriptions", async () => {
    const session = await connectTestClient();
    try {
      const result = await session.client.callTool({ name: "search_organizations", arguments: { page_size: 5000 } });
      expect(result.isError).not.toBe(true);
      expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get("page[size]")).toBe("1000");
    } finally { await session.close(); }
  });
});
