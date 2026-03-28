/**
 * Simple test runner for DiffService
 * Run with: npx ts-node src/__tests__/DiffService.test.ts
 */

import { diffLines } from "diff";
import { DiffService } from "../services/DiffService.ts";
import { assertEqual, assertTrue, assertFalse, runTests } from "./testUtils.ts";

function testDiffCalculation(): void {
  console.log("Test: Diff Calculation");

  const oldContent = "Line 1\nLine 2\nLine 3\n";
  const newContent = "Line 1\nLine 2 Modified\nLine 3\nLine 4\n";

  const changes = diffLines(oldContent, newContent);

  // Check that we have the expected number of change blocks
  assertTrue(changes.length >= 2, "Should have at least 2 change blocks");

  // Check for added line
  const hasAddedLine = changes.some((change) => change.added && change.value.includes("Line 4"));
  assertTrue(hasAddedLine, "Should detect added line");

  // Check for modified line (technically removed + added)
  const hasModifiedLine = changes.some(
    (change) =>
      (change.added && change.value.includes("Line 2 Modified")) ||
      (change.removed && change.value.includes("Line 2\n"))
  );
  assertTrue(hasModifiedLine, "Should detect modified line");

  console.log("  PASSED");
}

function testEmptyContent(): void {
  console.log("Test: Empty Content");

  const oldContent = "";
  const newContent = "New line\n";

  const changes = diffLines(oldContent, newContent);

  assertTrue(changes.length === 1, "Should have one change block");
  assertTrue(changes[0].added, "Change should be marked as added");
  assertEqual(changes[0].value, "New line\n", "Added value should match");

  console.log("  PASSED");
}

function testNoChanges(): void {
  console.log("Test: No Changes");

  const content = "Line 1\nLine 2\nLine 3\n";

  const changes = diffLines(content, content);

  // Should have one unchanged block
  assertTrue(changes.length === 1, "Should have one change block");
  assertFalse(changes[0].added, "Should not be marked as added");
  assertFalse(changes[0].removed, "Should not be marked as removed");

  console.log("  PASSED");
}

function testLineCounting(): void {
  console.log("Test: Line Counting");

  const oldContent = "Line 1\nLine 2\n";
  const newContent = "Line 1\nLine 2\nLine 3\nLine 4\n";

  const changes = diffLines(oldContent, newContent);

  let addedCount = 0;
  for (const change of changes) {
    if (change.added) {
      addedCount += change.value.split("\n").length - 1;
    }
  }

  assertEqual(addedCount, 2, "Should count 2 added lines");

  console.log("  PASSED");
}

function testWhitespaceHandling(): void {
  console.log("Test: Whitespace Handling");

  const oldContent = "Line with trailing   \n";
  const newContent = "Line with trailing\n";

  const changes = diffLines(oldContent, newContent);

  const hasChange = changes.some((change) => change.added || change.removed);
  assertTrue(hasChange, "Should detect trailing whitespace change");

  console.log("  PASSED");
}

function testComplexChanges(): void {
  console.log("Test: Complex Changes");

  const oldContent = `First paragraph
Some text here
Another line

Second paragraph
More content here
`;

  const newContent = `First paragraph
Modified text here
New line inserted
Another line

Second paragraph
Modified content here
Final line added
`;

  const changes = diffLines(oldContent, newContent);

  // Should detect multiple changes
  const addedChanges = changes.filter((c) => c.added).length;
  const removedChanges = changes.filter((c) => c.removed).length;

  assertTrue(addedChanges > 0, "Should have added changes");
  assertTrue(removedChanges > 0, "Should have removed changes");

  console.log("  PASSED");
}

// --- DiffService instance tests (cherry-pick logic) ---

function createDiffService(): DiffService {
  return new DiffService(null as any);
}

// Test: convertToDiffChanges via calculateDiff
function testConvertToDiffChanges(): void {
  console.log("Test: convertToDiffChanges via calculateDiff");

  const svc = createDiffService();
  const oldContent = "Line 1\nLine 2\nLine 3\n";
  const newContent = "Line 1\nLine 2 Modified\nLine 3\nLine 4\n";

  const changes = svc.calculateDiff(oldContent, newContent);

  // Should contain unchanged, removed, added entries with line numbers
  const unchanged = changes.filter((c) => c.type === "unchanged");
  const added = changes.filter((c) => c.type === "added");
  const removed = changes.filter((c) => c.type === "removed");

  assertTrue(unchanged.length > 0, "Should have unchanged lines");
  assertTrue(added.length > 0, "Should have added lines");
  assertTrue(removed.length > 0, "Should have removed lines");

  // Every added line should have a newLineNumber
  for (const c of added) {
    assertTrue(c.newLineNumber !== undefined, "Added line should have newLineNumber");
  }
  // Every removed line should have an oldLineNumber
  for (const c of removed) {
    assertTrue(c.oldLineNumber !== undefined, "Removed line should have oldLineNumber");
  }
  // Every unchanged line should have both
  for (const c of unchanged) {
    assertTrue(c.oldLineNumber !== undefined, "Unchanged line should have oldLineNumber");
    assertTrue(c.newLineNumber !== undefined, "Unchanged line should have newLineNumber");
  }

  console.log("  convertToDiffChanges works correctly");
}

// Test: Accept all changes -> result equals newContent (minus trailing newline)
function testBuildContentAcceptAll(): void {
  console.log("Test: buildContentFromSelections — accept all");

  const svc = createDiffService();
  const oldContent = "Line 1\nLine 2\nLine 3";
  const newContent = "Line 1\nLine 2 Modified\nLine 3\nLine 4";

  const diff = svc.createFileDiff("test.md", oldContent, newContent);

  const acceptedChanges = new Set<number>();
  const rejectedChanges = new Set<number>();
  for (const c of diff.changes) {
    if (c.type === "added") acceptedChanges.add(c.newLineNumber!);
    else if (c.type === "removed") acceptedChanges.add(c.oldLineNumber!);
  }

  const result = svc.buildContentFromSelections(diff, acceptedChanges, rejectedChanges);
  assertEqual(result, newContent, "Accepting all changes should produce newContent");

  console.log("  accept all -> newContent");
}

// Test: Reject all changes -> result equals oldContent
function testBuildContentRejectAll(): void {
  console.log("Test: buildContentFromSelections — reject all");

  const svc = createDiffService();
  const oldContent = "Line 1\nLine 2\nLine 3";
  const newContent = "Line 1\nLine 2 Modified\nLine 3\nLine 4";

  const diff = svc.createFileDiff("test.md", oldContent, newContent);

  const acceptedChanges = new Set<number>();
  const rejectedChanges = new Set<number>();
  for (const c of diff.changes) {
    if (c.type === "added") rejectedChanges.add(c.newLineNumber!);
    else if (c.type === "removed") rejectedChanges.add(c.oldLineNumber!);
  }

  const result = svc.buildContentFromSelections(diff, acceptedChanges, rejectedChanges);
  assertEqual(result, oldContent, "Rejecting all changes should produce oldContent");

  console.log("  reject all -> oldContent");
}

// Test: Selective cherry-pick — accept some added lines, reject some removed lines
function testBuildContentSelectiveCherryPick(): void {
  console.log("Test: buildContentFromSelections — selective cherry-pick");

  const svc = createDiffService();
  const oldContent = "Alpha\nBravo\nCharlie";
  const newContent = "Alpha\nBravo Modified\nCharlie\nDelta";

  const diff = svc.createFileDiff("test.md", oldContent, newContent);

  // Accept addition of "Delta", reject the "Bravo"->"Bravo Modified" change
  const acceptedChanges = new Set<number>();
  const rejectedChanges = new Set<number>();
  for (const c of diff.changes) {
    if (c.type === "added" && c.content === "Delta") acceptedChanges.add(c.newLineNumber!);
    else if (c.type === "added" && c.content === "Bravo Modified") rejectedChanges.add(c.newLineNumber!);
    else if (c.type === "removed" && c.content === "Bravo") rejectedChanges.add(c.oldLineNumber!);
  }

  const result = svc.buildContentFromSelections(diff, acceptedChanges, rejectedChanges);
  // "Bravo" kept (rejected removal), "Bravo Modified" excluded (rejected addition), "Delta" added
  assertEqual(result, "Alpha\nBravo\nCharlie\nDelta", "Selective cherry-pick should merge correctly");

  console.log("  selective cherry-pick works");
}

// Test: Edge case — line number in both acceptedChanges and rejectedChanges
// For removed lines: condition is `rejectedChanges.has(n) || !acceptedChanges.has(n)`
// so if in BOTH sets, rejectedChanges wins — the line is KEPT (removal not applied).
function testBuildContentLineInBothSets(): void {
  console.log("Test: buildContentFromSelections — line in both accepted and rejected");

  const svc = createDiffService();
  const oldContent = "Keep\nRemoveMe";
  const newContent = "Keep";

  const diff = svc.createFileDiff("test.md", oldContent, newContent);
  const removedLine = diff.changes.find((c) => c.type === "removed")!;
  const lineNum = removedLine.oldLineNumber!;

  // Both sets contain the line — for removed lines, rejected wins, so the line is KEPT
  const acceptedChanges = new Set<number>([lineNum]);
  const rejectedChanges = new Set<number>([lineNum]);

  const result = svc.buildContentFromSelections(diff, acceptedChanges, rejectedChanges);
  assertEqual(result, oldContent, "When removed line is in both sets, rejected wins — line is kept");

  console.log("  line in both sets -> rejected wins for removed lines");
}

// Test: Edge case — changed lines not in either set (unselected)
// Unselected removed lines: KEPT (removal not applied — user must explicitly accept)
// Unselected added lines: EXCLUDED (not applied)
function testBuildContentUnselectedChanges(): void {
  console.log("Test: buildContentFromSelections — unselected changes (not in either set)");

  const svc = createDiffService();
  const oldContent = "First\nSecond\nThird";
  const newContent = "First\nThird\nFourth";

  const diff = svc.createFileDiff("test.md", oldContent, newContent);

  const result = svc.buildContentFromSelections(diff, new Set(), new Set());

  // Unselected removals kept, unselected additions excluded -> equals oldContent
  assertEqual(result, oldContent,
    "Unselected changes: removed lines kept, added lines excluded");

  console.log("  unselected changes default correctly");
}

// Test: generateCherryPickResult returns content and stats
function testGenerateCherryPickResult(): void {
  console.log("Test: generateCherryPickResult");

  const svc = createDiffService();
  const oldContent = "A\nB\n";
  const newContent = "A\nB\nC\n";

  const diff = svc.createFileDiff("test.md", oldContent, newContent);
  // With trailing newlines, diffLines produces a clean "added C" at the end
  const addedLine = diff.changes.find((c) => c.type === "added")!;
  const accepted = new Set<number>([addedLine.newLineNumber!]);

  const result = svc.generateCherryPickResult(diff, accepted, new Set());

  // buildContentFromSelections joins with "\n", so result.content === "A\nB\nC" (no trailing \n)
  assertTrue(result.content.includes("C"), "Accepted addition should appear in result");
  assertTrue(typeof result.stats === "object", "Result should include stats object");
  assertTrue(result.stats.modified >= 0, "stats.modified should be a non-negative number");

  console.log("  generateCherryPickResult structure is correct");
}

runTests("DiffService Tests", [
  testDiffCalculation,
  testEmptyContent,
  testNoChanges,
  testLineCounting,
  testWhitespaceHandling,
  testComplexChanges,
  testConvertToDiffChanges,
  testBuildContentAcceptAll,
  testBuildContentRejectAll,
  testBuildContentSelectiveCherryPick,
  testBuildContentLineInBothSets,
  testBuildContentUnselectedChanges,
  testGenerateCherryPickResult,
]);
