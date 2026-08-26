/**
 * Tests for the MCP prompt handlers (src/prompts.ts) — drives ListPrompts and
 * GetPrompt through a real client/server pair over an in-memory transport,
 * the same way an MCP host consumes them.
 */

import { describe, it, expect, vi } from "vitest";

// Mock fetch globally before importing the server factory.
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { createMcpServer } from "../mcp-server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

async function connectClient(): Promise<Client> {
  const server = createMcpServer({ apiKey: "test-api-key" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "prompts-test", version: "1.0.0" });
  await client.connect(clientTransport);
  return client;
}

function promptText(result: Awaited<ReturnType<Client["getPrompt"]>>): string {
  const message = result.messages[0];
  expect(message.role).toBe("user");
  expect(message.content.type).toBe("text");
  return (message.content as { type: "text"; text: string }).text;
}

describe("prompt handlers", () => {
  describe("ListPrompts", () => {
    it("lists the three pre-baked prompts with their arguments", async () => {
      const client = await connectClient();
      const { prompts } = await client.listPrompts();

      expect(prompts.map((p) => p.name)).toEqual([
        "doc-completeness",
        "runbook-check",
        "password-audit",
      ]);

      const docCompleteness = prompts.find((p) => p.name === "doc-completeness");
      expect(docCompleteness?.arguments).toEqual([
        {
          name: "org_name",
          description: "The organization to audit",
          required: true,
        },
      ]);

      const runbookCheck = prompts.find((p) => p.name === "runbook-check");
      expect(runbookCheck?.arguments?.map((a) => a.name)).toEqual([
        "org_name",
        "system_name",
      ]);
      expect(runbookCheck?.arguments?.find((a) => a.name === "system_name")?.required).toBe(false);

      const passwordAudit = prompts.find((p) => p.name === "password-audit");
      expect(passwordAudit?.arguments?.map((a) => a.name)).toEqual(["org_name"]);
    });
  });

  describe("GetPrompt", () => {
    it("renders doc-completeness with the org name interpolated", async () => {
      const client = await connectClient();
      const result = await client.getPrompt({
        name: "doc-completeness",
        arguments: { org_name: "Acme Corp" },
      });

      expect(result.description).toBe(
        "Documentation completeness audit for an organization"
      );
      const text = promptText(result);
      expect(text).toContain("Audit documentation completeness for Acme Corp in IT Glue.");
      expect(text).toContain("Overall completeness score");
    });

    it("renders runbook-check without a system filter when system_name is omitted", async () => {
      const client = await connectClient();
      const result = await client.getPrompt({
        name: "runbook-check",
        arguments: { org_name: "Acme Corp" },
      });

      expect(result.description).toBe("Find systems without runbooks");
      const text = promptText(result);
      expect(text).toContain("Check for missing runbooks in IT Glue for Acme Corp.");
      expect(text).not.toContain("specifically for");
      expect(text).toContain("For each configuration");
    });

    it("renders runbook-check scoped to a system when system_name is provided", async () => {
      const client = await connectClient();
      const result = await client.getPrompt({
        name: "runbook-check",
        arguments: { org_name: "Acme Corp", system_name: "Mail Server" },
      });

      const text = promptText(result);
      expect(text).toContain(
        "Check for missing runbooks in IT Glue for Acme Corp, specifically for Mail Server."
      );
      expect(text).toContain('Focus on configurations matching "Mail Server"');
    });

    it("renders password-audit with age buckets and no-plaintext instruction", async () => {
      const client = await connectClient();
      const result = await client.getPrompt({
        name: "password-audit",
        arguments: { org_name: "Acme Corp" },
      });

      expect(result.description).toBe("Find passwords not rotated in 90+ days");
      const text = promptText(result);
      expect(text).toContain("Audit password rotation compliance for Acme Corp in IT Glue.");
      expect(text).toContain("90–180 days");
      expect(text).toContain("Do NOT display actual password values in the report.");
    });

    it("rejects an unknown prompt name", async () => {
      const client = await connectClient();
      await expect(
        client.getPrompt({ name: "no-such-prompt", arguments: {} })
      ).rejects.toThrow(/Unknown prompt: no-such-prompt/);
    });
  });
});
