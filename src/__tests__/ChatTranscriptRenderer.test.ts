import { describe, expect, it } from "vitest";
import { normalizeMathDelimiters } from "../views/chat/ChatTranscriptRenderer.ts";

describe("ChatTranscriptRenderer helpers", () => {
  it("normalizes LaTeX delimiters for markdown rendering", () => {
    expect(normalizeMathDelimiters("\\(x+y\\) and \\[a+b\\]")).toBe("$x+y$ and $$\na+b\n$$");
  });
});
