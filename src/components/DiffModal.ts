import { Modal, App, Setting, Notice, TFile, ButtonComponent, setIcon } from "obsidian";
import { DiffView } from "./DiffView";
import { PendingDiff } from "../services/FileChangeDetector";
import { DiffService, type FileDiff } from "../services/DiffService";
import type { ActiveNoteEditProposal } from "../types/tools";
import { formatErrorMessage } from "../utils/errorUtils";

export interface DiffModalResult {
  action: "accept" | "reject" | "cancel" | "cherry-pick";
  content?: string;
  acceptedLines?: Set<number>;
  rejectedLines?: Set<number>;
}

export type DiffModalCallback = (result: DiffModalResult) => void;

export interface DiffModalOptions {
  proposal?: ActiveNoteEditProposal;
  conflictMode?: "warn" | "block";
}

export class DiffModal extends Modal {
  private diffView?: DiffView;
  private result: DiffModalResult = { action: "cancel" };
  private readonly callbacks: DiffModalCallback;
  private readonly diffService: DiffService;
  private acceptedLines: Set<number> = new Set();
  private rejectedLines: Set<number> = new Set();
  private selectionMode = false;
  private statsEl?: HTMLElement;
  private applyBtn?: ButtonComponent;
  private editableContentEl?: HTMLTextAreaElement;
  private currentDiff: FileDiff;
  private editRefreshTimer: number | null = null;
  private readonly proposal?: ActiveNoteEditProposal;
  private readonly conflictMode: "warn" | "block";

  constructor(
    app: App,
    private readonly pendingDiff: PendingDiff,
    callbacks: DiffModalCallback,
    options: DiffModalOptions = {},
  ) {
    super(app);
    this.callbacks = callbacks;
    this.diffService = new DiffService(app);
    this.currentDiff = pendingDiff.diff;
    this.proposal = options.proposal;
    this.conflictMode = options.conflictMode ?? "warn";
  }

  onOpen(): void {
    const { contentEl } = this;

    contentEl.addClass("oa-diff-modal");
    this.titleEl.setText(`Review Changes: ${this.pendingDiff.file.name}`);

    if (this.proposal) {
      this.renderProposalSummary(contentEl);
      this.renderProposalEditor(contentEl);
    }

    const infoEl = contentEl.createDiv({ cls: "oa-diff-info" });
    const infoIcon = infoEl.createSpan({ cls: "oa-diff-info-icon" });
    setIcon(infoIcon, "info");
    infoEl.createSpan({
      text: this.proposal
        ? "Review the proposed edits below. You can refine the modified content, cherry-pick line changes, or apply the current proposal."
        : "Review the changes below. Toggle selection mode to cherry-pick individual changes, or use Accept All/Reject All buttons.",
    });

    const diffContainer = contentEl.createDiv({ cls: "oa-diff-modal-content" });
    this.diffView = new DiffView(
      diffContainer,
      this.currentDiff,
      {
        onAccept: (content) => this.handleAccept(content),
        onReject: () => this.handleReject(),
        onAcceptLine: (lineNumber) => this.handleAcceptLine(lineNumber),
        onRejectLine: (lineNumber) => this.handleRejectLine(lineNumber),
      }
    );

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

    this.statsEl = contentEl.createDiv({ cls: "oa-diff-selection-stats" });
    this.updateSelectionStats();

    const footer = contentEl.createDiv({ cls: "oa-diff-modal-footer" });
    new Setting(footer)
      .addButton((btn) => {
        btn
          .setButtonText(this.proposal ? "Apply Current Changes" : "Accept All Changes")
          .setCta()
          .onClick(() => {
            this.handleAccept(this.getCurrentProposedContent());
          });
        return btn;
      })
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
      .addButton((btn) => {
        btn
          .setButtonText("Reset Proposal")
          .setDisabled(!this.proposal)
          .onClick(() => {
            this.resetProposal();
          });
        return btn;
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

    if (this.editRefreshTimer !== null) {
      window.clearTimeout(this.editRefreshTimer);
      this.editRefreshTimer = null;
    }

    this.callbacks(this.result);
  }

  private renderProposalSummary(contentEl: HTMLElement): void {
    if (!this.proposal) {
      return;
    }

    const summaryEl = contentEl.createDiv({ cls: "oa-diff-proposal-summary" });
    const badgeEl = summaryEl.createSpan({ cls: "oa-diff-proposal-badge" });
    badgeEl.setText(this.proposal.scope === "selection" ? "Selection edit" : "Note edit");

    summaryEl.createSpan({
      cls: "oa-diff-proposal-description",
      text: this.proposal.description,
    });
  }

  private renderProposalEditor(contentEl: HTMLElement): void {
    if (!this.proposal) {
      return;
    }

    const editorSection = contentEl.createDiv({ cls: "oa-diff-proposal-editor" });
    const headerEl = editorSection.createDiv({ cls: "oa-diff-proposal-editor-header" });
    headerEl.createDiv({ cls: "oa-diff-proposal-editor-title", text: "Modified content" });
    headerEl.createDiv({
      cls: "oa-diff-proposal-editor-meta",
      text: "Edit this version before applying. The diff below updates automatically.",
    });

    this.editableContentEl = editorSection.createEl("textarea", {
      cls: "oa-diff-proposal-textarea",
    });
    this.editableContentEl.value = this.proposal.proposedContent;
    this.editableContentEl.addEventListener("input", () => {
      this.scheduleDiffRefresh();
    });
  }

  private updateSelectionUI(): void {
    const diffView = this.diffView?.getContainer();
    if (diffView) {
      diffView.toggleClass("oa-diff-selection-mode", this.selectionMode);
    }
  }

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
      return;
    }

    this.statsEl.createEl("span", {
      text: this.proposal
        ? "No cherry-pick selections yet. You can also edit the proposed content directly above."
        : "No cherry-pick selections yet.",
      cls: "oa-diff-stats-text",
    });
  }

  private handleAcceptLine(lineNumber: number): void {
    if (!this.selectionMode) return;

    if (this.rejectedLines.has(lineNumber)) {
      this.rejectedLines.delete(lineNumber);
    }
    this.acceptedLines.add(lineNumber);
    
    // Update visual state
    this.diffView?.markLineAccepted(lineNumber, "added");
    this.diffView?.markLineAccepted(lineNumber, "removed");

    this.updateSelectionStats();
    this.updateApplyButtonState();
  }

  private handleRejectLine(lineNumber: number): void {
    if (!this.selectionMode) return;

    if (this.acceptedLines.has(lineNumber)) {
      this.acceptedLines.delete(lineNumber);
    }
    this.rejectedLines.add(lineNumber);
    
    // Update visual state
    this.diffView?.markLineRejected(lineNumber, "added");
    this.diffView?.markLineRejected(lineNumber, "removed");

    this.updateSelectionStats();
    this.updateApplyButtonState();
  }

  private updateApplyButtonState(): void {
    const hasSelections = this.acceptedLines.size > 0 || this.rejectedLines.size > 0;
    if (this.applyBtn) {
      this.applyBtn.setDisabled(!hasSelections);
    }
  }

  private getCurrentProposedContent(): string {
    return this.editableContentEl?.value ?? this.currentDiff.newContent;
  }

  private scheduleDiffRefresh(): void {
    if (this.editRefreshTimer !== null) {
      window.clearTimeout(this.editRefreshTimer);
    }

    this.editRefreshTimer = window.setTimeout(() => {
      this.editRefreshTimer = null;
      this.refreshDiffFromEditedContent();
    }, 200);
  }

  private refreshDiffFromEditedContent(): void {
    const nextDiff = this.diffService.createFileDiff(
      this.currentDiff.path,
      this.pendingDiff.diff.oldContent,
      this.getCurrentProposedContent(),
    );

    this.currentDiff = nextDiff;
    this.clearSelections();
    this.diffView?.setDiff(nextDiff);
    this.updateSelectionUI();
  }

  private clearSelections(): void {
    this.acceptedLines = new Set();
    this.rejectedLines = new Set();
    this.updateSelectionStats();
    this.updateApplyButtonState();
  }

  private resetProposal(): void {
    if (!this.proposal || !this.editableContentEl) {
      return;
    }

    this.editableContentEl.value = this.proposal.proposedContent;
    this.refreshDiffFromEditedContent();
  }

  private async handleCherryPick(): Promise<void> {
    try {
      const result = this.diffService.generateCherryPickResult(
        this.currentDiff,
        this.acceptedLines,
        this.rejectedLines
      );

      const currentContent = await this.app.vault.cachedRead(this.pendingDiff.file);
      if (this.hasConflictingChanges(currentContent)) {
        this.handleConflict(result.content, "cherry-pick");
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

  private async handleAccept(content: string): Promise<void> {
    try {
      const currentContent = await this.app.vault.cachedRead(this.pendingDiff.file);
      if (this.hasConflictingChanges(currentContent)) {
        this.handleConflict(content, "accept");
        return;
      }

      this.result = { action: "accept", content };
      this.close();
    } catch (error) {
      new Notice(`Failed to accept changes: ${formatErrorMessage(error)}`);
    }
  }

  private async handleReject(): Promise<void> {
    try {
      this.result = { action: "reject" };
      this.close();
    } catch (error) {
      new Notice(`Failed to reject changes: ${formatErrorMessage(error)}`);
    }
  }

  private hasConflictingChanges(currentContent: string): boolean {
    if (this.conflictMode === "block") {
      return currentContent !== this.pendingDiff.diff.oldContent;
    }

    return currentContent !== this.pendingDiff.diff.newContent
      && currentContent !== this.pendingDiff.diff.oldContent;
  }

  private handleConflict(content: string, action: "accept" | "cherry-pick"): void {
    if (this.conflictMode === "block") {
      new Notice("This note changed since the proposal was created. Reopen and regenerate the proposal.");
      return;
    }

    this.showConflictWarning(content, action);
  }

  private showConflictWarning(content: string, action: "accept" | "cherry-pick"): void {
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
            if (action === "cherry-pick") {
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
