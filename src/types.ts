import type { MCPSettings } from "./types/mcp";
import { DEFAULT_MCP_SETTINGS } from "./types/mcp";

export enum ChatRole {
  System = "system",
  User = "user",
  Assistant = "assistant",
  Tool = "tool",
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

export interface OpenRouterSettings {
  apiKey: string;
  model: string;
}

export interface ObsidianAIChatSettings {
  openRouter: OpenRouterSettings;
  systemPrompt: string;
  mcp: MCPSettings;
}

export const DEFAULT_SETTINGS: ObsidianAIChatSettings = {
  openRouter: {
    apiKey: "",
    model: "openai/gpt-4o-mini",
  },
  systemPrompt: "",
  mcp: DEFAULT_MCP_SETTINGS,
};
