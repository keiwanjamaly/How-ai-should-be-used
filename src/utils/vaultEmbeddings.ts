import { createHash } from "crypto";
import type { RankedChunk } from "./vaultRag";

export const VAULT_INDEX_SCHEMA_VERSION = 1;

export interface VaultIndexSettingsSignatureInput {
  chunkSize: number;
  maxFileSizeKB: number;
  embeddingModel: string;
  includeExtensions: string[];
}

export interface EmbeddedChunkCandidate {
  path: string;
  title: string;
  content: string;
  embedding: Float32Array;
}

export interface StoredDocumentSnapshot {
  status: string;
  mtime: number;
  size: number;
}

export function normalizeExtensions(extensions: string[]): string[] {
  const normalized = extensions
    .map((extension) => extension.trim().toLowerCase())
    .filter((extension) => extension.length > 0)
    .map((extension) => (extension.startsWith(".") ? extension : `.${extension}`));

  return Array.from(new Set(normalized)).sort();
}

export function createVaultIndexSettingsSignature(
  input: VaultIndexSettingsSignatureInput,
): string {
  return JSON.stringify({
    schemaVersion: VAULT_INDEX_SCHEMA_VERSION,
    chunkSize: input.chunkSize,
    maxFileSizeKB: input.maxFileSizeKB,
    embeddingModel: input.embeddingModel.trim(),
    includeExtensions: normalizeExtensions(input.includeExtensions),
  });
}

export function hashTextContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function serializeEmbedding(embedding: number[] | Float32Array): Uint8Array {
  const floatArray = embedding instanceof Float32Array ? embedding : new Float32Array(embedding);
  return new Uint8Array(floatArray.buffer.slice(0));
}

export function deserializeEmbedding(blob: Uint8Array | ArrayBuffer | number[]): Float32Array {
  if (Array.isArray(blob)) {
    return new Float32Array(blob);
  }

  if (blob instanceof Uint8Array) {
    return new Float32Array(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength));
  }

  return new Float32Array(blob.slice(0));
}

export function cosineSimilarity(
  left: Float32Array | number[],
  right: Float32Array | number[],
): number {
  if (left.length !== right.length || left.length === 0) {
    return 0;
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export function rankEmbeddedChunks(
  chunks: EmbeddedChunkCandidate[],
  queryEmbedding: Float32Array,
  limit: number,
  activeFilePath?: string,
): RankedChunk[] {
  const ranked = chunks
    .map((chunk) => ({
      path: chunk.path,
      title: chunk.title,
      content: chunk.content,
      score: cosineSimilarity(chunk.embedding, queryEmbedding) + (chunk.path === activeFilePath ? 0.01 : 0),
    }))
    .filter((chunk) => chunk.score > 0)
    .sort((left, right) => right.score - left.score);

  const selected: RankedChunk[] = [];
  const seenPaths = new Set<string>();

  for (const chunk of ranked) {
    if (selected.length >= limit) {
      break;
    }

    if (seenPaths.has(chunk.path)) {
      continue;
    }

    selected.push(chunk);
    seenPaths.add(chunk.path);
  }

  if (selected.length >= limit) {
    return selected;
  }

  for (const chunk of ranked) {
    if (selected.length >= limit) {
      break;
    }

    if (selected.includes(chunk)) {
      continue;
    }

    selected.push(chunk);
  }

  return selected;
}

export function isStoredDocumentCurrent(
  snapshot: StoredDocumentSnapshot | null | undefined,
  fileMtime: number,
  fileSize: number,
): boolean {
  return Boolean(
    snapshot &&
    snapshot.status === "indexed" &&
    snapshot.mtime === fileMtime &&
    snapshot.size === fileSize,
  );
}
