/**
 * JSON:API wire helpers shared by the IT Glue client and the tenant
 * flexible-asset tools.
 *
 * IT Glue speaks kebab-case JSON:API on the wire while every tool surface in
 * this server speaks camelCase, so the case conversion and resource
 * flattening used to exist once per module.
 */

export interface JsonApiResource {
  id: string;
  type: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, { data: unknown }>;
}

export interface JsonApiResponse {
  data: JsonApiResource | JsonApiResource[];
  meta?: {
    "current-page"?: number;
    "next-page"?: number | null;
    "prev-page"?: number | null;
    "total-pages"?: number;
    "total-count"?: number;
  };
  included?: JsonApiResource[];
  errors?: Array<{
    title?: string;
    detail?: string;
    status?: string;
  }>;
}

export interface PaginationMeta {
  currentPage: number;
  nextPage: number | null;
  prevPage: number | null;
  totalPages: number;
  totalCount: number;
}

export function kebabToCamel(value: string): string {
  return value.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

export function camelToKebab(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

export function convertKeysToCamel(
  obj: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = kebabToCamel(key);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      result[camelKey] = convertKeysToCamel(value as Record<string, unknown>);
    } else {
      result[camelKey] = value;
    }
  }
  return result;
}

/** Flatten a JSON:API resource to `{ id, type, ...camelCased attributes }`. */
export function deserializeResource(
  resource: JsonApiResource
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    id: resource.id,
    type: resource.type,
  };
  if (resource.attributes) {
    Object.assign(result, convertKeysToCamel(resource.attributes));
  }
  return result;
}

export function buildFilterParams(
  filter: Record<string, unknown>
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(filter)) {
    if (value === undefined || value === null) continue;
    const kebabKey = camelToKebab(key);
    if (typeof value === "object" && !Array.isArray(value)) {
      // JSON:API filter operator form, e.g. { ne: "" } → filter[key][ne]=
      for (const [op, opValue] of Object.entries(value as Record<string, unknown>)) {
        result[`${kebabKey}][${op}`] = String(opValue ?? "");
      }
    } else {
      result[kebabKey] = String(value);
    }
  }
  return result;
}

/** Read the pagination block off a JSON:API response, defaulting like IT Glue does. */
export function paginationMeta(
  json: JsonApiResponse,
  fallbackCount: number
): PaginationMeta {
  return {
    currentPage: json.meta?.["current-page"] || 1,
    nextPage: json.meta?.["next-page"] || null,
    prevPage: json.meta?.["prev-page"] || null,
    totalPages: json.meta?.["total-pages"] || 1,
    totalCount: json.meta?.["total-count"] || fallbackCount,
  };
}
