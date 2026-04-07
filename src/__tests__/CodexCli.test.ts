/**
 * Simple test runner for Codex CLI helpers
 * Run with: npx ts-node src/__tests__/CodexCli.test.ts
 */

import {
  extractCodexMessage,
  parseCodexLoginStatus,
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

runTests("Codex CLI helpers", [
  testParseCodexLoginStatusLoggedIn,
  testParseCodexLoginStatusNotLoggedIn,
  testExtractCodexMessage,
  testResolveCodexCliPathExpandsHome,
  testResolveCodexCliPathFindsHomebrewInstall,
]);
