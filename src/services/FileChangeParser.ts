import { App, TFile } from "obsidian";

export interface DetectedFileChange {
  file: TFile;
  originalContent: string;
  proposedContent: string;
}

/**
 * Parses AI responses to detect proposed file modifications.
 */
export class FileChangeParser {
  constructor(private readonly app: App) {}

  /**
   * Check whether the AI response contains a file modification proposal
   * (e.g. a fenced code block that rewrites the active file).
   */
  hasFileModification(response: string): boolean {
    // Look for fenced code blocks that look like full file rewrites
    return /```[\w]*\n[\s\S]+?\n```/.test(response);
  }

  /**
   * Attempt to extract the proposed new content from the AI response
   * for the given active file.
   */
  parseAIResponse(
    response: string,
    activeFile: TFile,
  ): DetectedFileChange | null {
    const codeBlockMatch = response.match(/```[\w]*\n([\s\S]+?)\n```/);
    if (!codeBlockMatch) return null;

    return {
      file: activeFile,
      originalContent: "",
      proposedContent: codeBlockMatch[1],
    };
  }
}
