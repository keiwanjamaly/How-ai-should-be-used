/**
 * Simple test runner for Codex CLI helpers
 * Run with: npx ts-node src/__tests__/CodexCli.test.ts
 */

import {
  buildCodexMcpConfigOverrides,
  extractCodexMessage,
  parseCodexLoginStatus,
  runCodexExec,
  resolveCodexCliPath,
} from "../services/CodexCli.ts";
import { assertEqual, assertFalse, assertTrue, runTests } from "./testUtils.ts";

function testParseCodexLoginStatusLoggedIn(): void {
  const status = parseCodexLoginStatus("WARNING: noise\nLogged in using ChatGPT\n");
  assertTrue(status.isLoggedIn, "Expected logged-in status");
  assertEqual(status.summary, "Logged in using ChatGPT", "Should keep the meaningful summary line");
}

function testParseCodexLoginStatusNotLoggedIn(): void {
  const status = parseCodexLoginStatus("Not logged in\n");
  assertFalse(status.isLoggedIn, "Expected logged-out status");
  assertEqual(status.summary, "Not logged in", "Should preserve the status summary");
}

function testExtractCodexMessage(): void {
  const output = [
    "{\"type\":\"thread.started\"}",
    "{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"hello\"}}",
    "non-json noise",
    "{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"world\"}}",
  ].join("\n");

  assertEqual(extractCodexMessage(output), "hello\n\nworld", "Should join completed agent messages");
}

function testResolveCodexCliPathExpandsHome(): void {
  const home = process.env.HOME;
  if (!home) {
    throw new Error("HOME must be set for this test");
  }

  assertEqual(resolveCodexCliPath("~/bin/codex"), `${home}/bin/codex`, "Should expand ~ paths");
}

function testResolveCodexCliPathFindsHomebrewInstall(): void {
  const resolved = resolveCodexCliPath("codex");
  assertTrue(resolved.endsWith("/codex"), "Should resolve to a concrete executable path when available");
}

function testBuildCodexMcpConfigOverrides(): void {
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

  assertEqual(overrides.length, 3, "Should create command, args, and env overrides");
  assertEqual(overrides[0], 'mcp_servers.filesystem.command="npx"', "Should set command override");
  assertEqual(
    overrides[1],
    'mcp_servers.filesystem.args=["-y", "@modelcontextprotocol/server-filesystem", "/tmp/docs"]',
    "Should set args override",
  );
  assertEqual(
    overrides[2],
    'mcp_servers.filesystem.env.NODE_ENV="test"',
    "Should set env overrides",
  );
}

function testBuildCodexMcpConfigOverridesSkipsDisabledServers(): void {
  const overrides = buildCodexMcpConfigOverrides({
    disabled: {
      type: "local",
      command: ["npx", "ignored"],
      enabled: false,
    },
  });

  assertEqual(overrides.length, 0, "Should skip disabled servers");
}

async function testRunCodexExecUsesHardenedFlags(): Promise<void> {
  const childProcess = require("child_process") as typeof import("child_process");
  const originalSpawn = childProcess.spawn;
  const calls: Array<{ command: string; args: string[] }> = [];

  childProcess.spawn = ((command: string, args: string[]) => {
    calls.push({ command, args });

    const { EventEmitter } = require("events") as typeof import("events");
    const stream = new EventEmitter() as import("events").EventEmitter & {
      setEncoding?: (encoding: string) => void;
    };
    const child = new EventEmitter() as import("events").EventEmitter & {
      stdout: typeof stream;
      stderr: typeof stream;
      kill: () => void;
    };

    child.stdout = stream;
    child.stderr = stream;
    child.kill = () => {};

    process.nextTick(() => {
      child.stdout.emit(
        "data",
        Buffer.from("{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"ok\"}}\n"),
      );
      child.emit("close", 0);
    });

    return child as unknown as import("child_process").ChildProcessWithoutNullStreams;
  }) as typeof childProcess.spawn;

  try {
    const result = await runCodexExec({
      cliPath: "codex",
      prompt: "Hello",
      model: "gpt-5",
      mcpServers: {},
    });

    assertEqual(result, "ok", "Should return the assistant message from Codex output");
    assertEqual(calls.length, 1, "Should spawn Codex exactly once");
    assertTrue(
      calls[0].args.includes("--ignore-user-config"),
      "Codex exec should ignore user config",
    );
    assertTrue(
      calls[0].args.includes("--ignore-rules"),
      "Codex exec should ignore local and user rules",
    );
    assertTrue(
      calls[0].args.includes("read-only"),
      "Codex exec should keep the read-only sandbox",
    );
  } finally {
    childProcess.spawn = originalSpawn;
  }
}

async function runAsyncTests(): Promise<void> {
  runTests("Codex CLI helpers", [
    testParseCodexLoginStatusLoggedIn,
    testParseCodexLoginStatusNotLoggedIn,
    testExtractCodexMessage,
    testResolveCodexCliPathExpandsHome,
    testResolveCodexCliPathFindsHomebrewInstall,
    testBuildCodexMcpConfigOverrides,
    testBuildCodexMcpConfigOverridesSkipsDisabledServers,
  ]);

  await testRunCodexExecUsesHardenedFlags();
}

void runAsyncTests();
