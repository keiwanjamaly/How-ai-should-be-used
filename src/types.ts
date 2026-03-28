export enum ChatRole {
  System = "system",
  User = "user",
  Assistant = "assistant",
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
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
  chatSessions: ChatSession[];
  activeSessionId: string | null;
}

export const DEFAULT_SETTINGS: ObsidianAIChatSettings = {
  openRouter: {
    apiKey: "",
    model: "openai/gpt-4o-mini",
  },
  systemPrompt: "",
  chatSessions: [],
  activeSessionId: null,
};
