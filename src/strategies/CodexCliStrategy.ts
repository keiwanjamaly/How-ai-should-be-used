import type { ChatGPTSettings, ChatMessage } from "../types";
import type { MCPCallEvent } from "../types";
import { getCodexLoginStatus, runCodexExec } from "../services/CodexCli";
import type { MCPServers } from "../types/mcp";
import type { LLMStrategy } from "./LLMStrategy";

export class CodexCliStrategy implements LLMStrategy {
  public readonly name = "ChatGPT";

  constructor(
    private readonly config: ChatGPTSettings,
    private readonly mcpServers: MCPServers = {},
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
    _onMCPCall?: (call: MCPCallEvent) => void,
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

    onChunk(response);
    return response;
  }

  private serializeMessages(messages: ChatMessage[]): string {
    return messages
      .map((message) => {
        const role = message.role.toUpperCase();
        return `${role}:\n${message.content}`;
      })
      .join("\n\n");
  }
}
