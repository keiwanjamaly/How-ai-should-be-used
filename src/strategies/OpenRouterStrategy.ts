import { ChatRole, type ChatMessage, type OpenRouterSettings } from "../types";
import type { LLMStrategy, ToolCall } from "./LLMStrategy";
import { parseSSEStream } from "../utils/sseParser";
import type { MCPTool, MCPToolResult } from "../types/mcp";

interface OpenRouterErrorResponse {
  choices?: Array<{
    message?: {
      content?: string;
      tool_calls?: RawToolCall[];
    };
    finish_reason?: string;
  }>;
  error?: {
    message?: string;
  };
}

interface OpenRouterFunction {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: unknown;
  };
}

/** Raw streaming tool call delta as sent by OpenRouter/OpenAI */
interface RawToolCall {
  index?: number;
  id?: string;
  type?: "function";
  function?: {
    name?: string;
    arguments?: string;
  };
}

export class OpenRouterStrategy implements LLMStrategy {
  public readonly name = "OpenRouter";

  private readonly endpoint = "https://openrouter.ai/api/v1/chat/completions";

  constructor(
    private readonly config: OpenRouterSettings,
    private readonly mcpTools: MCPTool[] = [],
    private readonly executeTool?: (toolName: string, args: unknown) => Promise<MCPToolResult>,
  ) {}

  validateConfig(): string | null {
    if (!this.config.apiKey.trim()) {
      return "OpenRouter API key is missing. Set it in plugin settings.";
    }

    if (!this.config.model.trim()) {
      return "OpenRouter model is missing. Set it in plugin settings.";
    }

    return null;
  }

  /**
   * Convert MCP tools to OpenRouter function format
   */
  private getTools(): OpenRouterFunction[] | undefined {
    if (this.mcpTools.length === 0) {
      return undefined;
    }

    return this.mcpTools.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description || `Execute ${tool.name}`,
        parameters: tool.inputSchema || { type: "object", properties: {} },
      },
    }));
  }

  async sendMessage(
    messages: ChatMessage[],
    onChunk: (chunk: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    const tools = this.getTools();
    const maxToolCalls = 10; // Prevent infinite loops
    let toolCallCount = 0;
    let finalContent = "";

    // Make a copy of messages that we can modify
    let currentMessages = [...messages];

    while (toolCallCount < maxToolCalls) {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: currentMessages,
          stream: true,
          tools,
          tool_choice: tools ? "auto" : undefined,
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
        const rawToolCalls = json.choices?.[0]?.message?.tool_calls;

        if (rawToolCalls && rawToolCalls.length > 0 && this.executeTool) {
          const assembled = this.assembleToolCalls(rawToolCalls);
          if (assembled.length > 0) {
            currentMessages = await this.handleToolCalls(currentMessages, assembled);
            toolCallCount += assembled.length;
            continue;
          }
        }

        if (content) {
          onChunk(content);
          finalContent = content;
        }
        break;
      }

      // Handle streaming response.
      // Tool call arguments arrive as partial string deltas spread across many
      // SSE chunks. We accumulate them by index, then assemble + parse once the
      // stream is done.
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let completeContent = "";

      // Accumulator: index → partial raw tool call
      const rawAccumulator: Record<number, {
        id: string;
        type: "function";
        name: string;
        argumentsStr: string;
      }> = {};

      await parseSSEStream(
        reader,
        decoder,
        (payload) => {
          let parsed: {
            choices?: Array<{
              delta?: {
                content?: string;
                tool_calls?: RawToolCall[];
              };
            }>;
            error?: { message?: string };
          };

          try {
            parsed = JSON.parse(payload);
          } catch {
            return; // skip non-JSON chunks
          }

          if (parsed.error?.message) {
            throw new Error(parsed.error.message);
          }

          const delta = parsed.choices?.[0]?.delta;
          if (!delta) return;

          if (delta.content) {
            completeContent += delta.content;
            onChunk(delta.content);
          }

          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!rawAccumulator[idx]) {
                rawAccumulator[idx] = {
                  id: tc.id ?? "",
                  type: "function",
                  name: tc.function?.name ?? "",
                  argumentsStr: "",
                };
              }
              // id and name only arrive in the first delta for each index
              if (tc.id) rawAccumulator[idx].id = tc.id;
              if (tc.function?.name) rawAccumulator[idx].name = tc.function.name;
              if (tc.function?.arguments) {
                rawAccumulator[idx].argumentsStr += tc.function.arguments;
              }
            }
          }
        },
        signal,
      );

      // Convert accumulated raw tool calls into ToolCall objects
      const toolCalls: ToolCall[] = Object.values(rawAccumulator)
        .filter((tc) => tc.name) // must have at least a name
        .map((tc) => {
          let args: unknown;
          try {
            args = tc.argumentsStr ? JSON.parse(tc.argumentsStr) : {};
          } catch {
            args = {};
          }
          return {
            id: tc.id || `tool_${Math.random().toString(36).slice(2)}`,
            type: "function" as const,
            function: {
              name: tc.name,
              arguments: args,
            },
          };
        });

      if (toolCalls.length > 0 && this.executeTool) {
        currentMessages = await this.handleToolCalls(currentMessages, toolCalls);
        toolCallCount += toolCalls.length;
        finalContent = completeContent;
        continue;
      }

      // No tool calls, we're done
      finalContent = completeContent;
      break;
    }

    return finalContent;
  }

  /**
   * Assemble complete ToolCall objects from raw (non-streaming) tool call data.
   * Arguments in non-streaming responses are already a complete JSON string.
   */
  private assembleToolCalls(raw: RawToolCall[]): ToolCall[] {
    return raw
      .filter((tc) => tc.function?.name)
      .map((tc, i) => {
        let args: unknown;
        try {
          args = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {};
        } catch {
          args = {};
        }
        return {
          id: tc.id ?? `tool_${i}`,
          type: "function" as const,
          function: {
            name: tc.function!.name!,
            arguments: args,
          },
        };
      });
  }

  /**
   * Handle tool calls and update the message history
   */
  private async handleToolCalls(
    messages: ChatMessage[],
    toolCalls: ToolCall[],
  ): Promise<ChatMessage[]> {
    if (!this.executeTool) {
      return messages;
    }

    // Add the assistant's message with tool_calls in OpenAI format
    const updatedMessages = [...messages];
    updatedMessages.push({
      role: ChatRole.Assistant,
      content: "",
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: {
          name: tc.function.name,
          arguments: typeof tc.function.arguments === "string"
            ? tc.function.arguments
            : JSON.stringify(tc.function.arguments),
        },
      })),
    });

    // Execute each tool and add results as role:"tool" messages
    for (const toolCall of toolCalls) {
      try {
        const result = await this.executeTool(toolCall.function.name, toolCall.function.arguments);

        updatedMessages.push({
          role: ChatRole.Tool,
          tool_call_id: toolCall.id,
          content: result.success ? (result.content ?? "") : `Error: ${result.error}`,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updatedMessages.push({
          role: ChatRole.Tool,
          tool_call_id: toolCall.id,
          content: `Error: ${message}`,
        });
      }
    }

    return updatedMessages;
  }
}
