import { spawn } from "child_process";
import { existsSync } from "fs";
import { tmpdir } from "os";
import { delimiter, join } from "path";
import type { MCPServers } from "../types/mcp";

const COMMON_CODEX_PATHS = [
  "/opt/homebrew/bin/codex",
  "/usr/local/bin/codex",
  "/usr/bin/codex",
];

export interface CodexCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CodexLoginStatus {
  isLoggedIn: boolean;
  summary: string;
}

export interface RunCodexExecOptions {
  cliPath: string;
  prompt: string;
  model?: string;
  mcpServers?: MCPServers;
  signal?: AbortSignal;
}

interface CodexJsonEvent {
  type?: string;
  item?: {
    type?: string;
    text?: string;
  };
}

function normalizeCodexError(error: unknown, cliPath: string): Error {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") {
    return new Error(`Codex CLI not found at "${cliPath}". Install Codex or update the CLI path.`);
  }

  return error instanceof Error ? error : new Error(String(error));
}

function buildCommandError(stderr: string, stdout: string, fallback: string): Error {
  const text = [stderr, stdout]
    .join("\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .find((line) => !line.startsWith("{"));

  return new Error(text ?? fallback);
}

export function parseCodexLoginStatus(output: string): CodexLoginStatus {
  const text = output.trim();

  if (!text) {
    return {
      isLoggedIn: false,
      summary: "No response from Codex CLI.",
    };
  }

  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("WARNING:"));
  const summary = lines[lines.length - 1] ?? text;

  return {
    isLoggedIn: /^logged in\b/i.test(summary),
    summary,
  };
}

export function extractCodexMessage(output: string): string {
  const messages: string[] = [];

  for (const rawLine of output.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("{")) {
      continue;
    }

    try {
      const event = JSON.parse(line) as CodexJsonEvent;
      if (event.type === "item.completed" && event.item?.type === "agent_message" && event.item.text) {
        messages.push(event.item.text);
      }
    } catch {
      // Ignore non-JSON lines mixed into the stream.
    }
  }

  return messages.join("\n\n").trim();
}

function expandHomeDir(path: string): string {
  if (!path.startsWith("~")) {
    return path;
  }

  const home = process.env.HOME;
  if (!home) {
    return path;
  }

  if (path === "~") {
    return home;
  }

  if (path.startsWith("~/")) {
    return join(home, path.slice(2));
  }

  return path;
}

export function resolveCodexCliPath(cliPath: string): string {
  const requested = cliPath.trim();
  if (!requested) {
    return requested;
  }

  const expanded = expandHomeDir(requested);
  if (expanded.includes("/")) {
    return expanded;
  }

  const pathEntries = (process.env.PATH ?? "")
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  const candidates = [
    ...pathEntries.map((entry) => join(entry, expanded)),
    ...COMMON_CODEX_PATHS,
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return expanded;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlStringArray(values: string[]): string {
  return `[${values.map((value) => tomlString(value)).join(", ")}]`;
}

export function buildCodexMcpConfigOverrides(mcpServers: MCPServers): string[] {
  const overrides: string[] = [];

  for (const [serverName, server] of Object.entries(mcpServers)) {
    if (!server.enabled || server.type !== "local" || server.command.length === 0) {
      continue;
    }

    const [command, ...args] = server.command;
    const baseKey = `mcp_servers.${serverName}`;

    overrides.push(`${baseKey}.command=${tomlString(command)}`);
    overrides.push(`${baseKey}.args=${tomlStringArray(args)}`);

    for (const [envName, envValue] of Object.entries(server.environment ?? {})) {
      overrides.push(`${baseKey}.env.${envName}=${tomlString(envValue)}`);
    }
  }

  return overrides;
}

export async function runCodexCommand(
  cliPath: string,
  args: string[],
  signal?: AbortSignal,
): Promise<CodexCommandResult> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    const resolvedCliPath = resolveCodexCliPath(cliPath);
    const child = spawn(resolvedCliPath, args, {
      cwd: tmpdir(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    const cleanupAbort = () => {
      signal?.removeEventListener("abort", handleAbort);
    };

    const settle = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanupAbort();
      callback();
    };

    const handleAbort = () => {
      child.kill("SIGTERM");
      settle(() => reject(new DOMException("Aborted", "AbortError")));
    };

    if (signal) {
      if (signal.aborted) {
        handleAbort();
        return;
      }
      signal.addEventListener("abort", handleAbort, { once: true });
    }

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.once("error", (error) => {
      settle(() => reject(normalizeCodexError(error, resolvedCliPath)));
    });

    child.once("close", (code) => {
      settle(() =>
        resolve({
          stdout,
          stderr,
          exitCode: code ?? 0,
        }),
      );
    });
  });
}

export async function getCodexLoginStatus(
  cliPath: string,
  signal?: AbortSignal,
): Promise<CodexLoginStatus> {
  const result = await runCodexCommand(cliPath, ["login", "status"], signal);

  if (result.exitCode !== 0) {
    throw buildCommandError(
      result.stderr,
      result.stdout,
      "Failed to check Codex login status.",
    );
  }

  return parseCodexLoginStatus([result.stdout, result.stderr].filter(Boolean).join("\n"));
}

export async function runCodexExec({
  cliPath,
  prompt,
  model,
  mcpServers = {},
  signal,
}: RunCodexExecOptions): Promise<string> {
  const args = [
    "exec",
    "--ephemeral",
    "--json",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--color",
    "never",
  ];

  if (model?.trim()) {
    args.push("--model", model.trim());
  }

  for (const override of buildCodexMcpConfigOverrides(mcpServers)) {
    args.push("-c", override);
  }

  args.push(prompt);

  const result = await runCodexCommand(cliPath, args, signal);
  if (result.exitCode !== 0) {
    throw buildCommandError(result.stderr, result.stdout, `Codex exec failed (${result.exitCode}).`);
  }

  const message = extractCodexMessage(result.stdout);
  if (!message) {
    throw new Error("Codex CLI returned no assistant message.");
  }

  return message;
}
