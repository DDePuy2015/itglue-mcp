/**
 * Round-trip coverage for the focused adaptation of WYRE-AI/itglue-mcp
 * 40c2c25036e437be8b4802b98b6b2e73a307f384. All upstream HTTP calls are mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer, searchByNameWithFallback } from "../index.js";

const mockFetch = vi.fn();
const clients: Client[] = [];

function record(id: string, name: unknown, extra: Record<string, unknown> = {}) {
  return { id, type: "fixture", attributes: { name, ...extra } };
}

function page(data: ReturnType<typeof record>[] = [], number = 1, next: number | null = null) {
  return new Response(JSON.stringify({
    data,
    meta: {
      "current-page": number,
      "next-page": next,
      "prev-page": number > 1 ? number - 1 : null,
      "total-pages": next ?? number,
      "total-count": data.length,
    },
  }), { status: 200 });
}

function error(status: number) {
  return new Response("fixture provider error", { status });
}

async function connect(credentials = { apiKey: "fixture-api-key" }) {
  const server = createMcpServer(credentials);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "name-search-test", version: "1.0.0" });
  await client.connect(clientTransport);
  clients.push(client);
  return client;
}

function text(result: unknown): string {
  return (result as { content: Array<{ text: string }> }).content[0].text;
}

function payload(result: unknown) {
  const value = text(result);
  return JSON.parse(value.slice(value.indexOf("{\n"))) as {
    data: Array<Record<string, unknown>>;
    meta: { totalCount: number; currentPage: number; nextPage: number | null; totalPages: number };
  };
}

function url(index: number) {
  return new URL(mockFetch.mock.calls[index][0] as string);
}

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  vi.unstubAllGlobals();
});

describe.each([
  { tool: "search_organizations", scope: {}, path: "/organizations" },
  { tool: "search_documents", scope: { organization_id: 123 }, path: "/organizations/123/relationships/documents" },
])("$tool name fallback", ({ tool, scope, path }) => {
  it("matches case-insensitive substrings only after an empty exact search", async () => {
    const client = await connect();
    mockFetch.mockResolvedValueOnce(page()).mockResolvedValueOnce(page([
      record("1", "ACME Operations"), record("2", "Beta"), record("3", null),
    ]));
    const result = await client.callTool({ name: tool, arguments: { ...scope, name: "acme" } });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(url(0).searchParams.get("filter[name]")).toBe("acme");
    expect(url(1).searchParams.has("filter[name]")).toBe(false);
    expect(url(1).searchParams.get("page[size]")).toBe("1000");
    expect(url(1).pathname).toBe(path);
    expect(payload(result).data.map((item) => item.id)).toEqual(["1"]);
    expect(text(result)).toContain("client-side, case-insensitive");
    expect(text(result)).not.toContain("capped");
  });

  it("keeps exact hits on the single-request fast path", async () => {
    const client = await connect();
    mockFetch.mockResolvedValueOnce(page([record("1", "Acme")]));
    const result = await client.callTool({ name: tool, arguments: { ...scope, name: "Acme" } });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(payload(result).data).toHaveLength(1);
    expect(text(result)).not.toContain("client-side");
  });

  it("does not scan an empty listing without a name", async () => {
    const client = await connect();
    mockFetch.mockResolvedValueOnce(page());
    // The organization type avoids the existing interactive name prompt.
    const args = tool === "search_organizations" ? { organization_type_id: 7 } : scope;
    const result = await client.callTool({ name: tool, arguments: args });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(text(result)).not.toContain("client-side");
  });

  it("preserves an empty exact page when exact matches exist on earlier pages", async () => {
    const client = await connect();
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      data: [], meta: { "current-page": 2, "next-page": null, "total-pages": 1, "total-count": 1 },
    }), { status: 200 }));
    const result = await client.callTool({
      name: tool, arguments: { ...scope, name: "Acme", page_size: 50, page_number: 2 },
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(payload(result)).toMatchObject({ data: [], meta: { currentPage: 2, totalCount: 1 } });
    expect(text(result)).not.toContain("client-side");
  });

  it("collects multiple listing pages before slicing the caller's result page", async () => {
    const client = await connect();
    mockFetch.mockResolvedValueOnce(page())
      .mockResolvedValueOnce(page([record("1", "Acme One"), record("x", "Beta")], 1, 2))
      .mockResolvedValueOnce(page([record("2", "Acme Two"), record("3", "Acme Three")], 2));
    const result = await client.callTool({
      name: tool, arguments: { ...scope, name: "acme", page_size: 2, page_number: 2, sort: "name" },
    });
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(url(0).searchParams.get("page[number]")).toBe("2");
    expect(url(1).searchParams.get("page[number]")).toBe("1");
    expect(url(2).searchParams.get("page[number]")).toBe("2");
    for (const index of [1, 2]) {
      expect(url(index).pathname).toBe(path);
      expect(url(index).searchParams.get("sort")).toBe("name");
    }
    expect(payload(result)).toMatchObject({
      data: [{ id: "3" }],
      meta: { totalCount: 3, totalPages: 2, currentPage: 2, nextPage: null },
    });
  });

  it("stops after five listing pages and labels the partial totals", async () => {
    const client = await connect();
    mockFetch.mockResolvedValueOnce(page());
    for (let number = 1; number <= 5; number++) {
      mockFetch.mockResolvedValueOnce(page([record(String(number), "Acme")], number, number + 1));
    }
    const result = await client.callTool({ name: tool, arguments: { ...scope, name: "acme" } });
    expect(mockFetch).toHaveBeenCalledTimes(6);
    expect(payload(result).meta.totalCount).toBe(5);
    expect(text(result)).toContain("capped at 5 pages");
    expect(text(result)).toContain("totals describe only matches in the scanned pages");
  });

  it("returns an empty completed fallback without claiming truncation", async () => {
    const client = await connect();
    mockFetch.mockResolvedValueOnce(page()).mockResolvedValueOnce(page([record("1", "Beta")]));
    const result = await client.callTool({ name: tool, arguments: { ...scope, name: "acme" } });
    expect(payload(result)).toMatchObject({ data: [], meta: { totalCount: 0, nextPage: null } });
    expect(text(result)).not.toContain("capped");
  });

  it.each([401, 403, 429, 500])("does not broaden the search after HTTP %s", async (status) => {
    const client = await connect();
    mockFetch.mockResolvedValueOnce(error(status));
    const result = await client.callTool({ name: tool, arguments: { ...scope, name: "acme" } });
    expect(result.isError).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("propagates a fallback failure instead of returning partial success", async () => {
    const client = await connect();
    mockFetch.mockResolvedValueOnce(page())
      .mockResolvedValueOnce(page([record("1", "Acme")], 1, 2))
      .mockResolvedValueOnce(error(403));
    const result = await client.callTool({ name: tool, arguments: { ...scope, name: "acme" } });
    expect(result.isError).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(text(result)).not.toContain('"id": "1"');
  });
});

describe("preserved search boundaries", () => {
  it("preserves organization type, status, PSA filter, sort and request credentials", async () => {
    const client = await connect();
    mockFetch.mockResolvedValueOnce(page()).mockResolvedValueOnce(page([record("1", "Acme")]));
    await client.callTool({ name: "search_organizations", arguments: {
      name: "acme", organization_type_id: 7, organization_status_id: 8, psa_id: "fixture-psa", sort: "-name",
    } });
    expect(url(1).searchParams.get("filter[organization-type-id]")).toBe("7");
    expect(url(1).searchParams.get("filter[organization-status-id]")).toBe("8");
    expect(url(1).searchParams.get("filter[psa-id]")).toBe("fixture-psa");
    expect(url(1).searchParams.get("sort")).toBe("-name");
    for (const call of mockFetch.mock.calls) {
      expect((call[1] as RequestInit).headers).toMatchObject({ "x-api-key": "fixture-api-key" });
    }
  });

  it("retains explicit document folder/organization scope and omits document bodies", async () => {
    const client = await connect();
    mockFetch.mockResolvedValueOnce(page()).mockResolvedValueOnce(page([
      record("1", "Acme SOP", { "document-folder-id": 42, content: [{ content: "BODY_FIXTURE" }] }),
    ]));
    const result = await client.callTool({ name: "search_documents", arguments: {
      organization_id: 123, document_folder_id: 42, name: "acme", sort: "-name",
    } });
    for (const index of [0, 1]) {
      expect(url(index).pathname).toBe("/organizations/123/relationships/documents");
      expect(url(index).searchParams.get("filter[document-folder-id]")).toBe("42");
      expect(url(index).searchParams.has("filter[document_folder_id]")).toBe(false);
      expect(url(index).searchParams.get("sort")).toBe("-name");
    }
    expect(payload(result).data[0].documentFolderId).toBe(42);
    expect(text(result)).not.toContain("BODY_FIXTURE");
    expect(text(result)).not.toContain("ROOT-LEVEL");
    expect(text(result)).not.toContain("includes documents inside folders");
  });

  it("warns about root-only scope if any fallback page degrades", async () => {
    const client = await connect();
    mockFetch.mockResolvedValueOnce(page())
      .mockResolvedValueOnce(page([record("1", "Acme Foldered")], 1, 2))
      .mockResolvedValueOnce(error(400)).mockResolvedValueOnce(error(422))
      .mockResolvedValueOnce(page([record("2", "Acme Root")], 2));
    const result = await client.callTool({ name: "search_documents", arguments: { organization_id: 123, name: "acme" } });
    expect(mockFetch).toHaveBeenCalledTimes(5);
    expect(url(1).searchParams.get("filter[document_folder_id]")).toBe("null");
    expect(url(3).searchParams.has("filter[document_folder_id][ne]")).toBe(true);
    expect(text(result)).toContain("ROOT-LEVEL");
    expect(text(result)).toContain("folder coverage is incomplete");
    expect(text(result)).not.toContain("contains only ROOT-LEVEL");
    expect(text(result)).not.toContain("includes documents inside folders");
    expect(payload(result).data).toHaveLength(2);
  });

  it("reports root-only scope when every fallback page degrades", async () => {
    const client = await connect();
    mockFetch.mockResolvedValueOnce(page())
      .mockResolvedValueOnce(error(400)).mockResolvedValueOnce(error(422))
      .mockResolvedValueOnce(page([record("1", "Acme Root")]));
    const result = await client.callTool({ name: "search_documents", arguments: { organization_id: 123, name: "acme" } });
    expect(mockFetch).toHaveBeenCalledTimes(4);
    expect(text(result)).toContain("contains only ROOT-LEVEL");
    expect(text(result)).not.toContain("includes documents inside folders");
  });

  it("uses the fallback's folder-inclusive scope instead of the primary root-only note", async () => {
    const client = await connect();
    mockFetch.mockResolvedValueOnce(error(400)).mockResolvedValueOnce(error(422))
      .mockResolvedValueOnce(page())
      .mockResolvedValueOnce(error(400))
      .mockResolvedValueOnce(page([record("1", "Acme Foldered", { content: ["BODY_FIXTURE"] })]));
    const result = await client.callTool({ name: "search_documents", arguments: { organization_id: 123, name: "acme" } });
    expect(mockFetch).toHaveBeenCalledTimes(5);
    expect(text(result)).toContain("includes documents inside folders");
    expect(text(result)).not.toContain("ROOT-LEVEL");
    expect(text(result)).not.toContain("BODY_FIXTURE");
  });

  it("still rejects a document search without organization_id before any fetch", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "search_documents", arguments: { name: "acme" } });
    expect(result.isError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("keeps each server's credentials isolated across overlapping fallback requests", async () => {
    const a = await connect({ apiKey: "fixture-tenant-a" });
    const b = await connect({ apiKey: "fixture-tenant-b" });
    let releaseA!: () => void;
    const gateA = new Promise<void>((resolve) => { releaseA = resolve; });
    let enteredA!: () => void;
    const startedA = new Promise<void>((resolve) => { enteredA = resolve; });
    const observed: string[] = [];
    mockFetch.mockImplementation(async (requestUrl: string, init: RequestInit) => {
      const key = (init.headers as Record<string, string>)["x-api-key"];
      observed.push(key);
      if (new URL(requestUrl).searchParams.has("filter[name]")) {
        if (key === "fixture-tenant-a") { enteredA(); await gateA; }
        return page();
      }
      return page([record(key, "Acme")]);
    });
    const resultA = a.callTool({ name: "search_organizations", arguments: { name: "acme" } });
    await startedA;
    const resultB = await b.callTool({ name: "search_organizations", arguments: { name: "acme" } });
    releaseA();
    expect(payload(await resultA).data[0].id).toBe("fixture-tenant-a");
    expect(payload(resultB).data[0].id).toBe("fixture-tenant-b");
    expect(observed).toEqual(["fixture-tenant-a", "fixture-tenant-b", "fixture-tenant-b", "fixture-tenant-a"]);
  });
});

it("does not mark a fully exhausted fifth listing page as capped", async () => {
  const fetchPage = vi.fn(async (requested: { size: number; number: number }) => ({
    data: [{ name: "Acme" }],
    meta: { currentPage: requested.number, nextPage: requested.number < 5 ? requested.number + 1 : null,
      prevPage: null, totalPages: 5, totalCount: 5 },
  }));
  const result = await searchByNameWithFallback(fetchPage, "acme", { size: 2, number: 1 });
  expect(result.capped).toBe(false);
  expect(result.meta).toMatchObject({ totalCount: 5, totalPages: 3, nextPage: 2 });
  expect(result.data).toHaveLength(2);
  expect(fetchPage).toHaveBeenCalledTimes(5);
  expect(fetchPage).toHaveBeenLastCalledWith({ size: 1000, number: 5 });
});
