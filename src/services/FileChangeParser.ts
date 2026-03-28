import { TFile, App } from "obsidian";

export interface DetectedFileChange {
  file: TFile;
  originalContent: string;
  proposedContent: string;
  description: string;
}

export class FileChangeParser {
  constructor(private readonly app: App) {}

  /**
   * Parse AI response to detect file modification proposals
   * Looks for patterns like:
   * - Content between --- markers
   * - Code blocks with explicit file content
   * - "Here's the updated..." followed by content
   */
  parseAIResponse(response: string, activeFile: TFile | null): DetectedFileChange | null {
    if (!activeFile) {
      return null;
    }

    // Pattern 1: Content wrapped in --- (horizontal rules)
    // Matches: Text\n---\ncontent\n---
    const horizontalRulePattern = /(?:Here'?s?\s+(?:the\s+)?updated\s+(?:note|file).*?)?\n---\n([\s\S]*?)\n---\s*(?:\n|$)/i;
    const hrMatch = response.match(horizontalRulePattern);
    
    if (hrMatch) {
      const proposedContent = hrMatch[1].trim();
      if (proposedContent.length > 0) {
        return {
          file: activeFile,
          originalContent: "", // Will be filled in later
          proposedContent: proposedContent,
          description: this.extractChangeDescription(response, hrMatch.index || 0),
        };
      }
    }

    // Pattern 2: Markdown code blocks with file path in info string
    // Matches: ```markdown filepath.md
    //          content
    //          ```
    const codeBlockPattern = /```(?:markdown|md)?\s*(\S+\.\w+)?\n([\s\S]*?)```/;
    const codeMatch = response.match(codeBlockPattern);
    
    if (codeMatch) {
      const proposedContent = codeMatch[2].trim();
      if (proposedContent.length > 0) {
        return {
          file: activeFile,
          originalContent: "", // Will be filled in later
          proposedContent: proposedContent,
          description: this.extractChangeDescription(response, codeMatch.index || 0),
        };
      }
    }

    // Pattern 3: "Updated content:" or similar headers followed by content
    const updateHeaderPattern = /(?:updated?\s+(?:content|file|note)|new\s+(?:content|version))[:\s]\n+([\s\S]{50,})/i;
    const updateMatch = response.match(updateHeaderPattern);
    
    if (updateMatch) {
      const proposedContent = updateMatch[1].trim();
      // Only consider substantial content (at least 50 chars to avoid false positives)
      if (proposedContent.length >= 50) {
        return {
          file: activeFile,
          originalContent: "",
          proposedContent: proposedContent,
          description: this.extractChangeDescription(response, updateMatch.index || 0),
        };
      }
    }

    return null;
  }

  /**
   * Extract a description of the change from the text before the content
   */
  private extractChangeDescription(response: string, contentIndex: number): string {
    const textBefore = response.substring(0, contentIndex).trim();
    
    // Get the last sentence or line before the content
    const sentences = textBefore.split(/[.!?]\s+/);
    const lastSentence = sentences[sentences.length - 1];
    
    if (lastSentence.length > 10) {
      return lastSentence.trim();
    }
    
    return "AI proposed changes";
  }

  /**
   * Check if response likely contains a file modification proposal
   */
  hasFileModification(response: string): boolean {
    const indicators = [
      /---\n[\s\S]{50,}\n---/, // Content between horizontal rules
      /```(?:markdown|md)?\s*\S*\.\w*\n[\s\S]{50,}```/, // Code block with file extension
      /updated?\s+(?:content|file|note).*:/i, // "Updated content:" header
      /here'?s?\s+(?:the\s+)?updated/i, // "Here's the updated..."
      /changed?\s+.*to\s+/i, // "changed X to Y"
    ];

    return indicators.some(pattern => pattern.test(response));
  }
}
