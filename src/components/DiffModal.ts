import { Modal, App, Setting, Notice, TFile, ButtonComponent, setIcon } from "obsidian";
import { DiffView } from "./DiffView";
import { PendingDiff } from "../services/FileChangeDetector";
import { DiffService } from "../services/DiffService";
import { formatErrorMessage } from "../utils/errorUtils";

export interface DiffModalResult {
  action: "accept" | "reject" | "cancel" | "cherry-pick";
  content?: string;
  acceptedLines?: Set<number>;
  rejectedLines?: Set<number>;
}

export type DiffModalCallback = (result: DiffModalResult) => void;

export class DiffModal extends Modal {
  private diffView?: DiffView;
  private result: DiffModalResult = { action: "cancel" };
  private callbacks: DiffModalCallback;
  private diffService: DiffService;
  private acceptedLines: Set<number> = new Set();
  private rejectedLines: Set<number> = new Set();
  private selectionMode = false;
  private statsEl?: HTMLElement;
  private applyBtn?: ButtonComponent;

  constructor(
    app: App,
    private readonly pendingDiff: PendingDiff,
    callbacks: DiffModalCallback
  ) {
    super(app);
    this.callbacks = callbacks;
    this.diffService = new DiffService(app);
  }

  onOpen(): void {
    const { contentEl } = this;

    contentEl.addClass("oa-diff-modal");
    
    // Title
    this.titleEl.setText(`Review Changes: ${this.pendingDiff.file.name}`);

    // Info text
    const infoEl = contentEl.createDiv({ cls: "oa-diff-info" });
    const infoIcon = infoEl.createSpan({ cls: "oa-diff-info-icon" });
    setIcon(infoIcon, "info");
    infoEl.createSpan({
      text: "Review the changes below. Toggle selection mode to cherry-pick individual changes, or use Accept All/Reject All buttons.",
    });

    // Main content area for diff
    const diffContainer = contentEl.createDiv({ cls: "oa-diff-modal-content" });

    // Create the diff view with granular callbacks
    this.diffView = new DiffView(
      diffContainer,
      this.pendingDiff.diff,
      {
        onAccept: (content) => this.handleAccept(content),
        onReject: () => this.handleReject(),
        onAcceptLine: (lineNumber) => this.handleAcceptLine(lineNumber),
        onRejectLine: (lineNumber) => this.handleRejectLine(lineNumber),
      }
    );

    // Selection mode toggle
    const controlsEl = contentEl.createDiv({ cls: "oa-diff-controls" });
    
    new Setting(controlsEl)
      .setName("Cherry-pick mode")
      .setDesc("Enable to selectively accept/reject individual changes")
      .addToggle((toggle) => {
        toggle.setValue(this.selectionMode);
        toggle.onChange((value) => {
          this.selectionMode = value;
          this.updateSelectionUI();
        });
      });

    // Selection stats
    this.statsEl = contentEl.createDiv({ cls: "oa-diff-selection-stats" });
    this.updateSelectionStats();

    // Footer with action buttons
    const footer = contentEl.createDiv({ cls: "oa-diff-modal-footer" });
    
    new Setting(footer)
      .addButton((btn) =>
        btn
          .setButtonText("Accept All Changes")
          .setCta()
          .onClick(() => {
            this.handleAccept(this.pendingDiff.diff.newContent);
          })
      )
      .addButton((btn) => {
        this.applyBtn = btn
          .setButtonText("Apply Selected")
          .setDisabled(true)
          .setClass("oa-diff-apply-selected")
          .onClick(() => {
            this.handleCherryPick();
          });
        return this.applyBtn;
      })
      .addButton((btn) =>
        btn
          .setButtonText("Reject All Changes")
          .onClick(() => {
            this.handleReject();
          })
      )
      .addButton((btn) =>
        btn
          .setButtonText("Cancel")
          .onClick(() => {
            this.close();
          })
      );
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
    
    // Notify callback with result
    this.callbacks(this.result);
  }

  /**
   * Toggle selection mode UI visibility
   */
  private updateSelectionUI(): void {
    // Add/remove class to show/hide individual line action buttons
    const diffView = this.diffView?.getContainer();
    if (diffView) {
      diffView.toggleClass("oa-diff-selection-mode", this.selectionMode);
    }
  }

  /**
   * Update the selection statistics display
   */
  private updateSelectionStats(): void {
    if (!this.statsEl) return;
    
    this.statsEl.empty();
    const accepted = this.acceptedLines.size;
    const rejected = this.rejectedLines.size;
    
    if (accepted > 0 || rejected > 0) {
      this.statsEl.createEl("span", {
        text: `Selected: ${accepted} accepted, ${rejected} rejected`,
        cls: "oa-diff-stats-text",
      });
    }
  }

  /**
   * Handle accepting a specific line
   */
  private handleAcceptLine(lineNumber: number): void {
    if (!this.selectionMode) return;
    
    if (this.rejectedLines.has(lineNumber)) {
      this.rejectedLines.delete(lineNumber);
    }
    this.acceptedLines.add(lineNumber);
    
    // Update visual state
    this.diffView?.markLineAccepted(lineNumber, "added");
    this.diffView?.markLineAccepted(lineNumber, "removed");
    
    // Update UI
    this.updateSelectionStats();
    
    // Enable the Apply Selected button
    this.updateApplyButtonState();
  }

  /**
   * Handle rejecting a specific line
   */
  private handleRejectLine(lineNumber: number): void {
    if (!this.selectionMode) return;
    
    if (this.acceptedLines.has(lineNumber)) {
      this.acceptedLines.delete(lineNumber);
    }
    this.rejectedLines.add(lineNumber);
    
    // Update visual state
    this.diffView?.markLineRejected(lineNumber, "added");
    this.diffView?.markLineRejected(lineNumber, "removed");
    
    // Update UI
    this.updateSelectionStats();
    
    // Enable the Apply Selected button
    this.updateApplyButtonState();
  }

  /**
   * Update the Apply Selected button state
   */
  private updateApplyButtonState(): void {
    const hasSelections = this.acceptedLines.size > 0 || this.rejectedLines.size > 0;
    if (this.applyBtn) {
      this.applyBtn.setDisabled(!hasSelections);
    }
  }

  /**
   * Handle cherry-picking (applying only selected changes)
   */
  private async handleCherryPick(): Promise<void> {
    try {
      // Generate the content with only selected changes applied
      const result = this.diffService.generateCherryPickResult(
        this.pendingDiff.diff,
        this.acceptedLines,
        this.rejectedLines
      );

      // Check for conflicts
      const currentContent = await this.app.vault.read(this.pendingDiff.file);
      if (currentContent !== this.pendingDiff.diff.oldContent && 
          currentContent !== this.pendingDiff.diff.newContent) {
        this.showConflictWarning(result.content);
        return;
      }

      this.result = {
        action: "cherry-pick",
        content: result.content,
        acceptedLines: this.acceptedLines,
        rejectedLines: this.rejectedLines,
      };
      
      new Notice(`Applied ${result.stats.modified} changes (${result.stats.kept} lines kept, ${result.stats.removed} removed)`);
      this.close();
    } catch (error) {
      new Notice(`Failed to apply selected changes: ${formatErrorMessage(error)}`);
    }
  }

  /**
   * Handle accepting all changes
   */
  private async handleAccept(content: string): Promise<void> {
    try {
      // Check if file has been modified since diff was created
      const currentContent = await this.app.vault.read(this.pendingDiff.file);
      if (currentContent !== this.pendingDiff.diff.newContent && 
          currentContent !== this.pendingDiff.diff.oldContent) {
        // File changed, show warning
        this.showConflictWarning(content);
        return;
      }

      this.result = { action: "accept", content };
      this.close();
    } catch (error) {
      new Notice(`Failed to accept changes: ${formatErrorMessage(error)}`);
    }
  }

  /**
   * Handle rejecting all changes
   */
  private async handleReject(): Promise<void> {
    try {
      this.result = { action: "reject" };
      this.close();
    } catch (error) {
      new Notice(`Failed to reject changes: ${formatErrorMessage(error)}`);
    }
  }

  /**
   * Show conflict warning when file has been modified
   */
  private showConflictWarning(content: string): void {
    const conflictModal = new Modal(this.app);
    conflictModal.titleEl.setText("File Has Changed");
    
    conflictModal.contentEl.createEl("p", {
      text: "This file was modified since the diff was generated. Proceeding will overwrite those changes.",
    });

    new Setting(conflictModal.contentEl)
      .addButton((btn) =>
        btn
          .setButtonText("Proceed Anyway")
          .setWarning()
          .onClick(() => {
            conflictModal.close();
            // Determine which action to preserve
            if (this.result.action === "cherry-pick") {
              this.result = {
                action: "cherry-pick",
                content,
                acceptedLines: this.acceptedLines,
                rejectedLines: this.rejectedLines,
              };
            } else {
              this.result = { action: "accept", content };
            }
            this.close();
          })
      )
      .addButton((btn) =>
        btn
          .setButtonText("Cancel")
          .onClick(() => {
            conflictModal.close();
          })
      );

    conflictModal.open();
  }
}

/**
 * Simple notification modal for when changes are detected
 */
export class ChangeNotificationModal extends Modal {
  constructor(
    app: App,
    private readonly fileName: string,
    private readonly onReview: () => void,
    private readonly onDismiss: () => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("External Changes Detected");
    
    this.contentEl.createEl("p", {
      text: `The file "${this.fileName}" was modified externally. Would you like to review the changes?`,
    });

    new Setting(this.contentEl)
      .addButton((btn) =>
        btn
          .setButtonText("Review Changes")
          .setCta()
          .onClick(() => {
            this.close();
            this.onReview();
          })
      )
      .addButton((btn) =>
        btn
          .setButtonText("Dismiss")
          .onClick(() => {
            this.close();
            this.onDismiss();
          })
      );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
