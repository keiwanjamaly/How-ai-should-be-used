export interface EditorSnapshot {
  content: string;
}

/**
 * A vault modify event that matches the latest editor snapshot is treated as a
 * normal in-app save rather than an external edit.
 */
export function matchesEditorSnapshot(
  currentContent: string,
  snapshot?: EditorSnapshot,
): boolean {
  if (!snapshot) {
    return false;
  }

  return snapshot.content === currentContent;
}
