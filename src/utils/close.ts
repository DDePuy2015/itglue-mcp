/**
 * Teardown of per-request MCP resources.
 *
 * Both entrypoints create a fresh server + transport per request and close them
 * once the response is done. Closing happens after the outcome is decided, so a
 * failure there cannot be reported to the caller — it must not replace a good
 * response with a throw, nor (in Node, where teardown runs from a `close` event)
 * become an unhandled rejection. It is logged instead.
 */
export async function closeQuietly(
  ...closeables: Array<{ close(): Promise<void> | void }>
): Promise<void> {
  for (const closeable of closeables) {
    try {
      await closeable.close();
    } catch (err) {
      console.error(
        `[itglue-mcp] Error closing MCP request resources: ` +
          `${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}
