import { describe, expect, it } from "vitest";
import {
  buildCodexEditInstruction,
  parseCodexEditEnvelope,
} from "../services/InternalToolProtocol.ts";

describe("Internal tool protocol", () => {
  it("parses a valid note replacement envelope", () => {
    const envelope = parseCodexEditEnvelope(
      JSON.stringify({
        type: "active_note_replacement",
        message: "Prepared a checklist version.",
        proposedContent: "# Title\n\n- [ ] Item",
      }),
    );

    expect(envelope).toEqual({
      type: "active_note_replacement",
      message: "Prepared a checklist version.",
      proposedContent: "# Title\n\n- [ ] Item",
    });
  });

  it("parses a valid selection replacement envelope", () => {
    const envelope = parseCodexEditEnvelope(
      JSON.stringify({
        type: "active_selection_replacement",
        message: "Replace the selected heading.",
        replacement: "## New heading",
      }),
    );

    expect(envelope).toEqual({
      type: "active_selection_replacement",
      message: "Replace the selected heading.",
      replacement: "## New heading",
    });
  });

  it("rejects markdown-wrapped JSON", () => {
    const envelope = parseCodexEditEnvelope(
      "```json\n{\"type\":\"active_note_replacement\",\"message\":\"x\",\"proposedContent\":\"y\"}\n```",
    );

    expect(envelope).toBeNull();
  });

  it("builds the codex edit instruction", () => {
    const instruction = buildCodexEditInstruction();

    expect(instruction).toContain("conversational assistant inside Obsidian");
    expect(instruction).toContain("active_note_replacement");
    expect(instruction).toContain("propose_active_note_replacement");
    expect(instruction).toContain("active_selection_replacement");
    expect(instruction).toContain("never return the JSON envelope");
  });
});
