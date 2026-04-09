import { App, TFile } from "obsidian";
import type { VaultRAGSettings } from "../types";
import {
  chunkDocument,
  rankChunks,
  tokenizeText,
  type IndexedChunk,
  type RankedChunk,
} from "../utils/vaultRag";

export type VaultChunk = RankedChunk;

interface CachedFileChunks {
  mtime: number;
  size: number;
  chunkSize: number;
  chunks: IndexedChunk[];
}

export interface VaultRAGIndexStatus {
  enabled: boolean;
  isIndexing: boolean;
  totalMarkdownFiles: number;
  eligibleFiles: number;
  indexedFiles: number;
  skippedFiles: number;
}

export class VaultRAGService {
  private readonly fileCache = new Map<string, CachedFileChunks>();
  private readonly listeners = new Set<(status: VaultRAGIndexStatus) => void>();
  private status: VaultRAGIndexStatus = {
    enabled: false,
    isIndexing: false,
    totalMarkdownFiles: 0,
    eligibleFiles: 0,
    indexedFiles: 0,
    skippedFiles: 0,
  };
  private activeIndexRun = 0;

  constructor(private readonly app: App) {}

  getStatus(): VaultRAGIndexStatus {
    return { ...this.status };
  }

  onStatusChange(listener: (status: VaultRAGIndexStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => {
      this.listeners.delete(listener);
    };
  }

  async warmIndex(settings: VaultRAGSettings): Promise<void> {
    const runId = ++this.activeIndexRun;

    if (!settings.enabled) {
      this.setStatus({
        enabled: false,
        isIndexing: false,
        totalMarkdownFiles: this.app.vault.getMarkdownFiles().length,
        eligibleFiles: 0,
        indexedFiles: 0,
        skippedFiles: 0,
      });
      return;
    }

    const files = this.getEligibleFiles(settings);
    this.setStatus({
      enabled: true,
      isIndexing: true,
      totalMarkdownFiles: this.app.vault.getMarkdownFiles().length,
      eligibleFiles: files.length,
      indexedFiles: 0,
      skippedFiles: this.app.vault.getMarkdownFiles().length - files.length,
    });

    let indexedFiles = 0;
    for (const file of files) {
      await this.getFileChunks(file, settings.chunkSize);
      if (runId !== this.activeIndexRun) {
        return;
      }

      indexedFiles += 1;
      this.setStatus({
        enabled: true,
        isIndexing: true,
        totalMarkdownFiles: this.app.vault.getMarkdownFiles().length,
        eligibleFiles: files.length,
        indexedFiles,
        skippedFiles: this.app.vault.getMarkdownFiles().length - files.length,
      });
    }

    this.refreshStatus(settings, false);
  }

  async indexFile(file: TFile, settings: VaultRAGSettings): Promise<void> {
    if (!settings.enabled) {
      this.refreshStatus(settings, false);
      return;
    }

    const maxBytes = settings.maxFileSizeKB * 1024;
    if (file.extension !== "md" || file.stat.size > maxBytes) {
      this.invalidateFile(file.path);
      this.refreshStatus(settings, false);
      return;
    }

    await this.getFileChunks(file, settings.chunkSize);
    this.refreshStatus(settings, false);
  }

  refreshStatus(settings: VaultRAGSettings, isIndexing = this.status.isIndexing): void {
    if (!settings.enabled) {
      this.setStatus({
        enabled: false,
        isIndexing: false,
        totalMarkdownFiles: this.app.vault.getMarkdownFiles().length,
        eligibleFiles: 0,
        indexedFiles: 0,
        skippedFiles: 0,
      });
      return;
    }

    const files = this.getEligibleFiles(settings);
    const indexedFiles = files.filter((file) => this.isFileCached(file, settings.chunkSize)).length;

    this.setStatus({
      enabled: true,
      isIndexing,
      totalMarkdownFiles: this.app.vault.getMarkdownFiles().length,
      eligibleFiles: files.length,
      indexedFiles,
      skippedFiles: this.app.vault.getMarkdownFiles().length - files.length,
    });
  }

  invalidateFile(filePath: string): void {
    this.fileCache.delete(filePath);
  }

  async retrieveRelevantChunks(
    query: string,
    settings: VaultRAGSettings,
    activeFilePath?: string,
  ): Promise<VaultChunk[]> {
    if (!settings.enabled) {
      return [];
    }

    const maxBytes = settings.maxFileSizeKB * 1024;
    const files = this.app.vault.getMarkdownFiles().filter((file) => file.stat.size <= maxBytes);
    const indexedChunks: IndexedChunk[] = [];

    for (const file of files) {
      const fileChunks = await this.getFileChunks(file, settings.chunkSize);
      indexedChunks.push(...fileChunks);
    }

    this.refreshStatus(settings, this.status.isIndexing);
    return rankChunks(indexedChunks, query, settings.maxChunks, activeFilePath);
  }

  private async getFileChunks(file: TFile, chunkSize: number): Promise<IndexedChunk[]> {
    const cached = this.fileCache.get(file.path);
    if (
      cached &&
      cached.mtime === file.stat.mtime &&
      cached.size === file.stat.size &&
      cached.chunkSize === chunkSize
    ) {
      return cached.chunks;
    }

    const raw = await this.app.vault.cachedRead(file);
    const chunks = chunkDocument(raw, chunkSize).map((content) => ({
      path: file.path,
      title: file.basename,
      content,
      normalized: content.toLowerCase(),
      tokens: tokenizeText(content),
    }));

    this.fileCache.set(file.path, {
      mtime: file.stat.mtime,
      size: file.stat.size,
      chunkSize,
      chunks,
    });

    return chunks;
  }

  private getEligibleFiles(settings: VaultRAGSettings): TFile[] {
    const maxBytes = settings.maxFileSizeKB * 1024;
    return this.app.vault.getMarkdownFiles().filter((file) => file.stat.size <= maxBytes);
  }

  private isFileCached(file: TFile, chunkSize: number): boolean {
    const cached = this.fileCache.get(file.path);
    return Boolean(
      cached &&
      cached.mtime === file.stat.mtime &&
      cached.size === file.stat.size &&
      cached.chunkSize === chunkSize,
    );
  }

  private setStatus(status: VaultRAGIndexStatus): void {
    this.status = status;
    for (const listener of this.listeners) {
      listener(this.getStatus());
    }
  }
}
