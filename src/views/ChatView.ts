import { ItemView, Notice, WorkspaceLeaf, TFile, setIcon } from "obsidian";
import type ObsidianAIChatPlugin from "../main";
import type { LLMStrategy } from "../strategies/LLMStrategy";
import { ChatRole, type ChatMessage, type ChatSession } from "../types";
import { FileChangeParser, type DetectedFileChange } from "../services/FileChangeParser";
import type { FileDiff } from "../services/DiffService";
import { DiffModal } from "../components/DiffModal";
import { handleDiffResult } from "../utils/diffResultHandler";
import { formatErrorMessage } from "../utils/errorUtils";

export const CHAT_VIEW_TYPE = "obsidian-ai-chat-view";

export class ChatView extends ItemView {
  private messages: ChatMessage[] = [];
  private messagesEl!: HTMLDivElement;
  private inputEl!: HTMLTextAreaElement;
  private sendButtonEl!: HTMLButtonElement;
  private stopButtonEl!: HTMLButtonElement;
  private newChatButtonEl!: HTMLButtonElement;
  private contextToggleEl!: HTMLButtonElement;
  private contextBadgeEl!: HTMLDivElement;
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
  private fileChangeParser: FileChangeParser;
  private detectedAIFileChange: DetectedFileChange | null = null;
  private messageWrappers = new Map<ChatMessage, HTMLDivElement>();
  private messageCleanupMap = new Map<ChatMessage, () => void>();

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: ObsidianAIChatPlugin,
  ) {
    super(leaf);
    this.fileChangeParser = new FileChangeParser(this.app);
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

    this.selectedModel = this.plugin.settings.openRouter.model;

    this.modelSelectorEl = headerActions.createEl("select", {
      cls: "oa-chat-model-selector",
      attr: { title: "Select model", "aria-label": "Select model" },
    });
    this.refreshModelSelector();
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
    this.contextToggleEl.addEventListener("click", () => this.toggleFileContext());
    this.updateContextToggleState();

    this.sessionSelectorEl = headerActions.createEl("select", {
      cls: "oa-chat-session-selector",
      attr: { title: "Switch conversation", "aria-label": "Switch conversation" },
    });
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
    this.newChatButtonEl.addEventListener("click", () => this.startNewChat());

    this.messagesEl = root.createDiv({ cls: "oa-chat-messages" });

    const composer = root.createDiv({ cls: "oa-chat-composer" });

    const badgesRow = composer.createDiv({ cls: "oa-chat-badges-row" });

    this.contextBadgeEl = badgesRow.createDiv({ cls: "oa-chat-context-badge" });
    this.updateContextBadge();

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
    this.pdfUploadBtnEl.addEventListener("click", () => {
      this.pdfFileInputEl.click();
    });

    this.stopButtonEl = controls.createEl("button", {
      cls: "oa-chat-stop",
      attr: { title: "Stop generation", "aria-label": "Stop generation" },
    });
    setIcon(this.stopButtonEl, "square");
    this.stopButtonEl.addEventListener("click", () => this.stopGeneration());

    this.sendButtonEl = controls.createEl("button", {
      cls: "mod-cta oa-chat-send",
      attr: { title: "Send message", "aria-label": "Send message" },
    });
    setIcon(this.sendButtonEl, "send-horizontal");
    this.sendButtonEl.addEventListener("click", () => { void this.handleSend(); });

    this.updateBusyState(false);

    // Listen for active file changes
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.updateContextBadge();
      })
    );

    this.restoreLastSession();
  }

  async onClose(): Promise<void> {
    this.saveCurrentSession();
    this.stopGeneration();
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
    const current = this.selectedModel || this.plugin.settings.openRouter.model;
    this.modelSelectorEl.empty();

    const models = this.plugin.settings.favoriteModels;
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

  private getActiveFile(): TFile | null {
    return this.app.workspace.getActiveFile();
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
      const contextContent = `The user has the following note open ("${file.name}"):\n---\n${content}\n---\nRefer to this note when answering the user's questions.`;

      return {
        role: ChatRole.System,
        content: contextContent,
      };
    } catch (error) {
      console.error("Failed to read active file:", error);
      return null;
    }
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
    this.detectedAIFileChange = null;
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
    content.setText(message.content);

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

  /**
   * Detect and handle file modification proposals from AI
   */
  private async detectAndHandleFileChange(
    messageEl: HTMLDivElement,
    response: string
  ): Promise<void> {
    const activeFile = this.getActiveFile();
    if (!activeFile) return;

    if (!this.fileChangeParser.hasFileModification(response)) return;

    const detectedChange = this.fileChangeParser.parseAIResponse(response, activeFile);
    if (!detectedChange) return;

    try {
      const currentContent = await this.app.vault.read(activeFile);
      detectedChange.originalContent = currentContent;
      this.detectedAIFileChange = detectedChange;

      const actionsEl = messageEl.createDiv({ cls: "oa-chat-message-actions" });

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
        void this.showDiffForChanges(detectedChange);
      });

      new Notice("AI proposed file changes - click 'Review & Apply Changes' to review");
    } catch (error) {
      console.error("Failed to read file for change detection:", error);
    }
  }

  /**
   * Show diff modal for AI-proposed changes
   */
  private async showDiffForChanges(change: DetectedFileChange): Promise<void> {
    const { diffService } = this.plugin;


    const fileDiff: FileDiff = diffService.createFileDiff(
      change.file.path,
      change.originalContent,
      change.proposedContent
    );

    if (!diffService.hasChanges(fileDiff)) {
      new Notice("No changes detected in AI response");
      return;
    }

    const pendingDiff = {
      file: change.file,
      diff: fileDiff,
      timestamp: Date.now(),
    };

    const clearState = () => {
      this.detectedAIFileChange = null;
    };

    new DiffModal(this.app, pendingDiff, async (result) => {
      await handleDiffResult(
        result,
        change.file,
        diffService,
        (path) => this.plugin.markAsSelfModified(path),
        { onApplied: clearState, onRejected: clearState },
      );
    }).open();
  }

  /**
   * Builds the request messages array for the LLM, prepending the system prompt and active file context if available.
   */
  private async buildRequestMessages(): Promise<ChatMessage[]> {
    const requestMessages: ChatMessage[] = [];

    const systemPrompt = this.plugin.settings.systemPrompt.trim();
    if (systemPrompt) {
      requestMessages.push({
        role: ChatRole.System,
        content: systemPrompt,
      });
    }

    const fileContext = await this.buildFileContextMessage();
    if (fileContext) {
      requestMessages.push(fileContext);
    }

    if (this.pdfExtractedText && this.pdfFilename) {
      requestMessages.push({
        role: ChatRole.System,
        content: `Extracted PDF content from "${this.pdfFilename}":\n---\n${this.pdfExtractedText}\n---`,
      });
    }

    requestMessages.push(
      ...this.messages.filter((message) => message.content.trim()),
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
          assistantContentEl.setText(assistantMessage.content);
          this.messagesEl.scrollTo({ top: this.messagesEl.scrollHeight });
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

      assistantContentEl.setText(assistantMessage.content);
    } finally {
      this.currentAbortController = null;
      this.updateBusyState(false);

      await this.detectAndHandleFileChange(assistantContentEl, assistantMessage.content);
    }
  }

  private async sendUserMessage(userMessage: ChatMessage): Promise<void> {
    const strategy = this.plugin.createStrategy(this.selectedModel);
    const configError = strategy.validateConfig();
    if (configError) {
      new Notice(configError);
      return;
    }

    this.messages.push(userMessage);
    this.appendMessage(userMessage);

    const requestMessages = await this.buildRequestMessages();

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

    const text = this.inputEl.value.trim();
    if (!text) {
      return;
    }

    this.inputEl.value = "";
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
