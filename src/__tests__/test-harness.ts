import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer, type GatewayCredentials } from "../mcp-server.js";

export async function connectTestClient(credentials: GatewayCredentials = { apiKey: "synthetic-test-key", region: "us" }) {
  const server = createMcpServer(credentials);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "reliability-regression", version: "1.0.0" });
  await client.connect(clientTransport);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

export function jsonResponse(data: unknown, meta: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ data, meta }), { headers: { "Content-Type": "application/vnd.api+json" } });
}

export function toolText(result: unknown): string {
  return (result as { content: Array<{ text: string }> }).content[0].text;
}

export function toolPayload(result: unknown): Record<string, unknown> {
  return JSON.parse(toolText(result));
}
