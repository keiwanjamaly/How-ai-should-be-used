import type { ChatMessage, MCPCallEvent, OpenRouterSettings } from "../types";
import { ChatRole } from "../types";
import type { LLMStrategy } from "./LLMStrategy";
import type { MCPTool, MCPToolResult } from "../types/mcp";
import { parseSSEStream } from "../utils/sseParser";

interface OpenRouterErrorResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id?: string;
        type?: "function";
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
  }>;
  error?: {
    message?: string;
  };
}

interface OpenRouterToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

interface OpenRouterToolCall {
  id?: string;
  type?: "function";
  function?: {
    name?: string;
    arguments?: string;
  };
}

const MAX_TOOL_ROUNDS = 8;

export class OpenRouterStrategy implements LLMStrategy {
  public readonly name = "OpenRouter";

  private readonly endpoint = "https://openrouter.ai/api/v1/chat/completions";

  constructor(
    private readonly config: OpenRouterSettings,
    private readonly mcpTools: MCPTool[] = [],
    private readonly executeTool?: (toolName: string, args: unknown) => Promise<unknown>,
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

  async sendMessage(
    messages: ChatMessage[],
    onChunk: (chunk: string) => void,
    onMCPCall?: (call: MCPCallEvent) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    if (this.mcpTools.length > 0 && this.executeTool) {
      return this.sendMessageWithTools(messages, onChunk, onMCPCall, signal);
    }

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(this.buildRequestBody(messages)),
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
      return this.handleNonStreamingResponse(response, onChunk);
    }

    return this.handleStreamingResponse(response, onChunk, signal);
  }

  private buildRequestBody(messages: ChatMessage[]): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: this.serializeMessages(messages),
      stream: true,
    };

    const tools = this.buildToolDefinitions();
    if (tools.length > 0) {
      body.tools = tools;
    }

    return body;
  }

  private buildNonStreamingRequestBody(messages: ChatMessage[]): Record<string, unknown> {
    return {
      ...this.buildRequestBody(messages),
      stream: false,
    };
  }

  private serializeMessages(messages: ChatMessage[]): Array<Record<string, unknown>> {
    return messages.map((message) => {
      const serialized: Record<string, unknown> = {
        role: message.role,
        content: message.content,
      };

      if (message.tool_calls?.length) {
        serialized.tool_calls = message.tool_calls;
      }

      if (message.tool_call_id) {
        serialized.tool_call_id = message.tool_call_id;
      }

      return serialized;
    });
  }

  private buildToolDefinitions(): OpenRouterToolDefinition[] {
    return this.mcpTools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: this.normalizeInputSchema(tool.inputSchema),
      },
    }));
  }

  private normalizeInputSchema(inputSchema: unknown): Record<string, unknown> {
    if (typeof inputSchema === "object" && inputSchema !== null && !Array.isArray(inputSchema)) {
      return inputSchema as Record<string, unknown>;
    }

    return {
      type: "object",
      properties: {},
    };
  }

  private async sendMessageWithTools(
    messages: ChatMessage[],
    onChunk: (chunk: string) => void,
    onMCPCall?: (call: MCPCallEvent) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    const conversation = [...messages];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(this.buildNonStreamingRequestBody(conversation)),
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

      const json = (await response.json()) as OpenRouterErrorResponse;
      const assistantMessage = json.choices?.[0]?.message;
      const content = assistantMessage?.content ?? "";
      const toolCalls = this.extractToolCalls(assistantMessage?.tool_calls);

      if (toolCalls.length === 0) {
        if (content) {
          onChunk(content);
        }
        return content;
      }

      conversation.push({
        role: ChatRole.Assistant,
        content,
        tool_calls: toolCalls,
      });

      for (const toolCall of toolCalls) {
        const toolResult = await this.executeSingleToolCall(toolCall);
        const mcpCall = toolResult.mcpCalls?.[0];
        if (mcpCall && onMCPCall) {
          onMCPCall(mcpCall);
        }
        conversation.push(toolResult);
      }
    }

    throw new Error("Model exceeded MCP tool call limit");
  }

  private async handleNonStreamingResponse(
    response: Response,
    onChunk: (chunk: string) => void,
  ): Promise<string> {
    const json = (await response.json()) as OpenRouterErrorResponse;
    const content = json.choices?.[0]?.message?.content ?? "";
    if (content) {
      onChunk(content);
    }
    return content;
  }

  private extractToolCalls(
    toolCalls?: OpenRouterToolCall[],
  ): NonNullable<ChatMessage["tool_calls"]> {
    if (!Array.isArray(toolCalls)) {
      return [];
    }

    return toolCalls
      .filter((toolCall) => toolCall?.type === "function" && toolCall.id && toolCall.function?.name)
      .map((toolCall) => ({
        id: toolCall.id!,
        type: "function" as const,
        function: {
          name: toolCall.function!.name!,
          arguments: toolCall.function?.arguments ?? "{}",
        },
      }));
  }

  private async executeSingleToolCall(
    toolCall: NonNullable<ChatMessage["tool_calls"]>[number],
  ): Promise<ChatMessage> {
    let args: unknown = {};

    try {
      args = toolCall.function.arguments ? JSON.parse(toolCall.function.arguments) : {};
    } catch {
      return {
        role: ChatRole.Tool,
        tool_call_id: toolCall.id,
        content: "Invalid tool arguments JSON",
        mcpCalls: [{
          serverName: "unknown",
          toolName: toolCall.function.name,
          qualifiedToolName: toolCall.function.name,
          argumentsText: toolCall.function.arguments ?? "{}",
          durationMs: 0,
          startedAt: Date.now(),
          success: false,
          errorText: "Invalid tool arguments JSON",
        }],
      };
    }

    try {
      const result = await this.executeTool?.(toolCall.function.name, args) as MCPToolResult | undefined;
      const content = this.stringifyToolResult(result);
      return {
        role: ChatRole.Tool,
        tool_call_id: toolCall.id,
        content,
        mcpCalls: result?.call ? [result.call] : undefined,
      };
    } catch (error) {
      return {
        role: ChatRole.Tool,
        tool_call_id: toolCall.id,
        content: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private stringifyToolResult(result: unknown): string {
    if (this.isMCPToolResult(result)) {
      if (result.success) {
        return result.content ?? "";
      }
      return result.error ?? "";
    }

    if (typeof result === "string") {
      return result;
    }

    if (result === null || result === undefined) {
      return "";
    }

    try {
      return JSON.stringify(result);
    } catch {
      return String(result);
    }
  }

  private async handleStreamingResponse(
    response: Response,
    onChunk: (chunk: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let complete = "";

    await parseSSEStream(
      reader,
      decoder,
      (payload) => {
        try {
          const parsed = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
            error?: { message?: string };
          };
          if (parsed.error?.message) {
            throw new Error(parsed.error.message);
          }
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            complete += content;
            onChunk(content);
          }
        } catch (e) {
          if (e instanceof Error && e.message !== "Unexpected end of JSON input") {
            throw e;
          }
          // Invalid JSON — skip this chunk
        }
      },
      signal,
    );

    return complete;
  }

  private isMCPToolResult(result: unknown): result is MCPToolResult {
    return typeof result === "object" && result !== null && "success" in result;
  }
}
