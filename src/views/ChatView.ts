import { ItemView, MarkdownRenderer, Notice, WorkspaceLeaf, TFile, setIcon } from "obsidian";
import type ObsidianAIChatPlugin from "../main";
import type { LLMStrategy } from "../strategies/LLMStrategy";
import { ChatRole, type ChatMessage, type ChatSession } from "../types";
import type { ActiveNoteEditProposal, ToolExecutionEvent } from "../types/tools";
import { formatErrorMessage } from "../utils/errorUtils";
import { getUniqueChunkPaths } from "../utils/ragPreview";
import type { VaultChunk } from "../services/VaultRAGService";

export const CHAT_VIEW_TYPE = "obsidian-ai-chat-view";
const DRAFT_RAG_PREVIEW_IDLE_MS = 700;
const DRAFT_RAG_PREVIEW_TICK_MS = 50;
type DraftRAGPreviewPhase = "idle" | "waiting" | "computing";

export class ChatView extends ItemView {
  private messages: ChatMessage[] = [];
  private messagesEl!: HTMLDivElement;
  private inputEl!: HTMLTextAreaElement;
  private sendButtonEl!: HTMLButtonElement;
  private stopButtonEl!: HTMLButtonElement;
  private newChatButtonEl!: HTMLButtonElement;
  private contextToggleEl!: HTMLButtonElement;
  private contextBadgeEl!: HTMLDivElement;
  private selectionBadgeEl!: HTMLDivElement;
  private ragBadgeEl!: HTMLDivElement;
  private ragPreviewToggleEl!: HTMLLabelElement;
  private ragPreviewToggleInputEl!: HTMLInputElement;
  private sessionSelectorEl!: HTMLSelectElement;
  private currentSessionId: string | null = null;
  private pdfExtractedText: string | null = null;
  private pdfFilename: string | null = null;
  private pdfBadgeEl!: HTMLDivElement;
  private pdfUploadBtnEl!: HTMLButtonElement;
  private pdfFileInputEl!: HTMLInputElement;
  private currentAbortController: AbortController | null = null;
  private busy = false;
  private includeFileContext = true;
  private selectedModel: string = "";
  private modelSelectorEl!: HTMLSelectElement;
  private messageWrappers = new Map<ChatMessage, HTMLDivElement>();
  private messageCleanupMap = new Map<ChatMessage, () => void>();
  private messageRenderState = new WeakMap<HTMLDivElement, { rendering: boolean; pending: boolean; message: ChatMessage }>();
  private ragPreviewEnabled = true;
  private previewRetrievedChunks: VaultChunk[] = [];
  private draftRAGPreviewTimer: number | null = null;
  private draftRAGPreviewTickTimer: number | null = null;
  private draftRAGPreviewRequestId = 0;
  private draftRAGPreviewPhase: DraftRAGPreviewPhase = "idle";
  private draftRAGPreviewProgress = 0;
  private draftRAGPreviewStartedAt = 0;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: ObsidianAIChatPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return CHAT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "AI Chat";
  }

  getIcon(): string {
    return "bot";
  }

  async onOpen(): Promise<void> {
    this.containerEl.empty();

    const root = this.containerEl.createDiv({ cls: "oa-chat-root" });

    const header = root.createDiv({ cls: "oa-chat-header" });
    const titleEl = header.createDiv({ cls: "oa-chat-header-title" });
    const titleIcon = titleEl.createSpan();
    setIcon(titleIcon, "sparkles");
    titleEl.createSpan({ text: "AI Chat" });

    const headerActions = header.createDiv({ cls: "oa-chat-header-actions" });

    this.selectedModel = this.plugin.getDefaultModel();

    this.modelSelectorEl = headerActions.createEl("select", {
      cls: "oa-chat-model-selector",
      attr: { title: "Select model", "aria-label": "Select model" },
    });
    this.refreshModelSelector();
    this.preserveMarkdownContextOnPointerDown(this.modelSelectorEl);
    this.modelSelectorEl.addEventListener("change", () => {
      this.selectedModel = this.modelSelectorEl.value;
    });

    this.contextToggleEl = headerActions.createEl("button", {
      cls: "oa-chat-context-toggle",
      attr: {
        title: "Toggle file context inclusion",
        "aria-label": "Toggle file context",
      },
    });
    setIcon(this.contextToggleEl, "paperclip");
    this.preserveMarkdownContextOnPointerDown(this.contextToggleEl);
    this.contextToggleEl.addEventListener("click", () => this.toggleFileContext());
    this.updateContextToggleState();

    this.sessionSelectorEl = headerActions.createEl("select", {
      cls: "oa-chat-session-selector",
      attr: { title: "Switch conversation", "aria-label": "Switch conversation" },
    });
    this.preserveMarkdownContextOnPointerDown(this.sessionSelectorEl);
    this.sessionSelectorEl.addEventListener("change", () => {
      const id = this.sessionSelectorEl.value;
      if (id && id !== this.currentSessionId) {
        this.loadSession(id);
      }
    });

    this.newChatButtonEl = headerActions.createEl("button", {
      cls: "oa-chat-new",
      attr: { title: "New conversation", "aria-label": "New conversation" },
    });
    setIcon(this.newChatButtonEl, "plus");
    this.preserveMarkdownContextOnPointerDown(this.newChatButtonEl);
    this.newChatButtonEl.addEventListener("click", () => this.startNewChat());

    this.messagesEl = root.createDiv({ cls: "oa-chat-messages" });

    const composer = root.createDiv({ cls: "oa-chat-composer" });

    const badgesRow = composer.createDiv({ cls: "oa-chat-badges-row" });

    this.contextBadgeEl = badgesRow.createDiv({ cls: "oa-chat-context-badge" });
    this.updateContextBadge();

    this.selectionBadgeEl = badgesRow.createDiv({ cls: "oa-chat-selection-badge" });
    this.updateSelectionBadge();

    this.ragBadgeEl = badgesRow.createDiv({ cls: "oa-chat-rag-badge" });

    this.ragPreviewToggleEl = badgesRow.createEl("label", {
      cls: "oa-chat-rag-preview-toggle",
      attr: {
        title: "Toggle draft RAG preview",
        "aria-label": "Toggle draft RAG preview",
      },
    });
    this.ragPreviewToggleInputEl = this.ragPreviewToggleEl.createEl("input", {
      cls: "oa-chat-rag-preview-toggle-input",
      attr: { type: "checkbox" },
    });
    this.ragPreviewToggleInputEl.checked = this.ragPreviewEnabled;
    this.ragPreviewToggleEl.createSpan({ cls: "oa-chat-rag-preview-toggle-slider" });
    this.ragPreviewToggleEl.createSpan({
      cls: "oa-chat-rag-preview-toggle-label",
      text: "Preview",
    });
    this.preserveMarkdownContextOnPointerDown(this.ragPreviewToggleEl);
    this.ragPreviewToggleInputEl.addEventListener("change", () => this.toggleDraftRAGPreview());
    this.updateDraftRAGPreviewToggle();
    this.updateRAGBadge();

    this.pdfBadgeEl = badgesRow.createDiv({ cls: "oa-chat-pdf-badge" });
    this.pdfBadgeEl.hide();

    this.pdfFileInputEl = this.containerEl.createEl("input", {
      attr: { type: "file", accept: ".pdf", style: "display:none" },
    });
    this.pdfFileInputEl.addEventListener("change", () => {
      const file = this.pdfFileInputEl.files?.[0];
      if (file) {
        void this.handlePDFUpload(file);
        this.pdfFileInputEl.value = "";
      }
    });

    const composerInner = composer.createDiv({ cls: "oa-chat-composer-inner" });

    this.inputEl = composerInner.createEl("textarea", {
      cls: "oa-chat-input",
      attr: { placeholder: "Ask something...", rows: "3" },
    });
    this.preserveMarkdownContextOnPointerDown(this.inputEl);
    this.inputEl.addEventListener("input", () => this.handleDraftInputChanged());
    this.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void this.handleSend();
      }
    });

    const controls = composerInner.createDiv({ cls: "oa-chat-controls" });

    this.pdfUploadBtnEl = controls.createEl("button", {
      cls: "oa-chat-pdf-upload",
      attr: { title: "Upload PDF for context", "aria-label": "Upload PDF" },
    });
    setIcon(this.pdfUploadBtnEl, "file-up");
    this.preserveMarkdownContextOnPointerDown(this.pdfUploadBtnEl);
    this.pdfUploadBtnEl.addEventListener("click", () => {
      this.pdfFileInputEl.click();
    });

    this.stopButtonEl = controls.createEl("button", {
      cls: "oa-chat-stop",
      attr: { title: "Stop generation", "aria-label": "Stop generation" },
    });
    setIcon(this.stopButtonEl, "square");
    this.preserveMarkdownContextOnPointerDown(this.stopButtonEl);
    this.stopButtonEl.addEventListener("click", () => this.stopGeneration());

    this.sendButtonEl = controls.createEl("button", {
      cls: "mod-cta oa-chat-send",
      attr: { title: "Send message", "aria-label": "Send message" },
    });
    setIcon(this.sendButtonEl, "send-horizontal");
    this.preserveMarkdownContextOnPointerDown(this.sendButtonEl);
    this.sendButtonEl.addEventListener("click", () => { void this.handleSend(); });

    this.updateProviderControls();
    this.updateBusyState(false);

    // Listen for active file changes
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.plugin.internalToolService.captureMarkdownViewContext();
        this.updateContextBadge();
        this.updateSelectionBadge();
        this.scheduleDraftRAGPreview();
      })
    );

    this.plugin.internalToolService.captureMarkdownViewContext();
    this.updateSelectionBadge();
    this.restoreLastSession();
    void this.refreshProviderModels();
  }

  async onClose(): Promise<void> {
    this.saveCurrentSession();
    this.stopGeneration();
    this.clearDraftRAGPreview();
    this.runMessageCleanups();
    this.containerEl.empty();
  }

  private toggleFileContext(): void {
    this.includeFileContext = !this.includeFileContext;
    this.updateContextToggleState();
    this.updateContextBadge();
  }

  private updateContextToggleState(): void {
    this.contextToggleEl.toggleClass("oa-chat-context-active", this.includeFileContext);
    this.contextToggleEl.toggleClass("oa-chat-context-inactive", !this.includeFileContext);
  }

  private refreshModelSelector(): void {
    const current = this.selectedModel || this.plugin.getDefaultModel();
    this.modelSelectorEl.empty();

    const models = this.plugin.getSelectableModels();
    const allModels = models.includes(current) ? models : [current, ...models];

    for (const model of allModels) {
      const opt = this.modelSelectorEl.createEl("option", {
        text: model.split("/").pop() ?? model,
        attr: { value: model },
      });
      if (model === current) opt.selected = true;
    }
    this.selectedModel = current;
  }

  private updateProviderControls(): void {
    this.modelSelectorEl.toggleClass("oa-hidden", !this.plugin.supportsModelSelection());
    this.refreshModelSelector();

    const supportsPDFUpload = this.plugin.supportsPDFUpload();
    this.pdfUploadBtnEl.toggleClass("oa-hidden", !supportsPDFUpload);
    if (!supportsPDFUpload) {
      this.pdfExtractedText = null;
      this.pdfFilename = null;
      this.updatePDFBadge();
    }

    this.updateDraftRAGPreviewToggle();
    this.updateRAGBadge();
  }

  private async refreshProviderModels(): Promise<void> {
    if (this.plugin.getActiveProvider() !== "chatgpt") {
      this.refreshModelSelector();
      return;
    }

    try {
      const models = await this.plugin.refreshCodexModels(false);
      if (!models.includes(this.selectedModel)) {
        this.selectedModel = this.plugin.getDefaultModel();
      }
    } catch {
      // Keep the cached/default selector state if the background refresh fails.
    }

    this.refreshModelSelector();
  }

  private getActiveFile(): TFile | null {
    return this.app.workspace.getActiveFile();
  }

  private preserveMarkdownContextOnPointerDown(element: HTMLElement): void {
    element.addEventListener("pointerdown", () => {
      this.plugin.internalToolService.captureMarkdownViewContext();
      this.updateSelectionBadge();
    });
  }

  private updateContextBadge(): void {
    if (!this.includeFileContext) {
      this.contextBadgeEl.setText("");
      this.contextBadgeEl.hide();
      return;
    }

    const file = this.getActiveFile();
    if (file) {
      this.contextBadgeEl.empty();
      const badgeIcon = this.contextBadgeEl.createSpan({ cls: "oa-chat-context-badge-icon" });
      setIcon(badgeIcon, "paperclip");
      this.contextBadgeEl.createSpan({ text: file.name });
      this.contextBadgeEl.show();
    } else {
      this.contextBadgeEl.empty();
      this.contextBadgeEl.hide();
    }
  }

  private updateSelectionBadge(): void {
    this.selectionBadgeEl.empty();

    if (!this.includeFileContext) {
      this.selectionBadgeEl.hide();
      return;
    }

    const selection = this.plugin.internalToolService.getActiveSelectionContext();
    if (!selection) {
      this.selectionBadgeEl.hide();
      return;
    }

    const badgeIcon = this.selectionBadgeEl.createSpan({ cls: "oa-chat-selection-badge-icon" });
    setIcon(badgeIcon, "quote-glyph");

    const preview = this.summarizeSelection(selection.selectedText);
    const lineRange = `${selection.from.line + 1}:${selection.from.ch}-${selection.to.line + 1}:${selection.to.ch}`;
    this.selectionBadgeEl.createSpan({ text: `Selection: ${preview}` });
    this.selectionBadgeEl.setAttr(
      "title",
      `Cached selection ${lineRange}\n\n${selection.selectedText}`,
    );
    this.selectionBadgeEl.show();
  }

  private summarizeSelection(text: string): string {
    const singleLine = text.replace(/\s+/g, " ").trim();
    if (singleLine.length <= 48) {
      return singleLine;
    }

    return `${singleLine.slice(0, 45)}...`;
  }

  private toggleDraftRAGPreview(): void {
    this.ragPreviewEnabled = this.ragPreviewToggleInputEl.checked;
    this.updateDraftRAGPreviewToggle();
    if (!this.ragPreviewEnabled) {
      this.clearDraftRAGPreview();
      return;
    }

    this.scheduleDraftRAGPreview();
  }

  private updateDraftRAGPreviewToggle(): void {
    const visible = this.plugin.settings.vaultRAG.enabled;
    this.ragPreviewToggleEl.toggleClass("oa-hidden", !visible);
    this.ragPreviewToggleInputEl.checked = this.ragPreviewEnabled;
    this.ragPreviewToggleEl.toggleClass("is-enabled", this.ragPreviewEnabled);
    this.ragPreviewToggleEl.toggleClass("is-disabled", !this.ragPreviewEnabled);
  }

  private updateRAGBadge(): void {
    this.ragBadgeEl.empty();

    if (!this.plugin.settings.vaultRAG.enabled) {
      if (this.draftRAGPreviewTimer !== null) {
        window.clearTimeout(this.draftRAGPreviewTimer);
        this.draftRAGPreviewTimer = null;
      }
      this.stopDraftRAGPreviewTicking();
      this.draftRAGPreviewRequestId += 1;
      this.draftRAGPreviewPhase = "idle";
      this.draftRAGPreviewProgress = 0;
      this.previewRetrievedChunks = [];
      this.ragBadgeEl.hide();
      return;
    }

    const previewPaths = getUniqueChunkPaths(this.previewRetrievedChunks);
    const showProgress = this.draftRAGPreviewPhase !== "idle";
    if (showProgress) {
      const progressRing = this.ragBadgeEl.createSpan({ cls: "oa-chat-rag-progress-ring" });
      progressRing.toggleClass("is-computing", this.draftRAGPreviewPhase === "computing");
      progressRing.style.setProperty("--oa-rag-progress", `${Math.round(this.draftRAGPreviewProgress * 100)}%`);
    }

    const badgeIcon = this.ragBadgeEl.createSpan({ cls: "oa-chat-rag-badge-icon" });
    setIcon(badgeIcon, "library");
    this.ragBadgeEl.createSpan({
      text: previewPaths.length > 0
        ? `Vault RAG Preview (${previewPaths.length})`
        : "Vault RAG",
    });
    this.ragBadgeEl.setAttr(
      "title",
      previewPaths.length > 0
        ? `Draft preview would use:\n${previewPaths.join("\n")}`
        : this.draftRAGPreviewPhase === "waiting"
          ? `Draft preview updates in ${Math.max(0, Math.ceil((1 - this.draftRAGPreviewProgress) * DRAFT_RAG_PREVIEW_IDLE_MS))} ms.`
          : this.draftRAGPreviewPhase === "computing"
            ? "Computing draft preview now."
            : this.ragPreviewEnabled
              ? "Vault-wide retrieval is enabled for markdown notes. Pause typing to preview which notes would be used."
              : "Draft RAG preview is off for this chat view.",
    );
    this.ragBadgeEl.show();
  }

  private handleDraftInputChanged(): void {
    this.scheduleDraftRAGPreview();
  }

  private scheduleDraftRAGPreview(): void {
    if (this.draftRAGPreviewTimer !== null) {
      window.clearTimeout(this.draftRAGPreviewTimer);
      this.draftRAGPreviewTimer = null;
    }

    const draft = this.inputEl.value.trim();
    if (!this.shouldPreviewDraftRAG(draft)) {
      this.clearDraftRAGPreview();
      return;
    }

    this.startDraftRAGPreviewWaitingState();
    this.draftRAGPreviewTimer = window.setTimeout(() => {
      this.draftRAGPreviewTimer = null;
      void this.refreshDraftRAGPreview(draft);
    }, DRAFT_RAG_PREVIEW_IDLE_MS);
  }

  private shouldPreviewDraftRAG(draft: string): boolean {
    return this.plugin.settings.vaultRAG.enabled
      && this.ragPreviewEnabled
      && !this.busy
      && draft.length > 0;
  }

  private clearDraftRAGPreview(): void {
    if (this.draftRAGPreviewTimer !== null) {
      window.clearTimeout(this.draftRAGPreviewTimer);
      this.draftRAGPreviewTimer = null;
    }

    this.stopDraftRAGPreviewTicking();
    this.draftRAGPreviewRequestId += 1;
    this.draftRAGPreviewPhase = "idle";
    this.draftRAGPreviewProgress = 0;
    this.draftRAGPreviewStartedAt = 0;
    this.previewRetrievedChunks = [];
    this.updateRAGBadge();
  }

  private async refreshDraftRAGPreview(draft: string): Promise<void> {
    if (!this.shouldPreviewDraftRAG(draft)) {
      this.clearDraftRAGPreview();
      return;
    }

    const requestId = ++this.draftRAGPreviewRequestId;
    this.stopDraftRAGPreviewTicking();
    this.draftRAGPreviewPhase = "computing";
    this.draftRAGPreviewProgress = 1;
    this.updateRAGBadge();

    try {
      const chunks = await this.plugin.vaultRAGService.retrieveRelevantChunks(
        draft,
        this.getActiveFile()?.path,
      );

      if (requestId !== this.draftRAGPreviewRequestId) {
        return;
      }

      const currentDraft = this.inputEl.value.trim();
      if (!this.shouldPreviewDraftRAG(currentDraft) || currentDraft !== draft) {
        return;
      }

      this.draftRAGPreviewPhase = "idle";
      this.draftRAGPreviewProgress = 0;
      this.previewRetrievedChunks = chunks;
      this.updateRAGBadge();
    } catch (error) {
      if (requestId !== this.draftRAGPreviewRequestId) {
        return;
      }

      console.error("Failed to refresh draft RAG preview:", error);
      this.draftRAGPreviewPhase = "idle";
      this.draftRAGPreviewProgress = 0;
      this.previewRetrievedChunks = [];
      this.updateRAGBadge();
    }
  }

  private startDraftRAGPreviewWaitingState(): void {
    this.stopDraftRAGPreviewTicking();
    this.draftRAGPreviewPhase = "waiting";
    this.draftRAGPreviewProgress = 0;
    this.draftRAGPreviewStartedAt = Date.now();
    this.previewRetrievedChunks = [];
    this.updateRAGBadge();
    this.draftRAGPreviewTickTimer = window.setInterval(() => {
      const elapsed = Date.now() - this.draftRAGPreviewStartedAt;
      this.draftRAGPreviewProgress = Math.max(0, Math.min(elapsed / DRAFT_RAG_PREVIEW_IDLE_MS, 1));
      this.updateRAGBadge();
      if (this.draftRAGPreviewProgress >= 1) {
        this.stopDraftRAGPreviewTicking();
      }
    }, DRAFT_RAG_PREVIEW_TICK_MS);
  }

  private stopDraftRAGPreviewTicking(): void {
    if (this.draftRAGPreviewTickTimer !== null) {
      window.clearInterval(this.draftRAGPreviewTickTimer);
      this.draftRAGPreviewTickTimer = null;
    }
  }

  private async buildFileContextMessage(): Promise<ChatMessage | null> {
    if (!this.includeFileContext) {
      return null;
    }

    const file = this.getActiveFile();
    if (!file) {
      return null;
    }

    try {
      const content = await this.app.vault.cachedRead(file);
      const selection = this.plugin.internalToolService.getActiveSelectionContext();
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
      const contextContent = `The user has the following note open ("${file.name}"):\n---\n${content}\n---\nRefer to this note when answering the user's questions.${selectionContext}`;

      return {
        role: ChatRole.System,
        content: contextContent,
      };
    } catch (error) {
      console.error("Failed to read active file:", error);
      return null;
    }
  }

  private async buildVaultContextMessage(query: string): Promise<ChatMessage | null> {
    const chunks = await this.plugin.vaultRAGService.retrieveRelevantChunks(
      query,
      this.getActiveFile()?.path,
    );

    if (chunks.length === 0) {
      return null;
    }

    const formattedChunks = chunks.map((chunk, index) => [
      `Snippet ${index + 1}`,
      `Path: ${chunk.path}`,
      `Title: ${chunk.title}`,
      chunk.content,
    ].join("\n")).join("\n\n---\n\n");

    return {
      role: ChatRole.System,
      content: [
        "Use the following retrieved vault snippets as optional grounding context.",
        "Prefer them when they are relevant, and cite note paths naturally when you rely on them.",
        "---",
        formattedChunks,
        "---",
      ].join("\n"),
    };
  }

  private updateBusyState(isBusy: boolean): void {
    this.busy = isBusy;
    this.sendButtonEl.disabled = isBusy;
    this.inputEl.disabled = isBusy;
    this.stopButtonEl.toggleClass("oa-hidden", !isBusy);
    this.newChatButtonEl.disabled = isBusy;
    this.modelSelectorEl.disabled = isBusy;
    this.pdfUploadBtnEl.disabled = isBusy;
    this.messagesEl.querySelectorAll<HTMLButtonElement>(".oa-chat-edit-btn").forEach(btn => {
      btn.disabled = isBusy;
    });

    if (isBusy) {
      this.clearDraftRAGPreview();
    } else {
      this.scheduleDraftRAGPreview();
    }
  }

  private runMessageCleanups(): void {
    this.messageCleanupMap.forEach((cleanup) => cleanup());
    this.messageCleanupMap.clear();
    this.messageWrappers.clear();
  }

  private generateSessionTitle(messages: ChatMessage[]): string {
    const firstUser = messages.find(m => m.role === ChatRole.User);
    if (!firstUser) return "New chat";
    const text = firstUser.content.trim().replace(/\n/g, " ");
    return text.length > 40 ? text.slice(0, 40) + "…" : text;
  }

  private clearMessages(): void {
    this.messages = [];
    this.messagesEl.empty();
    this.runMessageCleanups();
  }

  private saveCurrentSession(): void {
    const toSave = this.messages.filter(m => m.role !== ChatRole.System);
    if (toSave.length === 0) return;

    const { chatSessions } = this.plugin.settings;
    const title = this.generateSessionTitle(toSave);
    const existing = this.currentSessionId
      ? chatSessions.find(s => s.id === this.currentSessionId)
      : null;

    if (existing) {
      existing.messages = toSave;
      existing.title = title;
    } else {
      const session: ChatSession = {
        id: crypto.randomUUID(),
        title,
        messages: toSave,
        createdAt: Date.now(),
      };
      chatSessions.unshift(session);
      this.currentSessionId = session.id;
    }

    if (chatSessions.length > 50) {
      chatSessions.splice(50);
    }

    this.plugin.settings.activeSessionId = this.currentSessionId;
    void this.plugin.saveSettings();
  }

  private loadSession(id: string): void {
    this.saveCurrentSession();

    const session = this.plugin.settings.chatSessions.find(s => s.id === id);
    if (!session) return;

    this.clearMessages();
    this.inputEl.value = "";
    this.clearDraftRAGPreview();
    this.messages = [...session.messages];
    this.currentSessionId = id;
    this.plugin.settings.activeSessionId = id;
    void this.plugin.saveSettings();

    for (const msg of this.messages) {
      this.appendMessage(msg);
    }

    this.refreshSessionSelector();
  }

  private startNewChat(): void {
    if (this.busy) return;
    this.saveCurrentSession();

    this.clearMessages();
    this.inputEl.value = "";
    this.clearDraftRAGPreview();
    this.currentSessionId = null;
    this.plugin.settings.activeSessionId = null;
    void this.plugin.saveSettings();
    this.refreshSessionSelector();
  }

  private restoreLastSession(): void {
    const { activeSessionId, chatSessions } = this.plugin.settings;
    if (activeSessionId) {
      const session = chatSessions.find(s => s.id === activeSessionId);
      if (session) {
        this.messages = [...session.messages];
        this.currentSessionId = activeSessionId;
        for (const msg of this.messages) {
          this.appendMessage(msg);
        }
      }
    }
    this.refreshSessionSelector();
  }

  private refreshSessionSelector(): void {
    this.sessionSelectorEl.empty();

    const { chatSessions } = this.plugin.settings;

    if (chatSessions.length === 0) {
      const opt = this.sessionSelectorEl.createEl("option", {
        text: "No history",
        attr: { value: "" },
      });
      opt.disabled = true;
      opt.selected = true;
      return;
    }

    for (const session of chatSessions) {
      const opt = this.sessionSelectorEl.createEl("option", {
        text: session.title,
        attr: { value: session.id },
      });
      if (session.id === this.currentSessionId) {
        opt.selected = true;
      }
    }

    if (!this.currentSessionId) {
      const placeholder = this.sessionSelectorEl.createEl("option", {
        text: "New chat",
        attr: { value: "" },
      });
      placeholder.selected = true;
      this.sessionSelectorEl.insertBefore(placeholder, this.sessionSelectorEl.firstChild);
    }
  }

  private stopGeneration(): void {
    if (!this.currentAbortController) {
      return;
    }

    this.currentAbortController.abort();
    this.currentAbortController = null;
  }

  private appendMessage(message: ChatMessage): HTMLDivElement {
    const wrapper = this.messagesEl.createDiv({ cls: "oa-chat-message" });
    wrapper.toggleClass("oa-chat-user", message.role === ChatRole.User);
    wrapper.toggleClass("oa-chat-assistant", message.role === ChatRole.Assistant);
    wrapper.toggleClass("oa-chat-system", message.role === ChatRole.System);

    this.messageWrappers.set(message, wrapper);

    const content = wrapper.createDiv({
      cls: "oa-chat-message-content",
    });
    this.renderMessageContent(content, message);

    if (message.role !== ChatRole.System) {
      const toolbar = wrapper.createDiv({ cls: "oa-chat-message-toolbar" });

      const copyBtn = toolbar.createEl("button", {
        cls: "oa-chat-copy-btn",
        attr: {
          title: "Copy message",
        },
      });
      setIcon(copyBtn, "copy");

      const clickHandler = () => {
        navigator.clipboard.writeText(message.content).then(() => {
          setIcon(copyBtn, "check");
          setTimeout(() => {
            setIcon(copyBtn, "copy");
          }, 2000);
        });
      };

      copyBtn.addEventListener("click", clickHandler);
      this.messageCleanupMap.set(message, () => {
        copyBtn.removeEventListener("click", clickHandler);
      });

      if (message.role === ChatRole.User) {
        const editBtn = toolbar.createEl("button", {
          cls: "oa-chat-edit-btn",
          attr: { title: "Edit message", "aria-label": "Edit message" },
        });
        setIcon(editBtn, "pencil");
        const editHandler = () => {
          if (!this.busy) this.enterEditMode(wrapper, content, message);
        };
        editBtn.addEventListener("click", editHandler);
        const existingCleanup = this.messageCleanupMap.get(message);
        this.messageCleanupMap.set(message, () => {
          existingCleanup?.();
          editBtn.removeEventListener("click", editHandler);
        });
      }
    }

    this.messagesEl.scrollTo({ top: this.messagesEl.scrollHeight });
    return content;
  }

  private renderMessageContent(contentEl: HTMLDivElement, message: ChatMessage): void {
    const existing = this.messageRenderState.get(contentEl);
    if (existing) {
      existing.pending = true;
      existing.message = message;
      if (existing.rendering) {
        return;
      }
    }

    const state = existing ?? {
      rendering: false,
      pending: true,
      message,
    };

    this.messageRenderState.set(contentEl, state);
    state.pending = true;
    state.message = message;

    void this.processMessageRender(contentEl, state);
  }

  private async processMessageRender(
    contentEl: HTMLDivElement,
    state: { rendering: boolean; pending: boolean; message: ChatMessage },
  ): Promise<void> {
    if (state.rendering) {
      return;
    }

    state.rendering = true;

    try {
      while (state.pending) {
        state.pending = false;
        const { message } = state;
        const renderedContent = this.normalizeMathDelimiters(message.content);

        contentEl.empty();

        try {
          await MarkdownRenderer.render(
            this.app,
            renderedContent,
            contentEl,
            this.getActiveFile()?.path ?? "",
            this,
          );
        } catch (error) {
          console.error("Failed to render chat message as markdown:", error);
          contentEl.setText(message.content);
        }

        const toolEvents = message.toolEvents ?? message.mcpCalls;
        if (toolEvents?.length) {
          this.renderToolEvents(contentEl, toolEvents);
        }

        if (message.editProposal) {
          this.renderProposalAction(contentEl, message.editProposal);
        }
      }
    } finally {
      state.rendering = false;
      if (state.pending) {
        void this.processMessageRender(contentEl, state);
      }
    }
  }

  private normalizeMathDelimiters(content: string): string {
    return content
      .replace(/\\\[([\s\S]*?)\\\]/g, (_match, math: string) => `$$\n${math.trim()}\n$$`)
      .replace(/\\\(([^]+?)\\\)/g, (_match, math: string) => `$${math.trim()}$`);
  }

  private renderToolEvents(contentEl: HTMLDivElement, calls: ToolExecutionEvent[]): void {
    const callsEl = contentEl.createDiv({ cls: "oa-chat-mcp-calls" });
    const titleEl = callsEl.createDiv({ cls: "oa-chat-mcp-title" });
    titleEl.setText(calls.length === 1 ? "1 tool call" : `${calls.length} tool calls`);

    for (const call of calls) {
      const callEl = callsEl.createDiv({ cls: "oa-chat-mcp-call" });
      callEl.toggleClass("oa-chat-mcp-call-success", call.success);
      callEl.toggleClass("oa-chat-mcp-call-error", !call.success);

      const summaryEl = callEl.createDiv({ cls: "oa-chat-mcp-summary" });
      summaryEl.createSpan({
        cls: "oa-chat-mcp-status",
        text: call.success ? "Success" : "Error",
      });
      summaryEl.createSpan({
        cls: "oa-chat-mcp-tool",
        text: `${call.source === "internal" ? "internal" : call.serverName} -> ${call.toolName}`,
      });
      summaryEl.createSpan({
        cls: "oa-chat-mcp-duration",
        text: `${call.durationMs} ms`,
      });

      const detailsEl = callEl.createEl("details", { cls: "oa-chat-mcp-details" });
      detailsEl.createEl("summary", {
        cls: "oa-chat-mcp-details-summary",
        text: "Details",
      });

      this.createMCPDetailBlock(detailsEl, "Arguments", call.argumentsText);
      if (call.success) {
        this.createMCPDetailBlock(detailsEl, "Result", call.resultText ?? "");
      } else {
        this.createMCPDetailBlock(detailsEl, "Error", call.errorText ?? "");
      }
    }
  }

  private createMCPDetailBlock(parent: HTMLElement, label: string, text: string): void {
    const blockEl = parent.createDiv({ cls: "oa-chat-mcp-detail-block" });
    blockEl.createDiv({ cls: "oa-chat-mcp-detail-label", text: label });
    blockEl.createEl("pre", { cls: "oa-chat-mcp-detail-text", text: text || "No data" });
  }

  private renderProposalAction(
    contentEl: HTMLDivElement,
    proposal: ActiveNoteEditProposal,
  ): void {
    const actionsEl = contentEl.createDiv({ cls: "oa-chat-message-actions" });
    const applyBtn = actionsEl.createEl("button", {
      cls: "mod-cta oa-chat-apply-btn",
      attr: {
        title: "Review changes in diff view and apply selectively",
      },
    });
    const applyIcon = applyBtn.createSpan({ cls: "oa-chat-apply-btn-icon" });
    setIcon(applyIcon, "file-diff");
    applyBtn.createSpan({ text: "Review & Apply Changes" });

    applyBtn.addEventListener("click", () => {
      void this.showDiffForProposal(proposal);
    });
  }

  private async showDiffForProposal(proposal: ActiveNoteEditProposal): Promise<void> {
    await this.plugin.openEditReview(proposal, { source: "chat" });
  }

  /**
   * Builds the request messages array for the LLM, prepending the system prompt and active file context if available.
   */
  private async buildRequestMessages(userQuery: string): Promise<ChatMessage[]> {
    const requestMessages: ChatMessage[] = [];

    const systemPrompt = this.plugin.settings.systemPrompt.trim();
    if (systemPrompt) {
      requestMessages.push({
        role: ChatRole.System,
        content: systemPrompt,
      });
    }

    requestMessages.push({
      role: ChatRole.System,
      content: this.plugin.internalToolService.getToolUseInstruction(),
    });

    const fileContext = await this.buildFileContextMessage();
    if (fileContext) {
      requestMessages.push(fileContext);
    }

    const vaultContext = await this.buildVaultContextMessage(userQuery);
    if (vaultContext) {
      requestMessages.push(vaultContext);
    }

    if (this.pdfExtractedText && this.pdfFilename) {
      requestMessages.push({
        role: ChatRole.System,
        content: `Extracted PDF content from "${this.pdfFilename}":\n---\n${this.pdfExtractedText}\n---`,
      });
    }

    requestMessages.push(
      ...this.messages.filter((message) => message.content?.trim()),
    );

    return requestMessages;
  }

  /**
   * Streams the LLM response and updates the assistant message.
   */
  private async streamResponse(
    strategy: LLMStrategy,
    requestMessages: ChatMessage[],
    assistantMessage: ChatMessage,
    assistantContentEl: HTMLDivElement,
  ): Promise<void> {
    this.currentAbortController = new AbortController();

    try {
      await strategy.sendMessage(
        requestMessages,
        (chunk: string) => {
          assistantMessage.content += chunk;
          this.renderMessageContent(assistantContentEl, assistantMessage);
          this.messagesEl.scrollTo({ top: this.messagesEl.scrollHeight });
        },
        (call: ToolExecutionEvent) => {
          assistantMessage.toolEvents = [...(assistantMessage.toolEvents ?? []), call];
          if (call.editProposal) {
            assistantMessage.editProposal = call.editProposal;
          }
          this.renderMessageContent(assistantContentEl, assistantMessage);
          this.messagesEl.scrollTo({ top: this.messagesEl.scrollHeight });
          if (call.editProposal) {
            new Notice("AI proposed file changes - click 'Review & Apply Changes' to review");
          }
        },
        this.currentAbortController.signal,
      );
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        assistantMessage.content = assistantMessage.content || "[Stopped]";
      } else {
        const message = formatErrorMessage(error);
        assistantMessage.content = `Error: ${message}`;
        new Notice(`AI request failed: ${message}`);
      }

      this.renderMessageContent(assistantContentEl, assistantMessage);
    } finally {
      this.currentAbortController = null;
      this.updateBusyState(false);
    }
  }

  private async sendUserMessage(userMessage: ChatMessage): Promise<void> {
    const strategy = this.plugin.createStrategy(this.selectedModel);
    const configError = await strategy.validateConfig();
    if (configError) {
      new Notice(configError);
      return;
    }

    this.messages.push(userMessage);
    this.appendMessage(userMessage);

    let requestMessages: ChatMessage[];
    try {
      requestMessages = await this.buildRequestMessages(userMessage.content);
    } catch (error) {
      new Notice(`Failed to build request: ${formatErrorMessage(error)}`);
      return;
    }

    const assistantMessage: ChatMessage = { role: ChatRole.Assistant, content: "" };
    this.messages.push(assistantMessage);
    const assistantContentEl = this.appendMessage(assistantMessage);

    this.updateBusyState(true);
    await this.streamResponse(strategy, requestMessages, assistantMessage, assistantContentEl);
  }

  private async handlePDFUpload(file: File): Promise<void> {
    if (this.busy) return;

    new Notice(`Extracting text from ${file.name}…`);
    this.pdfUploadBtnEl.disabled = true;

    try {
      const text = await this.performOCR(file);
      this.pdfExtractedText = text;
      this.pdfFilename = file.name;
      this.updatePDFBadge();
      new Notice(`PDF extracted: ${file.name}`);
    } catch (error) {
      new Notice(`PDF extraction failed: ${formatErrorMessage(error)}`);
    } finally {
      this.pdfUploadBtnEl.disabled = false;
    }
  }

  private async performOCR(file: File): Promise<string> {
    if (!this.plugin.supportsPDFUpload()) {
      throw new Error("PDF OCR is only available when using the OpenRouter provider.");
    }

    const buffer = await file.arrayBuffer();

    // Chunked base64 encoding to avoid stack overflow on large files
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    const base64 = btoa(binary);

    const apiKey = this.plugin.settings.openRouter.apiKey;
    if (!apiKey) throw new Error("OpenRouter API key is not set");

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.plugin.settings.ocrModel,
        stream: false,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document_url",
                document_url: `data:application/pdf;base64,${base64}`,
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      let msg = `OCR request failed (${response.status})`;
      try {
        const json = await response.json() as { error?: { message?: string } };
        if (json.error?.message) msg = json.error.message;
      } catch { /* ignore */ }
      throw new Error(msg);
    }

    const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = json.choices?.[0]?.message?.content ?? "";
    if (!content) throw new Error("OCR model returned empty content");
    return content;
  }

  private updatePDFBadge(): void {
    this.pdfBadgeEl.empty();

    if (!this.pdfExtractedText || !this.pdfFilename) {
      this.pdfBadgeEl.hide();
      return;
    }

    const icon = this.pdfBadgeEl.createSpan({ cls: "oa-chat-pdf-badge-icon" });
    setIcon(icon, "file-text");
    this.pdfBadgeEl.createSpan({ text: this.pdfFilename });

    const dismissBtn = this.pdfBadgeEl.createEl("button", {
      cls: "oa-chat-pdf-badge-dismiss",
      attr: { title: "Remove PDF context", "aria-label": "Remove PDF" },
    });
    setIcon(dismissBtn, "x");
    dismissBtn.addEventListener("click", () => {
      this.pdfExtractedText = null;
      this.pdfFilename = null;
      this.updatePDFBadge();
    });

    this.pdfBadgeEl.show();
  }

  private async handleSend(): Promise<void> {
    if (this.busy) {
      return;
    }

    this.plugin.internalToolService.captureMarkdownViewContext();

    const text = this.inputEl.value.trim();
    if (!text) {
      return;
    }

    this.inputEl.value = "";
    this.clearDraftRAGPreview();
    const userMessage: ChatMessage = { role: ChatRole.User, content: text };
    await this.sendUserMessage(userMessage);
  }

  private enterEditMode(
    wrapper: HTMLDivElement,
    contentEl: HTMLDivElement,
    message: ChatMessage,
  ): void {
    contentEl.hide();

    const editArea = wrapper.createDiv({ cls: "oa-chat-edit-area" });

    const textarea = editArea.createEl("textarea", {
      cls: "oa-chat-edit-textarea",
      attr: { rows: "3" },
    });
    textarea.value = message.content;
    textarea.focus();

    const actions = editArea.createDiv({ cls: "oa-chat-edit-actions" });

    const sendBtn = actions.createEl("button", {
      cls: "mod-cta oa-chat-edit-send",
      attr: { title: "Confirm edit and resend" },
    });
    setIcon(sendBtn, "send-horizontal");

    const cancelBtn = actions.createEl("button", {
      cls: "oa-chat-edit-cancel",
      attr: { title: "Cancel edit" },
    });
    setIcon(cancelBtn, "x");

    sendBtn.addEventListener("click", () => {
      void this.confirmEdit(wrapper, message, textarea.value.trim(), editArea);
    });

    cancelBtn.addEventListener("click", () => {
      this.cancelEdit(contentEl, editArea);
    });

    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void this.confirmEdit(wrapper, message, textarea.value.trim(), editArea);
      }
      if (e.key === "Escape") {
        this.cancelEdit(contentEl, editArea);
      }
    });
  }

  private cancelEdit(
    contentEl: HTMLDivElement,
    editArea: HTMLDivElement,
  ): void {
    editArea.remove();
    contentEl.show();
  }

  private async confirmEdit(
    wrapper: HTMLDivElement,
    message: ChatMessage,
    newText: string,
    editArea: HTMLDivElement,
  ): Promise<void> {
    if (!newText || this.busy) return;

    const idx = this.messages.indexOf(message);
    if (idx === -1) return;

    const removedMessages = this.messages.splice(idx);

    for (const removed of removedMessages) {
      const el = this.messageWrappers.get(removed);
      if (el) {
        this.messageCleanupMap.get(removed)?.();
        this.messageCleanupMap.delete(removed);
        this.messageWrappers.delete(removed);
        el.remove();
      }
    }

    // editArea is a child of wrapper, already removed above; this is a safety net
    editArea.remove();

    const updatedMessage: ChatMessage = { role: ChatRole.User, content: newText };
    await this.sendUserMessage(updatedMessage);
  }
}
