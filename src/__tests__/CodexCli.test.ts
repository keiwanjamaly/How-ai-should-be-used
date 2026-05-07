import { EventEmitter } from "events";
import { afterEach, describe, expect, it, vi } from "vitest";

const { existsSyncMock, spawnMock } = vi.hoisted(() => ({
  existsSyncMock: vi.fn<(path: string) => boolean>(),
  spawnMock: vi.fn(),
}));

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    existsSync: existsSyncMock,
  };
});

vi.mock("child_process", () => ({
  spawn: spawnMock,
}));

import {
  buildCodexMcpConfigOverrides,
  extractCodexMessage,
  parseCodexLoginStatus,
  runCodexExec,
  resolveCodexCliPath,
} from "../services/CodexCli.ts";

type MockStream = EventEmitter & {
  setEncoding?: (encoding: string) => void;
};

type MockChild = EventEmitter & {
  stdout: MockStream;
  stderr: MockStream;
  kill: () => void;
};

function createMockChild(): MockChild {
  const stdout = new EventEmitter() as MockStream;
  stdout.setEncoding = () => {};

  const stderr = new EventEmitter() as MockStream;
  stderr.setEncoding = () => {};

  const child = new EventEmitter() as MockChild;
  child.stdout = stdout;
  child.stderr = stderr;
  child.kill = () => {};
  return child;
}

afterEach(() => {
  existsSyncMock.mockReset();
  spawnMock.mockReset();
  vi.unstubAllEnvs();
});

describe("Codex CLI helpers", () => {
  it("parses a logged-in status", () => {
    const status = parseCodexLoginStatus("WARNING: noise\nLogged in using ChatGPT\n");

    expect(status.isLoggedIn).toBe(true);
    expect(status.summary).toBe("Logged in using ChatGPT");
  });

  it("parses a logged-out status", () => {
    const status = parseCodexLoginStatus("Not logged in\n");

    expect(status.isLoggedIn).toBe(false);
    expect(status.summary).toBe("Not logged in");
  });

  it("extracts completed agent messages from JSONL output", () => {
    const output = [
      "{\"type\":\"thread.started\"}",
      "{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"hello\"}}",
      "non-json noise",
      "{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"world\"}}",
    ].join("\n");

    expect(extractCodexMessage(output)).toBe("hello\n\nworld");
  });

  it("expands home-directory paths", () => {
    vi.stubEnv("HOME", "/Users/tester");

    expect(resolveCodexCliPath("~/bin/codex")).toBe("/Users/tester/bin/codex");
  });

  it("resolves the first available executable path", () => {
    vi.stubEnv("PATH", "/custom/bin:/fallback/bin");
    existsSyncMock.mockImplementation((path) => path === "/fallback/bin/codex");

    expect(resolveCodexCliPath("codex")).toBe("/fallback/bin/codex");
  });

  it("builds TOML override arguments for enabled local MCP servers", () => {
    const overrides = buildCodexMcpConfigOverrides({
      filesystem: {
        type: "local",
        command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/tmp/docs"],
        enabled: true,
        environment: {
          NODE_ENV: "test",
        },
      },
    });

    expect(overrides).toEqual([
      'mcp_servers.filesystem.command="npx"',
      'mcp_servers.filesystem.args=["-y", "@modelcontextprotocol/server-filesystem", "/tmp/docs"]',
      'mcp_servers.filesystem.env.NODE_ENV="test"',
    ]);
  });

  it("skips disabled servers when building MCP overrides", () => {
    const overrides = buildCodexMcpConfigOverrides({
      disabled: {
        type: "local",
        command: ["npx", "ignored"],
        enabled: false,
      },
    });

    expect(overrides).toEqual([]);
  });

  it("runs Codex with hardened flags and returns the assistant message", async () => {
    existsSyncMock.mockReturnValue(true);
    const child = createMockChild();
    const calls: Array<{ command: string; args: string[] }> = [];

    spawnMock.mockImplementation((command: string, args: string[]) => {
      calls.push({ command, args });

      process.nextTick(() => {
        child.stdout.emit(
          "data",
          Buffer.from("{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"ok\"}}\n"),
        );
        child.emit("close", 0);
      });

      return child;
    });

    const result = await runCodexExec({
      cliPath: "codex",
      prompt: "Hello",
      model: "gpt-5",
      mcpServers: {},
    });

    expect(result).toBe("ok");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.command.endsWith("/codex") || calls[0]?.command === "codex").toBe(true);
    expect(calls[0]?.args).toContain("--ignore-user-config");
    expect(calls[0]?.args).toContain("--ignore-rules");
    expect(calls[0]?.args).toContain("read-only");
  });
});
