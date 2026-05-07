import { ChatRole, type ChatGPTSettings } from "../types.ts";
import { assertEqual, assertTrue } from "./testUtils.ts";

const codexCliModule = require("../services/CodexCli.ts") as {
  runCodexExec: (options: {
    cliPath: string;
    prompt: string;
    model?: string;
    mcpServers?: Record<string, unknown>;
    signal?: AbortSignal;
  }) => Promise<string>;
};

const { CodexCliStrategy } = require("../strategies/CodexCliStrategy.ts") as {
  CodexCliStrategy: new (
    config: ChatGPTSettings,
    mcpServers?: Record<string, unknown>,
    internalToolService?: {
      getCodexPromptInstruction(): string;
      parseCodexEditResponse(response: string): Promise<{
        message: string;
        toolResult: {
          success: boolean;
          call?: unknown;
        };
      } | null>;
    },
  ) => {
    sendMessage(
      messages: Array<{ role: ChatRole; content: string }>,
      onChunk: (chunk: string) => void,
      onToolEvent?: (call: unknown) => void,
      signal?: AbortSignal,
    ): Promise<string>;
  };
};

type AsyncTestFn = () => Promise<void> | void;

async function runAsyncTests(suiteName: string, tests: AsyncTestFn[]): Promise<void> {
  console.log(`\n=== ${suiteName} ===\n`);

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      await test();
      passed++;
    } catch (error) {
      failed++;
      console.error(
        `\u2717 ${test.name} failed:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  console.log(`\n=== Test Results ===`);
  console.log(`Passed: ${passed}/${tests.length}`);
  console.log(`Failed: ${failed}/${tests.length}`);

  if (failed === 0) {
    console.log(`\n\u2713 All tests passed!`);
    return;
  }

  console.log(`\n\u2717 Some tests failed`);
  process.exit(1);
}

const baseConfig: ChatGPTSettings = {
  cliPath: "codex",
  model: "gpt-5",
  favoriteModels: ["gpt-5"],
};

async function testStructuredEditResponseEmitsToolEvent(): Promise<void> {
  const originalRunCodexExec = codexCliModule.runCodexExec;
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

  codexCliModule.runCodexExec = async ({ prompt }: { prompt: string }) => {
    capturedPrompt = prompt;
    return "{\"type\":\"active_note_replacement\",\"message\":\"Updated the note\",\"proposedContent\":\"# Updated\"}";
  };

  const strategy = new CodexCliStrategy(
    baseConfig,
    {},
    {
      getCodexPromptInstruction: () => "Use structured edit proposals for explicit note edits.",
      parseCodexEditResponse: async (response: string) => {
        assertTrue(
          response.includes("active_note_replacement"),
          "Structured response should be passed to the internal tool parser",
        );
        return {
          message: "Updated the note",
          toolResult: {
            success: true,
            call: toolCall,
          },
        };
      },
    },
  );

  const chunks: string[] = [];
  const toolEvents: unknown[] = [];

  try {
    const result = await strategy.sendMessage(
      [{ role: ChatRole.User, content: "Rewrite the current note as a checklist." }],
      (chunk) => {
        chunks.push(chunk);
      },
      (call) => {
        toolEvents.push(call);
      },
    );

    assertEqual(result, "Updated the note", "Structured responses should resolve to the tool summary");
    assertEqual(chunks, ["Updated the note"], "Structured responses should stream the summary message");
    assertEqual(toolEvents, [toolCall], "Structured responses should emit the tool event");
    assertTrue(
      capturedPrompt.startsWith("SYSTEM:\nUse structured edit proposals for explicit note edits."),
      "Codex prompt instruction should be prepended to the serialized prompt",
    );
    assertTrue(
      capturedPrompt.includes("USER:\nRewrite the current note as a checklist."),
      "User message should be serialized into the Codex prompt",
    );
  } finally {
    codexCliModule.runCodexExec = originalRunCodexExec;
  }
}

async function testPlainResponseSkipsToolEvent(): Promise<void> {
  const originalRunCodexExec = codexCliModule.runCodexExec;

  codexCliModule.runCodexExec = async () => "Normal conversational answer";

  const strategy = new CodexCliStrategy(
    baseConfig,
    {},
    {
      getCodexPromptInstruction: () => "Be concise.",
      parseCodexEditResponse: async () => null,
    },
  );

  const chunks: string[] = [];
  const toolEvents: unknown[] = [];

  try {
    const result = await strategy.sendMessage(
      [{ role: ChatRole.User, content: "Summarize this note." }],
      (chunk) => {
        chunks.push(chunk);
      },
      (call) => {
        toolEvents.push(call);
      },
    );

    assertEqual(result, "Normal conversational answer", "Plain responses should pass through unchanged");
    assertEqual(chunks, ["Normal conversational answer"], "Plain responses should stream directly");
    assertEqual(toolEvents, [], "Plain responses should not emit tool events");
  } finally {
    codexCliModule.runCodexExec = originalRunCodexExec;
  }
}

void runAsyncTests("Codex CLI strategy", [
  testStructuredEditResponseEmitsToolEvent,
  testPlainResponseSkipsToolEvent,
]);
