import type { ChatMessage } from "../types";

export interface LLMStrategy {
  readonly name: string;
  sendMessage(
    messages: ChatMessage[],
    onChunk: (chunk: string) => void,
    signal?: AbortSignal,
  ): Promise<string>;
  validateConfig(): string | null;
}
