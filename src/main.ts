import { Plugin, TFile, Notice, Platform } from "obsidian";
import { ObsidianAIChatSettingTab } from "./settings";
import { OpenRouterStrategy } from "./strategies/OpenRouterStrategy";
import { CodexCliStrategy } from "./strategies/CodexCliStrategy";
import type { LLMStrategy } from "./strategies/LLMStrategy";
import { CHAT_VIEW_TYPE, ChatView } from "./views/ChatView";
import {
  DEFAULT_SETTINGS,
  ChatRole,
  type ChatMessage,
  type AIProvider,
  type ObsidianAIChatSettings,
  type OpenRouterSettings,
} from "./types";
import { FileChangeDetector } from "./services/FileChangeDetector";
import { DiffService } from "./services/DiffService";
import { MCPService } from "./services/MCPService";
import { InternalToolService } from "./services/InternalToolService";
import { VaultRAGService } from "./services/VaultRAGService";
import { DiffModal, ChangeNotificationModal } from "./components/DiffModal";
import { TextPromptModal } from "./components/TextPromptModal";
import { handleDiffResult } from "./utils/diffResultHandler";
import { formatErrorMessage } from "./utils/errorUtils";
import { mergeMCPServers } from "./types/mcp";
import type { MCPServers } from "./types/mcp";
import type {
  ActiveNoteEditProposal,
  ToolDefinition,
  ToolExecutionEvent,
  ToolExecutionResult,
} from "./types/tools";
import { fetchCodexAvailableModels } from "./services/CodexModels";
import type { VaultRAGIndexStatus } from "./services/VaultRAGService";
import { normalizeExtensions } from "./utils/vaultEmbeddings";

export default class ObsidianAIChatPlugin extends Plugin {
  settings!: ObsidianAIChatSettings;
  fileChangeDetector!: FileChangeDetector;
  diffService!: DiffService;
  mcpService!: MCPService;
  internalToolService!: InternalToolService;
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
    this.internalToolService = new InternalToolService(this.app);
    this.vaultRAGService = new VaultRAGService(this.app, this.manifest.id, () => this.settings);
    this.vaultRAGStatusEl = this.addStatusBarItem();
    this.vaultRAGStatusEl.addClass("oa-rag-status");
    this.register(() => this.vaultRAGStatusEl.remove());
    this.register(this.vaultRAGService.onStatusChange((status) => {
      this.updateVaultRAGStatusBar(status);
    }));
    try {
      await this.vaultRAGService.initialize();
      await this.vaultRAGService.refreshStatus();
    } catch (error) {
      console.error("Failed to initialize vault embedding index:", error);
      this.vaultRAGStatusEl.setText("RAG error");
      this.vaultRAGStatusEl.setAttr(
        "title",
        error instanceof Error ? error.message : String(error),
      );
    }
    
    // Set up change detection
    this.fileChangeDetector.onChange((pendingDiff) => {
      this.handleExternalChange(pendingDiff);
    });

    this.registerEvent(this.app.vault.on("create", (file) => {
      if (!(file instanceof TFile)) {
        return;
      }
      if (this.settings.vaultRAG.enabled) {
        void this.vaultRAGService.indexFile(file);
      } else {
        void this.vaultRAGService.refreshStatus();
      }
    }));

    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (!(file instanceof TFile)) {
        return;
      }
      if (this.settings.vaultRAG.enabled) {
        void this.vaultRAGService.indexFile(file);
      } else {
        void this.vaultRAGService.refreshStatus();
      }
    }));

    this.registerEvent(this.app.vault.on("delete", (file) => {
      void this.vaultRAGService.removeFile(file.path);
    }));

    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      void this.vaultRAGService.removeFile(oldPath);
      if (this.settings.vaultRAG.enabled && file instanceof TFile) {
        void this.vaultRAGService.indexFile(file);
      } else {
        void this.vaultRAGService.refreshStatus();
      }
    }));
    
    // Register the file change detector as a component
    this.addChild(this.fileChangeDetector);
    this.fileChangeDetector.initialize();

    // Initialize MCP servers if enabled
    await this.initializeMCP();

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
      id: "ai-edit-active-note",
      name: "AI Edit: Rewrite active note",
      callback: () => {
        void this.openEditInstructionPrompt("note");
      },
    });

    this.addCommand({
      id: "ai-edit-selection",
      name: "AI Edit: Rewrite selection",
      callback: () => {
        void this.openEditInstructionPrompt("selection");
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

    this.addCommand({
      id: "rebuild-vault-embedding-index",
      name: "Rebuild Vault Embedding Index",
      callback: () => {
        void this.rebuildVaultRAGIndex();
      },
    });

    this.addCommand({
      id: "clear-vault-embedding-index",
      name: "Clear Vault Embedding Index",
      callback: () => {
        void this.clearVaultRAGIndex();
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
      return new CodexCliStrategy(config, mcpServers, this.internalToolService);
    }

    const tools: ToolDefinition[] = [
      ...this.internalToolService.getAvailableTools(),
      ...(this.mcpService?.getAvailableTools(this.settings.mcp.enabledTools) ?? []).map((tool) => ({
        ...tool,
        source: "mcp" as const,
      })),
    ];
    const executeTool = async (toolName: string, args: unknown): Promise<ToolExecutionResult> => {
      if (this.internalToolService.hasTool(toolName)) {
        return this.internalToolService.executeTool(toolName, args);
      }
      return this.mcpService.executeTool(toolName, args);
    };
    const config: OpenRouterSettings = modelOverride
      ? { ...this.settings.openRouter, model: modelOverride }
      : this.settings.openRouter;
    return new OpenRouterStrategy(config, tools, executeTool);
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
    try {
      await this.vaultRAGService.refreshStatus();
      if (this.settings.vaultRAG.enabled) {
        await this.vaultRAGService.refreshIndex();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Failed to refresh vault embedding index:", error);
      new Notice(`Vault embedding index failed: ${message}`);
    }
  }

  async rebuildVaultRAGIndex(): Promise<void> {
    if (!this.settings.vaultRAG.enabled) {
      new Notice("Enable Vault RAG first to build the embedding index.");
      return;
    }

    await this.vaultRAGService.clearIndex();
    await this.vaultRAGService.refreshIndex();
    new Notice("Vault embedding index rebuilt.");
  }

  async clearVaultRAGIndex(): Promise<void> {
    await this.vaultRAGService.clearIndex();
    new Notice("Vault embedding index cleared.");
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
        embeddingModel:
          loaded?.vaultRAG?.embeddingModel?.trim() || DEFAULT_SETTINGS.vaultRAG.embeddingModel,
        includeExtensions: normalizeExtensions(
          loaded?.vaultRAG?.includeExtensions ?? DEFAULT_SETTINGS.vaultRAG.includeExtensions,
        ),
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
      `Vault RAG indexed ${indexed} of ${eligible} eligible files`,
    );
    this.vaultRAGStatusEl.setAttr(
      "title",
      [
        `${indexed} of ${eligible} eligible files are embedded for vault chat.`,
        `${status.staleFiles} files are waiting for embedding refresh.`,
        `${status.failedFiles} files currently have embedding errors.`,
        `${status.skippedFiles} files are skipped by the current extension or size filters.`,
        `Embedding model: ${status.activeModel || "unknown"}`,
        status.isIndexing ? `Background indexing phase: ${status.phase}.` : "Background indexing is idle.",
        status.lastError ? `Last error: ${status.lastError}` : "",
      ].filter(Boolean).join("\n"),
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

  async openEditReview(
    proposal: ActiveNoteEditProposal,
    options: { source?: ActiveNoteEditProposal["source"] } = {},
  ): Promise<void> {
    const abstractFile = this.app.vault.getAbstractFileByPath(proposal.filePath);
    if (!(abstractFile instanceof TFile)) {
      new Notice(`Could not find note for proposal: ${proposal.fileName}`);
      return;
    }

    const normalizedProposal: ActiveNoteEditProposal = {
      ...proposal,
      source: options.source ?? proposal.source,
    };

    const fileDiff = this.diffService.createFileDiff(
      normalizedProposal.filePath,
      normalizedProposal.originalContent,
      normalizedProposal.proposedContent,
    );

    if (!this.diffService.hasChanges(fileDiff)) {
      new Notice("No changes detected in the proposal");
      return;
    }

    const pendingDiff = {
      file: abstractFile,
      diff: fileDiff,
      timestamp: normalizedProposal.createdAt,
    };

    new DiffModal(this.app, pendingDiff, async (result) => {
      await handleDiffResult(
        result,
        abstractFile,
        this.diffService,
        (path) => this.markAsSelfModified(path),
        {},
      );
    }, {
      proposal: normalizedProposal,
      conflictMode: "block",
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

  private async openEditInstructionPrompt(scope: "note" | "selection"): Promise<void> {
    this.internalToolService.captureMarkdownViewContext();
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("Open a markdown note before requesting AI edits.");
      return;
    }
    if (file.extension !== "md") {
      new Notice("AI edit commands only support markdown notes.");
      return;
    }
    if (scope === "selection" && !this.internalToolService.getActiveSelectionContext()) {
      new Notice("Select some text before using the selection rewrite command.");
      return;
    }

    new TextPromptModal(this.app, {
      title: scope === "selection" ? "Rewrite Selected Text" : "Rewrite Active Note",
      description: scope === "selection"
        ? "Describe how the selected text should change. The AI will propose an edit and open it in the review view."
        : "Describe how the active note should change. The AI will propose an edit and open it in the review view.",
      placeholder: scope === "selection"
        ? "Example: tighten this paragraph, keep the equations unchanged, and make the tone more formal"
        : "Example: turn this note into a concise checklist and preserve all existing links",
      submitText: "Generate Proposal",
      onSubmit: (instruction) => {
        void this.runEditCommand(scope, instruction);
      },
    }).open();
  }

  private async runEditCommand(scope: "note" | "selection", instruction: string): Promise<void> {
    const strategy = this.createStrategy(this.getDefaultModel());
    const configError = await strategy.validateConfig();
    if (configError) {
      new Notice(configError);
      return;
    }

    let proposal: ActiveNoteEditProposal | null = null;
    const requestMessages = await this.buildEditRequestMessages(scope, instruction);

    new Notice(scope === "selection" ? "Generating selection edit proposal…" : "Generating note edit proposal…");

    try {
      await strategy.sendMessage(
        requestMessages,
        () => {
          // Ignore normal streamed text for command-driven edits. We only care about the proposal.
        },
        (call: ToolExecutionEvent) => {
          if (call.editProposal) {
            proposal = {
              ...call.editProposal,
              source: "command",
            };
          }
        },
      );
    } catch (error) {
      new Notice(`AI edit request failed: ${formatErrorMessage(error)}`);
      return;
    }

    if (!proposal) {
      new Notice("AI did not return an edit proposal. Try rephrasing the request.");
      return;
    }

    await this.openEditReview(proposal, { source: "command" });
  }

  private async buildEditRequestMessages(
    scope: "note" | "selection",
    instruction: string,
  ): Promise<ChatMessage[]> {
    const messages: ChatMessage[] = [];
    const systemPrompt = this.settings.systemPrompt.trim();
    if (systemPrompt) {
      messages.push({
        role: ChatRole.System,
        content: systemPrompt,
      });
    }

    messages.push({
      role: ChatRole.System,
      content: this.internalToolService.getToolUseInstruction(),
    });

    const activeFileMessage = await this.buildActiveFileContextMessage();
    if (activeFileMessage) {
      messages.push(activeFileMessage);
    }

    messages.push({
      role: ChatRole.User,
      content: scope === "selection"
        ? [
          "Rewrite only the current editor selection in the active markdown note.",
          "Do not rewrite the rest of the note.",
          "Use the available edit tool to propose the change.",
          "",
          `Instruction: ${instruction}`,
        ].join("\n")
        : [
          "Rewrite the active markdown note according to the instruction below.",
          "Use the available edit tool to propose the change.",
          "",
          `Instruction: ${instruction}`,
        ].join("\n"),
    });

    return messages;
  }

  private async buildActiveFileContextMessage(): Promise<ChatMessage | null> {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") {
      return null;
    }

    try {
      const content = await this.app.vault.cachedRead(file);
      const selection = this.internalToolService.getActiveSelectionContext();
      const selectionContext = selection
        ? [
          "",
          `The user currently has this text selected (${selection.from.line + 1}:${selection.from.ch} to ${selection.to.line + 1}:${selection.to.ch}):`,
          "---",
          selection.selectedText,
          "---",
          "If the user asks to replace only that part, prefer a selection replacement instead of rewriting the whole note.",
        ].join("\n")
        : "";

      return {
        role: ChatRole.System,
        content: `The user has the following note open ("${file.name}"):\n---\n${content}\n---\nRefer to this note when preparing edit proposals.${selectionContext}`,
      };
    } catch (error) {
      console.error("Failed to read active file for edit command:", error);
      return null;
    }
  }
}
