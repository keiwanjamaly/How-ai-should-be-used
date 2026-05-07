import { setIcon } from "obsidian";

export type ChatStatusBarRAGPhase = "idle" | "waiting" | "computing";

export interface ChatStatusBarSelectionState {
  preview: string;
  lineRange: string;
  fullText: string;
}

export interface ChatStatusBarState {
  context: {
    enabled: boolean;
    fileName: string | null;
    selection: ChatStatusBarSelectionState | null;
  };
  rag: {
    available: boolean;
    enabled: boolean;
    phase: ChatStatusBarRAGPhase;
    progress: number;
    previewPaths: string[];
    idleDelayMs: number;
  };
  pdf: {
    filename: string | null;
  };
}

interface ChatStatusBarOptions {
  parent: HTMLElement;
  preserveMarkdownContextOnPointerDown?: (element: HTMLElement) => void;
  onToggleContext: () => void;
  onToggleRAG: () => void;
  onRemovePDF: () => void;
}

export class ChatStatusBar {
  private readonly rootEl: HTMLDivElement;
  private readonly leftClusterEl: HTMLDivElement;
  private readonly contextToggleEl: HTMLButtonElement;
  private readonly contextMetaGroupEl: HTMLDivElement;
  private readonly contextMetaEl: HTMLDivElement;
  private readonly selectionChipEl: HTMLDivElement;
  private readonly ragClusterEl: HTMLDivElement;
  private readonly ragToggleEl: HTMLButtonElement;
  private readonly ragIndicatorEl: HTMLDivElement;
  private readonly attachmentClusterEl: HTMLDivElement;
  private readonly pdfChipEl: HTMLDivElement;

  constructor(private readonly options: ChatStatusBarOptions) {
    this.rootEl = options.parent.createDiv({ cls: "oa-chat-status-bar" });

    this.leftClusterEl = this.rootEl.createDiv({ cls: "oa-chat-status-context" });
    this.contextToggleEl = this.leftClusterEl.createEl("button", {
      cls: "oa-chat-meta-toggle oa-chat-context-toggle",
      attr: {
        title: "Toggle file context inclusion",
        "aria-label": "Toggle file context",
      },
    });
    this.contextToggleEl.createSpan({ cls: "oa-chat-meta-toggle-label", text: "Context" });
    this.contextToggleEl.addEventListener("click", () => this.options.onToggleContext());

    this.contextMetaGroupEl = this.leftClusterEl.createDiv({ cls: "oa-chat-context-meta-group" });
    this.contextMetaEl = this.contextMetaGroupEl.createDiv({ cls: "oa-chat-context-meta" });
    this.selectionChipEl = this.leftClusterEl.createDiv({ cls: "oa-chat-selection-chip" });

    this.ragClusterEl = this.rootEl.createDiv({ cls: "oa-chat-status-rag" });
    this.ragToggleEl = this.ragClusterEl.createEl("button", {
      cls: "oa-chat-meta-toggle oa-chat-rag-toggle",
      attr: {
        title: "Toggle Vault RAG for this chat",
        "aria-label": "Toggle Vault RAG",
      },
    });
    this.ragToggleEl.createSpan({ cls: "oa-chat-meta-toggle-label", text: "RAG" });
    this.ragToggleEl.addEventListener("click", () => this.options.onToggleRAG());
    this.ragIndicatorEl = this.ragClusterEl.createDiv({ cls: "oa-chat-rag-indicator" });

    this.attachmentClusterEl = this.rootEl.createDiv({ cls: "oa-chat-status-attachment" });
    this.pdfChipEl = this.attachmentClusterEl.createDiv({ cls: "oa-chat-pdf-chip" });

    if (options.preserveMarkdownContextOnPointerDown) {
      options.preserveMarkdownContextOnPointerDown(this.contextToggleEl);
      options.preserveMarkdownContextOnPointerDown(this.ragToggleEl);
    }
  }

  update(state: ChatStatusBarState): void {
    this.renderContextToggle(state);
    this.renderContextMeta(state);
    this.renderSelectionChip(state);
    this.renderRAGToggle(state);
    this.renderRAGIndicator(state);
    this.renderPDFChip(state);
  }

  private renderContextToggle(state: ChatStatusBarState): void {
    this.contextToggleEl.toggleClass("is-enabled", state.context.enabled);
    this.contextToggleEl.toggleClass("is-disabled", !state.context.enabled);
  }

  private renderContextMeta(state: ChatStatusBarState): void {
    this.contextMetaEl.empty();

    if (!state.context.enabled) {
      this.contextMetaGroupEl.hide();
      return;
    }

    if (state.context.fileName) {
      const iconEl = this.contextMetaEl.createSpan({ cls: "oa-chat-context-meta-icon" });
      setIcon(iconEl, "paperclip");
      const textEl = this.contextMetaEl.createSpan({ cls: "oa-chat-context-meta-text" });
      textEl.createSpan({ cls: "oa-chat-context-meta-file", text: state.context.fileName });
      this.contextMetaEl.show();
    } else {
      this.contextMetaEl.hide();
    }

    this.contextMetaGroupEl.show();
  }

  private renderSelectionChip(state: ChatStatusBarState): void {
    this.selectionChipEl.empty();

    if (!state.context.enabled || !state.context.selection) {
      this.selectionChipEl.hide();
      return;
    }

    const iconEl = this.selectionChipEl.createSpan({ cls: "oa-chat-selection-chip-icon" });
    setIcon(iconEl, "quote-glyph");
    this.selectionChipEl.createSpan({
      cls: "oa-chat-selection-chip-text",
      text: `Selection: ${state.context.selection.preview}`,
    });
    this.selectionChipEl.setAttr(
      "title",
      `Cached selection ${state.context.selection.lineRange}\n\n${state.context.selection.fullText}`,
    );
    this.selectionChipEl.show();
  }

  private renderRAGToggle(state: ChatStatusBarState): void {
    this.ragClusterEl.toggleClass("oa-hidden", !state.rag.available);
    this.ragToggleEl.toggleClass("is-enabled", state.rag.enabled);
    this.ragToggleEl.toggleClass("is-disabled", !state.rag.enabled);
  }

  private renderRAGIndicator(state: ChatStatusBarState): void {
    this.ragIndicatorEl.empty();

    if (!state.rag.available) {
      return;
    }

    this.ragIndicatorEl.removeClass(
      "is-idle",
      "is-waiting",
      "is-computing",
      "is-active",
      "is-disabled",
    );

    const statusClass = !state.rag.enabled
      ? "is-disabled"
      : state.rag.previewPaths.length > 0
        ? "is-active"
        : state.rag.phase === "waiting"
          ? "is-waiting"
          : state.rag.phase === "computing"
            ? "is-computing"
            : "is-idle";
    this.ragIndicatorEl.addClass(statusClass);

    const signalEl = this.ragIndicatorEl.createSpan({ cls: "oa-chat-rag-indicator-signal" });
    if (state.rag.enabled && state.rag.phase !== "idle") {
      const progressRing = signalEl.createSpan({ cls: "oa-chat-rag-progress-ring" });
      progressRing.toggleClass("is-computing", state.rag.phase === "computing");
      progressRing.style.setProperty("--oa-rag-progress", `${Math.round(state.rag.progress * 100)}%`);
    } else {
      const iconEl = signalEl.createSpan({ cls: "oa-chat-rag-indicator-icon" });
      setIcon(iconEl, "library");
    }

    const copyEl = this.ragIndicatorEl.createSpan({ cls: "oa-chat-rag-indicator-copy" });
    copyEl.createSpan({ cls: "oa-chat-rag-indicator-label", text: "Vault RAG" });
    copyEl.createSpan({ cls: "oa-chat-rag-indicator-detail", text: this.getRAGDetailText(state) });
    this.ragIndicatorEl.setAttr("title", this.getRAGBadgeTitle(state));
  }

  private renderPDFChip(state: ChatStatusBarState): void {
    this.pdfChipEl.empty();

    if (!state.pdf.filename) {
      this.attachmentClusterEl.hide();
      return;
    }

    const iconEl = this.pdfChipEl.createSpan({ cls: "oa-chat-pdf-chip-icon" });
    setIcon(iconEl, "file-text");
    const textEl = this.pdfChipEl.createSpan({ cls: "oa-chat-pdf-chip-text" });
    textEl.createSpan({ cls: "oa-chat-pdf-chip-label", text: "PDF" });
    textEl.createSpan({ cls: "oa-chat-pdf-chip-separator", text: "·" });
    textEl.createSpan({ cls: "oa-chat-pdf-chip-name", text: state.pdf.filename });

    const dismissBtn = this.pdfChipEl.createEl("button", {
      cls: "oa-chat-pdf-chip-dismiss",
      attr: { title: "Remove PDF context", "aria-label": "Remove PDF" },
    });
    setIcon(dismissBtn, "x");
    dismissBtn.addEventListener("click", () => this.options.onRemovePDF());

    if (this.options.preserveMarkdownContextOnPointerDown) {
      this.options.preserveMarkdownContextOnPointerDown(dismissBtn);
    }

    this.attachmentClusterEl.show();
  }

  private getRAGDetailText(state: ChatStatusBarState): string {
    if (!state.rag.enabled) {
      return "Off";
    }

    if (state.rag.previewPaths.length > 0) {
      const count = state.rag.previewPaths.length;
      return `${count} ${count === 1 ? "note" : "notes"} queued`;
    }

    if (state.rag.phase === "waiting") {
      const remainingMs = Math.max(
        0,
        Math.ceil((1 - state.rag.progress) * state.rag.idleDelayMs),
      );
      return `Updating in ${remainingMs} ms`;
    }

    if (state.rag.phase === "computing") {
      return "Scanning notes";
    }

    return "Ready";
  }

  private getRAGBadgeTitle(state: ChatStatusBarState): string {
    if (!state.rag.enabled) {
      return "Vault RAG is disabled for this chat.";
    }

    if (state.rag.previewPaths.length > 0) {
      return `Draft preview would use:\n${state.rag.previewPaths.join("\n")}`;
    }

    if (state.rag.phase === "waiting") {
      const remainingMs = Math.max(
        0,
        Math.ceil((1 - state.rag.progress) * state.rag.idleDelayMs),
      );
      return `Draft preview updates in ${remainingMs} ms.`;
    }

    if (state.rag.phase === "computing") {
      return "Computing draft preview now.";
    }

    return "Vault-wide retrieval is enabled for this chat. Pause typing to preview which notes would be used.";
  }
}
