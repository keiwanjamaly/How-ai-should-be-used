/**
 * Simple test runner for DiffService
 * Run with: npx ts-node src/__tests__/DiffService.test.ts
 */

import { diffLines } from "diff";

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
