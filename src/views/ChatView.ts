import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
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
  private currentAbortController: AbortController | null = null;
  private busy = false;

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

    this.messagesEl = root.createDiv({ cls: "oa-chat-messages" });

    const composer = root.createDiv({ cls: "oa-chat-composer" });
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
  }

  async onClose(): Promise<void> {
    this.stopGeneration();
    this.containerEl.empty();
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
   * Builds the request messages array for the LLM, prepending the system prompt if set.
   */
  private buildRequestMessages(): ChatMessage[] {
    const requestMessages: ChatMessage[] = [];

    const systemPrompt = this.plugin.settings.systemPrompt.trim();
    if (systemPrompt) {
      requestMessages.push({
        role: ChatRole.System,
        content: systemPrompt,
      });
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
    const requestMessages = this.buildRequestMessages();

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
