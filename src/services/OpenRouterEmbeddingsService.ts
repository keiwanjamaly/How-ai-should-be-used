import type { OpenRouterSettings } from "../types";

interface OpenRouterEmbeddingsResponse {
  data?: Array<{
    embedding?: number[];
  }>;
  error?: {
    message?: string;
  };
}

export class OpenRouterEmbeddingsService {
  private readonly endpoint = "https://openrouter.ai/api/v1/embeddings";

  async createEmbeddings(
    config: OpenRouterSettings,
    model: string,
    input: string[],
    signal?: AbortSignal,
  ): Promise<Float32Array[]> {
    if (!config.apiKey.trim()) {
      throw new Error("OpenRouter API key is missing. Vault embeddings require an OpenRouter key.");
    }

    if (!model.trim()) {
      throw new Error("Vault embedding model is missing.");
    }

    if (input.length === 0) {
      return [];
    }

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input,
        encoding_format: "float",
      }),
      signal,
    });

    if (!response.ok) {
      let message = `OpenRouter embeddings request failed (${response.status})`;

      try {
        const errorJson = (await response.json()) as OpenRouterEmbeddingsResponse;
        if (errorJson.error?.message) {
          message = errorJson.error.message;
        }
      } catch {
        // Ignore JSON parse errors and keep the generic error.
      }

      throw new Error(message);
    }

    const json = (await response.json()) as OpenRouterEmbeddingsResponse;
    const embeddings = json.data?.map((entry) => new Float32Array(entry.embedding ?? [])) ?? [];
    if (embeddings.length !== input.length || embeddings.some((embedding) => embedding.length === 0)) {
      throw new Error("OpenRouter embeddings response was incomplete.");
    }

    return embeddings;
  }
}
