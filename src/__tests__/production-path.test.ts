import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ITGlueClient } from "../mcp-server.js";
import { connectTestClient, jsonResponse, toolPayload, toolText } from "./test-harness.js";

const fetchMock = vi.fn();
let session: Awaited<ReturnType<typeof connectTestClient>>;
beforeEach(async () => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); session = await connectTestClient(); });
afterEach(async () => { await session.close(); vi.unstubAllGlobals(); });
const resource = { id: "101", type: "synthetic-resource", attributes: { name: "Synthetic asset", "serial-number": "TEST-SERIAL" } };
const meta = { "current-page": 2, "next-page": 3, "total-pages": 4, "total-count": 80 };

describe("inherited coverage through the production client and handlers", () => {
  it("builds API-key headers and encoded filters in the real client", async () => {
    fetchMock.mockResolvedValue(jsonResponse([], meta));
    await new ITGlueClient({ apiKey: "synthetic-key" }).request("/organizations", {
      filter: { name: "A & B" }, page: { size: 17, number: 2 }, sort: "-name",
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(new URL(url).searchParams.get("filter[name]")).toBe("A & B");
    expect(new URL(url).searchParams.get("page[size]")).toBe("17");
    expect(new URL(url).searchParams.get("page[number]")).toBe("2");
    expect(new URL(url).searchParams.get("sort")).toBe("-name");
    expect(init).toMatchObject({ method: "GET", headers: { "x-api-key": "synthetic-key", Accept: "application/vnd.api+json", "Content-Type": "application/vnd.api+json" } });
  });

  it.each([
    ["HTTP", () => new Response("Synthetic rejection", { status: 401 }), "IT Glue API error (401)"],
    ["JSON:API", () => new Response(JSON.stringify({ data: [], errors: [{ detail: "Synthetic API error" }] })), "Synthetic API error"],
    ["network", () => Promise.reject(new Error("Synthetic network error")), "Synthetic network error"],
  ] as const)("propagates %s errors from the real client", async (_name, response, message) => {
    fetchMock.mockImplementation(response);
    await expect(new ITGlueClient({ apiKey: "synthetic-key" }).request("/organizations")).rejects.toThrow(message);
  });

  it.each([
    ["search_organizations", { name: "Synthetic", page_number: 2, sort: "-name" }, "/organizations", { "filter[name]": "Synthetic", "page[number]": "2", sort: "-name" }],
    ["search_configurations", { organization_id: 101, configuration_type_id: 202, serial_number: "TEST-SERIAL" }, "/configurations", { "filter[organization-id]": "101", "filter[configuration-type-id]": "202", "filter[serial-number]": "TEST-SERIAL" }],
    ["search_passwords", { organization_id: 101, password_category_id: 202, username: "synthetic-user" }, "/passwords", { "filter[password-category-id]": "202", "filter[username]": "synthetic-user", show_password: "false" }],
    ["search_documents", { organization_id: 101, name: "Synthetic" }, "/organizations/101/relationships/documents", { "filter[name]": "Synthetic" }],
    ["search_flexible_assets", { organization_id: 101, flexible_asset_type_id: 900123 }, "/flexible_assets", { "filter[flexible-asset-type-id]": "900123", "filter[organization-id]": "101" }],
    ["list_flexible_asset_types", { organization_id: 101 }, "/flexible_asset_types", { "filter[organization-id]": "101" }],
  ] as const)("%s sends handler-built scope and filters", async (name, args, path, query) => {
    fetchMock.mockImplementation((url: string) => url.includes("relationships/flexible_asset_fields") ? jsonResponse([]) : jsonResponse([resource], meta));
    const result = await session.client.callTool({ name, arguments: args });
    expect(result.isError).not.toBe(true);
    expect(toolText(result)).toContain("Synthetic asset");
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe(path);
    for (const [key, value] of Object.entries(query)) expect(url.searchParams.get(key)).toBe(value);
    if (name === "search_organizations") expect(toolPayload(result).meta).toMatchObject({ currentPage: 2, nextPage: 3, totalPages: 4, totalCount: 80 });
  });

  it.each(["get_organization", "get_configuration"])("%s deserializes a real single-resource response", async (name) => {
    fetchMock.mockResolvedValue(jsonResponse(resource));
    const result = await session.client.callTool({ name, arguments: { id: 101 } });
    expect(result.isError).not.toBe(true);
    expect(toolPayload(result)).toMatchObject({ id: "101", name: "Synthetic asset", serialNumber: "TEST-SERIAL" });
    expect(new URL(fetchMock.mock.calls[0][0]).pathname).toBe(name === "get_organization" ? "/organizations/101" : "/configurations/101");
  });

  it.each([true, false])("get_password retains its show_password=%s provider contract", async (show_password) => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "101", type: "passwords", attributes: { name: "Synthetic password metadata" } }));
    const result = await session.client.callTool({ name: "get_password", arguments: { id: 101, show_password } });
    expect(result.isError).not.toBe(true);
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get("show_password")).toBe(String(show_password));
    expect(toolPayload(result).name).toBe("Synthetic password metadata");
  });

  it.each(["heading", "text"])("creates a %s section with resource_type and no relationships binding", async (section_type) => {
    fetchMock.mockResolvedValue(jsonResponse(resource));
    const result = await session.client.callTool({ name: "create_document_section", arguments: { document_id: 101, section_type, content: "<p>Synthetic text</p>" } });
    expect(result.isError).not.toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(new URL(url).pathname).toBe("/documents/101/relationships/sections");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ data: { type: "document-sections", attributes: { resource_type: section_type === "heading" ? "Document::Heading" : "Document::Text", content: "<p>Synthetic text</p>" } } });
  });

  it.each([
    ["list_document_sections", { document_id: 101 }, "GET", "/documents/101/relationships/sections"],
    ["update_document_section", { document_id: 101, section_id: 202, content: "<p>Synthetic update</p>" }, "PATCH", "/documents/101/relationships/sections/202"],
    ["delete_document_section", { document_id: 101, section_id: 202 }, "DELETE", "/documents/101/relationships/sections/202"],
    ["publish_document", { document_id: 101 }, "PATCH", "/documents/101/publish"],
    ["archive_document", { document_id: 101 }, "PATCH", "/documents/101"],
    ["unarchive_document", { document_id: 101 }, "PATCH", "/documents/101"],
  ] as const)("%s runs the existing handler and serializes its operation", async (name, args, method, path) => {
    fetchMock.mockResolvedValue(jsonResponse([resource]));
    const result = await session.client.callTool({ name, arguments: args });
    expect(result.isError).not.toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(new URL(url).pathname).toBe(path);
    expect(init.method).toBe(method);
    if (name === "update_document_section") expect(JSON.parse(init.body)).toEqual({ data: { type: "document-sections", attributes: { content: args.content } } });
    if (name === "archive_document" || name === "unarchive_document") expect(JSON.parse(init.body)).toEqual({ data: { type: "documents", attributes: { archived: name === "archive_document" } } });
  });

  it.each(["get_organization", "search_flexible_assets", "create_document_section"])("%s rejects missing required arguments without a provider call", async (name) => {
    const result = await session.client.callTool({ name, arguments: {} });
    expect(result.isError).toBe(true);
    expect(toolText(result)).toContain("required");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("health check reads the provider count", async () => {
    fetchMock.mockResolvedValue(jsonResponse([resource], { "total-count": 7 }));
    const result = await session.client.callTool({ name: "itglue_health_check", arguments: {} });
    expect(toolPayload(result)).toMatchObject({ status: "ok", organizationTypesFound: 7 });
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get("page[size]")).toBe("1");
  });

  it.each([401, 404, 500])("maps provider %s failures to MCP errors", async (status) => {
    fetchMock.mockResolvedValue(new Response("Synthetic failure", { status }));
    const result = await session.client.callTool({ name: "get_organization", arguments: { id: 101 } });
    expect(result.isError).toBe(true);
    expect(toolText(result)).toContain(`IT Glue API error (${status})`);
  });

  it("checks advertised schemas and reaches a real branch for every advertised tool", async () => {
    const { tools } = await session.client.listTools();
    expect(tools).toHaveLength(46);
    expect(new Set(tools.map((tool) => tool.name)).size).toBe(tools.length);
    fetchMock.mockResolvedValue(jsonResponse([]));
    for (const tool of tools) {
      for (const required of tool.inputSchema.required ?? []) expect(tool.inputSchema.properties).toHaveProperty(required);
      const result = await session.client.callTool({ name: tool.name, arguments: {} });
      expect(toolText(result)).not.toContain("Unknown tool:");
    }
    const unknown = await session.client.callTool({ name: "synthetic_unknown_tool", arguments: {} });
    expect(unknown.isError).toBe(true);
    expect(toolText(unknown)).toBe("Unknown tool: synthetic_unknown_tool");
  });
});
