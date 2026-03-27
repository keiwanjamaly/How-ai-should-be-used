import type { ChatMessage, OpenRouterSettings } from "../types";
import type { LLMStrategy } from "./LLMStrategy";
import { parseSSEStream, parseOpenAIStreamChunk } from "../utils/sseParser";

interface OpenRouterErrorResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
}

export class OpenRouterStrategy implements LLMStrategy {
  public readonly name = "OpenRouter";

  private readonly endpoint = "https://openrouter.ai/api/v1/chat/completions";

  constructor(private readonly config: OpenRouterSettings) {}

  validateConfig(): string | null {
    if (!this.config.apiKey.trim()) {
      return "OpenRouter API key is missing. Set it in plugin settings.";
    }

    if (!this.config.model.trim()) {
      return "OpenRouter model is missing. Set it in plugin settings.";
    }

    return null;
  }

  async sendMessage(
    messages: ChatMessage[],
    onChunk: (chunk: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.config.model,
        messages,
        stream: true,
      }),
      signal,
    });

    if (!response.ok) {
      let message = `OpenRouter request failed (${response.status})`;

      try {
        const errorJson = (await response.json()) as OpenRouterErrorResponse;
        if (errorJson.error?.message) {
          message = errorJson.error.message;
        }
      } catch {
        // Ignore JSON parse errors and keep generic HTTP error message.
      }

      throw new Error(message);
    }

    if (!response.body) {
      // Fallback for non-streaming response
      const json = (await response.json()) as OpenRouterErrorResponse;
      const content = json.choices?.[0]?.message?.content ?? "";
      if (content) {
        onChunk(content);
      }
      return content;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let complete = "";

    await parseSSEStream(
      reader,
      decoder,
      (payload) => {
        const { content, error } = parseOpenAIStreamChunk(payload);
        if (error) {
          throw new Error(error);
        }
        if (content) {
          complete += content;
          onChunk(content);
        }
      },
      signal,
    );

    return complete;
  }
}
