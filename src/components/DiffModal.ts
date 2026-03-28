import { Modal, App, Setting, Notice, TFile } from "obsidian";
import { DiffView } from "./DiffView";
import { PendingDiff } from "../services/FileChangeDetector";
import { DiffService } from "../services/DiffService";

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

    // Main content area for diff
    const diffContainer = contentEl.createDiv({ cls: "oa-diff-modal-content" });

    // Create the diff view
    this.diffView = new DiffView(
      diffContainer,
      this.pendingDiff.diff,
      {
        onAccept: (content) => this.handleAccept(content),
        onReject: () => this.handleReject(),
      }
    );

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
   * Handle accepting changes
   */
  private async handleAccept(content: string): Promise<void> {
    try {
      // Check if file has been modified since diff was created
      const currentContent = await this.app.vault.read(this.pendingDiff.file);
      if (currentContent !== this.pendingDiff.diff.newContent) {
        // File changed, show warning
        this.showConflictWarning(content);
        return;
      }

      this.result = { action: "accept", content };
      this.close();
    } catch (error) {
      new Notice(`Failed to accept changes: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  /**
   * Handle rejecting changes
   */
  private async handleReject(): Promise<void> {
    try {
      this.result = { action: "reject" };
      this.close();
    } catch (error) {
      new Notice(`Failed to reject changes: ${error instanceof Error ? error.message : "Unknown error"}`);
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
            this.result = { action: "accept", content };
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
