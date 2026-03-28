/**
 * Simple test runner for DiffService
 * Run with: npx ts-node src/__tests__/DiffService.test.ts
 */

import { diffLines } from "diff";
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

runTests("DiffService Tests", [
  testDiffCalculation,
  testEmptyContent,
  testNoChanges,
  testLineCounting,
  testWhitespaceHandling,
  testComplexChanges,
]);
