import { describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import {
  BibPDFPreparationService,
  getReadyBibPDFContext,
} from "../services/BibPDFPreparationService.ts";

function createMarkdownFile(path: string): TFile {
  const file = new TFile();
  file.path = path;
  return file;
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

describe("BibPDFPreparationService", () => {
  it("enters preparing and then ready for an active literature note", async () => {
    const extraction = createDeferred<{ filename: string; text: string }>();
    const service = new BibPDFPreparationService(
      {
        resolveForActiveFile: vi.fn(async () => ({
          notePath: "Notes/Paper.md",
          bibKey: "KEY",
          bibPath: "Library.bib",
          pdfPath: "/tmp/Paper.pdf",
          filename: "Paper.pdf",
        })),
      } as never,
      {
        getAvailabilityError: vi.fn(() => null),
        extractBuffer: vi.fn(() => extraction.promise),
      } as never,
      {
        getByHash: vi.fn(async () => null),
        store: vi.fn(async () => {}),
      } as never,
      vi.fn(async () => new TextEncoder().encode("pdf-body").buffer),
    );
    const states = [service.getState()];
    service.onStateChange((state) => {
      states.push(state);
    });

    const refreshPromise = service.refreshForActiveFile(createMarkdownFile("Notes/Paper.md"));
    await Promise.resolve();

    expect(states[states.length - 1]).toMatchObject({
      notePath: "Notes/Paper.md",
      filename: "Paper.pdf",
      pdfPath: "/tmp/Paper.pdf",
      status: "preparing",
    });

    extraction.resolve({ filename: "Paper.pdf", text: "OCR text" });
    await refreshPromise;

    expect(service.getState()).toMatchObject({
      notePath: "Notes/Paper.md",
      filename: "Paper.pdf",
      pdfPath: "/tmp/Paper.pdf",
      status: "ready",
      ocrText: "OCR text",
      source: "ocr",
    });
  });

  it("goes directly to ready from cache without calling Mistral", async () => {
    const extractBuffer = vi.fn();
    const service = new BibPDFPreparationService(
      {
        resolveForActiveFile: vi.fn(async () => ({
          notePath: "Notes/Paper.md",
          bibKey: "KEY",
          bibPath: "Library.bib",
          pdfPath: "/tmp/Paper.pdf",
          filename: "Paper.pdf",
        })),
      } as never,
      {
        getAvailabilityError: vi.fn(() => null),
        extractBuffer,
      } as never,
      {
        getByHash: vi.fn(async () => ({
          hash: "hash-1",
          filename: "Cached.pdf",
          sourcePath: "/cache/original.pdf",
          createdAt: 1,
          text: "Cached OCR",
        })),
        store: vi.fn(async () => {}),
      } as never,
      vi.fn(async () => new TextEncoder().encode("pdf-body").buffer),
    );

    await service.refreshForActiveFile(createMarkdownFile("Notes/Paper.md"));

    expect(service.getState()).toMatchObject({
      notePath: "Notes/Paper.md",
      filename: "Cached.pdf",
      pdfPath: "/tmp/Paper.pdf",
      status: "ready",
      ocrText: "Cached OCR",
      source: "cache",
    });
    expect(extractBuffer).not.toHaveBeenCalled();
  });

  it("returns idle or error for unresolved bib pdf states", async () => {
    const service = new BibPDFPreparationService(
      {
        resolveForActiveFile: vi
          .fn()
          .mockResolvedValueOnce({ reason: "no-bibkey" })
          .mockResolvedValueOnce({ reason: "bib-file-not-found", detail: "/tmp/Library.bib" })
          .mockResolvedValueOnce({ reason: "bib-pdf-root-missing" }),
      } as never,
      {
        getAvailabilityError: vi.fn(() => null),
        extractBuffer: vi.fn(),
      } as never,
      {
        getByHash: vi.fn(async () => null),
        store: vi.fn(async () => {}),
      } as never,
      vi.fn(async () => new TextEncoder().encode("pdf-body").buffer),
    );

    await service.refreshForActiveFile(createMarkdownFile("Notes/NoBib.md"));
    expect(service.getState()).toEqual({
      notePath: "Notes/NoBib.md",
      filename: null,
      pdfPath: null,
      status: "idle",
    });

    await service.refreshForActiveFile(createMarkdownFile("Notes/MissingBib.md"));
    expect(service.getState()).toMatchObject({
      notePath: "Notes/MissingBib.md",
      status: "error",
      errorMessage: "BibTeX file not found (/tmp/Library.bib).",
    });

    await service.refreshForActiveFile(createMarkdownFile("Notes/MissingRoot.md"));
    expect(service.getState()).toMatchObject({
      notePath: "Notes/MissingRoot.md",
      status: "error",
      errorMessage: "Set the Bib PDF folder in this plugin's PDF settings.",
    });
  });

  it("deduplicates inflight OCR when the same note is reopened", async () => {
    const readBuffer = createDeferred<ArrayBuffer>();
    const extraction = createDeferred<{ filename: string; text: string }>();
    const extractBuffer = vi.fn(() => extraction.promise);
    const readAbsoluteBinaryFile = vi.fn(() => readBuffer.promise);
    const service = new BibPDFPreparationService(
      {
        resolveForActiveFile: vi.fn(async () => ({
          notePath: "Notes/Paper.md",
          bibKey: "KEY",
          bibPath: "Library.bib",
          pdfPath: "/tmp/Paper.pdf",
          filename: "Paper.pdf",
        })),
      } as never,
      {
        getAvailabilityError: vi.fn(() => null),
        extractBuffer,
      } as never,
      {
        getByHash: vi.fn(async () => null),
        store: vi.fn(async () => {}),
      } as never,
      readAbsoluteBinaryFile,
    );

    const first = service.refreshForActiveFile(createMarkdownFile("Notes/Paper.md"));
    await vi.waitFor(() => {
      expect(readAbsoluteBinaryFile).toHaveBeenCalledTimes(1);
    });
    const second = service.refreshForActiveFile(createMarkdownFile("Notes/Paper.md"));

    readBuffer.resolve(new TextEncoder().encode("pdf-body").buffer);
    await vi.waitFor(() => {
      expect(extractBuffer).toHaveBeenCalledTimes(1);
    });

    expect(extractBuffer).toHaveBeenCalledTimes(1);

    extraction.resolve({ filename: "Paper.pdf", text: "OCR text" });
    await Promise.all([first, second]);
    expect(service.getState().status).toBe("ready");
  });

  it("does not cancel an inflight OCR job when the user switches notes", async () => {
    const extraction = createDeferred<{ filename: string; text: string }>();
    const store = vi.fn(async () => {});
    const service = new BibPDFPreparationService(
      {
        resolveForActiveFile: vi.fn(async (file: TFile | null) => {
          if (file?.path === "Notes/Paper.md") {
            return {
              notePath: "Notes/Paper.md",
              bibKey: "KEY",
              bibPath: "Library.bib",
              pdfPath: "/tmp/Paper.pdf",
              filename: "Paper.pdf",
            };
          }
          return { reason: "no-bibkey" };
        }),
      } as never,
      {
        getAvailabilityError: vi.fn(() => null),
        extractBuffer: vi.fn(() => extraction.promise),
      } as never,
      {
        getByHash: vi.fn(async () => null),
        store,
      } as never,
      vi.fn(async () => new TextEncoder().encode("pdf-body").buffer),
    );

    const first = service.refreshForActiveFile(createMarkdownFile("Notes/Paper.md"));
    await Promise.resolve();
    const second = service.refreshForActiveFile(createMarkdownFile("Notes/Other.md"));
    await Promise.resolve();

    extraction.resolve({ filename: "Paper.pdf", text: "OCR text" });
    await Promise.all([first, second]);

    expect(store).toHaveBeenCalledWith(
      expect.any(String),
      "Paper.pdf",
      "/tmp/Paper.pdf",
      "OCR text",
    );
    expect(service.getState()).toEqual({
      notePath: "Notes/Other.md",
      filename: null,
      pdfPath: null,
      status: "idle",
    });
  });
});

describe("getReadyBibPDFContext", () => {
  it("only returns OCR text when the active note state is ready", () => {
    expect(getReadyBibPDFContext({
      notePath: "Notes/Paper.md",
      filename: "Paper.pdf",
      pdfPath: "/tmp/Paper.pdf",
      status: "ready",
      ocrText: "OCR text",
      source: "cache",
    }, "Notes/Paper.md")).toEqual({
      filename: "Paper.pdf",
      text: "OCR text",
    });

    expect(getReadyBibPDFContext({
      notePath: "Notes/Paper.md",
      filename: "Paper.pdf",
      pdfPath: "/tmp/Paper.pdf",
      status: "preparing",
    }, "Notes/Paper.md")).toBeNull();
  });
});
