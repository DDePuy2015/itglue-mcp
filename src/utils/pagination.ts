/**
 * Pagination plumbing shared by the IT Glue tool definitions and handlers.
 *
 * Every list/search tool exposes the same `page_size` / `page_number` inputs
 * and turns them into the same JSON:API `page` object with the same defaults,
 * so both halves live here instead of being repeated per tool.
 */

export const PAGINATION_PROPERTIES = {
  page_size: {
    type: "number",
    description: "Number of results per page (max 1000, default 50)",
  },
  page_number: {
    type: "number",
    description: "Page number to retrieve (default 1)",
  },
} as const;

/** Sort input, whose description names the resource-specific examples. */
export function sortProperty(
  description = "Sort field (prefix with - for descending)"
): { type: "string"; description: string } {
  return { type: "string", description };
}

export const DEFAULT_PAGE_SIZE = 50;

/** JSON:API `page` object for a tool call's arguments. */
export function pageParams(
  args: Record<string, unknown> | undefined,
  defaultSize = DEFAULT_PAGE_SIZE
): { size: number; number: number } {
  return {
    size: (args?.page_size as number) || defaultSize,
    number: (args?.page_number as number) || 1,
  };
}
