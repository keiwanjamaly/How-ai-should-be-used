import type { MCPSettings } from "./types/mcp";
import { DEFAULT_MCP_SETTINGS } from "./types/mcp";

export enum ChatRole {
  System = "system",
  User = "user",
  Assistant = "assistant",
  Tool = "tool",
}

export interface MCPCallEvent {
  serverName: string;
  toolName: string;
  qualifiedToolName: string;
  argumentsText: string;
  durationMs: number;
  startedAt: number;
  success: boolean;
  resultText?: string;
  errorText?: string;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  mcpCalls?: MCPCallEvent[];
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

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
}

export interface ObsidianAIChatSettings {
  openRouter: OpenRouterSettings;
  systemPrompt: string;
  mcp: MCPSettings;
  chatSessions: ChatSession[];
  activeSessionId: string | null;
  favoriteModels: string[];
  ocrModel: string;
}

export const DEFAULT_SETTINGS: ObsidianAIChatSettings = {
  openRouter: {
    apiKey: "",
    model: "openai/gpt-4o-mini",
  },
  systemPrompt: "",
  mcp: DEFAULT_MCP_SETTINGS,
  chatSessions: [],
  activeSessionId: null,
  favoriteModels: ["openai/gpt-4o-mini", "anthropic/claude-3.5-sonnet", "google/gemini-flash-1.5"],
  ocrModel: "mistral/mistral-ocr-latest",
};
