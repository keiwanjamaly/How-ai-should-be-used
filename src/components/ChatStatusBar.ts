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
  };
  pdf: {
    manualFilename: string | null;
    bib: {
      filename: string;
      pdfPath: string;
      status: "preparing" | "ready" | "error";
      includedInContext: boolean;
      contextLabel: string;
      title: string;
    } | null;
  };
}

interface ChatStatusBarOptions {
  parent: HTMLElement;
  preserveMarkdownContextOnPointerDown?: (element: HTMLElement) => void;
  captureMarkdownContextOnPointerDown?: (element: HTMLElement) => void;
  onToggleContext: () => void;
  onToggleRAG: () => void;
  onRemovePDF: () => void;
  onOpenPDF: (path: string) => void;
}

export function getContextSummaryTitle(state: ChatStatusBarState): string {
  if (!state.context.enabled) {
    return "File context is disabled for this chat.";
  }

  const parts: string[] = ["File context is enabled for this chat."];

  if (state.context.fileName) {
    parts.push(`File: ${state.context.fileName}`);
  }

  if (state.context.selection) {
    parts.push(`Cached selection ${state.context.selection.lineRange}`);
    parts.push("");
    parts.push(state.context.selection.fullText);
  }

  return parts.join("\n");
}

export function getRAGDetailText(state: ChatStatusBarState): string {
  if (!state.rag.enabled) {
    return "Off";
  }

  if (state.rag.previewPaths.length > 0) {
    const count = state.rag.previewPaths.length;
    return `${count} ${count === 1 ? "note" : "notes"} queued`;
  }

  if (state.rag.phase === "waiting") {
    return "Waiting for typing to pause";
  }

  if (state.rag.phase === "computing") {
    return "Scanning notes";
  }

  return "Ready";
}

export function getRAGBadgeTitle(state: ChatStatusBarState): string {
  if (!state.rag.enabled) {
    return "Vault RAG is disabled for this chat.";
  }

  if (state.rag.previewPaths.length > 0) {
    return `Draft preview would use:\n${state.rag.previewPaths.join("\n")}`;
  }

  if (state.rag.phase === "waiting") {
    return "Draft preview will refresh after typing pauses.";
  }

  if (state.rag.phase === "computing") {
    return "Computing draft preview now.";
  }

  return "Vault-wide retrieval is enabled for this chat. Pause typing to preview which notes would be used.";
}

export function getManualPDFTitle(filename: string): string {
  return `Manual PDF attached: ${filename}`;
}

export function getBibPDFTitle(state: NonNullable<ChatStatusBarState["pdf"]["bib"]>): string {
  return `${state.title}\n\nContext: ${state.contextLabel}\nFile: ${state.filename}\nClick to open in your default PDF viewer.`;
}

function getBibPDFStatusText(state: NonNullable<ChatStatusBarState["pdf"]["bib"]>): string {
  if (state.status === "preparing") {
    return "OCR running";
  }
  if (state.status === "ready") {
    return "Ready";
  }
  return "Error";
}

export class ChatStatusBar {
  private readonly rootEl: HTMLDivElement;
  private readonly leftClusterEl: HTMLDivElement;
  private readonly contextToggleEl: HTMLButtonElement;
  private readonly contextMetaEl: HTMLDivElement;
  private readonly selectionChipEl: HTMLDivElement;
  private readonly ragClusterEl: HTMLDivElement;
  private readonly ragToggleEl: HTMLButtonElement;
  private readonly ragIndicatorEl: HTMLDivElement;
  private readonly attachmentClusterEl: HTMLDivElement;
  private readonly manualPDFChipEl: HTMLDivElement;
  private readonly bibPDFChipEl: HTMLButtonElement;

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
    setIcon(this.contextToggleEl, "file-text");
    this.contextToggleEl.addEventListener("click", () => this.options.onToggleContext());

    this.contextMetaEl = this.leftClusterEl.createDiv({ cls: "oa-chat-context-meta" });
    this.selectionChipEl = this.leftClusterEl.createDiv({ cls: "oa-chat-selection-chip" });

    this.ragClusterEl = this.rootEl.createDiv({ cls: "oa-chat-status-rag" });
    this.ragToggleEl = this.ragClusterEl.createEl("button", {
      cls: "oa-chat-meta-toggle oa-chat-rag-toggle",
      attr: {
        title: "Toggle Vault RAG for this chat",
        "aria-label": "Toggle Vault RAG",
      },
    });
    setIcon(this.ragToggleEl, "library");
    this.ragToggleEl.addEventListener("click", () => this.options.onToggleRAG());
    this.ragIndicatorEl = this.ragClusterEl.createDiv({ cls: "oa-chat-rag-indicator" });

    this.attachmentClusterEl = this.rootEl.createDiv({ cls: "oa-chat-status-attachment" });
    this.manualPDFChipEl = this.attachmentClusterEl.createDiv({ cls: "oa-chat-pdf-chip" });
    this.bibPDFChipEl = this.attachmentClusterEl.createEl("button", {
      cls: "oa-chat-pdf-chip oa-chat-pdf-chip-button",
      attr: { type: "button", "aria-label": "Open linked PDF" },
    });
    this.bibPDFChipEl.addEventListener("click", () => {
      const pdfPath = this.bibPDFChipEl.dataset.pdfPath;
      if (!pdfPath) {
        return;
      }
      this.options.onOpenPDF(pdfPath);
    });

    if (options.preserveMarkdownContextOnPointerDown) {
      options.preserveMarkdownContextOnPointerDown(this.contextToggleEl);
      options.preserveMarkdownContextOnPointerDown(this.ragToggleEl);
    }
    if (options.captureMarkdownContextOnPointerDown) {
      options.captureMarkdownContextOnPointerDown(this.bibPDFChipEl);
    }
  }

  update(state: ChatStatusBarState): void {
    this.renderContextToggle(state);
    this.renderContextMeta(state);
    this.renderSelectionChip(state);
    this.renderRAGToggle(state);
    this.renderRAGIndicator(state);
    this.renderPDFChips(state);
  }

  private renderContextToggle(state: ChatStatusBarState): void {
    this.contextToggleEl.toggleClass("is-enabled", state.context.enabled);
    this.contextToggleEl.toggleClass("is-disabled", !state.context.enabled);
    this.contextToggleEl.setAttr(
      "title",
      state.context.enabled ? "Disable file context for this chat" : "Enable file context for this chat",
    );
    this.contextToggleEl.setAttr(
      "aria-label",
      state.context.enabled ? "Disable file context" : "Enable file context",
    );
  }

  private renderContextMeta(state: ChatStatusBarState): void {
    this.contextMetaEl.empty();

    if (!state.context.enabled) {
      this.contextMetaEl.hide();
      return;
    }

    const iconEl = this.contextMetaEl.createSpan({ cls: "oa-chat-context-meta-icon" });
    setIcon(iconEl, state.context.selection ? "quote-glyph" : "paperclip");
    if (state.context.fileName) {
      this.contextMetaEl.createSpan({ cls: "oa-chat-context-meta-marker" });
    }

    this.contextMetaEl.setAttr("title", getContextSummaryTitle(state));
    this.contextMetaEl.show();
  }

  private renderSelectionChip(state: ChatStatusBarState): void {
    this.selectionChipEl.empty();

    if (!state.context.enabled || !state.context.selection) {
      this.selectionChipEl.hide();
      return;
    }

    const iconEl = this.selectionChipEl.createSpan({ cls: "oa-chat-selection-chip-icon" });
    setIcon(iconEl, "quote-glyph");
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
    this.ragToggleEl.setAttr(
      "title",
      state.rag.enabled ? "Disable Vault RAG for this chat" : "Enable Vault RAG for this chat",
    );
    this.ragToggleEl.setAttr(
      "aria-label",
      state.rag.enabled ? "Disable Vault RAG" : "Enable Vault RAG",
    );
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
      if (state.rag.phase === "waiting") {
        progressRing.toggleClass("is-filling", true);
        progressRing.style.setProperty("--oa-rag-progress", `${Math.round(state.rag.progress * 100)}%`);
      } else {
        progressRing.toggleClass("is-spinning", true);
      }
    } else {
      const iconEl = signalEl.createSpan({ cls: "oa-chat-rag-indicator-icon" });
      setIcon(iconEl, "library");
    }

    if (state.rag.enabled && state.rag.previewPaths.length > 0) {
      this.ragIndicatorEl.createSpan({ cls: "oa-chat-rag-indicator-count", text: `${state.rag.previewPaths.length}` });
    }
    this.ragIndicatorEl.setAttr("title", getRAGBadgeTitle(state));
  }

  private renderPDFChips(state: ChatStatusBarState): void {
    this.renderManualPDFChip(state.pdf.manualFilename);
    this.renderBibPDFChip(state.pdf.bib);

    if (!state.pdf.manualFilename && !state.pdf.bib) {
      this.attachmentClusterEl.hide();
      return;
    }

    this.attachmentClusterEl.show();
  }

  private renderManualPDFChip(filename: string | null): void {
    this.manualPDFChipEl.empty();

    if (!filename) {
      this.manualPDFChipEl.hide();
      return;
    }

    const iconEl = this.manualPDFChipEl.createSpan({ cls: "oa-chat-pdf-chip-icon" });
    setIcon(iconEl, "file-text");
    this.manualPDFChipEl.createSpan({
      cls: "oa-chat-pdf-chip-label",
      text: filename,
    });
    this.manualPDFChipEl.setAttr("title", getManualPDFTitle(filename));

    const dismissBtn = this.manualPDFChipEl.createEl("button", {
      cls: "oa-chat-pdf-chip-dismiss",
      attr: { title: "Remove PDF context", "aria-label": "Remove PDF" },
    });
    setIcon(dismissBtn, "x");
    dismissBtn.addEventListener("click", () => this.options.onRemovePDF());

    if (this.options.captureMarkdownContextOnPointerDown) {
      this.options.captureMarkdownContextOnPointerDown(dismissBtn);
    }

    this.manualPDFChipEl.show();
  }

  private renderBibPDFChip(state: ChatStatusBarState["pdf"]["bib"]): void {
    this.bibPDFChipEl.empty();
    delete this.bibPDFChipEl.dataset.pdfPath;

    if (!state) {
      this.bibPDFChipEl.hide();
      return;
    }

    const iconEl = this.bibPDFChipEl.createSpan({ cls: "oa-chat-pdf-chip-icon" });
    setIcon(
      iconEl,
      state.status === "preparing"
        ? "loader-circle"
        : state.status === "ready"
          ? "check"
          : "alert-circle",
    );
    if (state.status === "preparing") {
      iconEl.addClass("is-spinning");
    }
    this.bibPDFChipEl.createSpan({
      cls: "oa-chat-pdf-chip-kind",
      text: "Bib PDF",
    });
    this.bibPDFChipEl.createSpan({
      cls: "oa-chat-pdf-chip-status",
      text: getBibPDFStatusText(state),
    });
    this.bibPDFChipEl.createSpan({
      cls: "oa-chat-pdf-chip-meta",
      text: state.contextLabel,
    });
    this.bibPDFChipEl.toggleClass("is-in-context", state.includedInContext);
    this.bibPDFChipEl.toggleClass("is-out-of-context", !state.includedInContext);
    this.bibPDFChipEl.dataset.pdfPath = state.pdfPath;
    this.bibPDFChipEl.setAttr("aria-label", `Open linked PDF ${state.filename}`);
    this.bibPDFChipEl.setAttr("title", getBibPDFTitle(state));
    this.bibPDFChipEl.show();
  }
}
