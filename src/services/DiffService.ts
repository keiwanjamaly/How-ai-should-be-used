import { TFile, App, Vault, Component } from "obsidian";
import { diffLines, Change } from "diff";

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
    await this.app.vault.modify(file, newContent);
  }

  /**
   * Reject changes by restoring the old content
     */
  async rejectChanges(file: TFile, oldContent: string): Promise<void> {
    await this.app.vault.modify(file, oldContent);
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
  getDiffStats(diff: FileDiff): { added: number; removed: number; unchanged: number } {
    return {
      added: diff.changes.filter((c) => c.type === "added").length,
      removed: diff.changes.filter((c) => c.type === "removed").length,
      unchanged: diff.changes.filter((c) => c.type === "unchanged").length,
    };
  }
}
