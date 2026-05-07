import { App, MarkdownView, TFile, type EditorPosition } from "obsidian";
import type { ToolDefinition, ToolExecutionResult } from "../types/tools";
import {
  ACTIVE_NOTE_REPLACEMENT_TOOL_SCHEMA,
  ACTIVE_SELECTION_REPLACEMENT_TOOL_SCHEMA,
  buildCodexEditInstruction,
  buildToolUseInstruction,
  parseCodexEditEnvelope,
  PROPOSE_ACTIVE_NOTE_REPLACEMENT_TOOL,
  PROPOSE_ACTIVE_SELECTION_REPLACEMENT_TOOL,
  type ActiveNoteReplacementArgs,
  type ActiveSelectionReplacementArgs,
} from "./InternalToolProtocol";

export class InternalToolService {
  private lastMarkdownView: MarkdownView | null = null;
  private lastSelectionContext: {
    filePath: string;
    selectedText: string;
    from: EditorPosition;
    to: EditorPosition;
  } | null = null;

  constructor(private readonly app: App) {}

  getAvailableTools(): ToolDefinition[] {
    return [
      {
        source: "internal",
        name: PROPOSE_ACTIVE_NOTE_REPLACEMENT_TOOL,
        description: "Create a structured replacement proposal for the active markdown note.",
        inputSchema: ACTIVE_NOTE_REPLACEMENT_TOOL_SCHEMA,
      },
      {
        source: "internal",
        name: PROPOSE_ACTIVE_SELECTION_REPLACEMENT_TOOL,
        description: "Create a structured replacement proposal for the current editor selection.",
        inputSchema: ACTIVE_SELECTION_REPLACEMENT_TOOL_SCHEMA,
      },
    ];
  }

  hasTool(name: string): boolean {
    return name === PROPOSE_ACTIVE_NOTE_REPLACEMENT_TOOL
      || name === PROPOSE_ACTIVE_SELECTION_REPLACEMENT_TOOL;
  }

  getCodexPromptInstruction(): string {
    return buildCodexEditInstruction();
  }

  getToolUseInstruction(): string {
    return buildToolUseInstruction(this.getActiveSelectionContext() !== null);
  }

  async executeTool(name: string, args: unknown): Promise<ToolExecutionResult> {
    if (
      name !== PROPOSE_ACTIVE_NOTE_REPLACEMENT_TOOL
      && name !== PROPOSE_ACTIVE_SELECTION_REPLACEMENT_TOOL
    ) {
      return this.buildFailureResult(
        name,
        args,
        `Internal tool "${name}" not found`,
        0,
        Date.now(),
      );
    }

    const startedAt = Date.now();
    const argumentsText = this.safeStringify(args);

    try {
      const proposal = name === PROPOSE_ACTIVE_NOTE_REPLACEMENT_TOOL
        ? await this.buildActiveNoteReplacementProposal(args)
        : await this.buildActiveSelectionReplacementProposal(args);
      const resultText = `Prepared a replacement proposal for ${proposal.fileName}.`;

      return {
        success: true,
        content: resultText,
        call: {
          source: "internal",
          serverName: "internal",
          toolName: name,
          qualifiedToolName: name,
          argumentsText,
          durationMs: Date.now() - startedAt,
          startedAt,
          success: true,
          resultText,
          editProposal: proposal,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.buildFailureResult(
        name,
        args,
        message,
        Date.now() - startedAt,
        startedAt,
      );
    }
  }

  async parseCodexEditResponse(response: string): Promise<{
    message: string;
    toolResult: ToolExecutionResult;
  } | null> {
    const envelope = parseCodexEditEnvelope(response);
    if (!envelope) {
      return null;
    }

    const toolResult = envelope.type === "active_note_replacement"
      ? await this.executeTool(PROPOSE_ACTIVE_NOTE_REPLACEMENT_TOOL, {
        proposedContent: envelope.proposedContent,
        message: envelope.message,
      })
      : await this.executeTool(PROPOSE_ACTIVE_SELECTION_REPLACEMENT_TOOL, {
        replacement: envelope.replacement,
        message: envelope.message,
      });

    return {
      message: envelope.message,
      toolResult,
    };
  }

  getActiveSelectionContext(): {
    selectedText: string;
    from: EditorPosition;
    to: EditorPosition;
  } | null {
    const view = this.getTrackedMarkdownView();
    if (!view?.file || view.file.extension !== "md") {
      return null;
    }

    const liveSelection = this.getLiveSelectionContext(view);
    if (liveSelection) {
      this.lastSelectionContext = {
        filePath: view.file.path,
        ...liveSelection,
      };
      return liveSelection;
    }

    if (this.lastSelectionContext?.filePath === view.file.path) {
      return {
        selectedText: this.lastSelectionContext.selectedText,
        from: this.lastSelectionContext.from,
        to: this.lastSelectionContext.to,
      };
    }

    return null;
  }

  captureMarkdownViewContext(): void {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView?.file?.extension === "md") {
      this.lastMarkdownView = activeView;
      const liveSelection = this.getLiveSelectionContext(activeView);
      if (liveSelection) {
        this.lastSelectionContext = {
          filePath: activeView.file.path,
          ...liveSelection,
        };
      } else if (this.lastSelectionContext?.filePath !== activeView.file.path) {
        this.lastSelectionContext = null;
      }
    }
  }

  private parseReplacementArgs(args: unknown): ActiveNoteReplacementArgs {
    if (typeof args !== "object" || args === null || Array.isArray(args)) {
      throw new Error("Internal tool arguments must be an object.");
    }

    const raw = args as Record<string, unknown>;
    const proposedContent = typeof raw.proposedContent === "string"
      ? raw.proposedContent.trim()
      : "";

    if (!proposedContent) {
      throw new Error("Replacement proposals require non-empty proposedContent.");
    }

    const message = typeof raw.message === "string" ? raw.message.trim() : "";

    return {
      proposedContent,
      message: message || undefined,
    };
  }

  private parseSelectionReplacementArgs(args: unknown): ActiveSelectionReplacementArgs {
    if (typeof args !== "object" || args === null || Array.isArray(args)) {
      throw new Error("Internal tool arguments must be an object.");
    }

    const raw = args as Record<string, unknown>;
    const replacement = typeof raw.replacement === "string"
      ? raw.replacement.trim()
      : "";

    if (!replacement) {
      throw new Error("Selection replacement proposals require non-empty replacement.");
    }

    const message = typeof raw.message === "string" ? raw.message.trim() : "";

    return {
      replacement,
      message: message || undefined,
    };
  }

  private async buildActiveNoteReplacementProposal(args: unknown) {
    const parsedArgs = this.parseReplacementArgs(args);
    const file = this.getActiveMarkdownFile();
    const originalContent = await this.app.vault.cachedRead(file);

    return {
      scope: "note" as const,
      source: "chat" as const,
      filePath: file.path,
      fileName: file.name,
      originalContent,
      proposedContent: parsedArgs.proposedContent,
      description: parsedArgs.message || "AI proposed changes",
      createdAt: Date.now(),
    };
  }

  private async buildActiveSelectionReplacementProposal(args: unknown) {
    const parsedArgs = this.parseSelectionReplacementArgs(args);
    const file = this.getActiveMarkdownFile();
    const originalContent = await this.app.vault.cachedRead(file);
    const selection = this.getActiveSelectionContext();
    if (!selection) {
      throw new Error("No active text selection is available.");
    }

    const view = this.getTrackedMarkdownView();
    const editor = view?.editor;
    if (!editor) {
      throw new Error("No active markdown editor is available.");
    }

    const startOffset = editor.posToOffset(selection.from);
    const endOffset = editor.posToOffset(selection.to);
    const proposedContent =
      originalContent.slice(0, startOffset)
      + parsedArgs.replacement
      + originalContent.slice(endOffset);

    return {
      scope: "selection" as const,
      source: "chat" as const,
      filePath: file.path,
      fileName: file.name,
      originalContent,
      proposedContent,
      description: parsedArgs.message || "AI proposed changes",
      selection: {
        from: selection.from,
        to: selection.to,
        startOffset,
        endOffset,
      },
      createdAt: Date.now(),
    };
  }

  private getTrackedMarkdownView(): MarkdownView | null {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView?.file?.extension === "md") {
      this.lastMarkdownView = activeView;
      return activeView;
    }

    if (this.lastMarkdownView?.file?.extension === "md") {
      return this.lastMarkdownView;
    }

    const markdownLeaf = this.app.workspace.getLeavesOfType("markdown")[0];
    const leafView = markdownLeaf?.view;
    if (leafView instanceof MarkdownView && leafView.file?.extension === "md") {
      this.lastMarkdownView = leafView;
      return leafView;
    }

    return null;
  }

  private getLiveSelectionContext(view: MarkdownView): {
    selectedText: string;
    from: EditorPosition;
    to: EditorPosition;
  } | null {
    const editor = view.editor;
    if (!editor || !editor.somethingSelected()) {
      return null;
    }

    const selectedText = editor.getSelection();
    if (!selectedText.trim()) {
      return null;
    }

    return {
      selectedText,
      from: editor.getCursor("from"),
      to: editor.getCursor("to"),
    };
  }

  private getActiveMarkdownFile(): TFile {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      throw new Error("No active note is open.");
    }
    if (file.extension !== "md") {
      throw new Error("Structured note edits only support active markdown notes.");
    }
    return file;
  }

  private buildFailureResult(
    toolName: string,
    args: unknown,
    errorText: string,
    durationMs: number,
    startedAt: number,
  ): ToolExecutionResult {
    return {
      success: false,
      error: errorText,
      call: {
        source: "internal",
        serverName: "internal",
        toolName,
        qualifiedToolName: toolName,
        argumentsText: this.safeStringify(args),
        durationMs,
        startedAt,
        success: false,
        errorText,
      },
    };
  }

  private safeStringify(value: unknown): string {
    if (typeof value === "string") {
      return value;
    }

    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
}
