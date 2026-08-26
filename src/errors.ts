/**
 * Typed IT Glue failure classes.
 *
 * Layered degradation (folder-inclusive document listings, API-key-before-JWT
 * folder enumeration) and the tool-level 404/401 messages branch on the HTTP
 * status of a failed IT Glue call. That status used to be recovered by
 * substring-matching the error message (`msg.includes("404")`), which matches
 * any response body that happens to contain those three digits — a document
 * named "404", or a 500 whose body quotes a 404 upstream — so a genuine
 * failure could be reported as "no documents found" and a real error swallowed.
 * The status now travels on the error itself; the message parse survives only
 * as a fallback for errors that crossed a boundary that stripped the class.
 */

/** Message prefix kept stable: callers and tests match on this shape. */
function apiErrorMessage(status: number, body: string): string {
  return `IT Glue API error (${status}): ${body}`;
}

/** A non-2xx (or JSON:API `errors`) response from the IT Glue API. */
export class ITGlueApiError extends Error {
  readonly status: number;
  readonly body: string;
  readonly method: string;
  readonly path: string;

  constructor(args: {
    status: number;
    body: string;
    method: string;
    path: string;
  }) {
    super(apiErrorMessage(args.status, args.body));
    this.name = "ITGlueApiError";
    this.status = args.status;
    this.body = args.body;
    this.method = args.method;
    this.path = args.path;
  }
}

/**
 * A call that never produced a usable IT Glue response: the request failed at
 * the network layer, or the response body was not the JSON:API document the
 * caller needs. Carries the request that failed, because the underlying
 * error alone ("fetch failed", "Unexpected token '<'") says nothing about
 * which call broke or why.
 */
export class ITGlueTransportError extends Error {
  readonly method: string;
  readonly path: string;

  constructor(args: {
    method: string;
    path: string;
    detail: string;
    cause?: unknown;
  }) {
    super(`IT Glue API request failed (${args.method} ${args.path}): ${args.detail}`, {
      cause: args.cause,
    });
    this.name = "ITGlueTransportError";
    this.method = args.method;
    this.path = args.path;
  }
}

/**
 * HTTP status of a failed IT Glue call, or null when the failure has no status
 * (network error, malformed body, a bug in our own code).
 *
 * Prefers the typed error; falls back to parsing the canonical message prefix
 * so an error that lost its class (structured-clone across a worker boundary,
 * a re-thrown `new Error(err.message)`) still routes correctly.
 */
export function apiErrorStatus(err: unknown): number | null {
  if (err instanceof ITGlueApiError) return err.status;
  if (err instanceof ITGlueTransportError) return null;
  const msg = err instanceof Error ? err.message : String(err);
  const match = msg.match(/^IT Glue API error \((\d{3})\)/);
  return match ? Number(match[1]) : null;
}

/**
 * Flatten an error and its `cause` chain into one line.
 *
 * Tool handlers report failures as text, and `error.message` alone drops the
 * cause — the wrapper says which call failed while the root cause (DNS failure,
 * TLS error, JSON parse position) is only in the chain. Depth-limited and
 * cycle-safe so a self-referential cause cannot hang the handler.
 */
export function describeError(err: unknown, maxDepth = 4): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = err;

  while (current != null && parts.length < maxDepth && !seen.has(current)) {
    seen.add(current);
    const message = current instanceof Error ? current.message : String(current);
    // Wrappers embed their cause's message; don't repeat it.
    if (!parts.some((part) => part.includes(message))) parts.push(message);
    current = current instanceof Error ? (current as { cause?: unknown }).cause : null;
  }

  return parts.join(" | caused by: ") || String(err);
}

/** True when the error is an IT Glue failure carrying exactly `status`. */
export function isApiErrorStatus(err: unknown, status: number): boolean {
  return apiErrorStatus(err) === status;
}
