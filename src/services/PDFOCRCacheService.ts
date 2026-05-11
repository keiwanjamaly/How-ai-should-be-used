import { App, normalizePath } from "obsidian";
import { createHash } from "crypto";

interface PDFOCRCacheIndexEntry {
  hash: string;
  filename: string;
  sourcePath: string;
  createdAt: number;
  textPath: string;
}

interface PDFOCRCacheIndex {
  entries: Record<string, PDFOCRCacheIndexEntry>;
}

const CACHE_DIRNAME = "pdf-ocr-cache";
const INDEX_FILENAME = "index.json";

export interface CachedPDFOCRResult {
  hash: string;
  filename: string;
  sourcePath: string;
  createdAt: number;
  text: string;
}

export function computeSHA256Hex(buffer: ArrayBuffer): string {
  return createHash("sha256").update(Buffer.from(buffer)).digest("hex");
}

export class PDFOCRCacheService {
  private indexCache: PDFOCRCacheIndex | null = null;

  constructor(
    private readonly app: App,
    private readonly pluginId: string,
  ) {}

  async getByHash(hash: string): Promise<CachedPDFOCRResult | null> {
    const entry = (await this.loadIndex()).entries[hash];
    if (!entry) {
      return null;
    }

    try {
      const text = await this.app.vault.adapter.read(entry.textPath);
      return {
        hash,
        filename: entry.filename,
        sourcePath: entry.sourcePath,
        createdAt: entry.createdAt,
        text,
      };
    } catch {
      return null;
    }
  }

  async store(hash: string, filename: string, sourcePath: string, text: string): Promise<void> {
    await this.ensureCacheDir();

    const index = await this.loadIndex();
    const textPath = this.getTextPath(hash);
    await this.app.vault.adapter.write(textPath, text);

    index.entries[hash] = {
      hash,
      filename,
      sourcePath,
      createdAt: Date.now(),
      textPath,
    };

    await this.persistIndex(index);
  }

  private async ensureCacheDir(): Promise<void> {
    const pluginDir = this.getPluginDirPath();
    if (!(await this.app.vault.adapter.exists(pluginDir))) {
      await this.app.vault.adapter.mkdir(pluginDir);
    }

    const cacheDir = this.getCacheDirPath();
    if (!(await this.app.vault.adapter.exists(cacheDir))) {
      await this.app.vault.adapter.mkdir(cacheDir);
    }
  }

  private async loadIndex(): Promise<PDFOCRCacheIndex> {
    if (this.indexCache) {
      return this.indexCache;
    }

    await this.ensureCacheDir();
    const indexPath = this.getIndexPath();
    if (!(await this.app.vault.adapter.exists(indexPath))) {
      this.indexCache = { entries: {} };
      return this.indexCache;
    }

    try {
      const raw = await this.app.vault.adapter.read(indexPath);
      const parsed = JSON.parse(raw) as Partial<PDFOCRCacheIndex>;
      this.indexCache = {
        entries: parsed.entries ?? {},
      };
    } catch {
      this.indexCache = { entries: {} };
    }

    return this.indexCache;
  }

  private async persistIndex(index: PDFOCRCacheIndex): Promise<void> {
    this.indexCache = index;
    await this.app.vault.adapter.write(this.getIndexPath(), JSON.stringify(index, null, 2));
  }

  private getPluginDirPath(): string {
    return normalizePath(`${this.app.vault.configDir}/plugins/${this.pluginId}`);
  }

  private getCacheDirPath(): string {
    return normalizePath(`${this.getPluginDirPath()}/${CACHE_DIRNAME}`);
  }

  private getIndexPath(): string {
    return normalizePath(`${this.getCacheDirPath()}/${INDEX_FILENAME}`);
  }

  private getTextPath(hash: string): string {
    return normalizePath(`${this.getCacheDirPath()}/${hash}.txt`);
  }
}
