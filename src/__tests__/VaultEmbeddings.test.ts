import { describe, expect, it } from "vitest";
import {
  cosineSimilarity,
  createVaultIndexSettingsSignature,
  deserializeEmbedding,
  isStoredDocumentCurrent,
  normalizeExtensions,
  rankEmbeddedChunks,
  serializeEmbedding,
} from "../utils/vaultEmbeddings.ts";

describe("Vault embedding helpers", () => {
  it("normalizes, deduplicates, and sorts extensions", () => {
    const extensions = normalizeExtensions(["md", ".TXT", " md ", ".txt"]);

    expect(extensions).toEqual([".md", ".txt"]);
  });

  it("changes the settings signature when inputs change", () => {
    const base = createVaultIndexSettingsSignature({
      chunkSize: 1200,
      maxFileSizeKB: 300,
      embeddingModel: "openai/text-embedding-3-small",
      includeExtensions: [".md"],
    });

    const changedModel = createVaultIndexSettingsSignature({
      chunkSize: 1200,
      maxFileSizeKB: 300,
      embeddingModel: "openai/text-embedding-3-large",
      includeExtensions: [".md"],
    });

    expect(base).not.toBe(changedModel);
  });

  it("round-trips embedding serialization", () => {
    const original = new Float32Array([0.25, -0.5, 1.5]);
    const serialized = serializeEmbedding(original);
    const roundTrip = deserializeEmbedding(serialized);

    expect(Array.from(roundTrip)).toEqual(Array.from(original));
  });

  it("computes cosine similarity", () => {
    expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([1, 0]))).toBeCloseTo(1, 6);
    expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBeCloseTo(0, 6);
  });

  it("prefers unique documents when ranking chunks", () => {
    const ranked = rankEmbeddedChunks([
      {
        path: "notes/a.md",
        title: "a",
        content: "First chunk",
        embedding: new Float32Array([1, 0]),
      },
      {
        path: "notes/a.md",
        title: "a",
        content: "Second chunk",
        embedding: new Float32Array([0.95, 0.05]),
      },
      {
        path: "notes/b.md",
        title: "b",
        content: "Third chunk",
        embedding: new Float32Array([0.9, 0.1]),
      },
    ], new Float32Array([1, 0]), 2);

    expect(ranked).toHaveLength(2);
    expect(ranked.some((chunk) => chunk.path === "notes/a.md")).toBe(true);
    expect(ranked.some((chunk) => chunk.path === "notes/b.md")).toBe(true);
  });

  it("treats only indexed matching metadata as current", () => {
    expect(isStoredDocumentCurrent({ status: "indexed", mtime: 10, size: 20 }, 10, 20)).toBe(true);
    expect(isStoredDocumentCurrent({ status: "failed", mtime: 10, size: 20 }, 10, 20)).toBe(false);
  });
});
