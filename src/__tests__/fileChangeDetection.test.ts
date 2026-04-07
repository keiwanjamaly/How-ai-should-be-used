import {
  isRecentLocalEdit,
  LOCAL_EDIT_GRACE_PERIOD_MS,
} from "../utils/fileChangeDetection.ts";
import { assertFalse, assertTrue, runTests } from "./testUtils.ts";

function testRecentLocalEditMatchesWithinGracePeriod(): void {
  const now = 10_000;
  const currentContent = "# Note\nupdated";
  const snapshot = {
    content: currentContent,
    timestamp: now - 500,
  };

  assertTrue(
    isRecentLocalEdit(currentContent, snapshot, now),
    "Matching editor content inside the grace period should count as a local edit",
  );
}

function testRecentLocalEditRequiresMatchingContent(): void {
  const now = 10_000;
  const snapshot = {
    content: "# Note\nold",
    timestamp: now - 500,
  };

  assertFalse(
    isRecentLocalEdit("# Note\nnew", snapshot, now),
    "Different content should not be treated as the same local edit",
  );
}

function testRecentLocalEditExpires(): void {
  const now = 10_000;
  const currentContent = "# Note\nupdated";
  const snapshot = {
    content: currentContent,
    timestamp: now - LOCAL_EDIT_GRACE_PERIOD_MS - 1,
  };

  assertFalse(
    isRecentLocalEdit(currentContent, snapshot, now),
    "Old editor snapshots should not suppress external change detection",
  );
}

runTests("File change detection helpers", [
  testRecentLocalEditMatchesWithinGracePeriod,
  testRecentLocalEditRequiresMatchingContent,
  testRecentLocalEditExpires,
]);
