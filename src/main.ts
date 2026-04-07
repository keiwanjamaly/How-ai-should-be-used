import { Plugin, TFile, Notice, Platform } from "obsidian";
import { ObsidianAIChatSettingTab } from "./settings";
import { OpenRouterStrategy } from "./strategies/OpenRouterStrategy";
import { CodexCliStrategy } from "./strategies/CodexCliStrategy";
import type { LLMStrategy } from "./strategies/LLMStrategy";
import { CHAT_VIEW_TYPE, ChatView } from "./views/ChatView";
import {
  DEFAULT_SETTINGS,
  type AIProvider,
  type ObsidianAIChatSettings,
  type OpenRouterSettings,
} from "./types";
import { FileChangeDetector } from "./services/FileChangeDetector";
import { DiffService } from "./services/DiffService";
import { MCPService } from "./services/MCPService";
import { DiffModal, ChangeNotificationModal } from "./components/DiffModal";
import { handleDiffResult } from "./utils/diffResultHandler";
import { formatErrorMessage } from "./utils/errorUtils";
import { mergeMCPServers } from "./types/mcp";
import { fetchCodexAvailableModels } from "./services/CodexModels";

export default class ObsidianAIChatPlugin extends Plugin {
  settings!: ObsidianAIChatSettings;
  fileChangeDetector!: FileChangeDetector;
  diffService!: DiffService;
  mcpService!: MCPService;
  private codexModelsRefreshPromise: Promise<string[]> | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    // Initialize services
    this.diffService = new DiffService(this.app);
    this.fileChangeDetector = new FileChangeDetector(this.app, this.diffService);
    this.mcpService = new MCPService();
    
    // Set up change detection
    this.fileChangeDetector.onChange((pendingDiff) => {
      this.handleExternalChange(pendingDiff);
    });
    
    // Register the file change detector as a component
    this.addChild(this.fileChangeDetector);
    this.fileChangeDetector.initialize();

    // Initialize MCP servers if enabled
    await this.initializeMCP();
    void this.refreshCodexModels(false);

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

  async onunload(): Promise<void> {
    this.app.workspace.detachLeavesOfType(CHAT_VIEW_TYPE);
    await this.mcpService?.shutdown();
  }

  createStrategy(modelOverride?: string): LLMStrategy {
    if (this.settings.provider === "chatgpt") {
      const config = modelOverride
        ? { ...this.settings.chatgpt, model: modelOverride }
        : this.settings.chatgpt;
      return new CodexCliStrategy(config);
    }

    const mcpTools = this.mcpService?.getAvailableTools(this.settings.mcp.enabledTools) ?? [];
    const executeTool = this.mcpService
      ? async (toolName: string, args: unknown) => this.mcpService.executeTool(toolName, args)
      : undefined;
    const config: OpenRouterSettings = modelOverride
      ? { ...this.settings.openRouter, model: modelOverride }
      : this.settings.openRouter;
    return new OpenRouterStrategy(config, mcpTools, executeTool);
  }

  getActiveProvider(): AIProvider {
    return this.settings.provider;
  }

  getDefaultModel(): string {
    if (this.settings.provider === "chatgpt") {
      return this.settings.chatgpt.model.trim() || this.settings.chatgpt.favoriteModels[0] || "";
    }

    return this.settings.openRouter.model;
  }

  getSelectableModels(): string[] {
    if (this.settings.provider === "chatgpt") {
      return this.settings.chatgpt.favoriteModels.length > 0
        ? this.settings.chatgpt.favoriteModels
        : DEFAULT_SETTINGS.chatgpt.favoriteModels;
    }

    return this.settings.favoriteModels;
  }

  supportsModelSelection(): boolean {
    return true;
  }

  supportsPDFUpload(): boolean {
    return this.settings.provider === "openrouter";
  }

  async refreshCodexModels(force: boolean): Promise<string[]> {
    if (!force && this.codexModelsRefreshPromise) {
      return this.codexModelsRefreshPromise;
    }

    const refreshPromise = (async () => {
      try {
        const result = await fetchCodexAvailableModels(this.settings.chatgpt.cliPath);
        const models = result.models;
        if (models.length === 0) {
          return this.getSelectableModels();
        }

        const modelsChanged =
          JSON.stringify(models) !== JSON.stringify(this.settings.chatgpt.favoriteModels);
        const selectedModelValid = models.includes(this.settings.chatgpt.model);

        if (modelsChanged || !selectedModelValid) {
          this.settings.chatgpt.favoriteModels = models;
          if (!selectedModelValid) {
            this.settings.chatgpt.model = models[0];
          }
          await this.saveSettings();
        }

        return models;
      } catch {
        return this.getSelectableModels();
      } finally {
        this.codexModelsRefreshPromise = null;
      }
    })();

    this.codexModelsRefreshPromise = refreshPromise;
    return refreshPromise;
  }

  /**
   * Initialize MCP servers based on current settings
   */
  async initializeMCP(): Promise<void> {
    // Only initialize on desktop platforms
    if (!Platform.isMobile) {
      if (this.settings.mcp.enabled) {
        try {
          // Load servers from config file if path is set
          let fileServers = {};
          if (this.settings.mcp.configFilePath) {
            const config = await MCPService.loadConfigFromFile(this.settings.mcp.configFilePath);
            if (config?.mcp) {
              fileServers = config.mcp;
            }
          }

          // Merge with custom MCPs
          const allServers = mergeMCPServers(fileServers, this.settings.mcp.customMCPs);

          // Initialize the MCP service
          await this.mcpService.initialize(allServers);
        } catch (error) {
          console.error("Failed to initialize MCP:", error);
          new Notice("Failed to initialize MCP servers. Check console for details.");
        }
      } else {
        // MCP is disabled, shutdown any running servers
        await this.mcpService.shutdown();
      }
    }
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
      chatgpt: {
        ...DEFAULT_SETTINGS.chatgpt,
        ...loaded?.chatgpt,
      },
      chatSessions: loaded?.chatSessions ?? DEFAULT_SETTINGS.chatSessions,
      activeSessionId: loaded?.activeSessionId ?? DEFAULT_SETTINGS.activeSessionId,
      favoriteModels: loaded?.favoriteModels ?? DEFAULT_SETTINGS.favoriteModels,
      ocrModel: loaded?.ocrModel ?? DEFAULT_SETTINGS.ocrModel,
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
      await handleDiffResult(
        result,
        file,
        this.diffService,
        (path) => this.markAsSelfModified(path),
        {
          onApplied: () => {
            this.fileChangeDetector.removePendingDiff(file.path);
          },
          onRejected: async () => {
            try {
              await this.diffService.rejectChanges(file, pendingDiff.diff.oldContent);
              this.fileChangeDetector.removePendingDiff(file.path);
              new Notice("Changes rejected - file restored to original");
            } catch (error) {
              new Notice(`Failed to reject changes: ${formatErrorMessage(error)}`);
            }
          },
        },
      );
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
