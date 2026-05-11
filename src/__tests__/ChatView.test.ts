import { describe, expect, it } from "vitest";
import { ChatRole } from "../types.ts";
import { buildBibPDFChipState, buildPDFContextMessage, buildPDFContextMessages } from "../views/ChatView.ts";

describe("ChatView PDF context messages", () => {
  it("formats extracted PDF text as a system message", () => {
    expect(buildPDFContextMessage("paper.pdf", "Page 1")).toEqual({
      role: ChatRole.System,
      content: "Extracted PDF content from \"paper.pdf\":\n---\nPage 1\n---",
    });
  });

  it("keeps manual and bib-derived PDF context separate", () => {
    expect(buildPDFContextMessages(
      { filename: "manual.pdf", text: "Manual text" },
      { filename: "bib.pdf", text: "Bib text" },
    )).toEqual([
      {
        role: ChatRole.System,
        content: "Extracted PDF content from \"manual.pdf\":\n---\nManual text\n---",
      },
      {
        role: ChatRole.System,
        content: "Extracted PDF content from \"bib.pdf\":\n---\nBib text\n---",
      },
    ]);
  });

  it("builds a preparing bib chip state while OCR is running", () => {
    expect(buildBibPDFChipState(
      {
        notePath: "Notes/Paper.md",
        filename: "Paper.pdf",
        pdfPath: "/tmp/Paper.pdf",
        status: "preparing",
      },
      true,
      "Notes/Paper.md",
    )).toEqual({
      filename: "Paper.pdf",
      status: "preparing",
      title: "Bib PDF OCR is running for the active note.",
    });
  });

  it("builds a ready bib chip state and hides it when no matching note is active", () => {
    expect(buildBibPDFChipState(
      {
        notePath: "Notes/Paper.md",
        filename: "Paper.pdf",
        pdfPath: "/tmp/Paper.pdf",
        status: "ready",
        ocrText: "OCR text",
        source: "cache",
      },
      true,
      "Notes/Paper.md",
    )).toEqual({
      filename: "Paper.pdf",
      status: "ready",
      title: "Bib PDF OCR text is ready from cache.",
    });

    expect(buildBibPDFChipState(
      {
        notePath: "Notes/Paper.md",
        filename: "Paper.pdf",
        pdfPath: "/tmp/Paper.pdf",
        status: "ready",
        ocrText: "OCR text",
        source: "cache",
      },
      true,
      "Notes/Other.md",
    )).toBeNull();
  });
});
