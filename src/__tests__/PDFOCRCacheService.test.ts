import { describe, expect, it } from "vitest";
import { PDFOCRCacheService, computeSHA256Hex } from "../services/PDFOCRCacheService.ts";

function createAdapter() {
  const store = new Map<string, string>();
  return {
    store,
    exists: async (path: string) => store.has(path),
    mkdir: async (path: string) => {
      store.set(path, "__dir__");
    },
    read: async (path: string) => {
      const value = store.get(path);
      if (value === undefined || value === "__dir__") {
        throw new Error(`missing ${path}`);
      }
      return value;
    },
    write: async (path: string, value: string) => {
      store.set(path, value);
    },
  };
}

describe("PDFOCRCacheService", () => {
  it("computes stable hashes for identical PDF bytes", () => {
    const bytes = new TextEncoder().encode("pdf-body").buffer;
    expect(computeSHA256Hex(bytes)).toBe(computeSHA256Hex(bytes));
  });

  it("stores and reloads OCR text by hash", async () => {
    const adapter = createAdapter();
    const service = new PDFOCRCacheService({
      vault: {
        configDir: ".obsidian",
        adapter,
      },
    } as never, "obsidian-ai-chat");

    await service.store("hash-1", "paper.pdf", "/tmp/paper.pdf", "OCR text");
    const cached = await service.getByHash("hash-1");

    expect(cached).toEqual({
      hash: "hash-1",
      filename: "paper.pdf",
      sourcePath: "/tmp/paper.pdf",
      createdAt: expect.any(Number),
      text: "OCR text",
    });
  });
});
