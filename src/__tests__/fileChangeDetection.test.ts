import {
  matchesEditorSnapshot,
} from "../utils/fileChangeDetection.ts";
import { assertFalse, assertTrue, runTests } from "./testUtils.ts";

function testMatchesEditorSnapshotWhenContentMatches(): void {
  const currentContent = "# Note\nupdated";
  const snapshot = {
    content: currentContent,
  };

  assertTrue(
    matchesEditorSnapshot(currentContent, snapshot),
    "Matching editor content should count as the same editor snapshot",
  );
}

function testMatchesEditorSnapshotRequiresMatchingContent(): void {
  const snapshot = {
    content: "# Note\nold",
  };

  assertFalse(
    matchesEditorSnapshot("# Note\nnew", snapshot),
    "Different content should not be treated as the same editor snapshot",
  );
}

function testMatchesEditorSnapshotRequiresSnapshot(): void {
  assertFalse(
    matchesEditorSnapshot("# Note\nupdated"),
    "Missing snapshots should not suppress external change detection",
  );
}

runTests("File change detection helpers", [
  testMatchesEditorSnapshotWhenContentMatches,
  testMatchesEditorSnapshotRequiresMatchingContent,
  testMatchesEditorSnapshotRequiresSnapshot,
]);
