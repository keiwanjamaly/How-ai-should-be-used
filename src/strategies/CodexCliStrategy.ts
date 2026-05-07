import type { ChatGPTSettings, ChatMessage } from "../types";
import { getCodexLoginStatus, runCodexExec } from "../services/CodexCli";
import type { InternalToolService } from "../services/InternalToolService";
import type { MCPServers } from "../types/mcp";
import type { ToolExecutionEvent } from "../types/tools";
import type { LLMStrategy } from "./LLMStrategy";

export class CodexCliStrategy implements LLMStrategy {
  public readonly name = "ChatGPT";

  constructor(
    private readonly config: ChatGPTSettings,
    private readonly mcpServers: MCPServers = {},
    private readonly internalToolService?: InternalToolService,
  ) {}

  async validateConfig(signal?: AbortSignal): Promise<string | null> {
    if (!this.config.cliPath.trim()) {
      return "ChatGPT/Codex CLI path is missing. Set it in plugin settings.";
    }

    try {
      const status = await getCodexLoginStatus(this.config.cliPath, signal);
      if (!status.isLoggedIn) {
        return `Codex CLI is not logged in: ${status.summary}`;
      }
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }

    return null;
  }

  async sendMessage(
    messages: ChatMessage[],
    onChunk: (chunk: string) => void,
    onToolEvent?: (call: ToolExecutionEvent) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    const prompt = this.serializeMessages(messages);
    const response = await runCodexExec({
      cliPath: this.config.cliPath,
      prompt,
      model: this.config.model,
      mcpServers: this.mcpServers,
      signal,
    });

    const structuredResponse = await this.internalToolService?.parseCodexEditResponse(response);
    if (structuredResponse) {
      if (structuredResponse.toolResult.call && onToolEvent) {
        onToolEvent(structuredResponse.toolResult.call);
      }
      onChunk(structuredResponse.message);
      return structuredResponse.message;
    }

    onChunk(response);
    return response;
  }

  private serializeMessages(messages: ChatMessage[]): string {
    const serializedMessages = messages
      .map((message) => {
        const role = message.role.toUpperCase();
        return `${role}:\n${message.content}`;
      });

    const instruction = this.internalToolService?.getCodexPromptInstruction().trim();
    if (instruction) {
      serializedMessages.unshift(`SYSTEM:\n${instruction}`);
    }

    return serializedMessages.join("\n\n");
  }
}
