import { describe, expect, it, vi } from "vitest";
import { ChatRole, type ChatMessage } from "../types.ts";
import {
  buildPDFContextMessage,
  buildPDFContextMessages,
  ChatRequestBuilder,
} from "../views/chat/ChatRequestBuilder.ts";

describe("ChatRequestBuilder helpers", () => {
  it("formats extracted PDF text as a system message", () => {
    expect(buildPDFContextMessage("paper.pdf", "Page 1")).toEqual({
      role: ChatRole.System,
      content: "Extracted PDF content from \"paper.pdf\":\n---\nPage 1\n---",
    });
  });

  it("keeps manual and bib-derived PDF context separate", () => {
    expect(buildPDFContextMessages(
      { filename: "manual.pdf", text: "Manual text" },
      { filename: "bib.pdf", text: "Bib text" },
    )).toEqual([
      {
        role: ChatRole.System,
        content: "Extracted PDF content from \"manual.pdf\":\n---\nManual text\n---",
      },
      {
        role: ChatRole.System,
        content: "Extracted PDF content from \"bib.pdf\":\n---\nBib text\n---",
      },
    ]);
  });
});

describe("ChatRequestBuilder", () => {
  it("builds request messages with file, rag, and pdf context", async () => {
    const file = { name: "Note.md", path: "Notes/Note.md" };
    const messages: ChatMessage[] = [
      { role: ChatRole.User, content: "Previous message" },
      { role: ChatRole.System, content: " " },
    ];

    const builder = new ChatRequestBuilder({
      getSystemPrompt: () => "System prompt",
      getToolUseInstruction: () => "Use tools",
      getActiveFile: () => file as never,
      getActiveSelectionContext: () => ({
        selectedText: "important text",
        from: { line: 1, ch: 2 },
        to: { line: 1, ch: 8 },
      }),
      readFile: vi.fn().mockResolvedValue("# Note body"),
      retrieveRelevantChunks: vi.fn().mockResolvedValue([
        {
          path: "Notes/Other.md",
          title: "Other",
          content: "Retrieved chunk",
        },
      ]),
    });

    const result = await builder.build({
      userQuery: "What matters?",
      includeFileContext: true,
      vaultRAGEnabled: true,
      messages,
      manualPDFContext: { filename: "manual.pdf", text: "Manual text" },
      bibPDFState: {
        notePath: "Notes/Note.md",
        filename: "bib.pdf",
        pdfPath: "/tmp/bib.pdf",
        status: "ready",
        ocrText: "Bib text",
        source: "cache",
      },
    });

    expect(result[0]).toEqual({ role: ChatRole.System, content: "System prompt" });
    expect(result[1]).toEqual({ role: ChatRole.System, content: "Use tools" });
    expect(result[2]?.content).toContain("The user has the following note open (\"Note.md\")");
    expect(result[2]?.content).toContain("important text");
    expect(result[3]?.content).toContain("Retrieved chunk");
    expect(result[4]?.content).toContain("manual.pdf");
    expect(result[5]?.content).toContain("bib.pdf");
    expect(result[result.length - 1]).toEqual({ role: ChatRole.User, content: "Previous message" });
  });

  it("omits file and rag context when disabled", async () => {
    const builder = new ChatRequestBuilder({
      getSystemPrompt: () => "",
      getToolUseInstruction: () => "Use tools",
      getActiveFile: () => null,
      getActiveSelectionContext: () => null,
      readFile: vi.fn(),
      retrieveRelevantChunks: vi.fn(),
    });

    const result = await builder.build({
      userQuery: "Question",
      includeFileContext: false,
      vaultRAGEnabled: false,
      messages: [],
      manualPDFContext: null,
      bibPDFState: {
        notePath: null,
        filename: null,
        pdfPath: null,
        status: "idle",
      },
    });

    expect(result).toEqual([
      { role: ChatRole.System, content: "Use tools" },
    ]);
  });

  it("keeps linked bib pdf context when the prepared note matches even if no active file is available at send time", async () => {
    const builder = new ChatRequestBuilder({
      getSystemPrompt: () => "",
      getToolUseInstruction: () => "Use tools",
      getActiveFile: () => null,
      getActiveSelectionContext: () => null,
      readFile: vi.fn(),
      retrieveRelevantChunks: vi.fn(),
    });

    const result = await builder.build({
      userQuery: "Question",
      includeFileContext: true,
      vaultRAGEnabled: false,
      messages: [],
      manualPDFContext: null,
      bibPDFState: {
        notePath: "Notes/Note.md",
        filename: "bib.pdf",
        pdfPath: "/tmp/bib.pdf",
        status: "ready",
        ocrText: "Bib text",
        source: "cache",
      },
    });

    expect(result).toEqual([
      { role: ChatRole.System, content: "Use tools" },
      {
        role: ChatRole.System,
        content: "Extracted PDF content from \"bib.pdf\":\n---\nBib text\n---",
      },
    ]);
  });
});
