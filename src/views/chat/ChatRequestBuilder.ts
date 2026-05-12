import type { TFile } from "obsidian";
import { ChatRole, type ChatMessage } from "../../types";
import type { VaultChunk } from "../../services/VaultRAGService";
import {
  getReadyBibPDFContext,
  type BibPDFPreparationState,
} from "../../services/BibPDFPreparationService";

export interface FileSelectionContext {
  selectedText: string;
  from: { line: number; ch: number };
  to: { line: number; ch: number };
}

export interface PDFContextPayload {
  filename: string;
  text: string;
}

export interface ChatRequestBuilderOptions {
  getSystemPrompt: () => string;
  getToolUseInstruction: () => string;
  getActiveFile: () => TFile | null;
  getActiveSelectionContext: () => FileSelectionContext | null;
  readFile: (file: TFile) => Promise<string>;
  retrieveRelevantChunks: (query: string, activeFilePath?: string) => Promise<VaultChunk[]>;
}

export interface BuildRequestMessagesArgs {
  userQuery: string;
  includeFileContext: boolean;
  vaultRAGEnabled: boolean;
  messages: ChatMessage[];
  manualPDFContext: PDFContextPayload | null;
  bibPDFState: BibPDFPreparationState;
}

export function buildPDFContextMessage(filename: string, text: string): ChatMessage {
  return {
    role: ChatRole.System,
    content: `Extracted PDF content from "${filename}":\n---\n${text}\n---`,
  };
}

export function buildPDFContextMessages(
  manualPDF: PDFContextPayload | null,
  bibPDF: PDFContextPayload | null,
): ChatMessage[] {
  const messages: ChatMessage[] = [];
  if (manualPDF) {
    messages.push(buildPDFContextMessage(manualPDF.filename, manualPDF.text));
  }
  if (bibPDF) {
    messages.push(buildPDFContextMessage(bibPDF.filename, bibPDF.text));
  }
  return messages;
}

export class ChatRequestBuilder {
  constructor(private readonly options: ChatRequestBuilderOptions) {}

  async build(args: BuildRequestMessagesArgs): Promise<ChatMessage[]> {
    const requestMessages: ChatMessage[] = [];

    const systemPrompt = this.options.getSystemPrompt().trim();
    if (systemPrompt) {
      requestMessages.push({
        role: ChatRole.System,
        content: systemPrompt,
      });
    }

    requestMessages.push({
      role: ChatRole.System,
      content: this.options.getToolUseInstruction(),
    });

    const fileContext = await this.buildFileContextMessage(args.includeFileContext);
    if (fileContext) {
      requestMessages.push(fileContext);
    }

    const vaultContext = await this.buildVaultContextMessage(args.userQuery, args.vaultRAGEnabled);
    if (vaultContext) {
      requestMessages.push(vaultContext);
    }

    requestMessages.push(...buildPDFContextMessages(
      args.manualPDFContext,
      getReadyBibPDFContext(
        args.bibPDFState,
        args.includeFileContext ? args.bibPDFState.notePath : null,
      ),
    ));

    requestMessages.push(...args.messages.filter((message) => message.content?.trim()));
    return requestMessages;
  }

  private async buildFileContextMessage(includeFileContext: boolean): Promise<ChatMessage | null> {
    if (!includeFileContext) {
      return null;
    }

    const file = this.options.getActiveFile();
    if (!file) {
      return null;
    }

    const content = await this.options.readFile(file);
    const selection = this.options.getActiveSelectionContext();
    const selectionContext = selection
      ? [
        "",
        `The user currently has this text selected (${selection.from.line + 1}:${selection.from.ch} to ${selection.to.line + 1}:${selection.to.ch}):`,
        "---",
        selection.selectedText,
        "---",
        "If the user asks to replace only that part, prefer a selection replacement instead of rewriting the whole note.",
      ].join("\n")
      : "";

    return {
      role: ChatRole.System,
      content: `The user has the following note open ("${file.name}"):\n---\n${content}\n---\nRefer to this note when answering the user's questions.${selectionContext}`,
    };
  }

  private async buildVaultContextMessage(
    query: string,
    vaultRAGEnabled: boolean,
  ): Promise<ChatMessage | null> {
    if (!vaultRAGEnabled) {
      return null;
    }

    const chunks = await this.options.retrieveRelevantChunks(
      query,
      this.options.getActiveFile()?.path,
    );

    if (chunks.length === 0) {
      return null;
    }

    const formattedChunks = chunks.map((chunk, index) => [
      `Snippet ${index + 1}`,
      `Path: ${chunk.path}`,
      `Title: ${chunk.title}`,
      chunk.content,
    ].join("\n")).join("\n\n---\n\n");

    return {
      role: ChatRole.System,
      content: [
        "Use the following retrieved vault snippets as optional grounding context.",
        "Prefer them when they are relevant, and cite note paths naturally when you rely on them.",
        "---",
        formattedChunks,
        "---",
      ].join("\n"),
    };
  }
}
