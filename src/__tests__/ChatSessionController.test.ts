import { describe, expect, it, vi } from "vitest";
import { ChatRole, type ObsidianAIChatSettings } from "../types.ts";
import { DEFAULT_MCP_SETTINGS } from "../types/mcp.ts";
import { ChatSessionController } from "../views/chat/ChatSessionController.ts";

function createSettings(): ObsidianAIChatSettings {
  return {
    provider: "openrouter",
    openRouter: { apiKey: "", model: "model" },
    chatgpt: { cliPath: "codex", model: "gpt-5", favoriteModels: ["gpt-5"] },
    pdf: { mistralApiKey: "", mistralModel: "ocr", bibAttachmentRoot: "" },
    vaultRAG: {
      enabled: false,
      maxChunks: 6,
      chunkSize: 1200,
      maxFileSizeKB: 300,
      embeddingModel: "embed",
      includeExtensions: [".md"],
    },
    systemPrompt: "",
    mcp: DEFAULT_MCP_SETTINGS,
    chatSessions: [],
    activeSessionId: null,
    favoriteModels: [],
  };
}

describe("ChatSessionController", () => {
  it("saves a new session and restores it as active", async () => {
    const settings = createSettings();
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    const controller = new ChatSessionController({
      getSettings: () => settings,
      saveSettings,
    });

    const sessionId = await controller.save([
      { role: ChatRole.User, content: "First question" },
      { role: ChatRole.Assistant, content: "Answer" },
    ], null);

    expect(sessionId).toBeTruthy();
    expect(settings.chatSessions).toHaveLength(1);
    expect(settings.activeSessionId).toBe(sessionId);
    expect(controller.restoreLast()?.id).toBe(sessionId);
    expect(saveSettings).toHaveBeenCalled();
  });

  it("updates an existing session instead of creating a second one", async () => {
    const settings = createSettings();
    const controller = new ChatSessionController({
      getSettings: () => settings,
      saveSettings: vi.fn().mockResolvedValue(undefined),
    });

    const sessionId = await controller.save([
      { role: ChatRole.User, content: "Original" },
    ], null);

    await controller.save([
      { role: ChatRole.User, content: "Updated" },
    ], sessionId);

    expect(settings.chatSessions).toHaveLength(1);
    expect(settings.chatSessions[0]?.messages[0]?.content).toBe("Updated");
  });

  it("limits stored sessions to 50", async () => {
    const settings = createSettings();
    const controller = new ChatSessionController({
      getSettings: () => settings,
      saveSettings: vi.fn().mockResolvedValue(undefined),
    });

    let currentId: string | null = null;
    for (let index = 0; index < 55; index += 1) {
      currentId = await controller.save([
        { role: ChatRole.User, content: `Question ${index}` },
      ], null);
      expect(currentId).toBeTruthy();
    }

    expect(settings.chatSessions).toHaveLength(50);
  });
});
