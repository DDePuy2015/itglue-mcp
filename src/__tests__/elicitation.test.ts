/**
 * Tests for the elicitation helpers (src/utils/elicitation.ts).
 *
 * Each helper resolves the current server via the per-request async context
 * (utils/server-ref.ts) and must degrade gracefully: no bound server, a
 * declined/cancelled elicitation, or a client that errors (no elicitation
 * capability) all yield null instead of throwing into the tool handler.
 */

import { describe, it, expect, vi } from "vitest";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { runWithServerRef } from "../utils/server-ref.js";
import {
  elicitSelection,
  elicitText,
  elicitConfirmation,
  type ElicitOption,
} from "../utils/elicitation.js";

type FakeServer = Server & { elicitInput: ReturnType<typeof vi.fn> };

function createFakeServer(
  result:
    | { action: "accept"; content?: Record<string, unknown> }
    | { action: "decline" }
    | { action: "cancel" }
    | Error
): FakeServer {
  const elicitInput =
    result instanceof Error
      ? vi.fn().mockRejectedValue(result)
      : vi.fn().mockResolvedValue(result);
  return { elicitInput } as unknown as FakeServer;
}

const OPTIONS: ElicitOption[] = [
  { value: "folder-1", label: "Runbooks" },
  { value: "folder-2", label: "Network Diagrams" },
];

describe("elicitSelection", () => {
  it("returns null when no server is bound to the async context", async () => {
    expect(await elicitSelection("Pick a folder", "folder", OPTIONS)).toBeNull();
  });

  it("returns the selected value and requests an enum schema of the options", async () => {
    const server = createFakeServer({
      action: "accept",
      content: { folder: "folder-2" },
    });

    const selected = await runWithServerRef(server, () =>
      elicitSelection("Pick a folder", "folder", OPTIONS)
    );

    expect(selected).toBe("folder-2");
    expect(server.elicitInput).toHaveBeenCalledTimes(1);
    const request = server.elicitInput.mock.calls[0][0];
    expect(request.message).toBe("Pick a folder");
    expect(request.requestedSchema.required).toEqual(["folder"]);
    expect(request.requestedSchema.properties.folder.enum).toEqual([
      "folder-1",
      "folder-2",
    ]);
    expect(request.requestedSchema.properties.folder.enumNames).toEqual([
      "Runbooks",
      "Network Diagrams",
    ]);
  });

  it("returns null when the user declines", async () => {
    const server = createFakeServer({ action: "decline" });
    const selected = await runWithServerRef(server, () =>
      elicitSelection("Pick a folder", "folder", OPTIONS)
    );
    expect(selected).toBeNull();
  });

  it("returns null when the elicitation accept carries no content", async () => {
    const server = createFakeServer({ action: "accept" });
    const selected = await runWithServerRef(server, () =>
      elicitSelection("Pick a folder", "folder", OPTIONS)
    );
    expect(selected).toBeNull();
  });

  it("returns null when the client does not support elicitation (elicitInput throws)", async () => {
    const server = createFakeServer(new Error("Method not found"));
    const selected = await runWithServerRef(server, () =>
      elicitSelection("Pick a folder", "folder", OPTIONS)
    );
    expect(selected).toBeNull();
  });
});

describe("elicitText", () => {
  it("returns null when no server is bound to the async context", async () => {
    expect(await elicitText("Name the document", "title")).toBeNull();
  });

  it("returns the entered text and uses the provided description", async () => {
    const server = createFakeServer({
      action: "accept",
      content: { title: "Quarterly DR runbook" },
    });

    const text = await runWithServerRef(server, () =>
      elicitText("Name the document", "title", "A short document title")
    );

    expect(text).toBe("Quarterly DR runbook");
    const request = server.elicitInput.mock.calls[0][0];
    expect(request.requestedSchema.required).toEqual(["title"]);
    expect(request.requestedSchema.properties.title.description).toBe(
      "A short document title"
    );
  });

  it("falls back to a default description when none is provided", async () => {
    const server = createFakeServer({
      action: "accept",
      content: { title: "Untitled" },
    });

    await runWithServerRef(server, () => elicitText("Name the document", "title"));

    const request = server.elicitInput.mock.calls[0][0];
    expect(request.requestedSchema.properties.title.description).toBe("Enter title");
  });

  it("returns null when the user cancels", async () => {
    const server = createFakeServer({ action: "cancel" });
    const text = await runWithServerRef(server, () =>
      elicitText("Name the document", "title")
    );
    expect(text).toBeNull();
  });

  it("returns null when elicitInput throws", async () => {
    const server = createFakeServer(new Error("Method not found"));
    const text = await runWithServerRef(server, () =>
      elicitText("Name the document", "title")
    );
    expect(text).toBeNull();
  });
});

describe("elicitConfirmation", () => {
  it("returns null when no server is bound to the async context", async () => {
    expect(await elicitConfirmation("Delete this document?")).toBeNull();
  });

  it.each([true, false])("returns the confirmed boolean %s", async (confirm) => {
    const server = createFakeServer({ action: "accept", content: { confirm } });
    const confirmed = await runWithServerRef(server, () =>
      elicitConfirmation("Delete this document?")
    );
    expect(confirmed).toBe(confirm);

    const request = server.elicitInput.mock.calls[0][0];
    expect(request.requestedSchema.required).toEqual(["confirm"]);
    expect(request.requestedSchema.properties.confirm.type).toBe("boolean");
  });

  it("returns null when the user declines", async () => {
    const server = createFakeServer({ action: "decline" });
    const confirmed = await runWithServerRef(server, () =>
      elicitConfirmation("Delete this document?")
    );
    expect(confirmed).toBeNull();
  });

  it("returns null when elicitInput throws", async () => {
    const server = createFakeServer(new Error("Method not found"));
    const confirmed = await runWithServerRef(server, () =>
      elicitConfirmation("Delete this document?")
    );
    expect(confirmed).toBeNull();
  });
});
