import { describe, expect, it } from "vitest";
import { getUniqueChunkPaths } from "../utils/ragPreview";

describe("rag preview helpers", () => {
  it("preserves order, trims paths, and removes duplicates", () => {
    const deduped = getUniqueChunkPaths([
      { path: "notes/a.md" },
      { path: "notes/b.md" },
      { path: "notes/a.md" },
      { path: "  notes/c.md  " },
      { path: "" },
    ]);

    expect(deduped).toEqual(["notes/a.md", "notes/b.md", "notes/c.md"]);
  });
});
