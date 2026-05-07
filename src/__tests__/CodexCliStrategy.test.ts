import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatRole, type ChatGPTSettings } from "../types.ts";

const { runCodexExecMock } = vi.hoisted(() => ({
  runCodexExecMock: vi.fn(),
}));

vi.mock("../services/CodexCli.ts", async () => {
  const actual = await vi.importActual<typeof import("../services/CodexCli.ts")>("../services/CodexCli.ts");
  return {
    ...actual,
    runCodexExec: runCodexExecMock,
  };
});

import { CodexCliStrategy } from "../strategies/CodexCliStrategy.ts";

const baseConfig: ChatGPTSettings = {
  cliPath: "codex",
  model: "gpt-5",
  favoriteModels: ["gpt-5"],
};

afterEach(() => {
  runCodexExecMock.mockReset();
});

describe("Codex CLI strategy", () => {
  it("emits tool events for structured edit responses", async () => {
    let capturedPrompt = "";

    const toolCall = {
      source: "internal",
      serverName: "internal",
      toolName: "propose_active_note_replacement",
      qualifiedToolName: "propose_active_note_replacement",
      argumentsText: "{\"proposedContent\":\"# Updated\"}",
      durationMs: 12,
      startedAt: 1000,
      success: true,
      resultText: "Prepared a replacement proposal for note.md.",
      editProposal: {
        scope: "note",
        source: "chat",
        filePath: "note.md",
        fileName: "note.md",
        originalContent: "# Old",
        proposedContent: "# Updated",
        description: "Updated the note",
        createdAt: 1234,
      },
    };

    runCodexExecMock.mockImplementation(async ({ prompt }: { prompt: string }) => {
      capturedPrompt = prompt;
      return "{\"type\":\"active_note_replacement\",\"message\":\"Updated the note\",\"proposedContent\":\"# Updated\"}";
    });

    const strategy = new CodexCliStrategy(
      baseConfig,
      {},
      {
        getCodexPromptInstruction: () => "Use structured edit proposals for explicit note edits.",
        parseCodexEditResponse: async (response: string) => {
          expect(response).toContain("active_note_replacement");
          return {
            message: "Updated the note",
            toolResult: {
              success: true,
              call: toolCall,
            },
          };
        },
      } as never,
    );

    const chunks: string[] = [];
    const toolEvents: unknown[] = [];

    const result = await strategy.sendMessage(
      [{ role: ChatRole.User, content: "Rewrite the current note as a checklist." }],
      (chunk) => {
        chunks.push(chunk);
      },
      (call) => {
        toolEvents.push(call);
      },
    );

    expect(result).toBe("Updated the note");
    expect(chunks).toEqual(["Updated the note"]);
    expect(toolEvents).toEqual([toolCall]);
    expect(capturedPrompt.startsWith("SYSTEM:\nUse structured edit proposals for explicit note edits.")).toBe(true);
    expect(capturedPrompt).toContain("USER:\nRewrite the current note as a checklist.");
  });

  it("passes through plain responses without tool events", async () => {
    runCodexExecMock.mockResolvedValue("Normal conversational answer");

    const strategy = new CodexCliStrategy(
      baseConfig,
      {},
      {
        getCodexPromptInstruction: () => "Be concise.",
        parseCodexEditResponse: async () => null,
      } as never,
    );

    const chunks: string[] = [];
    const toolEvents: unknown[] = [];

    const result = await strategy.sendMessage(
      [{ role: ChatRole.User, content: "Summarize this note." }],
      (chunk) => {
        chunks.push(chunk);
      },
      (call) => {
        toolEvents.push(call);
      },
    );

    expect(result).toBe("Normal conversational answer");
    expect(chunks).toEqual(["Normal conversational answer"]);
    expect(toolEvents).toEqual([]);
  });
});
