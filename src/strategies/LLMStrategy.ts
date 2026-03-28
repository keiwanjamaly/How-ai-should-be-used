import type { ChatMessage } from "../types";

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: unknown;
  };
}

export interface LLMStrategy {
  readonly name: string;
  sendMessage(
    messages: ChatMessage[],
    onChunk: (chunk: string) => void,
    signal?: AbortSignal,
  ): Promise<string>;
  validateConfig(): string | null;
}
