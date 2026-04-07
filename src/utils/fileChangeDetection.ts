export interface EditorSnapshot {
  content: string;
  timestamp: number;
}

export const LOCAL_EDIT_GRACE_PERIOD_MS = 3000;

/**
 * A vault modify event that matches the latest editor snapshot within a short
 * grace period is treated as a normal in-app save rather than an external edit.
 */
export function isRecentLocalEdit(
  currentContent: string,
  snapshot?: EditorSnapshot,
  now: number = Date.now(),
): boolean {
  if (!snapshot) {
    return false;
  }

  if (snapshot.content !== currentContent) {
    return false;
  }

  return now - snapshot.timestamp <= LOCAL_EDIT_GRACE_PERIOD_MS;
}
