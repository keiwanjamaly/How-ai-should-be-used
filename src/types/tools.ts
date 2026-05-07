import type { EditorPosition } from "obsidian";

export interface ActiveNoteEditProposalSelection {
  from: EditorPosition;
  to: EditorPosition;
  startOffset: number;
  endOffset: number;
}

export interface ActiveNoteEditProposal {
  scope: "note" | "selection";
  source: "chat" | "command";
  filePath: string;
  fileName: string;
  originalContent: string;
  proposedContent: string;
  description: string;
  selection?: ActiveNoteEditProposalSelection;
  createdAt: number;
}

export interface ToolExecutionEvent {
  source: "mcp" | "internal" | "provider";
  serverName: string;
  toolName: string;
  qualifiedToolName: string;
  argumentsText: string;
  durationMs: number;
  startedAt: number;
  success: boolean;
  resultText?: string;
  errorText?: string;
  editProposal?: ActiveNoteEditProposal;
}

export interface ToolDefinition {
  source: "mcp" | "internal";
  name: string;
  description?: string;
  inputSchema: unknown;
}

export interface ToolExecutionResult {
  success: boolean;
  content?: string;
  error?: string;
  call?: ToolExecutionEvent;
}
