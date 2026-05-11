import { DEFAULT_SETTINGS, type ObsidianAIChatSettings } from "../types";
import { normalizeExtensions } from "./vaultEmbeddings";

function normalizeLegacyMistralModel(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.startsWith("mistral/") ? trimmed.slice("mistral/".length) : trimmed;
}

export function resolveSettings(
  loaded: Partial<ObsidianAIChatSettings> & { ocrModel?: string } | null | undefined,
): ObsidianAIChatSettings {
  const legacyOCRModel = normalizeLegacyMistralModel(loaded?.ocrModel);
  const legacyOpenRouterModel = normalizeLegacyMistralModel(
    (loaded as { pdf?: { openRouterModel?: string } } | null | undefined)?.pdf?.openRouterModel,
  );

  return {
    ...DEFAULT_SETTINGS,
    ...loaded,
    openRouter: {
      ...DEFAULT_SETTINGS.openRouter,
      ...loaded?.openRouter,
    },
    chatgpt: {
      ...DEFAULT_SETTINGS.chatgpt,
      ...loaded?.chatgpt,
    },
    pdf: {
      ...DEFAULT_SETTINGS.pdf,
      ...loaded?.pdf,
      mistralApiKey: loaded?.pdf?.mistralApiKey?.trim() ?? DEFAULT_SETTINGS.pdf.mistralApiKey,
      mistralModel:
        loaded?.pdf?.mistralModel?.trim()
        || legacyOCRModel
        || legacyOpenRouterModel
        || DEFAULT_SETTINGS.pdf.mistralModel,
      bibAttachmentRoot:
        loaded?.pdf?.bibAttachmentRoot?.trim() ?? DEFAULT_SETTINGS.pdf.bibAttachmentRoot,
    },
    vaultRAG: {
      ...DEFAULT_SETTINGS.vaultRAG,
      ...loaded?.vaultRAG,
      embeddingModel:
        loaded?.vaultRAG?.embeddingModel?.trim() || DEFAULT_SETTINGS.vaultRAG.embeddingModel,
      includeExtensions: normalizeExtensions(
        loaded?.vaultRAG?.includeExtensions ?? DEFAULT_SETTINGS.vaultRAG.includeExtensions,
      ),
    },
    chatSessions: loaded?.chatSessions ?? DEFAULT_SETTINGS.chatSessions,
    activeSessionId: loaded?.activeSessionId ?? DEFAULT_SETTINGS.activeSessionId,
    favoriteModels: loaded?.favoriteModels ?? DEFAULT_SETTINGS.favoriteModels,
  };
}
