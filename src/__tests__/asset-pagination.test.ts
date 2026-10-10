import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FLEXIBLE_ASSET_TOOL_CONFIGS } from "../flexible-assets.js";
import { connectTestClient, jsonResponse, toolPayload, toolText } from "./test-harness.js";

type RecordData = Record<string, unknown>;
let session: Awaited<ReturnType<typeof connectTestClient>>;
let fetchMock: ReturnType<typeof vi.fn>;
const printer = FLEXIBLE_ASSET_TOOL_CONFIGS[0];
const networkTypes = FLEXIBLE_ASSET_TOOL_CONFIGS.slice(2);
const createArgs = { organization_id: 101, fields: { device_name: "Synthetic printer", location_ids: [202] } };
const printerRecord = (id: number, name = `Synthetic printer ${id}`, location = 202) => ({ id: String(id), type: "flexible-assets", attributes: { name, traits: { "device-name": name, location: [location] } } });
const pageMeta = (page: number, pages: number, count: number) => ({ "current-page": page, "next-page": page < pages ? page + 1 : null, "total-pages": pages, "total-count": count });

function mockAssets(page: (number: number, type: number) => { data: RecordData[]; meta?: RecordData }) {
  fetchMock.mockImplementation((url: string, init: RequestInit) => {
    const parsed = new URL(url);
    if (init.method === "POST") return jsonResponse(printerRecord(9999));
    if (parsed.pathname.endsWith("relationships/flexible_asset_fields")) return jsonResponse([], pageMeta(1, 1, 0));
    expect(parsed.pathname).toBe("/flexible_assets");
    expect(parsed.searchParams.get("sort")).toBe("created_at");
    expect(parsed.searchParams.get("filter[organization-id]")).toBe("101");
    const result = page(Number(parsed.searchParams.get("page[number]")), Number(parsed.searchParams.get("filter[flexible-asset-type-id]")));
    return jsonResponse(result.data, result.meta);
  });
}
const writes = () => fetchMock.mock.calls.filter((call) => call[1].method === "POST");

beforeEach(async () => { fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); session = await connectTestClient(); });
afterEach(async () => { await session.close(); vi.unstubAllGlobals(); });

describe("typed asset result-set completeness", () => {
  it("reads beyond 100 per network type without flattening their fields or relationship IDs", async () => {
    mockAssets((page, type) => {
      const config = networkTypes.find((item) => item.schema.typeId === type)!;
      const traits = config === networkTypes[0] ? { provider: "Synthetic ISP", "link-type": "Fiber", "location-s": [202] }
        : config === networkTypes[1] ? { name: "Synthetic VLAN", subnet: "192.0.2.0/24", location: [202] }
        : { "network-name": "Synthetic wireless", ssid: "Synthetic SSID", "physical-location": [202], "pre-shared-key": "SYNTHETIC_REDACTION_MARKER" };
      return {
        data: Array.from({ length: page === 1 ? 100 : 1 }, (_, index) => ({ id: String((page - 1) * 100 + index + 1), type: "flexible-assets", attributes: { name: "Synthetic network service", traits } })),
        meta: pageMeta(page, 2, 101),
      };
    });
    const result = await session.client.callTool({ name: "get_site_network_overview", arguments: { organization_id: 101 } });
    expect(result.isError).not.toBe(true);
    const payload = toolPayload(result);
    expect(payload.complete).toBe(true);
    for (const config of networkTypes) {
      expect(payload[config.schema.name]).toHaveLength(101);
      expect((payload.pagination as RecordData)[config.schema.name]).toMatchObject({ complete: true, pagesFetched: 2, nextPage: null, totalCount: 101 });
    }
    expect((payload[networkTypes[0].schema.name] as RecordData[])[0].fields).toMatchObject({ provider: "Synthetic ISP", link_type: "Fiber", location_ids: [202] });
    expect((payload[networkTypes[1].schema.name] as RecordData[])[0].fields).toMatchObject({ subnet: "192.0.2.0/24", location_ids: [202] });
    expect((payload[networkTypes[2].schema.name] as RecordData[])[0].fields).toMatchObject({ ssid: "Synthetic SSID", physical_location_ids: [202] });
    expect(toolText(result)).not.toContain("SYNTHETIC_REDACTION_MARKER");
  });

  it("reports the five-page overview cap and exposes usable per-type continuation", async () => {
    mockAssets((page) => ({ data: Array.from({ length: 100 }, (_, index) => printerRecord((page - 1) * 100 + index + 1)), meta: pageMeta(page, 6, 600) }));
    const payload = toolPayload(await session.client.callTool({ name: "get_site_network_overview", arguments: { organization_id: 101 } }));
    expect(payload.complete).toBe(false);
    for (const config of networkTypes) expect((payload.pagination as RecordData)[config.schema.name]).toMatchObject({ complete: false, reason: "page_limit", nextPage: 6, pageSize: 100, searchTool: config.searchName });
    const continuation = toolPayload(await session.client.callTool({ name: networkTypes[0].searchName, arguments: { organization_id: 101, page_size: 100, page_number: 6 } }));
    expect(continuation.data).toHaveLength(100);
    expect(continuation.pagination).toMatchObject({ complete: false, reason: "page_window", startPage: 6, nextPage: null, totalCount: 600 });
    expect(writes()).toHaveLength(0);
  });

  it("distinguishes a complete empty overview from a failed type request", async () => {
    mockAssets(() => ({ data: [], meta: pageMeta(1, 1, 0) }));
    expect(toolPayload(await session.client.callTool({ name: "get_site_network_overview", arguments: { organization_id: 101 } })).complete).toBe(true);
    fetchMock.mockResolvedValue(new Response("Synthetic missing type", { status: 404 }));
    const failed = await session.client.callTool({ name: "get_site_network_overview", arguments: { organization_id: 101 } });
    expect(failed.isError).toBe(true);
    expect(toolText(failed)).toContain("404");
    expect(toolText(failed)).not.toContain('"complete": true');
  });

  it("keeps page-local partial name search explicit and exposes the next source page", async () => {
    mockAssets((page) => ({ data: [printerRecord(page, page === 1 ? "Unrelated" : "Synthetic printer")], meta: pageMeta(page, 2, 2) }));
    const first = toolPayload(await session.client.callTool({ name: printer.searchName, arguments: { organization_id: 101, name: "Synthetic" } }));
    expect(first.data).toEqual([]);
    expect(first.pagination).toMatchObject({ complete: false, nextPage: 2, totalCount: 2 });
    const second = toolPayload(await session.client.callTool({ name: printer.searchName, arguments: { organization_id: 101, name: "Synthetic", page_number: 2 } }));
    expect(second.data).toHaveLength(1);
    expect(second.pagination).toMatchObject({ complete: false, nextPage: null });
  });

  it("retains safe records when API pagination metadata is absent without claiming completion", async () => {
    mockAssets(() => ({ data: [printerRecord(1)], meta: {} }));
    const payload = toolPayload(await session.client.callTool({ name: printer.searchName, arguments: { organization_id: 101 } }));
    expect(payload.data).toHaveLength(1);
    expect(payload.pagination).toMatchObject({ complete: false, reason: "missing_metadata", nextPage: null });
    const overview = toolPayload(await session.client.callTool({ name: "get_site_network_overview", arguments: { organization_id: 101 } }));
    expect(overview.complete).toBe(false);
    for (const config of networkTypes) expect((overview.pagination as RecordData)[config.schema.name]).toMatchObject({ complete: false, reason: "missing_metadata" });
  });

  it.each(["organization", "type"])("typed get rejects a matching ID with the wrong %s", async (boundary) => {
    mockAssets(() => ({ data: [{ ...printerRecord(303), attributes: { ...printerRecord(303).attributes, "organization-id": boundary === "organization" ? 999 : 101, "flexible-asset-type-id": boundary === "type" ? 999 : printer.schema.typeId } }], meta: pageMeta(1, 1, 1) }));
    const result = await session.client.callTool({ name: printer.getName, arguments: { organization_id: 101, id: 303 } });
    expect(result.isError).toBe(true);
    expect(writes()).toHaveLength(0);
  });
});

describe("fail-closed duplicate-create scans", () => {
  it("finds a native composite identity after the first 1000 records", async () => {
    mockAssets((page) => ({ data: page === 1 ? Array.from({ length: 1000 }, (_, index) => printerRecord(index + 1)) : [printerRecord(1001, "  SYNTHETIC PRINTER  ")], meta: pageMeta(page, 2, 1001) }));
    const result = await session.client.callTool({ name: printer.createName, arguments: createArgs });
    expect(result.isError).toBe(true);
    expect(toolText(result)).toContain("already exists: 1001");
    expect(writes()).toHaveLength(0);
  });

  it("allows the same title at a distinct native location after a complete scan", async () => {
    mockAssets((page) => ({ data: [printerRecord(page, "Synthetic printer", page === 1 ? 303 : 404)], meta: pageMeta(page, 2, 2) }));
    const result = await session.client.callTool({ name: printer.createName, arguments: createArgs });
    expect(result.isError).not.toBe(true);
    expect(writes()).toHaveLength(1);
    expect(JSON.parse(writes()[0][1].body).data.attributes.traits).toMatchObject({ "device-name": "Synthetic printer", location: [202] });
  });

  it.each(["missing metadata", "null metadata", "empty page", "repeated record", "skipped page", "changed totals", "missing identity", "wrong organization"])("blocks POST on %s", async (defect) => {
    mockAssets((page) => {
      if (defect === "missing identity") return { data: [{ id: "1", type: "flexible-assets", attributes: { traits: {} } }], meta: pageMeta(1, 1, 1) };
      if (page === 1) return { data: [printerRecord(1)], meta: pageMeta(1, 2, 2) };
      const data = defect === "empty page" ? [] : [printerRecord(defect === "repeated record" ? 1 : 2)];
      if (defect === "wrong organization") data[0].attributes = { ...data[0].attributes, "organization-id": 999 } as typeof data[0]["attributes"];
      return { data, meta: defect === "missing metadata" ? {} : defect === "null metadata" ? { "current-page": null, "next-page": null, "total-pages": null, "total-count": null } : pageMeta(defect === "skipped page" ? 3 : 2, 2, defect === "changed totals" ? 3 : 2) };
    });
    const result = await session.client.callTool({ name: printer.createName, arguments: createArgs });
    expect(result.isError).toBe(true);
    expect(toolText(result)).toContain("Duplicate identity check is incomplete");
    expect(writes()).toHaveLength(0);
  });

  it("blocks POST at the scan cap rather than assuming no duplicate exists", async () => {
    mockAssets((page) => ({ data: Array.from({ length: 1000 }, (_, index) => printerRecord((page - 1) * 1000 + index + 1)), meta: pageMeta(page, 6, 6000) }));
    const result = await session.client.callTool({ name: printer.createName, arguments: createArgs });
    expect(result.isError).toBe(true);
    expect(toolText(result)).toContain("incomplete (page_limit)");
    expect(fetchMock.mock.calls.filter((call) => new URL(call[0]).pathname === "/flexible_assets")).toHaveLength(5);
    expect(writes()).toHaveLength(0);
  });
});
