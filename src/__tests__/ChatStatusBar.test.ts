import { describe, expect, it } from "vitest";
import {
  getBibPDFTitle,
  getContextSummaryTitle,
  getManualPDFTitle,
  getRAGBadgeTitle,
  getRAGDetailText,
  type ChatStatusBarState,
} from "../components/ChatStatusBar";

function buildState(overrides: Partial<ChatStatusBarState> = {}): ChatStatusBarState {
  return {
    context: {
      enabled: true,
      fileName: "Note.md",
      selection: null,
      ...(overrides.context ?? {}),
    },
    rag: {
      available: true,
      enabled: true,
      phase: "idle",
      progress: 0,
      previewPaths: [],
      ...(overrides.rag ?? {}),
    },
    pdf: {
      manualFilename: null,
      bib: null,
      ...(overrides.pdf ?? {}),
    },
  };
}

describe("ChatStatusBar helpers", () => {
  it("summarizes enabled context with cached selection details", () => {
    const title = getContextSummaryTitle(buildState({
      context: {
        enabled: true,
        fileName: "Paper.md",
        selection: {
          preview: "Some selected text",
          lineRange: "3:0-5:12",
          fullText: "Some selected text",
        },
      },
    }));

    expect(title).toContain("File context is enabled for this chat.");
    expect(title).toContain("File: Paper.md");
    expect(title).toContain("Cached selection 3:0-5:12");
    expect(title).toContain("Some selected text");
  });

  it("reports disabled context plainly", () => {
    expect(getContextSummaryTitle(buildState({
      context: { enabled: false, fileName: null, selection: null },
    }))).toBe("File context is disabled for this chat.");
  });

  it("reports rag phases and queued notes compactly", () => {
    expect(getRAGDetailText(buildState({
      rag: { available: true, enabled: false, phase: "idle", progress: 0, previewPaths: [] },
    }))).toBe("Off");

    expect(getRAGDetailText(buildState({
      rag: { available: true, enabled: true, phase: "waiting", progress: 0.5, previewPaths: [] },
    }))).toBe("Waiting for typing to pause");

    expect(getRAGDetailText(buildState({
      rag: { available: true, enabled: true, phase: "computing", progress: 1, previewPaths: [] },
    }))).toBe("Scanning notes");

    expect(getRAGDetailText(buildState({
      rag: { available: true, enabled: true, phase: "idle", progress: 0, previewPaths: ["a.md", "b.md"] },
    }))).toBe("2 notes queued");
  });

  it("builds rag tooltip copy for queued previews", () => {
    const title = getRAGBadgeTitle(buildState({
      rag: { available: true, enabled: true, phase: "idle", progress: 0, previewPaths: ["a.md", "b.md"] },
    }));

    expect(title).toBe("Draft preview would use:\na.md\nb.md");
  });

  it("builds compact pdf titles", () => {
    expect(getManualPDFTitle("paper.pdf")).toBe("Manual PDF attached: paper.pdf");
    expect(getBibPDFTitle({
      filename: "paper.pdf",
      pdfPath: "/tmp/paper.pdf",
      status: "ready",
      includedInContext: true,
      contextLabel: "In chat",
      title: "Bib PDF OCR text is ready from cache and included in this chat context.",
    })).toBe("Bib PDF OCR text is ready from cache and included in this chat context.\n\nContext: In chat\nFile: paper.pdf\nClick to open in your default PDF viewer.");
  });
});
