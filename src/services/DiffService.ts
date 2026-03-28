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
   * Build content from selective cherry-pick choices.
   *
   * For each diff change line:
   * - "unchanged" lines are always included.
   * - "added" lines are included only if their newLineNumber is in acceptedChanges.
   *   If in rejectedChanges or in neither set, the added line is excluded.
   * - "removed" lines are excluded (i.e. the removal is accepted) only if their
   *   oldLineNumber is in acceptedChanges. If in rejectedChanges the line is kept.
   *   If in neither set, the line is kept (removal is not applied) — this "keep
   *   original" default for unselected removals may be surprising; see tests.
   */
  buildContentFromSelections(
    changes: DiffChange[],
    acceptedChanges: Set<number>,
    rejectedChanges: Set<number>
  ): string {
    const lines: string[] = [];

    for (const change of changes) {
      if (change.type === "unchanged") {
        lines.push(change.content);
      } else if (change.type === "added") {
        const lineNum = change.newLineNumber!;
        if (acceptedChanges.has(lineNum)) {
          lines.push(change.content);
        }
        // If rejected or unselected, the added line is not included
      } else if (change.type === "removed") {
        const lineNum = change.oldLineNumber!;
        if (acceptedChanges.has(lineNum)) {
          // Removal accepted — line is dropped
        } else {
          // Rejected or unselected — keep the original line
          lines.push(change.content);
        }
      }
    }

    return lines.join("\n") + "\n";
  }

  /**
   * Generate a cherry-pick result from a FileDiff and selection sets.
   * Returns the built content along with the accepted/rejected sets for reporting.
   */
  generateCherryPickResult(
    diff: FileDiff,
    acceptedChanges: Set<number>,
    rejectedChanges: Set<number>
  ): { content: string; acceptedLines: Set<number>; rejectedLines: Set<number> } {
    const content = this.buildContentFromSelections(
      diff.changes,
      acceptedChanges,
      rejectedChanges
    );
    return {
      content,
      acceptedLines: acceptedChanges,
      rejectedLines: rejectedChanges,
    };
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
