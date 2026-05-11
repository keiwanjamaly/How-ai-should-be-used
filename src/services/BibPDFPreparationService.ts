import type { TFile } from "obsidian";
import type { BibPDFContext, BibPDFContextFailure, BibPDFContextService } from "./BibPDFContextService";
import type { PDFExtractionService } from "./PDFExtractionService";
import { computeSHA256Hex, type PDFOCRCacheService } from "./PDFOCRCacheService";
import { formatErrorMessage } from "../utils/errorUtils";

export type BibPDFPreparationStatus = "idle" | "preparing" | "ready" | "error";
export type BibPDFPreparationSource = "cache" | "ocr";

export interface BibPDFPreparationState {
  notePath: string | null;
  filename: string | null;
  pdfPath: string | null;
  status: BibPDFPreparationStatus;
  errorMessage?: string;
  ocrText?: string;
  source?: BibPDFPreparationSource;
}

interface PreparedBibPDFResult {
  filename: string;
  pdfPath: string;
  text: string;
  source: BibPDFPreparationSource;
}

export function createIdleBibPDFPreparationState(notePath: string | null = null): BibPDFPreparationState {
  return {
    notePath,
    filename: null,
    pdfPath: null,
    status: "idle",
  };
}

export function getReadyBibPDFContext(
  state: BibPDFPreparationState,
  notePath: string | null,
): { filename: string; text: string } | null {
  if (
    state.status !== "ready"
    || !state.filename
    || !state.ocrText
    || !notePath
    || state.notePath !== notePath
  ) {
    return null;
  }

  return {
    filename: state.filename,
    text: state.ocrText,
  };
}

export class BibPDFPreparationService {
  private state: BibPDFPreparationState = createIdleBibPDFPreparationState();
  private readonly listeners = new Set<(state: BibPDFPreparationState) => void>();
  private readonly inflightByPDFPath = new Map<string, Promise<PreparedBibPDFResult>>();
  private refreshRequestId = 0;

  constructor(
    private readonly bibPDFContextService: BibPDFContextService,
    private readonly pdfExtractionService: PDFExtractionService,
    private readonly pdfOCRCacheService: PDFOCRCacheService,
    private readonly readAbsoluteBinaryFile: (path: string) => Promise<ArrayBuffer>,
  ) {}

  getState(): BibPDFPreparationState {
    return this.state;
  }

  onStateChange(listener: (state: BibPDFPreparationState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async refreshForActiveFile(activeFile: TFile | null): Promise<void> {
    const requestId = ++this.refreshRequestId;
    const notePath = activeFile?.path ?? null;
    const resolution = await this.bibPDFContextService.resolveForActiveFile(activeFile, true);

    if (requestId !== this.refreshRequestId) {
      return;
    }

    if ("reason" in resolution) {
      this.publish(this.mapFailureState(notePath, resolution));
      return;
    }

    if (
      this.state.notePath === resolution.notePath
      && this.state.pdfPath === resolution.pdfPath
      && this.state.status === "ready"
    ) {
      return;
    }

    this.publish({
      notePath: resolution.notePath,
      filename: resolution.filename,
      pdfPath: resolution.pdfPath,
      status: "preparing",
    });

    const availabilityError = this.pdfExtractionService.getAvailabilityError();
    if (availabilityError) {
      if (requestId === this.refreshRequestId && this.isCurrentResolution(resolution)) {
        this.publish({
          notePath: resolution.notePath,
          filename: resolution.filename,
          pdfPath: resolution.pdfPath,
          status: "error",
          errorMessage: availabilityError,
        });
      }
      return;
    }

    try {
      const prepared = await this.preparePDF(resolution);
      if (requestId !== this.refreshRequestId || !this.isCurrentResolution(resolution)) {
        return;
      }

      this.publish({
        notePath: resolution.notePath,
        filename: prepared.filename,
        pdfPath: prepared.pdfPath,
        status: "ready",
        ocrText: prepared.text,
        source: prepared.source,
      });
    } catch (error) {
      if (requestId !== this.refreshRequestId || !this.isCurrentResolution(resolution)) {
        return;
      }

      this.publish({
        notePath: resolution.notePath,
        filename: resolution.filename,
        pdfPath: resolution.pdfPath,
        status: "error",
        errorMessage: formatErrorMessage(error),
      });
    }
  }

  private async preparePDF(context: BibPDFContext): Promise<PreparedBibPDFResult> {
    const existing = this.inflightByPDFPath.get(context.pdfPath);
    if (existing) {
      return existing;
    }

    const task = (async () => {
      const buffer = await this.readAbsoluteBinaryFile(context.pdfPath);
      const hash = computeSHA256Hex(buffer);
      const cached = await this.pdfOCRCacheService.getByHash(hash);
      if (cached) {
        return {
          filename: cached.filename,
          pdfPath: context.pdfPath,
          text: cached.text,
          source: "cache" as const,
        };
      }

      const extracted = await this.pdfExtractionService.extractBuffer(context.filename, buffer);
      await this.pdfOCRCacheService.store(hash, extracted.filename, context.pdfPath, extracted.text);
      return {
        filename: extracted.filename,
        pdfPath: context.pdfPath,
        text: extracted.text,
        source: "ocr" as const,
      };
    })().finally(() => {
      this.inflightByPDFPath.delete(context.pdfPath);
    });

    this.inflightByPDFPath.set(context.pdfPath, task);
    return task;
  }

  private publish(state: BibPDFPreparationState): void {
    this.state = state;
    for (const listener of this.listeners) {
      listener(state);
    }
  }

  private isCurrentResolution(resolution: BibPDFContext): boolean {
    return this.state.notePath === resolution.notePath && this.state.pdfPath === resolution.pdfPath;
  }

  private mapFailureState(
    notePath: string | null,
    failure: BibPDFContextFailure,
  ): BibPDFPreparationState {
    switch (failure.reason) {
      case "no-active-file":
      case "file-context-disabled":
      case "not-markdown":
      case "no-bibkey":
      case "bib-entry-missing":
      case "bib-pdf-field-missing":
        return createIdleBibPDFPreparationState(notePath);
      case "bib-plugin-config-missing":
        return {
          notePath,
          filename: null,
          pdfPath: null,
          status: "error",
          errorMessage: "No BibTeX plugin file path is configured.",
        };
      case "bib-file-not-found":
        return {
          notePath,
          filename: null,
          pdfPath: null,
          status: "error",
          errorMessage: `BibTeX file not found (${failure.detail ?? "unknown path"}).`,
        };
      case "bib-pdf-root-missing":
        return {
          notePath,
          filename: null,
          pdfPath: null,
          status: "error",
          errorMessage: "Set the Bib PDF folder in this plugin's PDF settings.",
        };
      case "pdf-file-not-found":
        return {
          notePath,
          filename: null,
          pdfPath: null,
          status: "error",
          errorMessage: `PDF file not found (${failure.detail ?? "unknown path"}).`,
        };
    }
  }
}
