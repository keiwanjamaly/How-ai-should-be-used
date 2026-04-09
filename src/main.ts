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
import { VaultRAGService } from "./services/VaultRAGService";
import { DiffModal, ChangeNotificationModal } from "./components/DiffModal";
import { handleDiffResult } from "./utils/diffResultHandler";
import { formatErrorMessage } from "./utils/errorUtils";
import { mergeMCPServers } from "./types/mcp";
import type { MCPServers } from "./types/mcp";
import { fetchCodexAvailableModels } from "./services/CodexModels";
import type { VaultRAGIndexStatus } from "./services/VaultRAGService";

export default class ObsidianAIChatPlugin extends Plugin {
  settings!: ObsidianAIChatSettings;
  fileChangeDetector!: FileChangeDetector;
  diffService!: DiffService;
  mcpService!: MCPService;
  vaultRAGService!: VaultRAGService;
  private vaultRAGStatusEl!: HTMLElement;
  private resolvedMCPServers: MCPServers = {};
  private codexModelsRefreshPromise: Promise<string[]> | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    // Initialize services
    this.diffService = new DiffService(this.app);
    this.fileChangeDetector = new FileChangeDetector(this.app, this.diffService);
    this.mcpService = new MCPService();
    this.vaultRAGService = new VaultRAGService(this.app);
    this.vaultRAGStatusEl = this.addStatusBarItem();
    this.vaultRAGStatusEl.addClass("oa-rag-status");
    this.register(() => this.vaultRAGStatusEl.remove());
    this.register(this.vaultRAGService.onStatusChange((status) => {
      this.updateVaultRAGStatusBar(status);
    }));
    this.vaultRAGService.refreshStatus(this.settings.vaultRAG, false);
    
    // Set up change detection
    this.fileChangeDetector.onChange((pendingDiff) => {
      this.handleExternalChange(pendingDiff);
    });

    this.registerEvent(this.app.vault.on("create", (file) => {
      if (!(file instanceof TFile)) {
        return;
      }
      this.vaultRAGService.invalidateFile(file.path);
      this.vaultRAGService.refreshStatus(this.settings.vaultRAG, false);
      if (this.settings.vaultRAG.enabled && file.extension === "md") {
        void this.vaultRAGService.indexFile(file, this.settings.vaultRAG);
      }
    }));

    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (!(file instanceof TFile)) {
        return;
      }
      this.vaultRAGService.invalidateFile(file.path);
      this.vaultRAGService.refreshStatus(this.settings.vaultRAG, false);
      if (this.settings.vaultRAG.enabled && file.extension === "md") {
        void this.vaultRAGService.indexFile(file, this.settings.vaultRAG);
      }
    }));

    this.registerEvent(this.app.vault.on("delete", (file) => {
      this.vaultRAGService.invalidateFile(file.path);
      this.vaultRAGService.refreshStatus(this.settings.vaultRAG, false);
    }));

    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      this.vaultRAGService.invalidateFile(oldPath);
      this.vaultRAGService.invalidateFile(file.path);
      this.vaultRAGService.refreshStatus(this.settings.vaultRAG, false);
      if (this.settings.vaultRAG.enabled && file instanceof TFile && file.extension === "md") {
        void this.vaultRAGService.indexFile(file, this.settings.vaultRAG);
      }
    }));
    
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
      void this.refreshVaultRAGIndex();
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
      const mcpServers = this.settings.mcp.enabled ? this.resolvedMCPServers : {};
      return new CodexCliStrategy(config, mcpServers);
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

  async refreshVaultRAGIndex(): Promise<void> {
    this.vaultRAGService.refreshStatus(this.settings.vaultRAG, false);
    if (!this.settings.vaultRAG.enabled) {
      return;
    }

    await this.vaultRAGService.warmIndex(this.settings.vaultRAG);
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
          const allServers = await this.resolveConfiguredMCPServers();
          this.resolvedMCPServers = allServers;

          // Initialize the MCP service
          await this.mcpService.initialize(allServers);
        } catch (error) {
          this.resolvedMCPServers = {};
          console.error("Failed to initialize MCP:", error);
          new Notice("Failed to initialize MCP servers. Check console for details.");
        }
      } else {
        // MCP is disabled, shutdown any running servers
        this.resolvedMCPServers = {};
        await this.mcpService.shutdown();
      }
    }
  }

  private getConfiguredMCPServers(): MCPServers {
    return mergeMCPServers(this.settings.mcp.customMCPs);
  }

  private async resolveConfiguredMCPServers(): Promise<MCPServers> {
    let fileServers: MCPServers = {};
    if (this.settings.mcp.configFilePath) {
      const config = await MCPService.loadConfigFromFile(this.settings.mcp.configFilePath);
      if (config?.mcp) {
        fileServers = config.mcp;
      }
    }

    return mergeMCPServers(fileServers, this.getConfiguredMCPServers());
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
      vaultRAG: {
        ...DEFAULT_SETTINGS.vaultRAG,
        ...loaded?.vaultRAG,
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

  private updateVaultRAGStatusBar(status: VaultRAGIndexStatus): void {
    if (!status.enabled) {
      this.vaultRAGStatusEl.setText("RAG off");
      this.vaultRAGStatusEl.setAttr("aria-label", "Vault RAG is disabled");
      this.vaultRAGStatusEl.setAttr("title", "Vault-wide retrieval is disabled.");
      return;
    }

    const eligible = status.eligibleFiles;
    const indexed = Math.min(status.indexedFiles, eligible);
    const percent = eligible > 0 ? Math.round((indexed / eligible) * 100) : 100;
    const prefix = status.isIndexing ? "RAG indexing" : "RAG";

    this.vaultRAGStatusEl.setText(`${prefix} ${indexed}/${eligible} (${percent}%)`);
    this.vaultRAGStatusEl.setAttr(
      "aria-label",
      `Vault RAG indexed ${indexed} of ${eligible} eligible markdown notes`,
    );
    this.vaultRAGStatusEl.setAttr(
      "title",
      [
        `${indexed} of ${eligible} eligible markdown notes are indexed for vault chat.`,
        `${status.skippedFiles} notes are currently skipped because they exceed the configured size limit.`,
        status.isIndexing ? "Background indexing is still running." : "Background indexing is idle.",
      ].join("\n"),
    );
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
