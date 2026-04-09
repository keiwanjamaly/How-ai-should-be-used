/**
 * Simple test runner for vault RAG helpers
 * Run with: npx ts-node src/__tests__/VaultRAGService.test.ts
 */

import { chunkDocument, rankChunks, tokenizeText } from "../utils/vaultRag.ts";
import { assertEqual, assertTrue, runTests } from "./testUtils.ts";

function testTokenizeTextFiltersStopWords(): void {
  const tokens = tokenizeText("How can we implement a simple vault chat with the whole vault?");
  assertEqual(tokens.includes("how"), false, "Should filter stop words");
  assertTrue(tokens.includes("implement"), "Should keep meaningful words");
  assertTrue(tokens.includes("vault"), "Should keep content words");
}

function testChunkDocumentSplitsLongParagraphs(): void {
  const content = `Intro paragraph.\n\n${"a".repeat(1300)}\n\nFinal paragraph.`;
  const chunks = chunkDocument(content, 500);

  assertTrue(chunks.length >= 4, "Should split oversized paragraphs into multiple chunks");
  assertEqual(chunks[0], "Intro paragraph.", "Should preserve earlier paragraph chunks");
}

function testRankChunksPrefersRareRelevantTerms(): void {
  const ranked = rankChunks([
    {
      path: "notes/rag.md",
      title: "rag",
      content: "RAG uses chunking retrieval embeddings and citations.",
      normalized: "rag uses chunking retrieval embeddings and citations.",
      tokens: tokenizeText("RAG uses chunking retrieval embeddings and citations."),
    },
    {
      path: "notes/todo.md",
      title: "todo",
      content: "Buy groceries and call the bank tomorrow.",
      normalized: "buy groceries and call the bank tomorrow.",
      tokens: tokenizeText("Buy groceries and call the bank tomorrow."),
    },
  ], "How do I build a retrieval chat with chunking?", 2);

  assertEqual(ranked[0]?.path, "notes/rag.md", "Should rank the semantically relevant chunk first");
}

function testRankChunksBoostsActiveFile(): void {
  const ranked = rankChunks([
    {
      path: "notes/active.md",
      title: "active",
      content: "Vault chat implementation notes and retrieval plan.",
      normalized: "vault chat implementation notes and retrieval plan.",
      tokens: tokenizeText("Vault chat implementation notes and retrieval plan."),
    },
    {
      path: "notes/other.md",
      title: "other",
      content: "Vault chat implementation notes and retrieval plan.",
      normalized: "vault chat implementation notes and retrieval plan.",
      tokens: tokenizeText("Vault chat implementation notes and retrieval plan."),
    },
  ], "vault chat retrieval", 2, "notes/active.md");

  assertEqual(ranked[0]?.path, "notes/active.md", "Should prefer the active note when scores tie");
}

runTests("Vault RAG helpers", [
  testTokenizeTextFiltersStopWords,
  testChunkDocumentSplitsLongParagraphs,
  testRankChunksPrefersRareRelevantTerms,
  testRankChunksBoostsActiveFile,
]);
