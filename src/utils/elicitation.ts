/**
 * Elicitation helpers for MCP tool handlers.
 *
 * All functions return null when the prompt could not produce a value: the
 * client does not support elicitation, the user declined or cancelled, or the
 * request failed. Callers rely on that single null signal to take a
 * non-interactive fallback path, so a failure must not become an exception.
 *
 * The failure is still reported: an unsupported client is expected and stays
 * quiet, but anything else is logged to stderr, because a broken elicitation
 * channel is otherwise indistinguishable from a user pressing "cancel" and
 * silently degrades every prompt in the server.
 */
import type { ElicitRequest } from "@modelcontextprotocol/sdk/types.js";
import { getServerRef } from "./server-ref.js";

export interface ElicitOption {
  value: string;
  label: string;
}

/** JSON-RPC "Method not found" — the client has no elicitation capability. */
const METHOD_NOT_FOUND = -32601;

function isUnsupported(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  if (code === METHOD_NOT_FOUND) return true;
  const message = err instanceof Error ? err.message : "";
  return /method not found|not supported|does not support/i.test(message);
}

// `params` is a union (form vs. URL-mode elicitation); we only build schemas.
type ElicitSchema = Extract<
  ElicitRequest["params"],
  { requestedSchema: unknown }
>["requestedSchema"];

/**
 * Run one elicitation round-trip, returning the accepted content or null.
 * Prompt text is never logged — it can name customer records.
 */
async function elicit(
  purpose: string,
  message: string,
  requestedSchema: ElicitSchema
): Promise<Record<string, unknown> | null> {
  const server = getServerRef();
  if (!server) return null;

  try {
    const result = await server.elicitInput({ message, requestedSchema });
    if (result.action === "accept" && result.content) {
      return result.content;
    }
    return null;
  } catch (err) {
    if (!isUnsupported(err)) {
      console.error(
        `[itglue-mcp] Elicitation for ${purpose} failed; continuing without it: ` +
          `${err instanceof Error ? err.message : String(err)}`
      );
    }
    return null;
  }
}

/**
 * Ask the user to select from a list of options.
 */
export async function elicitSelection(
  message: string,
  fieldName: string,
  options: ElicitOption[]
): Promise<string | null> {
  const content = await elicit(`selection of "${fieldName}"`, message, {
    type: "object" as const,
    properties: {
      [fieldName]: {
        type: "string" as const,
        title: fieldName,
        description: `Select a ${fieldName}`,
        enum: options.map((o) => o.value),
        enumNames: options.map((o) => o.label),
      },
    },
    required: [fieldName],
  });
  return content ? (content[fieldName] as string) : null;
}

/**
 * Ask the user for a free-text input.
 */
export async function elicitText(
  message: string,
  fieldName: string,
  description?: string
): Promise<string | null> {
  const content = await elicit(`text input "${fieldName}"`, message, {
    type: "object" as const,
    properties: {
      [fieldName]: {
        type: "string" as const,
        title: fieldName,
        description: description ?? `Enter ${fieldName}`,
      },
    },
    required: [fieldName],
  });
  return content ? (content[fieldName] as string) : null;
}

/**
 * Ask the user to confirm an action.
 */
export async function elicitConfirmation(
  message: string
): Promise<boolean | null> {
  const content = await elicit("confirmation", message, {
    type: "object" as const,
    properties: {
      confirm: {
        type: "boolean" as const,
        title: "Confirm",
        description: "Confirm this action",
      },
    },
    required: ["confirm"],
  });
  return content ? (content.confirm as boolean) : null;
}
