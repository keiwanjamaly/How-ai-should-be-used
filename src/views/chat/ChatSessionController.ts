import type { ChatMessage, ChatSession, ObsidianAIChatSettings } from "../../types";
import { ChatRole } from "../../types";

export interface ChatSessionControllerOptions {
  getSettings: () => ObsidianAIChatSettings;
  saveSettings: () => Promise<void>;
}

export class ChatSessionController {
  constructor(private readonly options: ChatSessionControllerOptions) {}

  generateSessionTitle(messages: ChatMessage[]): string {
    const firstUser = messages.find((message) => message.role === ChatRole.User);
    if (!firstUser) {
      return "New chat";
    }

    const text = firstUser.content.trim().replace(/\n/g, " ");
    return text.length > 40 ? `${text.slice(0, 40)}…` : text;
  }

  async save(messages: ChatMessage[], currentSessionId: string | null): Promise<string | null> {
    const toSave = messages.filter((message) => message.role !== ChatRole.System);
    if (toSave.length === 0) {
      return currentSessionId;
    }

    const settings = this.options.getSettings();
    const title = this.generateSessionTitle(toSave);
    const existing = currentSessionId
      ? settings.chatSessions.find((session) => session.id === currentSessionId)
      : null;

    if (existing) {
      existing.messages = toSave;
      existing.title = title;
    } else {
      const session: ChatSession = {
        id: crypto.randomUUID(),
        title,
        messages: toSave,
        createdAt: Date.now(),
      };
      settings.chatSessions.unshift(session);
      currentSessionId = session.id;
    }

    if (settings.chatSessions.length > 50) {
      settings.chatSessions.splice(50);
    }

    settings.activeSessionId = currentSessionId;
    await this.options.saveSettings();
    return currentSessionId;
  }

  async load(id: string): Promise<ChatSession | null> {
    const settings = this.options.getSettings();
    const session = settings.chatSessions.find((entry) => entry.id === id) ?? null;
    if (!session) {
      return null;
    }

    settings.activeSessionId = id;
    await this.options.saveSettings();
    return session;
  }

  async clearActiveSession(): Promise<void> {
    const settings = this.options.getSettings();
    settings.activeSessionId = null;
    await this.options.saveSettings();
  }

  restoreLast(): ChatSession | null {
    const settings = this.options.getSettings();
    if (!settings.activeSessionId) {
      return null;
    }

    return settings.chatSessions.find((entry) => entry.id === settings.activeSessionId) ?? null;
  }

  getSessions(): ChatSession[] {
    return this.options.getSettings().chatSessions;
  }
}
