import { describe, expect, it } from "vitest";
import { extractCodexPickerModels } from "../services/CodexModels.ts";

describe("Codex model helpers", () => {
  it("prefers list-visible models ordered by priority", () => {
    const models = extractCodexPickerModels([
      { slug: "hidden-model", visibility: "hide", priority: 0 },
      { slug: "gpt-5-mini", visibility: "list", priority: 2 },
      { slug: "gpt-5", visibility: "list", priority: 1 },
    ]);

    expect(models).toEqual(["gpt-5", "gpt-5-mini"]);
  });

  it("falls back to all models when none are visible", () => {
    const models = extractCodexPickerModels([
      { slug: "model-b", visibility: "hide", priority: 2 },
      { slug: "model-a", visibility: "none", priority: 1 },
    ]);

    expect(models).toEqual(["model-a", "model-b"]);
  });
});
