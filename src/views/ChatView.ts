import { ItemView, Notice, WorkspaceLeaf, TFile, setIcon } from "obsidian";
import type ObsidianAIChatPlugin from "../main";
import { ChatStatusBar, type ChatStatusBarState, type ChatStatusBarRAGPhase } from "../components/ChatStatusBar";
import type { LLMStrategy } from "../strategies/LLMStrategy";
import { ChatRole, type ChatMessage } from "../types";
import type { ActiveNoteEditProposal, ToolExecutionEvent } from "../types/tools";
import { formatErrorMessage } from "../utils/errorUtils";
import { getUniqueChunkPaths } from "../utils/ragPreview";
import {
  createIdleBibPDFPreparationState,
  type BibPDFPreparationState,
} from "../services/BibPDFPreparationService";
import { ChatRequestBuilder } from "./chat/ChatRequestBuilder";
import {
  DraftRAGPreviewController,
  type DraftRAGPreviewState,
} from "./chat/DraftRAGPreviewController";
import { ChatSessionController } from "./chat/ChatSessionController";
import { ChatTranscriptRenderer } from "./chat/ChatTranscriptRenderer";

export const CHAT_VIEW_TYPE = "obsidian-ai-chat-view";
const DRAFT_RAG_PREVIEW_IDLE_MS = 5000;
const DRAFT_RAG_PREVIEW_TICK_MS = 50;

export { buildPDFContextMessage, buildPDFContextMessages } from "./chat/ChatRequestBuilder";

export function buildBibPDFChipState(
  state: BibPDFPreparationState,
  includeFileContext: boolean,
  activeNotePath: string | null,
): ChatStatusBarState["pdf"]["bib"] {
  if (
    !state.filename
    || !state.pdfPath
    || state.status === "idle"
  ) {
    return null;
  }

  const includedInContext = includeFileContext && state.notePath === activeNotePath;
  const contextLabel = includedInContext ? "In chat" : "Not in chat";

  if (state.status === "preparing") {
    return {
      filename: state.filename,
      pdfPath: state.pdfPath,
      status: "preparing",
      includedInContext,
      contextLabel,
      title: includedInContext
        ? "Bib PDF OCR is running and will be included in this chat context."
        : "Bib PDF OCR is running, but the linked PDF is not currently in this chat context.",
    };
  }

  if (state.status === "ready") {
    return {
      filename: state.filename,
      pdfPath: state.pdfPath,
      status: "ready",
      includedInContext,
      contextLabel,
      title: includedInContext
        ? state.source === "cache"
          ? "Bib PDF OCR text is ready from cache and included in this chat context."
          : "Bib PDF OCR text is ready and included in this chat context."
        : state.source === "cache"
          ? "Bib PDF OCR text is ready from cache, but not included in this chat context."
          : "Bib PDF OCR text is ready, but not included in this chat context.",
    };
  }

  return {
    filename: state.filename,
    pdfPath: state.pdfPath,
    status: "error",
    includedInContext: false,
    contextLabel,
    title: state.errorMessage
      ? `Bib PDF OCR failed: ${state.errorMessage}`
      : "Bib PDF OCR failed.",
  };
}

export class ChatView extends ItemView {
  private messages: ChatMessage[] = [];
  private messagesEl!: HTMLDivElement;
  private inputEl!: HTMLTextAreaElement;
  private sendButtonEl!: HTMLButtonElement;
  private stopButtonEl!: HTMLButtonElement;
  private newChatButtonEl!: HTMLButtonElement;
  private statusBar!: ChatStatusBar;
  private sessionSelectorEl!: HTMLSelectElement;
  private currentSessionId: string | null = null;
  private manualPDFContext: { filename: string; text: string } | null = null;
  private bibPDFState: BibPDFPreparationState = createIdleBibPDFPreparationState();
  private pdfUploadBtnEl!: HTMLButtonElement;
  private pdfFileInputEl!: HTMLInputElement;
  private currentAbortController: AbortController | null = null;
  private busy = false;
  private includeFileContext = true;
  private selectedModel: string = "";
  private modelSelectorEl!: HTMLSelectElement;
  private ragEnabled = true;
  private draftRAGPreviewState: DraftRAGPreviewState = {
    phase: "idle",
    progress: 0,
    chunks: [],
  };
  private readonly requestBuilder: ChatRequestBuilder;
  private readonly draftRAGPreviewController: DraftRAGPreviewController;
  private readonly sessionController: ChatSessionController;
  private transcriptRenderer: ChatTranscriptRenderer | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: ObsidianAIChatPlugin,
  ) {
    super(leaf);
    this.requestBuilder = new ChatRequestBuilder({
      getSystemPrompt: () => this.plugin.settings.systemPrompt,
      getToolUseInstruction: () => this.plugin.internalToolService.getToolUseInstruction(),
      getActiveFile: () => this.getActiveFile(),
      getActiveSelectionContext: () => this.plugin.internalToolService.getActiveSelectionContext(),
      readFile: async (file) => this.app.vault.cachedRead(file),
      retrieveRelevantChunks: (query, activeFilePath) => this.plugin.vaultRAGService.retrieveRelevantChunks(query, activeFilePath),
    });
    this.draftRAGPreviewController = new DraftRAGPreviewController({
      idleMs: DRAFT_RAG_PREVIEW_IDLE_MS,
      tickMs: DRAFT_RAG_PREVIEW_TICK_MS,
      retrieveRelevantChunks: (query, activeFilePath) => this.plugin.vaultRAGService.retrieveRelevantChunks(query, activeFilePath),
      getActiveFilePath: () => this.getActiveFile()?.path,
      getCurrentDraft: () => this.inputEl?.value ?? "",
      onStateChange: (state) => {
        this.draftRAGPreviewState = state;
        this.renderStatusBar();
      },
    });
    this.sessionController = new ChatSessionController({
      getSettings: () => this.plugin.settings,
      saveSettings: () => this.plugin.saveSettings(),
    });
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
    this.transcriptRenderer = new ChatTranscriptRenderer({
      app: this.app,
      component: this,
      messagesEl: this.messagesEl,
      getActiveFilePath: () => this.getActiveFile()?.path ?? "",
      onEditMessage: (wrapper, contentEl, message) => {
        if (!this.busy) {
          this.enterEditMode(wrapper, contentEl, message);
        }
      },
      onReviewProposal: (proposal) => {
        void this.showDiffForProposal(proposal);
      },
    });

    const composer = root.createDiv({ cls: "oa-chat-composer" });

    this.statusBar = new ChatStatusBar({
      parent: composer,
      preserveMarkdownContextOnPointerDown: (element) => this.preserveMarkdownContextOnPointerDown(element),
      captureMarkdownContextOnPointerDown: (element) => this.captureMarkdownContextOnPointerDown(element),
      onToggleContext: () => this.toggleFileContext(),
      onToggleRAG: () => this.toggleRAG(),
      onRemovePDF: () => this.clearPDFContext(),
      onOpenPDF: (path) => { void this.plugin.openAbsolutePathInDefaultApp(path); },
    });
    this.register(this.plugin.bibPDFPreparationService.onStateChange((state) => {
      this.bibPDFState = state;
      this.renderStatusBar();
    }));
    this.renderStatusBar();

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
    const pdfUploadIcon = this.pdfUploadBtnEl.createSpan({ cls: "oa-chat-pdf-upload-icon" });
    setIcon(pdfUploadIcon, "file-up");
    this.pdfUploadBtnEl.createSpan({ cls: "oa-chat-pdf-upload-label", text: "PDF" });
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
        this.renderStatusBar();
        this.scheduleDraftRAGPreview();
      })
    );

    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (!(file instanceof TFile)) {
          return;
        }
        if (file.path !== this.getActiveFile()?.path) {
          return;
        }
        this.plugin.internalToolService.captureMarkdownViewContext();
        this.renderStatusBar();
      })
    );

    this.plugin.internalToolService.captureMarkdownViewContext();
    this.renderStatusBar();
    this.restoreLastSession();
    void this.refreshProviderModels();
  }

  async onClose(): Promise<void> {
    this.saveCurrentSession();
    this.stopGeneration();
    this.draftRAGPreviewController.clear();
    this.runMessageCleanups();
    this.containerEl.empty();
  }

  private toggleFileContext(): void {
    this.includeFileContext = !this.includeFileContext;
    this.renderStatusBar();
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
      this.clearPDFContext();
    }

    if (!this.plugin.settings.vaultRAG.enabled || !this.ragEnabled) {
      this.draftRAGPreviewController.clear();
    }

    this.draftRAGPreviewController.setAvailability(this.plugin.settings.vaultRAG.enabled, this.ragEnabled);
    this.renderStatusBar();
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
      this.renderStatusBar();
    });
  }

  private captureMarkdownContextOnPointerDown(element: HTMLElement): void {
    element.addEventListener("pointerdown", () => {
      this.plugin.internalToolService.captureMarkdownViewContext();
    });
  }

  private summarizeSelection(text: string): string {
    const singleLine = text.replace(/\s+/g, " ").trim();
    if (singleLine.length <= 48) {
      return singleLine;
    }

    return `${singleLine.slice(0, 45)}...`;
  }

  private toggleRAG(): void {
    this.ragEnabled = !this.ragEnabled;
    this.renderStatusBar();
    if (!this.ragEnabled) {
      this.clearDraftRAGPreview();
      return;
    }

    this.scheduleDraftRAGPreview();
  }

  private renderStatusBar(): void {
    this.statusBar.update(this.buildStatusBarState());
  }

  private buildStatusBarState(): ChatStatusBarState {
    const selection = this.includeFileContext
      ? this.plugin.internalToolService.getActiveSelectionContext()
      : null;

    return {
      context: {
        enabled: this.includeFileContext,
        fileName: this.getActiveFile()?.name ?? null,
        selection: selection
          ? {
            preview: this.summarizeSelection(selection.selectedText),
            lineRange: `${selection.from.line + 1}:${selection.from.ch}-${selection.to.line + 1}:${selection.to.ch}`,
            fullText: selection.selectedText,
          }
          : null,
      },
      rag: {
        available: this.plugin.settings.vaultRAG.enabled,
        enabled: this.ragEnabled,
        phase: this.draftRAGPreviewState.phase as ChatStatusBarRAGPhase,
        progress: this.draftRAGPreviewState.progress,
        previewPaths: getUniqueChunkPaths(this.draftRAGPreviewState.chunks),
      },
      pdf: {
        manualFilename: this.manualPDFContext?.filename ?? null,
        bib: this.buildBibPDFChipState(),
      },
    };
  }

  private handleDraftInputChanged(): void {
    this.scheduleDraftRAGPreview();
  }

  private scheduleDraftRAGPreview(): void {
    this.draftRAGPreviewController.setAvailability(this.plugin.settings.vaultRAG.enabled, this.ragEnabled);
    this.draftRAGPreviewController.schedule(this.inputEl.value.trim());
  }

  private clearDraftRAGPreview(): void {
    this.draftRAGPreviewController.clear();
  }

  private updateBusyState(isBusy: boolean): void {
    this.busy = isBusy;
    this.sendButtonEl.disabled = isBusy;
    this.inputEl.disabled = isBusy;
    this.stopButtonEl.toggleClass("oa-hidden", !isBusy);
    this.newChatButtonEl.disabled = isBusy;
    this.modelSelectorEl.disabled = isBusy;
    this.pdfUploadBtnEl.disabled = isBusy;
    this.transcriptRenderer?.setBusy(isBusy);
    this.draftRAGPreviewController.setBusy(isBusy);

    if (isBusy) {
      this.clearDraftRAGPreview();
    } else {
      this.scheduleDraftRAGPreview();
    }
  }

  private runMessageCleanups(): void {
    this.transcriptRenderer?.runMessageCleanups();
  }

  private clearMessages(): void {
    this.messages = [];
    this.transcriptRenderer?.clear();
  }

  private saveCurrentSession(): void {
    void this.sessionController.save(this.messages, this.currentSessionId).then((id) => {
      this.currentSessionId = id;
    });
  }

  private loadSession(id: string): void {
    this.saveCurrentSession();
    void this.sessionController.load(id).then((session) => {
      if (!session) {
        return;
      }

      this.clearMessages();
      this.inputEl.value = "";
      this.clearDraftRAGPreview();
      this.messages = [...session.messages];
      this.currentSessionId = id;

      for (const msg of this.messages) {
        this.appendMessage(msg);
      }

      this.refreshSessionSelector();
    });
  }

  private startNewChat(): void {
    if (this.busy) return;
    this.saveCurrentSession();

    this.clearMessages();
    this.inputEl.value = "";
    this.clearDraftRAGPreview();
    this.currentSessionId = null;
    void this.sessionController.clearActiveSession();
    this.refreshSessionSelector();
  }

  private restoreLastSession(): void {
    const session = this.sessionController.restoreLast();
    if (session) {
      this.messages = [...session.messages];
      this.currentSessionId = session.id;
      for (const msg of this.messages) {
        this.appendMessage(msg);
      }
    }
    this.refreshSessionSelector();
  }

  private refreshSessionSelector(): void {
    this.sessionSelectorEl.empty();

    const chatSessions = this.sessionController.getSessions();

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
    return this.transcriptRenderer!.appendMessage(message, this.busy);
  }

  private renderMessageContent(contentEl: HTMLDivElement, message: ChatMessage): void {
    this.transcriptRenderer?.renderMessageContent(contentEl, message);
  }

  private async showDiffForProposal(proposal: ActiveNoteEditProposal): Promise<void> {
    await this.plugin.openEditReview(proposal, { source: "chat" });
  }

  /**
   * Builds the request messages array for the LLM, prepending the system prompt and active file context if available.
   */
  private async buildRequestMessages(userQuery: string): Promise<ChatMessage[]> {
    return this.requestBuilder.build({
      userQuery,
      includeFileContext: this.includeFileContext,
      vaultRAGEnabled: this.plugin.settings.vaultRAG.enabled && this.ragEnabled,
      messages: this.messages,
      manualPDFContext: this.manualPDFContext,
      bibPDFState: this.bibPDFState,
    });
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

    const availabilityError = this.plugin.getPDFUploadError();
    if (availabilityError) {
      new Notice(availabilityError);
      return;
    }

    new Notice(`Extracting text from ${file.name}…`);
    this.pdfUploadBtnEl.disabled = true;

    try {
      const extracted = await this.plugin.pdfExtractionService.extract(file);
      this.manualPDFContext = extracted;
      this.renderStatusBar();
      new Notice(`PDF extracted: ${extracted.filename}`);
    } catch (error) {
      new Notice(`PDF extraction failed: ${formatErrorMessage(error)}`);
    } finally {
      this.pdfUploadBtnEl.disabled = false;
    }
  }

  private clearPDFContext(): void {
    this.manualPDFContext = null;
    this.renderStatusBar();
  }

  private buildBibPDFChipState(): ChatStatusBarState["pdf"]["bib"] {
    return buildBibPDFChipState(
      this.bibPDFState,
      this.includeFileContext,
      this.getActiveFile()?.path ?? null,
    );
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

    this.transcriptRenderer?.removeMessages(removedMessages);

    // editArea is a child of wrapper, already removed above; this is a safety net
    editArea.remove();

    const updatedMessage: ChatMessage = { role: ChatRole.User, content: newText };
    await this.sendUserMessage(updatedMessage);
  }
}
