import type { ChatMessage, MCPCallEvent } from "../types";

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
    onMCPCall?: (call: MCPCallEvent) => void,
    signal?: AbortSignal,
  ): Promise<string>;
  validateConfig(signal?: AbortSignal): Promise<string | null>;
}
