import { Plugin, TFile, Notice } from "obsidian";
import { ObsidianAIChatSettingTab } from "./settings";
import { OpenRouterStrategy } from "./strategies/OpenRouterStrategy";
import type { LLMStrategy } from "./strategies/LLMStrategy";
import { CHAT_VIEW_TYPE, ChatView } from "./views/ChatView";
import { DEFAULT_SETTINGS, type ObsidianAIChatSettings } from "./types";
import { FileChangeDetector } from "./services/FileChangeDetector";
import { DiffService } from "./services/DiffService";
import { DiffModal, ChangeNotificationModal } from "./components/DiffModal";
import { formatErrorMessage } from "./utils/errorUtils";

export default class ObsidianAIChatPlugin extends Plugin {
  settings!: ObsidianAIChatSettings;
  fileChangeDetector!: FileChangeDetector;
  diffService!: DiffService;

  async onload(): Promise<void> {
    await this.loadSettings();

    // Initialize services
    this.diffService = new DiffService(this.app);
    this.fileChangeDetector = new FileChangeDetector(this.app);
    
    // Set up change detection
    this.fileChangeDetector.onChange((pendingDiff) => {
      this.handleExternalChange(pendingDiff);
    });
    
    // Register the file change detector as a component
    this.addChild(this.fileChangeDetector);
    this.fileChangeDetector.initialize();

    // Register views
    this.registerView(CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf, this));
    this.addSettingTab(new ObsidianAIChatSettingTab(this.app, this));

    // Commands
    this.addCommand({
      id: "open-ai-chat",
      name: "Open AI Chat",
      callback: () => {
        void this.activateView();
      },
    });

    this.addCommand({
      id: "review-pending-changes",
      name: "Review Pending Changes",
      callback: () => {
        void this.reviewPendingChanges();
      },
    });

    this.addCommand({
      id: "toggle-change-detection",
      name: "Toggle External Change Detection",
      callback: () => {
        const currentState = this.fileChangeDetector.getEnabled();
        this.fileChangeDetector.setEnabled(!currentState);
        new Notice(`Change detection ${!currentState ? "enabled" : "disabled"}`);
      },
    });

    this.addRibbonIcon("bot", "Open AI Chat", () => {
      void this.activateView();
    });

    // Show pending changes indicator in ribbon
    this.addRibbonIcon("git-compare", "Review pending changes", () => {
      void this.reviewPendingChanges();
    }).toggleClass("oa-hidden", true); // Initially hidden

    this.app.workspace.onLayoutReady(() => {
      void this.activateView();
    });
  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(CHAT_VIEW_TYPE);
  }

  createStrategy(): LLMStrategy {
    return new OpenRouterStrategy(this.settings.openRouter);
  }

  async loadSettings(): Promise<void> {
    const loaded = (await this.loadData()) as Partial<ObsidianAIChatSettings> | null;

    this.settings = {
      ...DEFAULT_SETTINGS,
      ...loaded,
      openRouter: {
        ...DEFAULT_SETTINGS.openRouter,
        ...loaded?.openRouter,
      },
      chatSessions: loaded?.chatSessions ?? DEFAULT_SETTINGS.chatSessions,
      activeSessionId: loaded?.activeSessionId ?? DEFAULT_SETTINGS.activeSessionId,
    };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async activateView(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE);
    if (leaves.length > 0) {
      this.app.workspace.revealLeaf(leaves[0]);
      return;
    }

    const rightLeaf = this.app.workspace.getRightLeaf(false);
    if (!rightLeaf) {
      return;
    }

    await rightLeaf.setViewState({
      type: CHAT_VIEW_TYPE,
      active: true,
    });

    this.app.workspace.revealLeaf(rightLeaf);
  }

  /**
   * Handle external file changes detected by FileChangeDetector
   */
  private handleExternalChange(pendingDiff: { file: TFile; diff: { path: string; oldContent: string; newContent: string; changes: unknown[] }; timestamp: number }): void {
    // Show notification with option to review
    new ChangeNotificationModal(
      this.app,
      pendingDiff.file.name,
      () => this.showDiffModal(pendingDiff.file),
      () => {
        // Dismiss - remove from pending
        this.fileChangeDetector.removePendingDiff(pendingDiff.file.path);
      }
    ).open();
  }

  /**
   * Show the diff modal for a specific file
   */
  private async showDiffModal(file: TFile): Promise<void> {
    const pendingDiff = this.fileChangeDetector.getPendingDiff(file);
    if (!pendingDiff) {
      new Notice("No pending changes for this file");
      return;
    }

    new DiffModal(this.app, pendingDiff, async (result) => {
      if (result.action === "accept" && result.content) {
        try {
          this.markAsSelfModified(file.path);
          await this.diffService.acceptChanges(file, result.content);
          this.fileChangeDetector.removePendingDiff(file.path);
          new Notice("Changes accepted");
        } catch (error) {
          new Notice(`Failed to accept changes: ${formatErrorMessage(error)}`);
        }
      } else if (result.action === "cherry-pick" && result.content) {
        try {
          this.markAsSelfModified(file.path);
          await this.diffService.acceptChanges(file, result.content);
          this.fileChangeDetector.removePendingDiff(file.path);
          const accepted = result.acceptedLines?.size || 0;
          const rejected = result.rejectedLines?.size || 0;
          new Notice(`Applied ${accepted} changes, rejected ${rejected}`);
        } catch (error) {
          new Notice(`Failed to apply selected changes: ${formatErrorMessage(error)}`);
        }
      } else if (result.action === "reject") {
        try {
          await this.diffService.rejectChanges(file, pendingDiff.diff.oldContent);
          this.fileChangeDetector.removePendingDiff(file.path);
          new Notice("Changes rejected - file restored to original");
        } catch (error) {
          new Notice(`Failed to reject changes: ${formatErrorMessage(error)}`);
        }
      }
    }).open();
  }

  /**
   * Review all pending changes
   */
  private async reviewPendingChanges(): Promise<void> {
    const pendingDiffs = this.fileChangeDetector.getPendingDiffs();
    
    if (pendingDiffs.length === 0) {
      new Notice("No pending changes to review");
      return;
    }

    // For now, show the first pending diff
    // Could be extended to show a list of all pending files
    await this.showDiffModal(pendingDiffs[0].file);
  }

  /**
   * Mark a file as being modified by the AI (prevents diff detection)
   */
  markAsSelfModified(path: string): void {
    this.fileChangeDetector.markAsSelfModified(path);
  }
}
