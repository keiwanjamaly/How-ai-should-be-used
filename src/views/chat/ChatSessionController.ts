import type { ChatMessage, ChatSession, ObsidianAIChatSettings } from "../../types";
import { ChatRole } from "../../types";

export interface ChatSessionControllerOptions {
  getSettings: () => ObsidianAIChatSettings;
  saveSettings: () => Promise<void>;
}

export class ChatSessionController {
  constructor(private readonly options: ChatSessionControllerOptions) {}

  private sortSessions(
    sessions: ChatSession[],
    preferredNotePath: string | null = null,
  ): ChatSession[] {
    return [...sessions].sort((left, right) => {
      if (preferredNotePath) {
        const leftPreferred = left.notePath === preferredNotePath;
        const rightPreferred = right.notePath === preferredNotePath;
        if (leftPreferred !== rightPreferred) {
          return leftPreferred ? -1 : 1;
        }
      }

      return right.lastInteractedAt - left.lastInteractedAt;
    });
  }

  private upsertSession(settings: ObsidianAIChatSettings, session: ChatSession): void {
    const index = settings.chatSessions.findIndex((entry) => entry.id === session.id);
    if (index >= 0) {
      settings.chatSessions.splice(index, 1);
    }
    settings.chatSessions.unshift(session);
  }

  generateSessionTitle(messages: ChatMessage[]): string {
    const firstUser = messages.find((message) => message.role === ChatRole.User);
    if (!firstUser) {
      return "New chat";
    }

    const text = firstUser.content.trim().replace(/\n/g, " ");
    return text.length > 40 ? `${text.slice(0, 40)}…` : text;
  }

  async save(
    messages: ChatMessage[],
    currentSessionId: string | null,
    notePath: string | null,
  ): Promise<string | null> {
    const toSave = messages.filter((message) => message.role !== ChatRole.System);
    if (toSave.length === 0) {
      return currentSessionId;
    }

    const settings = this.options.getSettings();
    const title = this.generateSessionTitle(toSave);
    const now = Date.now();
    const existing = currentSessionId
      ? settings.chatSessions.find((session) => session.id === currentSessionId)
      : null;

    if (existing) {
      existing.messages = toSave;
      existing.title = title;
      existing.notePath = notePath;
      existing.lastInteractedAt = now;
    } else {
      const session: ChatSession = {
        id: crypto.randomUUID(),
        title,
        messages: toSave,
        createdAt: now,
        notePath,
        lastInteractedAt: now,
      };
      this.upsertSession(settings, session);
      currentSessionId = session.id;
    }

    if (existing) {
      this.upsertSession(settings, existing);
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

    session.lastInteractedAt = Date.now();
    this.upsertSession(settings, session);
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

  restoreLastForNote(notePath: string | null): ChatSession | null {
    const settings = this.options.getSettings();
    if (!notePath) {
      return this.restoreLast();
    }

    return this.sortSessions(settings.chatSessions, notePath)
      .find((entry) => entry.notePath === notePath) ?? null;
  }

  getSession(id: string): ChatSession | null {
    return this.options.getSettings().chatSessions.find((entry) => entry.id === id) ?? null;
  }

  getSessions(preferredNotePath: string | null = null): ChatSession[] {
    return this.sortSessions(this.options.getSettings().chatSessions, preferredNotePath);
  }

  async remapNotePath(oldPath: string, newPath: string): Promise<void> {
    const settings = this.options.getSettings();
    let changed = false;
    for (const session of settings.chatSessions) {
      if (session.notePath === oldPath) {
        session.notePath = newPath;
        changed = true;
      }
    }

    if (changed) {
      await this.options.saveSettings();
    }
  }
}
