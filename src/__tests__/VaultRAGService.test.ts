import { describe, expect, it } from "vitest";
import { chunkDocument, rankChunks, tokenizeText } from "../utils/vaultRag.ts";

describe("Vault RAG helpers", () => {
  it("filters stop words during tokenization", () => {
    const tokens = tokenizeText("How can we implement a simple vault chat with the whole vault?");

    expect(tokens.includes("how")).toBe(false);
    expect(tokens.includes("implement")).toBe(true);
    expect(tokens.includes("vault")).toBe(true);
  });

  it("splits oversized paragraphs into chunks", () => {
    const content = `Intro paragraph.\n\n${"a".repeat(1300)}\n\nFinal paragraph.`;
    const chunks = chunkDocument(content, 500);

    expect(chunks.length).toBeGreaterThanOrEqual(4);
    expect(chunks[0]).toBe("Intro paragraph.");
  });

  it("prefers semantically relevant chunks", () => {
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

    expect(ranked[0]?.path).toBe("notes/rag.md");
  });

  it("boosts the active file on ties", () => {
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

    expect(ranked[0]?.path).toBe("notes/active.md");
  });
});
