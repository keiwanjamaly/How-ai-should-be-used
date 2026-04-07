import { App, TFile, MarkdownView, MarkdownFileInfo, Editor, Component } from "obsidian";
import { FileDiff, DiffService } from "./DiffService";
import { EditorSnapshot, matchesEditorSnapshot } from "../utils/fileChangeDetection";

export interface PendingDiff {
  file: TFile;
  diff: FileDiff;
  timestamp: number;
}

export type ChangeHandler = (pendingDiff: PendingDiff) => void;

export class FileChangeDetector extends Component {
  private readonly baselines = new Map<string, string>();
  private readonly pendingDiffs = new Map<string, PendingDiff>();
  private readonly aiModifiedPaths = new Set<string>();
  private readonly editorSnapshots = new Map<string, EditorSnapshot>();
  private readonly locallyEditedPaths = new Set<string>();
  private changeHandler?: ChangeHandler;
  private isEnabled = true;

  constructor(private readonly app: App, private readonly diffService: DiffService) {
    super();
  }

  /**
   * Set the handler to be called when an external change is detected
   */
  onChange(handler: ChangeHandler): void {
    this.changeHandler = handler;
  }

  /**
   * Returns whether change detection is currently enabled
   */
  getEnabled(): boolean {
    return this.isEnabled;
  }

  /**
   * Enable or disable change detection
   */
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
  }

  /**
   * Initialize the detector and start listening for changes
   */
  initialize(): void {
    // Listen for active leaf changes to track currently open files
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        void this.updateBaselines();
      })
    );

    // Track editor content immediately so normal typing is not mistaken for an external write.
    this.registerEvent(
      this.app.workspace.on("editor-change", (editor, info) => {
        this.handleEditorChange(editor, info);
      })
    );

    // Listen for file modifications via vault events
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (!(file instanceof TFile)) return;
        void this.handleFileModify(file);
      })
    );

    // Initialize baselines for currently open files
    void this.updateBaselines();
  }

  /**
   * Clean up when the component is unloaded
   */
  onunload(): void {
    super.onunload();
  }

  /**
   * Mark a file as modified by the AI to prevent triggering diff detection
   */
  markAsSelfModified(path: string): void {
    this.aiModifiedPaths.add(path);
    this.locallyEditedPaths.delete(path);
    // Remove from pending diffs if present
    this.pendingDiffs.delete(path);
  }

  /**
   * Get all pending diffs
   */
  getPendingDiffs(): PendingDiff[] {
    return Array.from(this.pendingDiffs.values()).sort(
      (a, b) => a.timestamp - b.timestamp
    );
  }

  /**
   * Get pending diff for a specific file
   */
  getPendingDiff(file: TFile): PendingDiff | undefined {
    return this.pendingDiffs.get(file.path);
  }

  /**
   * Remove a pending diff (when accepted or rejected)
   */
  removePendingDiff(path: string): void {
    this.pendingDiffs.delete(path);
    this.baselines.delete(path);
  }

  /**
   * Check if a file has pending diffs
   */
  hasPendingDiff(file: TFile): boolean {
    return this.pendingDiffs.has(file.path);
  }

  /**
   * Clear all pending diffs
   */
  clearAllPendingDiffs(): void {
    this.pendingDiffs.clear();
  }

  private isMarkdownView(view: unknown): view is MarkdownView {
    return view instanceof MarkdownView;
  }

  /**
   * Track live editor changes so in-app edits don't get flagged as external
   */
  private handleEditorChange(editor: Editor, info: MarkdownView | MarkdownFileInfo): void {
    if (!this.isEnabled) {
      return;
    }

    const file = info.file;
    if (!file || file.extension !== "md") {
      return;
    }

    try {
      this.recordEditorSnapshot(file.path, editor.getValue());
      this.locallyEditedPaths.add(file.path);
    } catch (error) {
      console.error(`Failed to capture editor state for ${file.path}:`, error);
    }
  }

  private recordEditorSnapshot(path: string, content: string): void {
    this.baselines.set(path, content);
    this.editorSnapshots.set(path, {
      content,
    });
  }

  /**
   * Update baselines for all currently open files
   */
  private async updateBaselines(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType("markdown");

    const promises = leaves.map(async (leaf) => {
      const view = leaf.view;
      if (!this.isMarkdownView(view) || !view.file) return;

      try {
        const content = view.editor ? view.editor.getValue() : await this.app.vault.read(view.file);
        this.recordEditorSnapshot(view.file.path, content);
      } catch (error) {
        console.error(`Failed to read baseline for ${view.file.path}:`, error);
      }
    });
    
    await Promise.all(promises);
  }

  /**
   * Handle file modification event
   */
  private async handleFileModify(file: TFile): Promise<void> {
    if (!this.isEnabled) return;
    if (file.extension !== "md") return;

    // Skip if this was modified by the AI
    if (this.aiModifiedPaths.has(file.path)) {
      this.aiModifiedPaths.delete(file.path);
      this.locallyEditedPaths.delete(file.path);
      return;
    }

    // Get the baseline (expected content)
    const baseline = this.baselines.get(file.path);
    if (baseline === undefined) {
      // No baseline yet, set it and return
      try {
        const content = await this.app.vault.read(file);
        this.recordEditorSnapshot(file.path, content);
      } catch (error) {
        console.error(`Failed to read file ${file.path}:`, error);
      }
      return;
    }

    // Read current content
    let currentContent: string;
    try {
      currentContent = await this.app.vault.read(file);
    } catch (error) {
      console.error(`Failed to read file ${file.path}:`, error);
      return;
    }

    if (
      this.locallyEditedPaths.has(file.path) &&
      matchesEditorSnapshot(currentContent, this.editorSnapshots.get(file.path))
    ) {
      this.baselines.set(file.path, currentContent);
      this.locallyEditedPaths.delete(file.path);
      return;
    }

    // Check if there are actual changes
    if (baseline === currentContent) {
      return;
    }

    // Create diff
    const diff = this.diffService.createFileDiff(
      file.path,
      baseline,
      currentContent
    );

    // Only process if there are actual changes
    if (!this.diffService.hasChanges(diff)) {
      return;
    }

    // Store pending diff
    const pendingDiff: PendingDiff = {
      file,
      diff,
      timestamp: Date.now(),
    };
    this.pendingDiffs.set(file.path, pendingDiff);

    // Notify handler
    if (this.changeHandler) {
      this.changeHandler(pendingDiff);
    }
  }

  /**
   * Force check a specific file for changes
   */
  async checkFile(file: TFile): Promise<PendingDiff | null> {
    if (file.extension !== "md") return null;

    try {
      const baseline = this.baselines.get(file.path);
      const currentContent = await this.app.vault.read(file);

      // If no baseline, set it and return
      if (baseline === undefined) {
        this.baselines.set(file.path, currentContent);
        return null;
      }

      // Check for changes
      if (baseline === currentContent) {
        return null;
      }

      const diff = this.diffService.createFileDiff(file.path, baseline, currentContent);
      
      if (!this.diffService.hasChanges(diff)) {
        return null;
      }

      const pendingDiff: PendingDiff = {
        file,
        diff,
        timestamp: Date.now(),
      };
      this.pendingDiffs.set(file.path, pendingDiff);
      return pendingDiff;
    } catch (error) {
      console.error(`Failed to check file ${file.path}:`, error);
      return null;
    }
  }
}
