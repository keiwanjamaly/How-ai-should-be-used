/**
 * Shared test utilities for the lightweight custom test runner.
 * Provides assertion helpers and a generic runTests() runner.
 */

// ── Assertions ──────────────────────────────────────────────────────────────

export function assertEqual(actual: unknown, expected: unknown, message?: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

export function assertTrue(condition: boolean, message?: string): void {
  if (!condition) {
    throw new Error(message || "Expected true, got false");
  }
}

export function assertFalse(condition: boolean, message?: string): void {
  if (condition) {
    throw new Error(message || "Expected false, got true");
  }
}

export function assertAlmostEqual(
  actual: number,
  expected: number,
  epsilon = 1e-6,
  message?: string,
): void {
  if (Math.abs(actual - expected) > epsilon) {
    throw new Error(message || `Expected ${expected} ± ${epsilon}, got ${actual}`);
  }
}

// ── Test runner ─────────────────────────────────────────────────────────────

type TestFn = () => void;

export function runTests(suiteName: string, tests: TestFn[]): void {
  console.log(`\n=== ${suiteName} ===\n`);

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      test();
      passed++;
    } catch (error) {
      failed++;
      console.error(
        `\u2717 ${test.name} failed:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  console.log(`\n=== Test Results ===`);
  console.log(`Passed: ${passed}/${tests.length}`);
  console.log(`Failed: ${failed}/${tests.length}`);

  if (failed === 0) {
    console.log(`\n\u2713 All tests passed!`);
  } else {
    console.log(`\n\u2717 Some tests failed`);
    process.exit(1);
  }
}
