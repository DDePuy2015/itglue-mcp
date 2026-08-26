/**
 * Request-parameter assembly shared by the IT Glue search tools.
 *
 * Every search handler turned its snake_case tool arguments into the same
 * JSON:API shape — a camelCase `filter` object, an optional `sort`, and a
 * `page` object — so that translation lives here instead of once per tool.
 */

import { pageParams } from "./pagination.js";

/**
 * Pick the write-time attributes a create/update tool accepts, keeping IT
 * Glue's snake_case keys (accepted on write) and dropping unset ones.
 */
export function attributesFromArgs(
  args: Record<string, unknown> | undefined,
  fields: readonly string[]
): Record<string, unknown> {
  const attributes: Record<string, unknown> = {};
  for (const field of fields) {
    const value = args?.[field];
    if (value !== undefined && value !== null) attributes[field] = value;
  }
  return attributes;
}

export function snakeToCamel(value: string): string {
  return value.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

/**
 * Pick the given tool arguments into a JSON:API filter, camelCasing the keys.
 * Falsy values are dropped, matching the hand-written `if (args?.x)` guards.
 */
export function filterFromArgs(
  args: Record<string, unknown> | undefined,
  keys: readonly string[]
): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  for (const key of keys) {
    const value = args?.[key];
    if (value) filter[snakeToCamel(key)] = value;
  }
  return filter;
}

/**
 * Full `{ filter?, sort?, page }` parameter object for a search tool call.
 * `extraFilter` carries values the handler resolved itself (e.g. an
 * organization id found by elicitation) and keeps its leading position in the
 * filter, preserving query-string order.
 */
export function searchParams(
  args: Record<string, unknown> | undefined,
  filterKeys: readonly string[],
  extraFilter: Record<string, unknown> = {}
): Record<string, unknown> {
  const filter = { ...extraFilter, ...filterFromArgs(args, filterKeys) };
  const params: Record<string, unknown> = {};
  if (Object.keys(filter).length > 0) params.filter = filter;
  if (args?.sort) params.sort = args.sort;
  params.page = pageParams(args);
  return params;
}
