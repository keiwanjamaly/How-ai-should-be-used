import { FileDiff, DiffChange } from "../services/DiffService";

export interface DiffViewCallbacks {
  onAccept: (content: string) => void;
  onReject: () => void;
  onAcceptLine?: (lineNumber: number) => void;
  onRejectLine?: (lineNumber: number) => void;
}

export class DiffView {
  private container: HTMLElement;
  private oldContentEl!: HTMLElement;
  private newContentEl!: HTMLElement;
  private gutterEl!: HTMLElement;
  private callbacks: DiffViewCallbacks;

  constructor(
    parent: HTMLElement,
    private readonly diff: FileDiff,
    callbacks: DiffViewCallbacks
  ) {
    this.callbacks = callbacks;
    this.container = parent.createDiv({ cls: "oa-diff-view" });
    this.buildView();
  }

  /**
   * Build the diff view UI
   */
  private buildView(): void {
    // Header with file info and stats
    const header = this.container.createDiv({ cls: "oa-diff-header" });
    header.createEl("h3", { 
      text: this.diff.path,
      cls: "oa-diff-title" 
    });
    
    const stats = this.calculateStats();
    const statsEl = header.createDiv({ cls: "oa-diff-stats" });
    statsEl.createSpan({ 
      text: `+${stats.added} -${stats.removed}`,
      cls: "oa-diff-stats-text"
    });

    // Action buttons
    const actions = header.createDiv({ cls: "oa-diff-actions" });
    
    const acceptBtn = actions.createEl("button", {
      cls: "mod-cta oa-diff-accept",
      text: "Accept All",
    });
    acceptBtn.addEventListener("click", () => {
      this.callbacks.onAccept(this.diff.newContent);
    });

    const rejectBtn = actions.createEl("button", {
      cls: "oa-diff-reject",
      text: "Reject All",
    });
    rejectBtn.addEventListener("click", () => {
      this.callbacks.onReject();
    });

    // Diff container
    const diffContainer = this.container.createDiv({ cls: "oa-diff-container" });

    // Line numbers gutter
    this.gutterEl = diffContainer.createDiv({ cls: "oa-diff-gutter" });

    // Old content panel (read-only view of original)
    const oldPanel = diffContainer.createDiv({ cls: "oa-diff-panel oa-diff-old" });
    oldPanel.createDiv({ cls: "oa-diff-panel-header", text: "Original" });
    this.oldContentEl = oldPanel.createDiv({ cls: "oa-diff-content" });

    // New content panel (editable view with changes)
    const newPanel = diffContainer.createDiv({ cls: "oa-diff-panel oa-diff-new" });
    newPanel.createDiv({ cls: "oa-diff-panel-header", text: "Modified" });
    this.newContentEl = newPanel.createDiv({ cls: "oa-diff-content" });

    // Render the diff
    this.renderDiff();
  }

  /**
   * Render the diff content line by line
   */
  private renderDiff(): void {
    let oldLineNum = 1;
    let newLineNum = 1;

    for (const change of this.diff.changes) {
      // Gutter line number
      const gutterLine = this.gutterEl.createDiv({ cls: "oa-diff-gutter-line" });
      
      if (change.type === "removed") {
        // Only in old content
        gutterLine.setText(oldLineNum.toString());
        this.renderChangeLine(this.oldContentEl, change, "removed", oldLineNum);
        this.renderEmptyLine(this.newContentEl, newLineNum);
        oldLineNum++;
      } else if (change.type === "added") {
        // Only in new content
        gutterLine.setText(newLineNum.toString());
        this.renderEmptyLine(this.oldContentEl, oldLineNum);
        this.renderChangeLine(this.newContentEl, change, "added", newLineNum);
        newLineNum++;
      } else {
        // Unchanged - in both
        gutterLine.setText(`${oldLineNum}`);
        this.renderChangeLine(this.oldContentEl, change, "unchanged", oldLineNum);
        this.renderChangeLine(this.newContentEl, change, "unchanged", newLineNum);
        oldLineNum++;
        newLineNum++;
      }
    }
  }

  /**
   * Render a single change line
   */
  private renderChangeLine(
    container: HTMLElement, 
    change: DiffChange, 
    type: "added" | "removed" | "unchanged",
    lineNumber: number
  ): void {
    const line = container.createDiv({ 
      cls: `oa-diff-line oa-diff-${type}`,
      attr: { "data-line": lineNumber.toString() }
    });

    // Line prefix indicator
    const prefix = line.createSpan({ cls: "oa-diff-prefix" });
    if (type === "added") {
      prefix.setText("+");
    } else if (type === "removed") {
      prefix.setText("-");
    } else {
      prefix.setText(" ");
    }

    // Line content
    const content = line.createSpan({ cls: "oa-diff-line-content" });
    content.setText(change.content || " ");

    // Add action buttons for individual line changes
    if (type !== "unchanged" && this.callbacks.onAcceptLine && this.callbacks.onRejectLine) {
      const actions = line.createDiv({ cls: "oa-diff-line-actions" });
      
      const acceptBtn = actions.createEl("button", {
        cls: "oa-diff-line-btn oa-diff-line-accept",
        text: "✓",
        attr: { title: "Accept this change" }
      });
      acceptBtn.addEventListener("click", () => {
        this.callbacks.onAcceptLine?.(lineNumber);
      });

      const rejectBtn = actions.createEl("button", {
        cls: "oa-diff-line-btn oa-diff-line-reject",
        text: "✕",
        attr: { title: "Reject this change" }
      });
      rejectBtn.addEventListener("click", () => {
        this.callbacks.onRejectLine?.(lineNumber);
      });
    }
  }

  /**
   * Render an empty line placeholder
   */
  private renderEmptyLine(container: HTMLElement, lineNumber: number): void {
    const line = container.createDiv({ 
      cls: "oa-diff-line oa-diff-empty",
      attr: { "data-line": lineNumber.toString() }
    });
    line.createSpan({ cls: "oa-diff-prefix" }).setText(" ");
    line.createSpan({ cls: "oa-diff-line-content" }).setText(" ");
  }

  /**
   * Calculate statistics for the diff
   */
  private calculateStats(): { added: number; removed: number; unchanged: number } {
    return {
      added: this.diff.changes.filter((c) => c.type === "added").length,
      removed: this.diff.changes.filter((c) => c.type === "removed").length,
      unchanged: this.diff.changes.filter((c) => c.type === "unchanged").length,
    };
  }

  /**
   * Get the container element
   */
  getContainer(): HTMLElement {
    return this.container;
  }

  /**
   * Destroy the view and clean up
   */
  destroy(): void {
    this.container.remove();
  }
}
