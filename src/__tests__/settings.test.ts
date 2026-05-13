import { describe, expect, it } from "vitest";
import type { ObsidianAIChatSettings } from "../types.ts";
import { resolveSettings } from "../utils/settings.ts";

describe("settings resolution", () => {
  it("migrates the legacy OCR model into the Mistral model setting", () => {
    const settings = resolveSettings({
      ocrModel: "mistral/mistral-ocr-latest",
    });

    expect(settings.pdf.mistralModel).toBe("mistral-ocr-latest");
  });

  it("preserves explicit Mistral settings over legacy OCR config", () => {
    const settings = resolveSettings({
      ocrModel: "mistral/legacy-model",
      pdf: {
        mistralApiKey: "key",
        mistralModel: "custom-mistral-model",
        bibAttachmentRoot: " /tmp/pdfs ",
      },
    });

    expect(settings.pdf.mistralModel).toBe("custom-mistral-model");
    expect(settings.pdf.mistralApiKey).toBe("key");
    expect(settings.pdf.bibAttachmentRoot).toBe("/tmp/pdfs");
  });

  it("migrates legacy chat sessions to note-aware shape", () => {
    const settings = resolveSettings({
      chatSessions: [
        {
          id: "session-1",
          title: "Legacy",
          messages: [],
          createdAt: 100,
        },
      ],
    } as unknown as Partial<ObsidianAIChatSettings>);

    expect(settings.chatSessions).toEqual([
      {
        id: "session-1",
        title: "Legacy",
        messages: [],
        createdAt: 100,
        notePath: null,
        lastInteractedAt: 100,
      },
    ]);
  });
});
