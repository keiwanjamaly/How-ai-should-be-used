/**
 * Simple test runner for DiffService
 * Run with: npx ts-node src/__tests__/DiffService.test.ts
 */

import { diffLines } from "diff";
import { DiffService } from "../services/DiffService";

// Simple test assertions
function assertEqual(actual: unknown, expected: unknown, message?: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

function assertTrue(condition: boolean, message?: string): void {
  if (!condition) {
    throw new Error(message || "Expected true, got false");
  }
}

function assertFalse(condition: boolean, message?: string): void {
  if (condition) {
    throw new Error(message || "Expected false, got true");
  }
}

// Test Diff calculation
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

  console.log("✓ Diff calculation works correctly");
}

// Test with empty content
function testEmptyContent(): void {
  console.log("Test: Empty Content");

  const oldContent = "";
  const newContent = "New line\n";

  const changes = diffLines(oldContent, newContent);

  assertTrue(changes.length === 1, "Should have one change block");
  assertTrue(changes[0].added, "Change should be marked as added");
  assertEqual(changes[0].value, "New line\n", "Added value should match");

  console.log("✓ Empty content handling works correctly");
}

// Test no changes
function testNoChanges(): void {
  console.log("Test: No Changes");

  const content = "Line 1\nLine 2\nLine 3\n";

  const changes = diffLines(content, content);

  // Should have one unchanged block
  assertTrue(changes.length === 1, "Should have one change block");
  assertFalse(changes[0].added, "Should not be marked as added");
  assertFalse(changes[0].removed, "Should not be marked as removed");

  console.log("✓ No changes detection works correctly");
}

// Test line counting
function testLineCounting(): void {
  console.log("Test: Line Counting");

  const oldContent = "Line 1\nLine 2\n";
  const newContent = "Line 1\nLine 2\nLine 3\nLine 4\n";

  const changes = diffLines(oldContent, newContent);

  let addedCount = 0;
  for (const change of changes) {
    if (change.added) {
      // Count lines in added block
      addedCount += change.value.split("\n").length - 1;
    }
  }

  assertEqual(addedCount, 2, "Should count 2 added lines");

  console.log("✓ Line counting works correctly");
}

// Test whitespace handling
function testWhitespaceHandling(): void {
  console.log("Test: Whitespace Handling");

  const oldContent = "Line with trailing   \n";
  const newContent = "Line with trailing\n";

  const changes = diffLines(oldContent, newContent);

  // Line-based diff should detect this as a change
  const hasChange = changes.some((change) => change.added || change.removed);
  assertTrue(hasChange, "Should detect trailing whitespace change");

  console.log("✓ Whitespace handling works correctly");
}

// Test complex changes
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

  console.log("✓ Complex changes detection works correctly");
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

// Test: Accept all changes -> result equals newContent
function testBuildContentAcceptAll(): void {
  console.log("Test: buildContentFromSelections — accept all");

  const svc = createDiffService();
  const oldContent = "Line 1\nLine 2\nLine 3\n";
  const newContent = "Line 1\nLine 2 Modified\nLine 3\nLine 4\n";

  const changes = svc.calculateDiff(oldContent, newContent);

  // Collect all changed line numbers into acceptedChanges
  const acceptedChanges = new Set<number>();
  const rejectedChanges = new Set<number>();
  for (const c of changes) {
    if (c.type === "added") {
      acceptedChanges.add(c.newLineNumber!);
    } else if (c.type === "removed") {
      acceptedChanges.add(c.oldLineNumber!);
    }
  }

  const result = svc.buildContentFromSelections(changes, acceptedChanges, rejectedChanges);
  assertEqual(result, newContent, "Accepting all changes should produce newContent");

  console.log("  accept all -> newContent");
}

// Test: Reject all changes -> result equals oldContent
function testBuildContentRejectAll(): void {
  console.log("Test: buildContentFromSelections — reject all");

  const svc = createDiffService();
  const oldContent = "Line 1\nLine 2\nLine 3\n";
  const newContent = "Line 1\nLine 2 Modified\nLine 3\nLine 4\n";

  const changes = svc.calculateDiff(oldContent, newContent);

  // Collect all changed line numbers into rejectedChanges
  const acceptedChanges = new Set<number>();
  const rejectedChanges = new Set<number>();
  for (const c of changes) {
    if (c.type === "added") {
      rejectedChanges.add(c.newLineNumber!);
    } else if (c.type === "removed") {
      rejectedChanges.add(c.oldLineNumber!);
    }
  }

  const result = svc.buildContentFromSelections(changes, acceptedChanges, rejectedChanges);
  assertEqual(result, oldContent, "Rejecting all changes should produce oldContent");

  console.log("  reject all -> oldContent");
}

// Test: Selective cherry-pick — accept some added lines, reject some removed lines
function testBuildContentSelectiveCherryPick(): void {
  console.log("Test: buildContentFromSelections — selective cherry-pick");

  const svc = createDiffService();
  const oldContent = "Alpha\nBravo\nCharlie\n";
  const newContent = "Alpha\nBravo Modified\nCharlie\nDelta\n";

  const changes = svc.calculateDiff(oldContent, newContent);

  // Accept the addition of "Delta" but reject the modification of "Bravo" -> "Bravo Modified"
  const acceptedChanges = new Set<number>();
  const rejectedChanges = new Set<number>();

  for (const c of changes) {
    if (c.type === "added" && c.content === "Delta") {
      acceptedChanges.add(c.newLineNumber!);
    } else if (c.type === "added" && c.content === "Bravo Modified") {
      rejectedChanges.add(c.newLineNumber!);
    } else if (c.type === "removed" && c.content === "Bravo") {
      rejectedChanges.add(c.oldLineNumber!);
    }
  }

  const result = svc.buildContentFromSelections(changes, acceptedChanges, rejectedChanges);
  // Should keep original "Bravo" (rejected removal), not include "Bravo Modified" (rejected addition),
  // and include "Delta" (accepted addition)
  const expected = "Alpha\nBravo\nCharlie\nDelta\n";
  assertEqual(result, expected, "Selective cherry-pick should merge correctly");

  console.log("  selective cherry-pick works");
}

// Test: Edge case — line number in both acceptedChanges and rejectedChanges
// When a line number is in both sets, acceptedChanges takes precedence (it is checked first).
function testBuildContentLineInBothSets(): void {
  console.log("Test: buildContentFromSelections — line in both accepted and rejected");

  const svc = createDiffService();
  const oldContent = "Keep\nRemoveMe\n";
  const newContent = "Keep\n";

  const changes = svc.calculateDiff(oldContent, newContent);

  // Find the removed line's oldLineNumber
  const removedLine = changes.find((c) => c.type === "removed")!;
  const lineNum = removedLine.oldLineNumber!;

  // Put in both sets — acceptedChanges should win (removal is applied, line dropped)
  const acceptedChanges = new Set<number>([lineNum]);
  const rejectedChanges = new Set<number>([lineNum]);

  const result = svc.buildContentFromSelections(changes, acceptedChanges, rejectedChanges);
  assertEqual(result, newContent, "When line is in both sets, acceptedChanges takes precedence");

  console.log("  line in both sets -> accepted wins");
}

// Test: Edge case — changed lines not in either set (unselected)
// For removed lines not in either set: the removal is NOT applied, the line is kept.
// This "keep original" default for unselected removals is a deliberate choice — it means
// the user must explicitly accept a removal for it to take effect.
// For added lines not in either set: the addition is NOT applied, the line is excluded.
function testBuildContentUnselectedChanges(): void {
  console.log("Test: buildContentFromSelections — unselected changes (not in either set)");

  const svc = createDiffService();
  const oldContent = "First\nSecond\nThird\n";
  const newContent = "First\nThird\nFourth\n";

  const changes = svc.calculateDiff(oldContent, newContent);

  // Pass empty sets — no changes are explicitly accepted or rejected
  const acceptedChanges = new Set<number>();
  const rejectedChanges = new Set<number>();

  const result = svc.buildContentFromSelections(changes, acceptedChanges, rejectedChanges);

  // Unselected removed line "Second": kept (removal not applied)
  // Unselected added line "Fourth": excluded (addition not applied)
  // Result should be: "First\nSecond\nThird\n" — same as oldContent
  // because removed lines default to kept and added lines default to excluded.
  assertEqual(result, oldContent,
    "Unselected changes: removed lines are kept, added lines are excluded (equals oldContent)");

  console.log("  unselected changes default correctly");
}

// Test: generateCherryPickResult returns correct structure
function testGenerateCherryPickResult(): void {
  console.log("Test: generateCherryPickResult");

  const svc = createDiffService();
  const oldContent = "A\nB\n";
  const newContent = "A\nB\nC\n";

  const diff = svc.createFileDiff("test.md", oldContent, newContent);

  const addedLine = diff.changes.find((c) => c.type === "added")!;
  const accepted = new Set<number>([addedLine.newLineNumber!]);
  const rejected = new Set<number>();

  const result = svc.generateCherryPickResult(diff, accepted, rejected);

  assertEqual(result.content, newContent, "Content should match newContent when accepting addition");
  assertTrue(result.acceptedLines === accepted, "acceptedLines should be the same set reference");
  assertTrue(result.rejectedLines === rejected, "rejectedLines should be the same set reference");

  console.log("  generateCherryPickResult structure is correct");
}

// Run all tests
function runTests(): void {
  console.log("\n=== DiffService Tests ===\n");

  const tests = [
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
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      test();
      passed++;
    } catch (error) {
      failed++;
      console.error(`✗ ${test.name} failed:`, error instanceof Error ? error.message : error);
    }
  }

  console.log("\n=== Test Results ===");
  console.log(`Passed: ${passed}/${tests.length}`);
  console.log(`Failed: ${failed}/${tests.length}`);

  if (failed === 0) {
    console.log("\n✓ All tests passed!");
  } else {
    console.log("\n✗ Some tests failed");
    process.exit(1);
  }
}

// Run tests
runTests();
