import type { ObsidianAIChatSettings } from "../types";

interface MistralOCRResponse {
  pages?: Array<{
    markdown?: string | null;
  }>;
}

export interface ExtractedPDFContent {
  filename: string;
  text: string;
}

export function encodeArrayBufferAsBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function readMistralContent(json: MistralOCRResponse): string {
  return (json.pages ?? [])
    .map((page) => page.markdown?.trim() ?? "")
    .filter((page) => page.length > 0)
    .join("\n\n");
}

export class PDFExtractionService {
  constructor(
    private readonly getSettings: () => ObsidianAIChatSettings,
  ) {}

  supportsUpload(): boolean {
    return this.getAvailabilityError() === null;
  }

  getAvailabilityError(): string | null {
    const settings = this.getSettings();
    if (!settings.pdf.mistralApiKey.trim()) {
      return "Mistral API key is required for PDF OCR.";
    }

    return null;
  }

  async extract(file: File): Promise<ExtractedPDFContent> {
    return this.extractBuffer(file.name, await file.arrayBuffer());
  }

  async extractBuffer(filename: string, buffer: ArrayBuffer): Promise<ExtractedPDFContent> {
    const availabilityError = this.getAvailabilityError();
    if (availabilityError) {
      throw new Error(availabilityError);
    }

    const base64 = encodeArrayBufferAsBase64(buffer);
    const text = await this.extractViaMistral(base64);

    if (!text) {
      throw new Error("Mistral OCR returned empty content.");
    }

    return {
      filename,
      text,
    };
  }

  private async extractViaMistral(base64: string): Promise<string> {
    const settings = this.getSettings();
    const response = await fetch("https://api.mistral.ai/v1/ocr", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.pdf.mistralApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: settings.pdf.mistralModel,
        document: {
          type: "document_url",
          document_url: `data:application/pdf;base64,${base64}`,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Mistral OCR request failed (${response.status})`);
    }

    return readMistralContent(await response.json() as MistralOCRResponse);
  }
}
