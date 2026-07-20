import { describe, expect, it, vi } from "vitest";
import {
  flexibleAssetToolDefinitions,
  handleFlexibleAssetTool,
  redactFlexibleAssetResult,
  type FlexibleAssetClient,
} from "../flexible-assets.js";

function fakeClient(overrides: Partial<FlexibleAssetClient> = {}): FlexibleAssetClient {
  return {
    request: vi.fn(async () => ({ data: [], meta: {} })),
    get: vi.fn(async () => ({})),
    post: vi.fn(async () => ({ id: "900", type: "flexible-assets", name: "Created", traits: {} })),
    patch: vi.fn(async () => ({ id: "900", type: "flexible-assets", name: "Updated", traits: {} })),
    ...overrides,
  } as unknown as FlexibleAssetClient;
}

describe("tenant flexible-asset tools", () => {
  it("publishes all dedicated read and write tools", () => {
    const names = flexibleAssetToolDefinitions().map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining([
      "search_printers",
      "get_printer",
      "create_printer",
      "update_printer",
      "search_applications",
      "get_site_network_overview",
    ]));
    expect(names).toHaveLength(21);
  });

  it("enforces required fields and select values", async () => {
    const client = fakeClient();
    const missing = await handleFlexibleAssetTool("create_printer", {
      organization_id: 123,
      fields: { device_name: "Finance Printer" },
    }, client);
    expect(missing?.isError).toBe(true);
    expect(missing?.content[0].text).toContain("location_ids is required");

    const invalidSelect = await handleFlexibleAssetTool("create_wireless_network", {
      organization_id: 123,
      fields: { network_name: "Corp", ssid: "Corp", encryption_type: "WPA4" },
    }, client);
    expect(invalidSelect?.isError).toBe(true);
    expect(invalidSelect?.content[0].text).toContain("encryption_type must be one of");
  });

  it("serializes a printer create with traits and relationship IDs", async () => {
    const post = vi.fn(async () => ({
      id: "900",
      type: "flexible-assets",
      name: "Finance Printer",
      traits: { "device-name": "Finance Printer", location: [42], "mac-address": "00:11:22:33:44:55" },
    }));
    const client = fakeClient({ post });
    const result = await handleFlexibleAssetTool("create_printer", {
      organization_id: 123,
      fields: { device_name: "Finance Printer", location_ids: [42], mac_address: "00:11:22:33:44:55" },
    }, client);
    expect(result?.isError).not.toBe(true);
    const body = post.mock.calls[0][1] as { data: { attributes: { traits: Record<string, unknown>; "organization-id": number; "flexible-asset-type-id": number } } };
    expect(body.data.attributes.traits).toMatchObject({ "device-name": "Finance Printer", location: [42] });
    expect(body.data.attributes["organization-id"]).toBe(123);
    expect(body.data.attributes["flexible-asset-type-id"]).toBe(379697);
  });

  it("blocks duplicate identity creation", async () => {
    const client = fakeClient({
      request: vi.fn(async () => ({
        data: [{ id: "17", type: "flexible-assets", traits: { "device-name": "Finance Printer", location: [42] } }],
        meta: {},
      })),
    });
    const result = await handleFlexibleAssetTool("create_printer", {
      organization_id: 123,
      fields: { device_name: "Finance Printer", location_ids: [42] },
    }, client);
    expect(result?.isError).toBe(true);
    expect(result?.content[0].text).toContain("already exists: 17");
  });

  it("verifies organization/type on update and never sends password traits", async () => {
    const patch = vi.fn(async () => ({
      id: "17",
      type: "flexible-assets",
      traits: { "device-name": "Finance Printer", location: [42], "admin-credentials": "must-not-escape" },
    }));
    const request = vi.fn(async () => ({
      data: [{
        id: "17",
        type: "flexible-assets",
        organizationId: 123,
        flexibleAssetTypeId: 379697,
        traits: {
          "device-name": "Finance Printer",
          location: { type: "Locations", values: [{ id: 42, name: "HQ" }] },
          "admin-credentials": { type: "Passwords", values: [{ id: 55, name: "Printer admin" }] },
        },
      }],
      meta: {},
    }));
    const client = fakeClient({ request, patch });
    const result = await handleFlexibleAssetTool("update_printer", {
      organization_id: 123,
      id: 17,
      fields: { mac_address: "00:11:22:33:44:55" },
    }, client);
    expect(result?.isError).not.toBe(true);
    expect(request.mock.calls[0][0]).toBe("/flexible_assets");
    expect(request.mock.calls[0][1]).toMatchObject({ filter: { id: 17, flexibleAssetTypeId: 379697, organizationId: 123 } });
    const body = patch.mock.calls[0][1] as { data: { attributes: { traits: Record<string, unknown> } } };
    expect(body.data.attributes.traits.location).toEqual([42]);
    expect(body.data.attributes.traits["admin-credentials"]).toEqual([55]);
  });

  it("omits Password-kind traits from generic responses", async () => {
    const client = fakeClient({
      request: vi.fn(async () => ({
        data: [{ id: "1", attributes: { name: "PSK", nameKey: "pre-shared-key", kind: "Password" } }],
        meta: {},
      })),
    });
    const redacted = await redactFlexibleAssetResult(client, 900001, {
      data: [{ traits: { preSharedKey: "secret", "pre-shared-key": "secret", notes: "safe" } }],
    });
    expect(redacted.data[0].traits).not.toHaveProperty("preSharedKey");
    expect(redacted.data[0].traits).not.toHaveProperty("pre-shared-key");
    expect(redacted.data[0].traits.notes).toBe("safe");
  });

  it("excludes Wireless PSKs from dedicated update payloads", async () => {
    const patch = vi.fn(async () => ({ id: "22", type: "flexible-assets", traits: {} }));
    const client = fakeClient({
      request: vi.fn(async () => ({
        data: [{
          id: "22",
          organizationId: 123,
          flexibleAssetTypeId: 53878,
          traits: {
            "network-name": "Corp",
            ssid: "Corp",
            "encryption-type": "WPA2-Personal",
            "pre-shared-key": "secret",
          },
        }],
        meta: {},
      })),
      patch,
    });
    await handleFlexibleAssetTool("update_wireless_network", {
      organization_id: 123,
      id: 22,
      fields: { notes: "rotated APs" },
    }, client);
    const body = patch.mock.calls[0][1] as { data: { attributes: { traits: Record<string, unknown> } } };
    expect(body.data.attributes.traits).not.toHaveProperty("pre-shared-key");
  });
});
