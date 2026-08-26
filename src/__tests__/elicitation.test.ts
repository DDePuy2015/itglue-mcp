/**
 * Elicitation helpers keep their "return null so the caller falls back"
 * contract, but a failure that is not simply an unsupporting client has to be
 * visible: a broken elicitation channel otherwise looks exactly like a user
 * declining every prompt, silently degrading every interactive tool.
 */
import { describe, expect, it, vi } from "vitest";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { elicitConfirmation, elicitSelection, elicitText } from "../utils/elicitation.js";
import { runWithServerRef } from "../utils/server-ref.js";

function serverThatFails(err: unknown): Server {
  return { elicitInput: vi.fn().mockRejectedValue(err) } as unknown as Server;
}

describe("elicitation error handling", () => {
  it("returns null with no server bound", async () => {
    await expect(elicitText("m", "field")).resolves.toBeNull();
  });

  it("returns null and stays quiet when the client has no elicitation support", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const server = serverThatFails(
      Object.assign(new Error("Method not found"), { code: -32601 })
    );
    try {
      await expect(
        runWithServerRef(server, () => elicitSelection("m", "folder", []))
      ).resolves.toBeNull();
      expect(logged).not.toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });

  it("returns null but reports an unexpected elicitation failure", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const server = serverThatFails(new Error("connection closed"));
    try {
      await expect(
        runWithServerRef(server, () => elicitConfirmation("Delete this document?"))
      ).resolves.toBeNull();
      expect(logged).toHaveBeenCalledTimes(1);
      const message = String(logged.mock.calls[0][0]);
      expect(message).toContain("connection closed");
      // The prompt text can name customer records — it is never logged.
      expect(message).not.toContain("Delete this document?");
    } finally {
      logged.mockRestore();
    }
  });

  it("returns null when the user declines", async () => {
    const server = {
      elicitInput: vi.fn().mockResolvedValue({ action: "decline" }),
    } as unknown as Server;

    await expect(
      runWithServerRef(server, () => elicitText("m", "folder"))
    ).resolves.toBeNull();
  });

  it("returns the accepted value", async () => {
    const server = {
      elicitInput: vi.fn().mockResolvedValue({ action: "accept", content: { folder: "12" } }),
    } as unknown as Server;

    await expect(
      runWithServerRef(server, () => elicitText("m", "folder"))
    ).resolves.toBe("12");
  });
});
