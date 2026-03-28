import { TFile, App, Vault, Component } from "obsidian";
import { diffLines, Change } from "diff";
import { formatErrorMessage } from "../utils/errorUtils";
import { calculateDiffStats, type DiffStats } from "../utils/diffStats";

export interface FileDiff {
  path: string;
  oldContent: string;
  newContent: string;
  changes: DiffChange[];
}

export interface DiffChange {
  type: "added" | "removed" | "unchanged";
  oldLineNumber?: number;
  newLineNumber?: number;
  content: string;
}

export class DiffService {
  constructor(private readonly app: App) {}

  /**
   * Calculate the diff between two text contents
   */
  calculateDiff(oldContent: string, newContent: string): DiffChange[] {
    const changes = diffLines(oldContent, newContent);
    return this.convertToDiffChanges(changes);
  }

  /**
   * Create a FileDiff object from file path and contents
   */
  createFileDiff(path: string, oldContent: string, newContent: string): FileDiff {
    const changes = this.calculateDiff(oldContent, newContent);
    return {
      path,
      oldContent,
      newContent,
      changes,
    };
  }

  /**
   * Apply a diff to accept the new content (overwrite file)
   */
  async acceptChanges(file: TFile, newContent: string): Promise<void> {
    try {
      await this.app.vault.modify(file, newContent);
    } catch (error) {
      throw new Error(`Failed to accept changes for ${file.path}: ${formatErrorMessage(error)}`);
    }
  }

  /**
   * Reject changes by restoring the old content
   */
  async rejectChanges(file: TFile, oldContent: string): Promise<void> {
    try {
      await this.app.vault.modify(file, oldContent);
    } catch (error) {
      throw new Error(`Failed to reject changes for ${file.path}: ${formatErrorMessage(error)}`);
    }
  }

  /**
   * Convert diff library output to our format with line numbers
   */
  private convertToDiffChanges(changes: Change[]): DiffChange[] {
    const result: DiffChange[] = [];
    let oldLineNumber = 1;
    let newLineNumber = 1;

    for (const change of changes) {
      const lines = change.value.split("\n");
      // Remove empty line at end if content ends with newline
      if (lines[lines.length - 1] === "") {
        lines.pop();
      }

      for (const line of lines) {
        if (change.added) {
          result.push({
            type: "added",
            newLineNumber: newLineNumber++,
            content: line,
          });
        } else if (change.removed) {
          result.push({
            type: "removed",
            oldLineNumber: oldLineNumber++,
            content: line,
          });
        } else {
          result.push({
            type: "unchanged",
            oldLineNumber: oldLineNumber++,
            newLineNumber: newLineNumber++,
            content: line,
          });
        }
      }
    }

    return result;
  }

  /**
   * Check if there are any actual changes in the diff
   */
  hasChanges(diff: FileDiff): boolean {
    return diff.changes.some((change) => change.type !== "unchanged");
  }

  /**
   * Get statistics about the diff
   */
  getDiffStats(diff: FileDiff): DiffStats {
    return calculateDiffStats(diff);
  }

  /**
   * Build content from selected changes
   * @param diff The original file diff
   * @param acceptedChanges Set of line numbers (newLineNumber for added, oldLineNumber for removed) to accept
   * @param rejectedChanges Set of line numbers to reject
   * @returns The resulting content after applying selective changes
   */
  buildContentFromSelections(
    diff: FileDiff,
    acceptedChanges: Set<number>,
    rejectedChanges: Set<number>
  ): string {
    const lines: string[] = [];
    
    for (const change of diff.changes) {
      if (change.type === "unchanged") {
        // Always include unchanged lines
        lines.push(change.content);
      } else if (change.type === "added") {
        const lineNum = change.newLineNumber;
        if (lineNum === undefined) continue;
        // Include added lines that are accepted AND not rejected
        if (acceptedChanges.has(lineNum) && !rejectedChanges.has(lineNum)) {
          lines.push(change.content);
        }
        // Otherwise, skip this added line
      } else if (change.type === "removed") {
        const lineNum = change.oldLineNumber;
        if (lineNum === undefined) continue;
        // Include removed lines (from original) if they're rejected
        // OR if they're not specifically accepted (meaning we keep the original)
        if (rejectedChanges.has(lineNum) || !acceptedChanges.has(lineNum)) {
          lines.push(change.content);
        }
        // If accepted, we don't include the removed line (it stays removed)
      }
    }
    
    return lines.join("\n");
  }

  /**
   * Generate the final content after processing all cherry-pick selections
   * @param originalDiff The original diff between old and new content
   * @param acceptedLines Set of line numbers that were explicitly accepted
   * @param rejectedLines Set of line numbers that were explicitly rejected
   * @returns Object with the resulting content and a summary of changes
   */
  generateCherryPickResult(
    originalDiff: FileDiff,
    acceptedLines: Set<number>,
    rejectedLines: Set<number>
  ): { content: string; stats: { kept: number; removed: number; modified: number } } {
    const result = this.buildContentFromSelections(originalDiff, acceptedLines, rejectedLines);
    
    // Calculate stats
    let kept = 0;
    let removed = 0;
    let modified = 0;
    
    for (const change of originalDiff.changes) {
      if (change.type === "unchanged") {
        kept++;
      } else if (change.type === "added") {
        const lineNum = change.newLineNumber;
        if (lineNum !== undefined && acceptedLines.has(lineNum) && !rejectedLines.has(lineNum)) {
          modified++; // This was a new addition that was accepted
        }
      } else if (change.type === "removed") {
        const lineNum = change.oldLineNumber;
        if (lineNum !== undefined) {
          if (rejectedLines.has(lineNum) || !acceptedLines.has(lineNum)) {
            kept++; // Original line was kept
          } else {
            removed++; // Line was removed
          }
        }
      }
    }
    
    return {
      content: result,
      stats: { kept, removed, modified },
    };
  }

}
