import { describe, it, expect } from "vitest";
import {
  buildFilterParams,
  camelToKebab,
  convertKeysToCamel,
  deserializeResource,
  kebabToCamel,
  paginationMeta,
} from "../utils/json-api.js";
import {
  errorMessage,
  errorResult,
  requireArgs,
  textResult,
} from "../utils/tool-result.js";
import { pageParams } from "../utils/pagination.js";
import { filterFromArgs, searchParams, snakeToCamel } from "../utils/query.js";
import {
  backendAuthResponse,
  credentialsFromHeaders,
  credentialsFromVars,
} from "../utils/gateway.js";

describe("json-api helpers", () => {
  it("converts between kebab-case and camelCase", () => {
    expect(kebabToCamel("organization-status-name")).toBe("organizationStatusName");
    expect(camelToKebab("organizationStatusName")).toBe("organization-status-name");
  });

  it("camelCases nested keys", () => {
    expect(
      convertKeysToCamel({ "my-glue-account": { "account-id": 1 }, list: ["a-b"] })
    ).toEqual({ myGlueAccount: { accountId: 1 }, list: ["a-b"] });
  });

  it("flattens a resource onto id and type", () => {
    expect(
      deserializeResource({
        id: "7",
        type: "organizations",
        attributes: { name: "Acme", "organization-type-id": 3 },
      })
    ).toEqual({ id: "7", type: "organizations", name: "Acme", organizationTypeId: 3 });
  });

  it("kebab-cases filter keys and expands operator objects", () => {
    expect(
      buildFilterParams({
        organizationId: 12,
        serialNumber: { ne: "" },
        skipped: null,
      })
    ).toEqual({ "organization-id": "12", "serial-number][ne": "" });
  });

  it("defaults missing pagination meta", () => {
    expect(paginationMeta({ data: [] }, 4)).toEqual({
      currentPage: 1,
      nextPage: null,
      prevPage: null,
      totalPages: 1,
      totalCount: 4,
    });
    expect(
      paginationMeta({ data: [], meta: { "current-page": 2, "total-count": 9 } }, 4)
        .totalCount
    ).toBe(9);
  });
});

describe("tool-result helpers", () => {
  it("pretty-prints objects and passes strings through", () => {
    expect(textResult({ a: 1 })).toEqual({
      content: [{ type: "text", text: '{\n  "a": 1\n}' }],
    });
    expect(textResult("plain", true)).toEqual({
      content: [{ type: "text", text: "plain" }],
      isError: true,
    });
    expect(errorResult("boom")).toEqual({
      content: [{ type: "text", text: "Error: boom" }],
      isError: true,
    });
  });

  it("reads a message off any thrown value", () => {
    expect(errorMessage(new Error("nope"))).toBe("nope");
    expect(errorMessage("nope")).toBe("nope");
  });

  it("throws the argument list only when something is missing", () => {
    expect(() => requireArgs({ id: "1" }, ["id"])).not.toThrow();
    expect(() => requireArgs({ id: "1" }, ["organization_id", "id"])).toThrow(
      "organization_id and id are required"
    );
    expect(() => requireArgs(undefined, ["document_id", "section_type", "content"])).toThrow(
      "document_id, section_type, and content are required"
    );
  });
});

describe("request parameter helpers", () => {
  it("defaults page size and number", () => {
    expect(pageParams(undefined)).toEqual({ size: 50, number: 1 });
    expect(pageParams({ page_size: 10, page_number: 3 })).toEqual({ size: 10, number: 3 });
  });

  it("camelCases picked filter keys and drops absent ones", () => {
    expect(snakeToCamel("configuration_type_id")).toBe("configurationTypeId");
    expect(filterFromArgs({ serial_number: "SN1" }, ["serial_number", "rmm_id"])).toEqual({
      serialNumber: "SN1",
    });
  });

  it("builds filter, sort and page in one object", () => {
    expect(
      searchParams({ name: "Acme", sort: "-name" }, ["name"], { organizationId: 5 })
    ).toEqual({
      filter: { organizationId: 5, name: "Acme" },
      sort: "-name",
      page: { size: 50, number: 1 },
    });
    expect(searchParams({}, ["name"])).toEqual({ page: { size: 50, number: 1 } });
  });
});

describe("gateway helpers", () => {
  it("reads credentials from headers, preferring the IT Glue names", () => {
    const headers: Record<string, string> = {
      "x-api-key": "fallback",
      "x-itglue-api-key": "primary",
      "x-itglue-region": "eu",
    };
    expect(credentialsFromHeaders((name) => headers[name])).toEqual({
      apiKey: "primary",
      jwt: undefined,
      region: "eu",
      baseUrl: undefined,
    });
  });

  it("returns null when no credential header is present", () => {
    expect(credentialsFromHeaders(() => undefined)).toBeNull();
  });

  it("reads credentials from env vars, defaulting the region", () => {
    expect(credentialsFromVars({ ITGLUE_JWT: "jwt" })).toEqual({
      apiKey: undefined,
      jwt: "jwt",
      region: "us",
      baseUrl: undefined,
    });
    expect(credentialsFromVars({})).toBeUndefined();
  });

  it("maps backend-auth failures onto status codes", () => {
    expect(backendAuthResponse("not_configured").status).toBe(503);
    expect(backendAuthResponse("missing_or_invalid")).toEqual({
      status: 401,
      body: { error: "Backend authentication failed." },
    });
  });
});
