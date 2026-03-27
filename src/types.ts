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

export interface ObsidianAIChatSettings {
  openRouter: OpenRouterSettings;
  systemPrompt: string;
}

export const DEFAULT_SETTINGS: ObsidianAIChatSettings = {
  openRouter: {
    apiKey: "",
    model: "openai/gpt-4o-mini",
  },
  systemPrompt: "",
};
