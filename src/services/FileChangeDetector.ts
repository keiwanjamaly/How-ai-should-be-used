import { App, TFile, MarkdownView, Component } from "obsidian";
import { FileDiff, DiffService } from "./DiffService";

export interface PendingDiff {
  file: TFile;
  diff: FileDiff;
  timestamp: number;
}

export type ChangeHandler = (pendingDiff: PendingDiff) => void;

export class FileChangeDetector extends Component {
  private readonly baselines = new Map<string, string>();
  private readonly pendingDiffs = new Map<string, PendingDiff>();
  private readonly selfModifiedPaths = new Set<string>();
  private changeHandler?: ChangeHandler;
  private isEnabled = true;
  private editorCheckInterval?: number;

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
        this.updateBaselines();
      })
    );

    // Listen for file modifications via vault events
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (!(file instanceof TFile)) return;
        this.handleFileModify(file);
      })
    );

    // Set up interval to check editor contents for changes
    this.editorCheckInterval = window.setInterval(() => {
      if (this.isEnabled) {
        this.checkOpenEditors();
      }
    }, 1000) as unknown as number;

    // Initialize baselines for currently open files
    this.updateBaselines();
  }

  /**
   * Clean up when the component is unloaded
   */
  onunload(): void {
    if (this.editorCheckInterval) {
      clearInterval(this.editorCheckInterval);
    }
    super.onunload();
  }

  /**
   * Mark a file as self-modified to prevent triggering diff detection
   */
  markAsSelfModified(path: string): void {
    this.selfModifiedPaths.add(path);
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

  /**
   * Check open editors for changes
   */
  private checkOpenEditors(): void {
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    
    for (const leaf of leaves) {
      const view = leaf.view as MarkdownView;
      if (view.file && view.editor && view.getMode() === "source") {
        try {
          const content = view.editor.getValue();
          const baseline = this.baselines.get(view.file.path);

          // If we have a baseline and it differs from current editor content
          // update the baseline (user edited the file)
          if (baseline !== undefined && baseline !== content) {
            this.baselines.set(view.file.path, content);
          }
        } catch (error) {
          console.error(`Failed to check editor for ${view.file.path}:`, error);
        }
      }
    }
  }

  /**
   * Update baselines for all currently open files
   */
  private async updateBaselines(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    
    for (const leaf of leaves) {
      const view = leaf.view as MarkdownView;
      if (view.file && view.editor) {
        try {
          const content = await this.app.vault.read(view.file);
          this.baselines.set(view.file.path, content);
        } catch (error) {
          console.error(`Failed to read baseline for ${view.file.path}:`, error);
        }
      }
    }
  }

  /**
   * Handle file modification event
   */
  private async handleFileModify(file: TFile): Promise<void> {
    if (!this.isEnabled) return;
    if (file.extension !== "md") return;

    // Skip if this was a self-modification
    if (this.selfModifiedPaths.has(file.path)) {
      this.selfModifiedPaths.delete(file.path);
      return;
    }

    // Get the baseline (expected content)
    const baseline = this.baselines.get(file.path);
    if (baseline === undefined) {
      // No baseline yet, set it and return
      try {
        const content = await this.app.vault.read(file);
        this.baselines.set(file.path, content);
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
