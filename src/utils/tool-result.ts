/**
 * Shared shapes for MCP tool handler results.
 *
 * Every tool in this server answers with a single text block — either a
 * pretty-printed JSON payload or an `Error: ...` string with `isError` set.
 * Building that object inline once per tool made the handler bodies mostly
 * boilerplate, so the shape lives here and is used by both tool modules
 * (`mcp-server.ts` and `flexible-assets.ts`).
 */

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  // The MCP SDK's ServerResult allows extra fields (e.g. `_meta`); keeping the
  // index signature lets handlers return this type directly.
  [key: string]: unknown;
}

/** Wrap a value as a text result — objects are pretty-printed as JSON. */
export function textResult(value: unknown, isError = false): ToolResult {
  return {
    content: [
      {
        type: "text",
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
    ...(isError ? { isError: true } : {}),
  };
}

/** Failure result, prefixed the way every handler already reports errors. */
export function errorResult(message: string): ToolResult {
  return textResult(`Error: ${message}`, true);
}

/** Message of an unknown thrown value, without an `instanceof` dance per call site. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Guard the arguments a handler cannot run without.
 *
 * Throws when any of them is falsy — the same condition the hand-written
 * `if (!args?.x || !args?.y)` guards used — and the handler's outer catch turns
 * the message into the identical `Error: ... is required` tool result. Doubling
 * as a type assertion keeps `args` non-optional for the rest of the handler.
 */
export function requireArgs(
  args: Record<string, unknown> | undefined,
  names: readonly string[]
): asserts args is Record<string, unknown> {
  if (names.every((name) => Boolean(args?.[name]))) return;
  const list =
    names.length > 2
      ? `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`
      : names.join(" and ");
  throw new Error(`${list} ${names.length > 1 ? "are" : "is"} required`);
}
