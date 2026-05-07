import type { ChatMessage } from "../types";
import type { ToolExecutionEvent } from "../types/tools";

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
    onToolEvent?: (call: ToolExecutionEvent) => void,
    signal?: AbortSignal,
  ): Promise<string>;
  validateConfig(signal?: AbortSignal): Promise<string | null>;
}
