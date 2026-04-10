import { App, TFile, normalizePath } from "obsidian";
import initSqlJs from "sql.js";
import sqlWasmBinary from "sql.js/dist/sql-wasm.wasm";
import type { ObsidianAIChatSettings, VaultRAGSettings } from "../types";
import { OpenRouterEmbeddingsService } from "./OpenRouterEmbeddingsService";
import { chunkDocument, rankChunks, tokenizeText, type IndexedChunk, type RankedChunk } from "../utils/vaultRag";
import {
  VAULT_INDEX_SCHEMA_VERSION,
  createVaultIndexSettingsSignature,
  deserializeEmbedding,
  hashTextContent,
  isStoredDocumentCurrent,
  normalizeExtensions,
  rankEmbeddedChunks,
  serializeEmbedding,
  type EmbeddedChunkCandidate,
} from "../utils/vaultEmbeddings";

type SqlDatabase = {
  run(sql: string, params?: unknown[]): void;
  exec(sql: string, params?: unknown[]): Array<{ columns: string[]; values: unknown[][] }>;
  prepare(sql: string, params?: unknown[]): {
    bind(params?: unknown[]): void;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    free(): void;
  };
  export(): Uint8Array;
};

type SqlModule = {
  Database: new (data?: Uint8Array) => SqlDatabase;
};

export type VaultChunk = RankedChunk;
export type VaultRAGIndexPhase = "idle" | "scanning" | "embedding" | "saving";

interface StoredDocumentRecord {
  id: number;
  path: string;
  extension: string;
  mtime: number;
  size: number;
  contentHash: string;
  chunkCount: number;
  status: string;
  lastError: string | null;
}

export interface VaultRAGIndexStatus {
  enabled: boolean;
  isIndexing: boolean;
  phase: VaultRAGIndexPhase;
  totalFiles: number;
  eligibleFiles: number;
  indexedFiles: number;
  staleFiles: number;
  skippedFiles: number;
  failedFiles: number;
  activeModel: string;
  lastError: string | null;
}

interface DataAdapterLike {
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  readBinary(path: string): Promise<ArrayBuffer>;
  writeBinary(path: string, data: ArrayBuffer | Uint8Array): Promise<void>;
}

const INDEX_DB_FILENAME = "vault-rag-index.sqlite";
const META_SCHEMA_VERSION = "schema_version";
const META_SETTINGS_SIGNATURE = "settings_signature";
const EMBEDDING_BATCH_SIZE = 16;

export class VaultEmbeddingIndexService {
  private readonly listeners = new Set<(status: VaultRAGIndexStatus) => void>();
  private readonly embeddingsService: OpenRouterEmbeddingsService;
  private readonly adapter: DataAdapterLike;
  private readonly keywordFallbackCache = new Map<string, IndexedChunk[]>();
  private initPromise: Promise<void> | null = null;
  private sqlModule: SqlModule | null = null;
  private db: SqlDatabase | null = null;
  private status: VaultRAGIndexStatus = {
    enabled: false,
    isIndexing: false,
    phase: "idle",
    totalFiles: 0,
    eligibleFiles: 0,
    indexedFiles: 0,
    staleFiles: 0,
    skippedFiles: 0,
    failedFiles: 0,
    activeModel: "",
    lastError: null,
  };
  private activeRefreshRun = 0;

  constructor(
    private readonly app: App,
    private readonly pluginId: string,
    private readonly getSettings: () => ObsidianAIChatSettings,
    embeddingsService?: OpenRouterEmbeddingsService,
  ) {
    this.embeddingsService = embeddingsService ?? new OpenRouterEmbeddingsService();
    this.adapter = this.app.vault.adapter as unknown as DataAdapterLike;
  }

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

  async initialize(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      await this.ensurePluginDir();
      this.sqlModule = await initSqlJs({
        wasmBinary: sqlWasmBinary,
      }) as unknown as SqlModule;

      await this.loadDatabase();
      this.ensureSchema();
      this.setStatus({
        ...this.status,
        enabled: this.getVaultRAGSettings().enabled,
        activeModel: this.getVaultRAGSettings().embeddingModel,
      });
    })().catch((error) => {
      this.initPromise = null;
      throw error;
    });

    return this.initPromise;
  }

  async refreshIndex(): Promise<void> {
    const settings = this.getVaultRAGSettings();
    if (!settings.enabled) {
      await this.refreshStatus("idle");
      return;
    }

    await this.initialize();
    const runId = ++this.activeRefreshRun;
    this.setStatus({
      ...this.status,
      enabled: true,
      isIndexing: true,
      phase: "scanning",
      activeModel: settings.embeddingModel,
      lastError: null,
    });

    const signatureChanged = this.ensureIndexSignature(settings);
    const { allFiles, eligibleFiles } = this.collectVaultFiles(settings);
    const eligiblePaths = new Set(eligibleFiles.map((file) => file.path));
    await this.removeMissingDocuments(eligiblePaths);
    await this.refreshStatus("scanning");

    if (signatureChanged) {
      this.keywordFallbackCache.clear();
      await this.refreshStatus("scanning");
    }

    for (const file of eligibleFiles) {
      if (runId !== this.activeRefreshRun) {
        return;
      }

      const existing = this.getDocumentByPath(file.path);
      if (isStoredDocumentCurrent(existing, file.stat.mtime, file.stat.size)) {
        await this.refreshStatus("scanning");
        continue;
      }

      await this.indexFileInternal(file, false);
      if (runId !== this.activeRefreshRun) {
        return;
      }
      await this.refreshStatus("embedding");
    }

    if (runId !== this.activeRefreshRun) {
      return;
    }

    this.setStatus({ ...this.status, phase: "saving", isIndexing: true });
    await this.persistDatabase();
    await this.refreshStatus("idle");

    if (allFiles.length !== this.status.totalFiles) {
      await this.refreshStatus("idle");
    }
  }

  async indexFile(file: TFile): Promise<void> {
    await this.initialize();
    await this.indexFileInternal(file, true);
    await this.refreshStatus("idle");
  }

  async removeFile(filePath: string): Promise<void> {
    await this.initialize();
    this.deleteDocument(filePath);
    this.keywordFallbackCache.delete(filePath);
    await this.persistDatabase();
    await this.refreshStatus("idle");
  }

  async clearIndex(): Promise<void> {
    await this.initialize();
    this.db!.run("DELETE FROM chunks");
    this.db!.run("DELETE FROM documents");
    this.setMetaValue(META_SCHEMA_VERSION, String(VAULT_INDEX_SCHEMA_VERSION));
    this.setMetaValue(META_SETTINGS_SIGNATURE, this.getSettingsSignature(this.getVaultRAGSettings()));
    this.keywordFallbackCache.clear();
    await this.persistDatabase();
    await this.refreshStatus("idle");
  }

  async retrieveRelevantChunks(
    query: string,
    activeFilePath?: string,
  ): Promise<VaultChunk[]> {
    const settings = this.getVaultRAGSettings();
    if (!settings.enabled) {
      return [];
    }

    await this.initialize();
    if (!this.hasCurrentSignature(settings)) {
      void this.refreshIndex();
      return this.keywordFallbackSearch(query, settings, activeFilePath);
    }

    const indexedChunks = this.getIndexedChunks();
    if (indexedChunks.length === 0) {
      return this.keywordFallbackSearch(query, settings, activeFilePath);
    }

    try {
      const [queryEmbedding] = await this.embeddingsService.createEmbeddings(
        this.getSettings().openRouter,
        settings.embeddingModel,
        [query],
      );

      const ranked = rankEmbeddedChunks(indexedChunks, queryEmbedding, settings.maxChunks, activeFilePath);
      return ranked.length > 0
        ? ranked
        : this.keywordFallbackSearch(query, settings, activeFilePath);
    } catch (error) {
      this.setStatus({
        ...this.status,
        lastError: error instanceof Error ? error.message : String(error),
      });
      return this.keywordFallbackSearch(query, settings, activeFilePath);
    }
  }

  async refreshStatus(phase: VaultRAGIndexPhase = this.status.phase): Promise<void> {
    const settings = this.getVaultRAGSettings();
    const { allFiles, eligibleFiles } = this.collectVaultFiles(settings);

    if (!settings.enabled) {
      this.setStatus({
        enabled: false,
        isIndexing: false,
        phase: "idle",
        totalFiles: allFiles.length,
        eligibleFiles: 0,
        indexedFiles: 0,
        staleFiles: 0,
        skippedFiles: allFiles.length,
        failedFiles: 0,
        activeModel: settings.embeddingModel,
        lastError: null,
      });
      return;
    }

    await this.initialize();
    const signatureCurrent = this.hasCurrentSignature(settings);
    const documents = this.getDocumentsMap();

    let indexedFiles = 0;
    let failedFiles = 0;
    let staleFiles = 0;

    for (const file of eligibleFiles) {
      const document = documents.get(file.path);
      if (!signatureCurrent) {
        staleFiles += 1;
        continue;
      }

      if (isStoredDocumentCurrent(document, file.stat.mtime, file.stat.size)) {
        indexedFiles += 1;
        continue;
      }

      if (document && document.status === "failed" && document.mtime === file.stat.mtime && document.size === file.stat.size) {
        failedFiles += 1;
        continue;
      }

      staleFiles += 1;
    }

    this.setStatus({
      enabled: true,
      isIndexing: phase !== "idle",
      phase,
      totalFiles: allFiles.length,
      eligibleFiles: eligibleFiles.length,
      indexedFiles,
      staleFiles,
      skippedFiles: allFiles.length - eligibleFiles.length,
      failedFiles,
      activeModel: settings.embeddingModel,
      lastError: this.status.lastError,
    });
  }

  private async indexFileInternal(file: TFile, persist: boolean): Promise<void> {
    const settings = this.getVaultRAGSettings();
    if (!settings.enabled) {
      return;
    }

    if (!this.isEligibleFile(file, settings)) {
      this.deleteDocument(file.path);
      this.keywordFallbackCache.delete(file.path);
      if (persist) {
        await this.persistDatabase();
      }
      return;
    }

    const content = await this.app.vault.cachedRead(file);
    const contentHash = hashTextContent(content);
    const chunks = chunkDocument(content, settings.chunkSize);
    const documentId = this.upsertDocument({
      path: file.path,
      extension: this.toNormalizedExtension(file),
      mtime: file.stat.mtime,
      size: file.stat.size,
      contentHash,
      chunkCount: chunks.length,
      status: chunks.length === 0 ? "indexed" : "embedding",
      lastError: null,
    });

    this.deleteChunksForDocument(documentId);
    this.keywordFallbackCache.set(file.path, this.createKeywordChunks(file, chunks));

    if (chunks.length === 0) {
      if (persist) {
        await this.persistDatabase();
      }
      return;
    }

    try {
      this.setStatus({ ...this.status, phase: "embedding", isIndexing: true, lastError: null });
      const embeddings = await this.embedChunks(settings, chunks);

      for (let index = 0; index < chunks.length; index += 1) {
        this.db!.run(
          `INSERT INTO chunks (document_id, chunk_index, text, embedding_blob, char_count)
           VALUES (?, ?, ?, ?, ?)`,
          [documentId, index, chunks[index], serializeEmbedding(embeddings[index]), chunks[index].length],
        );
      }

      this.upsertDocument({
        path: file.path,
        extension: this.toNormalizedExtension(file),
        mtime: file.stat.mtime,
        size: file.stat.size,
        contentHash,
        chunkCount: chunks.length,
        status: "indexed",
        lastError: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deleteChunksForDocument(documentId);
      this.upsertDocument({
        path: file.path,
        extension: this.toNormalizedExtension(file),
        mtime: file.stat.mtime,
        size: file.stat.size,
        contentHash,
        chunkCount: 0,
        status: "failed",
        lastError: message,
      });
      this.setStatus({
        ...this.status,
        phase: "embedding",
        isIndexing: true,
        lastError: message,
      });
    }

    if (persist) {
      this.setStatus({ ...this.status, phase: "saving", isIndexing: true });
      await this.persistDatabase();
    }
  }

  private async embedChunks(settings: VaultRAGSettings, chunks: string[]): Promise<Float32Array[]> {
    const allEmbeddings: Float32Array[] = [];
    for (let start = 0; start < chunks.length; start += EMBEDDING_BATCH_SIZE) {
      const batch = chunks.slice(start, start + EMBEDDING_BATCH_SIZE);
      const embeddings = await this.embeddingsService.createEmbeddings(
        this.getSettings().openRouter,
        settings.embeddingModel,
        batch,
      );
      allEmbeddings.push(...embeddings);
    }
    return allEmbeddings;
  }

  private getIndexedChunks(): EmbeddedChunkCandidate[] {
    const statement = this.db!.prepare(
      `SELECT documents.path, chunks.text, chunks.embedding_blob
       FROM chunks
       INNER JOIN documents ON documents.id = chunks.document_id
       WHERE documents.status = 'indexed'
       ORDER BY documents.path ASC, chunks.chunk_index ASC`,
    );

    const chunks: EmbeddedChunkCandidate[] = [];
    while (statement.step()) {
      const row = statement.getAsObject();
      const path = String(row.path ?? "");
      const title = path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? path;
      chunks.push({
        path,
        title,
        content: String(row.text ?? ""),
        embedding: deserializeEmbedding(row.embedding_blob as Uint8Array),
      });
    }
    statement.free();
    return chunks;
  }

  private getDocumentsMap(): Map<string, StoredDocumentRecord> {
    const statement = this.db!.prepare(
      `SELECT id, path, extension, mtime, size, content_hash, chunk_count, status, last_error
       FROM documents`,
    );

    const documents = new Map<string, StoredDocumentRecord>();
    while (statement.step()) {
      const row = statement.getAsObject();
      documents.set(String(row.path ?? ""), {
        id: Number(row.id ?? 0),
        path: String(row.path ?? ""),
        extension: String(row.extension ?? ""),
        mtime: Number(row.mtime ?? 0),
        size: Number(row.size ?? 0),
        contentHash: String(row.content_hash ?? ""),
        chunkCount: Number(row.chunk_count ?? 0),
        status: String(row.status ?? ""),
        lastError: row.last_error ? String(row.last_error) : null,
      });
    }
    statement.free();
    return documents;
  }

  private getDocumentByPath(path: string): StoredDocumentRecord | null {
    const statement = this.db!.prepare(
      `SELECT id, path, extension, mtime, size, content_hash, chunk_count, status, last_error
       FROM documents WHERE path = ? LIMIT 1`,
    );
    statement.bind([path]);

    if (!statement.step()) {
      statement.free();
      return null;
    }

    const row = statement.getAsObject();
    statement.free();
    return {
      id: Number(row.id ?? 0),
      path: String(row.path ?? ""),
      extension: String(row.extension ?? ""),
      mtime: Number(row.mtime ?? 0),
      size: Number(row.size ?? 0),
      contentHash: String(row.content_hash ?? ""),
      chunkCount: Number(row.chunk_count ?? 0),
      status: String(row.status ?? ""),
      lastError: row.last_error ? String(row.last_error) : null,
    };
  }

  private upsertDocument(document: Omit<StoredDocumentRecord, "id">): number {
    this.db!.run(
      `INSERT INTO documents (
         path, extension, mtime, size, content_hash, chunk_count, last_indexed_at, status, last_error
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         extension = excluded.extension,
         mtime = excluded.mtime,
         size = excluded.size,
         content_hash = excluded.content_hash,
         chunk_count = excluded.chunk_count,
         last_indexed_at = excluded.last_indexed_at,
         status = excluded.status,
         last_error = excluded.last_error`,
      [
        document.path,
        document.extension,
        document.mtime,
        document.size,
        document.contentHash,
        document.chunkCount,
        Date.now(),
        document.status,
        document.lastError,
      ],
    );

    return this.getDocumentByPath(document.path)?.id ?? 0;
  }

  private deleteChunksForDocument(documentId: number): void {
    this.db!.run("DELETE FROM chunks WHERE document_id = ?", [documentId]);
  }

  private deleteDocument(path: string): void {
    const document = this.getDocumentByPath(path);
    if (!document) {
      return;
    }

    this.db!.run("DELETE FROM chunks WHERE document_id = ?", [document.id]);
    this.db!.run("DELETE FROM documents WHERE id = ?", [document.id]);
  }

  private async removeMissingDocuments(eligiblePaths: Set<string>): Promise<void> {
    const documents = this.getDocumentsMap();
    for (const path of documents.keys()) {
      if (!eligiblePaths.has(path)) {
        this.deleteDocument(path);
        this.keywordFallbackCache.delete(path);
      }
    }
  }

  private async keywordFallbackSearch(
    query: string,
    settings: VaultRAGSettings,
    activeFilePath?: string,
  ): Promise<VaultChunk[]> {
    const chunks: IndexedChunk[] = [];
    for (const file of this.collectVaultFiles(settings).eligibleFiles) {
      let cached = this.keywordFallbackCache.get(file.path);
      if (!cached) {
        const content = await this.app.vault.cachedRead(file);
        cached = this.createKeywordChunks(file, chunkDocument(content, settings.chunkSize));
        this.keywordFallbackCache.set(file.path, cached);
      }

      chunks.push(...cached);
    }

    return rankChunks(chunks, query, settings.maxChunks, activeFilePath);
  }

  private createKeywordChunks(file: TFile, chunks: string[]): IndexedChunk[] {
    return chunks.map((content) => ({
      path: file.path,
      title: file.basename,
      content,
      normalized: content.toLowerCase(),
      tokens: tokenizeText(content),
    }));
  }

  private collectVaultFiles(settings: VaultRAGSettings): { allFiles: TFile[]; eligibleFiles: TFile[] } {
    const allFiles = this.app.vault.getFiles();
    const includeExtensions = normalizeExtensions(settings.includeExtensions);
    const eligibleFiles = allFiles.filter((file) => this.isEligibleFile(file, settings, includeExtensions));
    return { allFiles, eligibleFiles };
  }

  private isEligibleFile(
    file: TFile,
    settings: VaultRAGSettings,
    includeExtensions = normalizeExtensions(settings.includeExtensions),
  ): boolean {
    const maxBytes = settings.maxFileSizeKB * 1024;
    return file.stat.size <= maxBytes && includeExtensions.includes(this.toNormalizedExtension(file));
  }

  private toNormalizedExtension(file: TFile): string {
    return `.${file.extension.toLowerCase()}`;
  }

  private getVaultRAGSettings(): VaultRAGSettings {
    return this.getSettings().vaultRAG;
  }

  private getSettingsSignature(settings: VaultRAGSettings): string {
    return createVaultIndexSettingsSignature({
      chunkSize: settings.chunkSize,
      maxFileSizeKB: settings.maxFileSizeKB,
      embeddingModel: settings.embeddingModel,
      includeExtensions: settings.includeExtensions,
    });
  }

  private hasCurrentSignature(settings: VaultRAGSettings): boolean {
    return this.getMetaValue(META_SCHEMA_VERSION) === String(VAULT_INDEX_SCHEMA_VERSION)
      && this.getMetaValue(META_SETTINGS_SIGNATURE) === this.getSettingsSignature(settings);
  }

  private ensureIndexSignature(settings: VaultRAGSettings): boolean {
    const signature = this.getSettingsSignature(settings);
    const schemaCurrent = this.getMetaValue(META_SCHEMA_VERSION) === String(VAULT_INDEX_SCHEMA_VERSION);
    const signatureCurrent = this.getMetaValue(META_SETTINGS_SIGNATURE) === signature;
    if (schemaCurrent && signatureCurrent) {
      return false;
    }

    this.db!.run("DELETE FROM chunks");
    this.db!.run("DELETE FROM documents");
    this.setMetaValue(META_SCHEMA_VERSION, String(VAULT_INDEX_SCHEMA_VERSION));
    this.setMetaValue(META_SETTINGS_SIGNATURE, signature);
    return true;
  }

  private getMetaValue(key: string): string | null {
    const statement = this.db!.prepare("SELECT value FROM meta WHERE key = ? LIMIT 1");
    statement.bind([key]);
    if (!statement.step()) {
      statement.free();
      return null;
    }

    const row = statement.getAsObject();
    statement.free();
    return row.value ? String(row.value) : null;
  }

  private setMetaValue(key: string, value: string): void {
    this.db!.run(
      `INSERT INTO meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, value],
    );
  }

  private async ensurePluginDir(): Promise<void> {
    const pluginDir = this.getPluginDirPath();
    if (!(await this.adapter.exists(pluginDir))) {
      await this.adapter.mkdir(pluginDir);
    }
  }

  private async loadDatabase(): Promise<void> {
    const databasePath = this.getDatabasePath();
    if (await this.adapter.exists(databasePath)) {
      const binary = await this.adapter.readBinary(databasePath);
      this.db = new this.sqlModule!.Database(new Uint8Array(binary));
    } else {
      this.db = new this.sqlModule!.Database();
    }
  }

  private ensureSchema(): void {
    this.db!.run("PRAGMA foreign_keys = ON");
    this.db!.run(`
      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL UNIQUE,
        extension TEXT NOT NULL,
        mtime INTEGER NOT NULL,
        size INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        chunk_count INTEGER NOT NULL,
        last_indexed_at INTEGER NOT NULL,
        status TEXT NOT NULL,
        last_error TEXT
      )
    `);
    this.db!.run(`
      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id INTEGER NOT NULL,
        chunk_index INTEGER NOT NULL,
        text TEXT NOT NULL,
        embedding_blob BLOB NOT NULL,
        char_count INTEGER NOT NULL,
        FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
      )
    `);
    this.db!.run(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
    this.db!.run("CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON chunks(document_id)");
  }

  private async persistDatabase(): Promise<void> {
    const exported = this.db!.export();
    await this.adapter.writeBinary(this.getDatabasePath(), exported);
  }

  private getPluginDirPath(): string {
    return normalizePath(`${this.app.vault.configDir}/plugins/${this.pluginId}`);
  }

  private getDatabasePath(): string {
    return normalizePath(`${this.getPluginDirPath()}/${INDEX_DB_FILENAME}`);
  }

  private setStatus(status: VaultRAGIndexStatus): void {
    this.status = status;
    for (const listener of this.listeners) {
      listener(this.getStatus());
    }
  }
}

export { VaultEmbeddingIndexService as VaultRAGService };
