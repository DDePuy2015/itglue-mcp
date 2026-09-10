/**
 * Security-boundary tests: request-path validation, base-URL validation, and
 * Origin allow-listing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import {
  assertSafeRequestPath,
  ITGlueClient,
  normalizeBaseUrl,
} from "../mcp-server.js";
import { isOriginAllowed, parseAllowedOrigins } from "../origin.js";

function okResponse(): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ data: [] }),
    text: async () => "",
  } as unknown as Response;
}

describe("assertSafeRequestPath", () => {
  it("accepts the literal + numeric-id paths the handlers build", () => {
    for (const path of [
      "/organizations",
      "/organizations/12345",
      "/organizations/12345/relationships/documents/678",
      "/user_metrics",
      "/documents/1/relationships/sections/2",
    ]) {
      expect(assertSafeRequestPath(path)).toBe(path);
    }
  });

  it("rejects ids carrying path or query syntax", () => {
    for (const path of [
      "/passwords/1?show_password=true",
      "/passwords/1/../users",
      "/passwords/..%2Fusers",
      "/organizations//relationships/documents",
      "/organizations/1 2",
      "/passwords/1#frag",
      "/passwords/1&filter[x]=1",
    ]) {
      expect(() => assertSafeRequestPath(path)).toThrow(/Invalid IT Glue request path/);
    }
  });
});

describe("ITGlueClient path validation", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(okResponse());
  });

  it("refuses to issue a request for an injected id", async () => {
    const client = new ITGlueClient({ apiKey: "key" });
    await expect(client.get("/passwords/1/../users")).rejects.toThrow(
      /Invalid IT Glue request path/
    );
    await expect(client.delete("/documents/1?force=true")).rejects.toThrow(
      /Invalid IT Glue request path/
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("normalizeBaseUrl", () => {
  it("accepts http(s) URLs and strips a trailing slash", () => {
    expect(normalizeBaseUrl("https://api.eu.itglue.com/")).toBe(
      "https://api.eu.itglue.com"
    );
    expect(normalizeBaseUrl("http://localhost:8080/api")).toBe(
      "http://localhost:8080/api"
    );
  });

  it("rejects non-HTTP schemes and unparseable values", () => {
    expect(() => normalizeBaseUrl("file:///etc/passwd")).toThrow(/only http and https/);
    expect(() => normalizeBaseUrl("api.itglue.com")).toThrow(/absolute URL/);
  });

  it("is applied to the client's base-URL override", () => {
    expect(
      () => new ITGlueClient({ apiKey: "key", baseUrl: "javascript:alert(1)" })
    ).toThrow(/only http and https/);
  });
});

describe("Origin allow-listing", () => {
  it("parses a comma-separated list", () => {
    expect(parseAllowedOrigins("https://a.example , https://b.example")).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
    expect(parseAllowedOrigins(undefined)).toEqual([]);
    expect(parseAllowedOrigins(" , ")).toEqual([]);
  });

  it("allows callers that send no Origin (gateway, probes, CLI)", () => {
    expect(isOriginAllowed(undefined, [])).toBe(true);
    expect(isOriginAllowed(null, [])).toBe(true);
  });

  it("allows only listed browser origins", () => {
    const allowed = ["https://app.example.com"];
    expect(isOriginAllowed("https://app.example.com", allowed)).toBe(true);
    expect(isOriginAllowed("https://evil.example.com", allowed)).toBe(false);
    expect(isOriginAllowed("https://evil.example.com", [])).toBe(false);
  });

  it("honours an explicit wildcard opt-in", () => {
    expect(isOriginAllowed("https://evil.example.com", ["*"])).toBe(true);
  });
});
