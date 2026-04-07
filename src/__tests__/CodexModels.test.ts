/**
 * Simple test runner for Codex model helpers
 * Run with: npx ts-node src/__tests__/CodexModels.test.ts
 */

import { extractCodexPickerModels } from "../services/CodexModels.ts";
import { assertEqual, runTests } from "./testUtils.ts";

function testExtractCodexPickerModelsPrefersVisibleAndPriority(): void {
  const models = extractCodexPickerModels([
    { slug: "hidden-model", visibility: "hide", priority: 0 },
    { slug: "gpt-5-mini", visibility: "list", priority: 2 },
    { slug: "gpt-5", visibility: "list", priority: 1 },
  ]);

  assertEqual(models, ["gpt-5", "gpt-5-mini"], "Should keep only picker-visible models in priority order");
}

function testExtractCodexPickerModelsFallsBackWhenNoVisibleModels(): void {
  const models = extractCodexPickerModels([
    { slug: "model-b", visibility: "hide", priority: 2 },
    { slug: "model-a", visibility: "none", priority: 1 },
  ]);

  assertEqual(models, ["model-a", "model-b"], "Should fall back to all models when none are explicitly list-visible");
}

runTests("Codex model helpers", [
  testExtractCodexPickerModelsPrefersVisibleAndPriority,
  testExtractCodexPickerModelsFallsBackWhenNoVisibleModels,
]);
