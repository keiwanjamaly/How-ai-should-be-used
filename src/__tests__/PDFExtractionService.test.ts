import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type ObsidianAIChatSettings } from "../types.ts";
import { PDFExtractionService } from "../services/PDFExtractionService.ts";

function createSettings(
  overrides: Partial<ObsidianAIChatSettings> = {},
): ObsidianAIChatSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...overrides,
    openRouter: {
      ...DEFAULT_SETTINGS.openRouter,
      ...overrides.openRouter,
    },
    chatgpt: {
      ...DEFAULT_SETTINGS.chatgpt,
      ...overrides.chatgpt,
    },
    pdf: {
      ...DEFAULT_SETTINGS.pdf,
      ...overrides.pdf,
    },
    vaultRAG: {
      ...DEFAULT_SETTINGS.vaultRAG,
      ...overrides.vaultRAG,
    },
  };
}

function createFile(name: string, content: string): File {
  return {
    name,
    arrayBuffer: async () => new TextEncoder().encode(content).buffer,
  } as File;
}

beforeAll(() => {
  globalThis.btoa ??= ((value: string) => Buffer.from(value, "binary").toString("base64"));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PDFExtractionService", () => {
  it("requires a Mistral API key", () => {
    const service = new PDFExtractionService(() => createSettings({
      pdf: {
        ...DEFAULT_SETTINGS.pdf,
        mistralApiKey: "",
      },
    }));

    expect(service.supportsUpload()).toBe(false);
    expect(service.getAvailabilityError()).toContain("Mistral API key");
  });

  it("sends PDFs to Mistral and joins page markdown", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        pages: [
          { markdown: "# Page 1" },
          { markdown: "Page 2" },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const service = new PDFExtractionService(() => createSettings({
      pdf: {
        ...DEFAULT_SETTINGS.pdf,
        mistralApiKey: "mistral-test-key",
        mistralModel: "mistral-ocr-latest",
      },
    }));

    const result = await service.extract(createFile("scan.pdf", "pdf-body"));

    expect(result).toEqual({
      filename: "scan.pdf",
      text: "# Page 1\n\nPage 2",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.mistral.ai/v1/ocr",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer mistral-test-key",
        }),
      }),
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      model: string;
      document: { type: string; document_url: string };
    };
    expect(body.model).toBe("mistral-ocr-latest");
    expect(body.document.type).toBe("document_url");
    expect(body.document.document_url.startsWith("data:application/pdf;base64,")).toBe(true);
  });

  it("extracts from a raw buffer for local PDFs", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        pages: [{ markdown: "Buffer page" }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const service = new PDFExtractionService(() => createSettings({
      pdf: {
        ...DEFAULT_SETTINGS.pdf,
        mistralApiKey: "mistral-test-key",
      },
    }));

    const result = await service.extractBuffer(
      "local.pdf",
      new TextEncoder().encode("pdf-body").buffer,
    );

    expect(result).toEqual({
      filename: "local.pdf",
      text: "Buffer page",
    });
  });
});
