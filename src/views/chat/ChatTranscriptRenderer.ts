import { MarkdownRenderer, Notice, setIcon } from "obsidian";
import type { App, Component } from "obsidian";
import type { ChatMessage } from "../../types";
import type { ActiveNoteEditProposal, ToolExecutionEvent } from "../../types/tools";

export interface ChatTranscriptRendererOptions {
  app: App;
  component: Component;
  messagesEl: HTMLDivElement;
  getActiveFilePath: () => string;
  onEditMessage: (wrapper: HTMLDivElement, contentEl: HTMLDivElement, message: ChatMessage) => void;
  onReviewProposal: (proposal: ActiveNoteEditProposal) => void;
}

export function normalizeMathDelimiters(content: string): string {
  return content
    .replace(/\\\[([\s\S]*?)\\\]/g, (_match, math: string) => `$$\n${math.trim()}\n$$`)
    .replace(/\\\(([^]+?)\\\)/g, (_match, math: string) => `$${math.trim()}$`);
}

export class ChatTranscriptRenderer {
  private readonly messageWrappers = new Map<ChatMessage, HTMLDivElement>();
  private readonly messageCleanupMap = new Map<ChatMessage, () => void>();
  private readonly messageRenderState = new WeakMap<HTMLDivElement, {
    rendering: boolean;
    pending: boolean;
    message: ChatMessage;
  }>();

  constructor(private readonly options: ChatTranscriptRendererOptions) {}

  appendMessage(message: ChatMessage, busy: boolean): HTMLDivElement {
    const wrapper = this.options.messagesEl.createDiv({ cls: "oa-chat-message" });
    wrapper.toggleClass("oa-chat-user", message.role === "user");
    wrapper.toggleClass("oa-chat-assistant", message.role === "assistant");
    wrapper.toggleClass("oa-chat-system", message.role === "system");

    this.messageWrappers.set(message, wrapper);

    const content = wrapper.createDiv({ cls: "oa-chat-message-content" });
    this.renderMessageContent(content, message);

    if (message.role !== "system") {
      const toolbar = wrapper.createDiv({ cls: "oa-chat-message-toolbar" });

      const copyBtn = toolbar.createEl("button", {
        cls: "oa-chat-copy-btn",
        attr: { title: "Copy message" },
      });
      setIcon(copyBtn, "copy");

      const clickHandler = () => {
        navigator.clipboard.writeText(message.content).then(() => {
          setIcon(copyBtn, "check");
          setTimeout(() => {
            setIcon(copyBtn, "copy");
          }, 2000);
        }).catch((error) => {
          new Notice(error instanceof Error ? error.message : String(error));
        });
      };

      copyBtn.addEventListener("click", clickHandler);
      this.messageCleanupMap.set(message, () => {
        copyBtn.removeEventListener("click", clickHandler);
      });

      if (message.role === "user") {
        const editBtn = toolbar.createEl("button", {
          cls: "oa-chat-edit-btn",
          attr: { title: "Edit message", "aria-label": "Edit message" },
        });
        setIcon(editBtn, "pencil");
        editBtn.disabled = busy;

        const editHandler = () => {
          this.options.onEditMessage(wrapper, content, message);
        };

        editBtn.addEventListener("click", editHandler);
        const existingCleanup = this.messageCleanupMap.get(message);
        this.messageCleanupMap.set(message, () => {
          existingCleanup?.();
          editBtn.removeEventListener("click", editHandler);
        });
      }
    }

    this.options.messagesEl.scrollTo({ top: this.options.messagesEl.scrollHeight });
    return content;
  }

  renderMessageContent(contentEl: HTMLDivElement, message: ChatMessage): void {
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

  removeMessages(messages: ChatMessage[]): void {
    for (const message of messages) {
      const el = this.messageWrappers.get(message);
      if (!el) {
        continue;
      }

      this.messageCleanupMap.get(message)?.();
      this.messageCleanupMap.delete(message);
      this.messageWrappers.delete(message);
      el.remove();
    }
  }

  clear(): void {
    this.options.messagesEl.empty();
    this.runMessageCleanups();
  }

  setBusy(isBusy: boolean): void {
    this.options.messagesEl.querySelectorAll<HTMLButtonElement>(".oa-chat-edit-btn").forEach((button) => {
      button.disabled = isBusy;
    });
  }

  runMessageCleanups(): void {
    this.messageCleanupMap.forEach((cleanup) => cleanup());
    this.messageCleanupMap.clear();
    this.messageWrappers.clear();
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
        const renderedContent = normalizeMathDelimiters(message.content);

        contentEl.empty();
        try {
          await MarkdownRenderer.render(
            this.options.app,
            renderedContent,
            contentEl,
            this.options.getActiveFilePath(),
            this.options.component,
          );
        } catch {
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

  private renderToolEvents(contentEl: HTMLDivElement, calls: ToolExecutionEvent[]): void {
    const callsEl = contentEl.createDiv({ cls: "oa-chat-mcp-calls" });
    if (calls.length > 1) {
      callsEl.createDiv({ cls: "oa-chat-mcp-title", text: `${calls.length} tool calls` });
    }

    for (const call of calls) {
      const callEl = callsEl.createEl("details", { cls: "oa-chat-mcp-call" });
      callEl.toggleClass("oa-chat-mcp-call-success", call.success);
      callEl.toggleClass("oa-chat-mcp-call-error", !call.success);

      const summaryEl = callEl.createEl("summary", { cls: "oa-chat-mcp-summary" });
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

      const detailsEl = callEl.createDiv({ cls: "oa-chat-mcp-details" });
      this.createMCPDetailBlock(detailsEl, "Arguments", call.argumentsText);
      this.createMCPDetailBlock(
        detailsEl,
        call.success ? "Result" : "Error",
        call.success ? call.resultText ?? "" : call.errorText ?? "",
      );
    }
  }

  private createMCPDetailBlock(parent: HTMLElement, label: string, text: string): void {
    const blockEl = parent.createDiv({ cls: "oa-chat-mcp-detail-block" });
    blockEl.createDiv({ cls: "oa-chat-mcp-detail-label", text: label });
    blockEl.createEl("pre", { cls: "oa-chat-mcp-detail-text", text: text || "No data" });
  }

  private renderProposalAction(contentEl: HTMLElement, proposal: ActiveNoteEditProposal): void {
    const actionsEl = contentEl.createDiv({ cls: "oa-chat-message-actions" });
    const applyBtn = actionsEl.createEl("button", {
      cls: "mod-cta oa-chat-apply-btn",
      attr: { title: "Review changes in diff view and apply selectively" },
    });
    const applyIcon = applyBtn.createSpan({ cls: "oa-chat-apply-btn-icon" });
    setIcon(applyIcon, "file-diff");
    applyBtn.createSpan({ text: "Review & Apply Changes" });
    applyBtn.addEventListener("click", () => {
      this.options.onReviewProposal(proposal);
    });
  }
}
