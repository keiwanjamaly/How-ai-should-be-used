import { readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { resolveCodexCliPath, runCodexCommand } from "./CodexCli";

interface CodexAuthFile {
  auth_mode?: string;
  tokens?: {
    access_token?: string;
    account_id?: string;
  };
}

interface CodexRemoteModel {
  slug?: string;
  visibility?: string;
  priority?: number;
}

interface CodexModelsCacheFile {
  client_version?: string;
  models?: CodexRemoteModel[];
}

interface CodexVersionFile {
  latest_version?: string;
}

export interface CodexModelsResult {
  models: string[];
  source: "remote" | "cache";
}

async function getRequestUrl(): Promise<(request: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  throw?: boolean;
}) => Promise<{ status: number; json: unknown }>> {
  const obsidian = await import("obsidian");
  return obsidian.requestUrl as (request: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    throw?: boolean;
  }) => Promise<{ status: number; json: unknown }>;
}

function getCodexHome(): string {
  return join(homedir(), ".codex");
}

function getAuthFilePath(): string {
  return join(getCodexHome(), "auth.json");
}

function getModelsCachePath(): string {
  return join(getCodexHome(), "models_cache.json");
}

function getVersionFilePath(): string {
  return join(getCodexHome(), "version.json");
}

async function readJsonFile<T>(path: string): Promise<T> {
  const content = await readFile(path, "utf8");
  return JSON.parse(content) as T;
}

function dedupeModels(models: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const model of models) {
    const trimmed = model.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    deduped.push(trimmed);
  }

  return deduped;
}

export function extractCodexPickerModels(models: CodexRemoteModel[]): string[] {
  const sorted = [...models].sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));
  const visible = sorted.filter((model) => model.visibility === "list");
  const source = visible.length > 0 ? visible : sorted;
  return dedupeModels(source.map((model) => model.slug ?? ""));
}

async function readCachedModels(): Promise<CodexModelsResult> {
  const cache = await readJsonFile<CodexModelsCacheFile>(getModelsCachePath());
  const models = extractCodexPickerModels(cache.models ?? []);
  if (models.length === 0) {
    throw new Error("Codex models cache is empty.");
  }

  return {
    models,
    source: "cache",
  };
}

function parseCodexCliVersion(output: string): string | null {
  const match = output.match(/(\d+\.\d+\.\d+)/);
  return match?.[1] ?? null;
}

async function getCodexClientVersion(cliPath: string): Promise<string> {
  try {
    const cache = await readJsonFile<CodexModelsCacheFile>(getModelsCachePath());
    if (cache.client_version?.trim()) {
      return cache.client_version.trim();
    }
  } catch {
    // Ignore missing or invalid cache files.
  }

  try {
    const result = await runCodexCommand(resolveCodexCliPath(cliPath), ["--version"]);
    const parsed = parseCodexCliVersion([result.stdout, result.stderr].join("\n"));
    if (parsed) {
      return parsed;
    }
  } catch {
    // Ignore version command failures and try the last local fallback.
  }

  try {
    const version = await readJsonFile<CodexVersionFile>(getVersionFilePath());
    if (version.latest_version?.trim()) {
      return version.latest_version.trim();
    }
  } catch {
    // Ignore missing version metadata.
  }

  return "0.0.0";
}

export async function fetchCodexAvailableModels(cliPath: string): Promise<CodexModelsResult> {
  let cachedResult: CodexModelsResult | null = null;

  try {
    cachedResult = await readCachedModels();
  } catch {
    cachedResult = null;
  }

  try {
    const auth = await readJsonFile<CodexAuthFile>(getAuthFilePath());
    const accessToken = auth.tokens?.access_token?.trim();
    const accountId = auth.tokens?.account_id?.trim();

    if (auth.auth_mode !== "chatgpt" || !accessToken || !accountId) {
      if (cachedResult) {
        return cachedResult;
      }
      throw new Error("Codex is not logged in with ChatGPT.");
    }

    const clientVersion = await getCodexClientVersion(cliPath);
    const requestUrl = await getRequestUrl();
    const response = await requestUrl({
      url: `https://chatgpt.com/backend-api/codex/models?client_version=${encodeURIComponent(clientVersion)}`,
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "ChatGPT-Account-ID": accountId,
        Accept: "application/json",
      },
      throw: false,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Codex models request failed (${response.status})`);
    }

    const json = response.json as { models?: CodexRemoteModel[] };
    const models = extractCodexPickerModels(json.models ?? []);
    if (models.length === 0) {
      throw new Error("Codex models endpoint returned no picker-visible models.");
    }

    return {
      models,
      source: "remote",
    };
  } catch (error) {
    if (cachedResult) {
      return cachedResult;
    }

    throw error instanceof Error ? error : new Error(String(error));
  }
}
