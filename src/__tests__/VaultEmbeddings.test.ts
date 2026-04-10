/**
 * Simple test runner for vault embedding helpers
 * Run with: npx ts-node src/__tests__/VaultEmbeddings.test.ts
 */

import {
  cosineSimilarity,
  createVaultIndexSettingsSignature,
  deserializeEmbedding,
  isStoredDocumentCurrent,
  normalizeExtensions,
  rankEmbeddedChunks,
  serializeEmbedding,
} from "../utils/vaultEmbeddings.ts";
import { assertAlmostEqual, assertEqual, assertFalse, assertTrue, runTests } from "./testUtils.ts";

function testNormalizeExtensionsDeduplicatesAndAddsDots(): void {
  const extensions = normalizeExtensions(["md", ".TXT", " md ", ".txt"]);
  assertEqual(extensions, [".md", ".txt"], "Should normalize, deduplicate, and sort extensions");
}

function testSettingsSignatureChangesWhenInputsChange(): void {
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

  assertFalse(base === changedModel, "Changing the embedding model should change the signature");
}

function testEmbeddingSerializationRoundTrip(): void {
  const original = new Float32Array([0.25, -0.5, 1.5]);
  const serialized = serializeEmbedding(original);
  const roundTrip = deserializeEmbedding(serialized);

  assertEqual(Array.from(roundTrip), Array.from(original), "Should round-trip embedding bytes");
}

function testCosineSimilarity(): void {
  assertAlmostEqual(
    cosineSimilarity(new Float32Array([1, 0]), new Float32Array([1, 0])),
    1,
    1e-6,
    "Parallel vectors should have cosine similarity of 1",
  );

  assertAlmostEqual(
    cosineSimilarity(new Float32Array([1, 0]), new Float32Array([0, 1])),
    0,
    1e-6,
    "Orthogonal vectors should have cosine similarity of 0",
  );
}

function testRankEmbeddedChunksPrefersUniqueDocuments(): void {
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

  assertEqual(ranked.length, 2, "Should return two ranked chunks");
  assertTrue(ranked.some((chunk) => chunk.path === "notes/a.md"), "Should include the best matching document");
  assertTrue(ranked.some((chunk) => chunk.path === "notes/b.md"), "Should diversify across documents before duplicates");
}

function testStoredDocumentCurrent(): void {
  assertTrue(
    isStoredDocumentCurrent({ status: "indexed", mtime: 10, size: 20 }, 10, 20),
    "Matching indexed metadata should be current",
  );
  assertFalse(
    isStoredDocumentCurrent({ status: "failed", mtime: 10, size: 20 }, 10, 20),
    "Failed documents should not count as current",
  );
}

runTests("Vault embedding helpers", [
  testNormalizeExtensionsDeduplicatesAndAddsDots,
  testSettingsSignatureChangesWhenInputsChange,
  testEmbeddingSerializationRoundTrip,
  testCosineSimilarity,
  testRankEmbeddedChunksPrefersUniqueDocuments,
  testStoredDocumentCurrent,
]);
