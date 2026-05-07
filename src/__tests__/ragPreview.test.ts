import { getUniqueChunkPaths } from "../utils/ragPreview";

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
  }
}

function runTests(): void {
  const deduped = getUniqueChunkPaths([
    { path: "notes/a.md" },
    { path: "notes/b.md" },
    { path: "notes/a.md" },
    { path: "  notes/c.md  " },
    { path: "" },
  ]);

  assertEqual(
    deduped,
    ["notes/a.md", "notes/b.md", "notes/c.md"],
    "Should preserve order, trim paths, and remove duplicates",
  );
}

runTests();
