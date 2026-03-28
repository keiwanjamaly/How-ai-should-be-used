import type { FileDiff } from "../services/DiffService";

export interface DiffStats {
  added: number;
  removed: number;
  unchanged: number;
}

/**
 * Calculate statistics for a diff
 */
export function calculateDiffStats(diff: FileDiff): DiffStats {
  let added = 0;
  let removed = 0;
  let unchanged = 0;

  for (const change of diff.changes) {
    if (change.type === "added") {
      added++;
    } else if (change.type === "removed") {
      removed++;
    } else {
      unchanged++;
    }
  }

  return { added, removed, unchanged };
}
