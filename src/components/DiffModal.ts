import { App, Modal, Notice, TFile, ButtonComponent, Setting, setIcon } from "obsidian";
import { DiffView } from "./DiffView";
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
}

export interface DiffModalFileTarget {
  file: TFile;
  diff: FileDiff;
  timestamp: number;
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

  constructor(
    app: App,
    private readonly reviewTarget: DiffModalFileTarget,
    callbacks: DiffModalCallback,
    options: DiffModalOptions = {},
  ) {
    super(app);
    this.callbacks = callbacks;
    this.diffService = new DiffService(app);
    this.currentDiff = reviewTarget.diff;
    this.proposal = options.proposal;
  }

  onOpen(): void {
    const { contentEl } = this;

    contentEl.addClass("oa-diff-modal");
    this.titleEl.setText(`Review Changes: ${this.reviewTarget.file.name}`);
    this.renderProposalSummary(contentEl);
    this.renderProposalEditor(contentEl);

    const infoEl = contentEl.createDiv({ cls: "oa-diff-info" });
    const infoIcon = infoEl.createSpan({ cls: "oa-diff-info-icon" });
    setIcon(infoIcon, "info");
    infoEl.createSpan({
      text: "Review the proposed edits below. You can refine the modified content, cherry-pick line changes, or apply the current proposal.",
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
          .setButtonText("Apply Current Changes")
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
    const summaryEl = contentEl.createDiv({ cls: "oa-diff-proposal-summary" });
    const badgeEl = summaryEl.createSpan({ cls: "oa-diff-proposal-badge" });
    badgeEl.setText(this.proposal?.scope === "selection" ? "Selection edit" : "Note edit");

    summaryEl.createSpan({
      cls: "oa-diff-proposal-description",
      text: this.proposal?.description ?? "AI proposed changes",
    });
  }

  private renderProposalEditor(contentEl: HTMLElement): void {
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
    this.editableContentEl.value = this.proposal?.proposedContent ?? this.currentDiff.newContent;
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
      text: "No cherry-pick selections yet. You can also edit the proposed content directly above.",
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
      this.reviewTarget.diff.oldContent,
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
    if (!this.editableContentEl) {
      return;
    }

    this.editableContentEl.value = this.proposal?.proposedContent ?? this.reviewTarget.diff.newContent;
    this.refreshDiffFromEditedContent();
  }

  private async handleCherryPick(): Promise<void> {
    try {
      const result = this.diffService.generateCherryPickResult(
        this.currentDiff,
        this.acceptedLines,
        this.rejectedLines
      );

      const currentContent = await this.app.vault.cachedRead(this.reviewTarget.file);
      if (this.hasConflictingChanges(currentContent)) {
        this.handleConflict();
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
      const currentContent = await this.app.vault.cachedRead(this.reviewTarget.file);
      if (this.hasConflictingChanges(currentContent)) {
        this.handleConflict();
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
    return currentContent !== this.reviewTarget.diff.oldContent;
  }

  private handleConflict(): void {
    new Notice("This note changed since the proposal was created. Reopen and regenerate the proposal.");
  }
}
