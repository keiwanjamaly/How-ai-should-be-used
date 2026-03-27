import { ItemView, Notice, WorkspaceLeaf, TFile } from "obsidian";
import type ObsidianAIChatPlugin from "../main";
import type { LLMStrategy } from "../strategies/LLMStrategy";
import { ChatRole, type ChatMessage } from "../types";

export const CHAT_VIEW_TYPE = "obsidian-ai-chat-view";

export class ChatView extends ItemView {
  private messages: ChatMessage[] = [];
  private messagesEl!: HTMLDivElement;
  private inputEl!: HTMLTextAreaElement;
  private sendButtonEl!: HTMLButtonElement;
  private stopButtonEl!: HTMLButtonElement;
  private clearButtonEl!: HTMLButtonElement;
  private contextToggleEl!: HTMLButtonElement;
  private contextBadgeEl!: HTMLDivElement;
  private currentAbortController: AbortController | null = null;
  private busy = false;
  private includeFileContext = true;

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
    header.createEl("h2", { text: "AI Chat" });

    this.clearButtonEl = header.createEl("button", {
      cls: "mod-cta oa-chat-clear",
      text: "Clear",
    });
    this.clearButtonEl.addEventListener("click", () => this.clearConversation());

    this.contextToggleEl = header.createEl("button", {
      cls: "oa-chat-context-toggle",
      text: "📎",
      attr: {
        title: "Toggle file context inclusion",
      },
    });
    this.contextToggleEl.addEventListener("click", () => this.toggleFileContext());
    this.updateContextToggleState();

    this.messagesEl = root.createDiv({ cls: "oa-chat-messages" });

    const composer = root.createDiv({ cls: "oa-chat-composer" });

    this.contextBadgeEl = composer.createDiv({ cls: "oa-chat-context-badge" });
    this.updateContextBadge();
    this.inputEl = composer.createEl("textarea", {
      cls: "oa-chat-input",
      attr: {
        placeholder: "Ask something...",
        rows: "3",
      },
    });

    this.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void this.handleSend();
      }
    });

    const controls = composer.createDiv({ cls: "oa-chat-controls" });
    this.stopButtonEl = controls.createEl("button", {
      cls: "oa-chat-stop",
      text: "Stop",
    });
    this.stopButtonEl.addEventListener("click", () => this.stopGeneration());

    this.sendButtonEl = controls.createEl("button", {
      cls: "mod-cta oa-chat-send",
      text: "Send",
    });
    this.sendButtonEl.addEventListener("click", () => {
      void this.handleSend();
    });

    this.updateBusyState(false);

    // Listen for active file changes
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.updateContextBadge();
      })
    );
  }

  async onClose(): Promise<void> {
    this.stopGeneration();
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
      this.contextBadgeEl.setText(`📎 ${file.name}`);
      this.contextBadgeEl.show();
    } else {
      this.contextBadgeEl.setText("");
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
    this.clearButtonEl.disabled = isBusy;
  }

  private clearConversation(): void {
    if (this.busy) {
      return;
    }

    this.messages = [];
    this.messagesEl.empty();
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

    const content = wrapper.createDiv({ cls: "oa-chat-message-content" });
    content.setText(message.content);

    this.messagesEl.scrollTo({ top: this.messagesEl.scrollHeight });
    return content;
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

    // Add active file context if available
    const fileContext = await this.buildFileContextMessage();
    if (fileContext) {
      requestMessages.push(fileContext);
    }

    // Include all messages with non-empty content
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
        const message = error instanceof Error ? error.message : "Unknown error";
        assistantMessage.content = `Error: ${message}`;
        new Notice(`AI request failed: ${message}`);
      }

      assistantContentEl.setText(assistantMessage.content);
    } finally {
      this.currentAbortController = null;
      this.updateBusyState(false);
    }
  }

  private async handleSend(): Promise<void> {
    if (this.busy) {
      return;
    }

    const text = this.inputEl.value.trim();
    if (!text) {
      return;
    }

    const strategy = this.plugin.createStrategy();
    const configError = strategy.validateConfig();
    if (configError) {
      new Notice(configError);
      return;
    }

    this.inputEl.value = "";

    // Add user message
    const userMessage: ChatMessage = { role: ChatRole.User, content: text };
    this.messages.push(userMessage);
    this.appendMessage(userMessage);

    // Build request messages BEFORE adding the assistant placeholder
    const requestMessages = await this.buildRequestMessages();

    // Add assistant placeholder (not included in request - it's empty)
    const assistantMessage: ChatMessage = {
      role: ChatRole.Assistant,
      content: "",
    };
    this.messages.push(assistantMessage);
    const assistantContentEl = this.appendMessage(assistantMessage);

    this.updateBusyState(true);
    await this.streamResponse(
      strategy,
      requestMessages,
      assistantMessage,
      assistantContentEl,
    );
  }
}
