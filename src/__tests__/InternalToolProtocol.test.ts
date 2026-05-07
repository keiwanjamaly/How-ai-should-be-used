import {
  buildCodexEditInstruction,
  parseCodexEditEnvelope,
} from "../services/InternalToolProtocol.ts";
import { assertEqual, assertTrue, runTests } from "./testUtils.ts";

function testParseCodexEditEnvelope(): void {
  const envelope = parseCodexEditEnvelope(
    JSON.stringify({
      type: "active_note_replacement",
      message: "Prepared a checklist version.",
      proposedContent: "# Title\n\n- [ ] Item",
    }),
  );

  assertEqual(
    envelope,
    {
      type: "active_note_replacement",
      message: "Prepared a checklist version.",
      proposedContent: "# Title\n\n- [ ] Item",
    },
    "Should parse a valid edit envelope",
  );
}

function testParseCodexSelectionEditEnvelope(): void {
  const envelope = parseCodexEditEnvelope(
    JSON.stringify({
      type: "active_selection_replacement",
      message: "Replace the selected heading.",
      replacement: "## New heading",
    }),
  );

  assertEqual(
    envelope,
    {
      type: "active_selection_replacement",
      message: "Replace the selected heading.",
      replacement: "## New heading",
    },
    "Should parse a valid selection edit envelope",
  );
}

function testParseCodexEditEnvelopeRejectsMarkdownWrappedJson(): void {
  const envelope = parseCodexEditEnvelope(
    "```json\n{\"type\":\"active_note_replacement\",\"message\":\"x\",\"proposedContent\":\"y\"}\n```",
  );
  assertEqual(envelope, null, "Should reject fenced JSON responses");
}

function testBuildCodexEditInstruction(): void {
  const instruction = buildCodexEditInstruction();
  assertTrue(
    instruction.includes("active_note_replacement"),
    "Instruction should describe the JSON envelope",
  );
  assertTrue(
    instruction.includes("propose_active_note_replacement"),
    "Instruction should mention the internal tool name",
  );
  assertTrue(
    instruction.includes("active_selection_replacement"),
    "Instruction should describe the selection replacement envelope",
  );
}

runTests("Internal tool protocol", [
  testParseCodexEditEnvelope,
  testParseCodexSelectionEditEnvelope,
  testParseCodexEditEnvelopeRejectsMarkdownWrappedJson,
  testBuildCodexEditInstruction,
]);
