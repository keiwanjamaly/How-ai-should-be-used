import { diffLines } from "diff";
import { describe, expect, it } from "vitest";
import { DiffService } from "../services/DiffService.ts";

function createDiffService(): DiffService {
  return new DiffService(null as never);
}

describe("DiffService tests", () => {
  it("detects added and modified lines with diffLines", () => {
    const oldContent = "Line 1\nLine 2\nLine 3\n";
    const newContent = "Line 1\nLine 2 Modified\nLine 3\nLine 4\n";

    const changes = diffLines(oldContent, newContent);

    expect(changes.length).toBeGreaterThanOrEqual(2);
    expect(changes.some((change) => change.added && change.value.includes("Line 4"))).toBe(true);
    expect(changes.some(
      (change) =>
        (change.added && change.value.includes("Line 2 Modified")) ||
        (change.removed && change.value.includes("Line 2\n")),
    )).toBe(true);
  });

  it("handles empty old content", () => {
    const changes = diffLines("", "New line\n");

    expect(changes).toHaveLength(1);
    expect(changes[0]?.added).toBe(true);
    expect(changes[0]?.value).toBe("New line\n");
  });

  it("reports no-op diffs as unchanged", () => {
    const changes = diffLines("Line 1\nLine 2\nLine 3\n", "Line 1\nLine 2\nLine 3\n");

    expect(changes).toHaveLength(1);
    expect(changes[0]?.added).toBeFalsy();
    expect(changes[0]?.removed).toBeFalsy();
  });

  it("counts added lines correctly", () => {
    const changes = diffLines("Line 1\nLine 2\n", "Line 1\nLine 2\nLine 3\nLine 4\n");
    let addedCount = 0;

    for (const change of changes) {
      if (change.added) {
        addedCount += change.value.split("\n").length - 1;
      }
    }

    expect(addedCount).toBe(2);
  });

  it("detects trailing whitespace changes", () => {
    const changes = diffLines("Line with trailing   \n", "Line with trailing\n");

    expect(changes.some((change) => change.added || change.removed)).toBe(true);
  });

  it("detects complex multi-block changes", () => {
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

    expect(changes.filter((change) => change.added).length).toBeGreaterThan(0);
    expect(changes.filter((change) => change.removed).length).toBeGreaterThan(0);
  });

  it("converts raw diff output to numbered DiffService changes", () => {
    const svc = createDiffService();
    const changes = svc.calculateDiff(
      "Line 1\nLine 2\nLine 3\n",
      "Line 1\nLine 2 Modified\nLine 3\nLine 4\n",
    );

    const unchanged = changes.filter((change) => change.type === "unchanged");
    const added = changes.filter((change) => change.type === "added");
    const removed = changes.filter((change) => change.type === "removed");

    expect(unchanged.length).toBeGreaterThan(0);
    expect(added.length).toBeGreaterThan(0);
    expect(removed.length).toBeGreaterThan(0);

    for (const change of added) {
      expect(change.newLineNumber).toBeDefined();
    }
    for (const change of removed) {
      expect(change.oldLineNumber).toBeDefined();
    }
    for (const change of unchanged) {
      expect(change.oldLineNumber).toBeDefined();
      expect(change.newLineNumber).toBeDefined();
    }
  });

  it("accepts all changes when every added and removed line is selected", () => {
    const svc = createDiffService();
    const oldContent = "Line 1\nLine 2\nLine 3";
    const newContent = "Line 1\nLine 2 Modified\nLine 3\nLine 4";
    const diff = svc.createFileDiff("test.md", oldContent, newContent);

    const acceptedChanges = new Set<number>();
    for (const change of diff.changes) {
      if (change.type === "added") {
        acceptedChanges.add(change.newLineNumber!);
      } else if (change.type === "removed") {
        acceptedChanges.add(change.oldLineNumber!);
      }
    }

    expect(svc.buildContentFromSelections(diff, acceptedChanges, new Set())).toBe(newContent);
  });

  it("rejects all changes when every changed line is rejected", () => {
    const svc = createDiffService();
    const oldContent = "Line 1\nLine 2\nLine 3";
    const newContent = "Line 1\nLine 2 Modified\nLine 3\nLine 4";
    const diff = svc.createFileDiff("test.md", oldContent, newContent);

    const rejectedChanges = new Set<number>();
    for (const change of diff.changes) {
      if (change.type === "added") {
        rejectedChanges.add(change.newLineNumber!);
      } else if (change.type === "removed") {
        rejectedChanges.add(change.oldLineNumber!);
      }
    }

    expect(svc.buildContentFromSelections(diff, new Set(), rejectedChanges)).toBe(oldContent);
  });

  it("supports selective cherry-picking", () => {
    const svc = createDiffService();
    const oldContent = "Alpha\nBravo\nCharlie";
    const newContent = "Alpha\nBravo Modified\nCharlie\nDelta";
    const diff = svc.createFileDiff("test.md", oldContent, newContent);

    const acceptedChanges = new Set<number>();
    const rejectedChanges = new Set<number>();
    for (const change of diff.changes) {
      if (change.type === "added" && change.content === "Delta") {
        acceptedChanges.add(change.newLineNumber!);
      } else if (change.type === "added" && change.content === "Bravo Modified") {
        rejectedChanges.add(change.newLineNumber!);
      } else if (change.type === "removed" && change.content === "Bravo") {
        rejectedChanges.add(change.oldLineNumber!);
      }
    }

    expect(svc.buildContentFromSelections(diff, acceptedChanges, rejectedChanges)).toBe(
      "Alpha\nBravo\nCharlie\nDelta",
    );
  });

  it("prefers rejection when a removed line is both accepted and rejected", () => {
    const svc = createDiffService();
    const oldContent = "Keep\nRemoveMe";
    const newContent = "Keep";
    const diff = svc.createFileDiff("test.md", oldContent, newContent);
    const removedLine = diff.changes.find((change) => change.type === "removed");

    expect(removedLine).toBeDefined();

    const lineNumber = removedLine!.oldLineNumber!;
    const acceptedChanges = new Set<number>([lineNumber]);
    const rejectedChanges = new Set<number>([lineNumber]);

    expect(svc.buildContentFromSelections(diff, acceptedChanges, rejectedChanges)).toBe(oldContent);
  });

  it("defaults unselected changes back to the old content", () => {
    const svc = createDiffService();
    const oldContent = "First\nSecond\nThird";
    const newContent = "First\nThird\nFourth";
    const diff = svc.createFileDiff("test.md", oldContent, newContent);

    expect(svc.buildContentFromSelections(diff, new Set(), new Set())).toBe(oldContent);
  });

  it("returns content and stats for generated cherry-pick results", () => {
    const svc = createDiffService();
    const diff = svc.createFileDiff("test.md", "A\nB\n", "A\nB\nC\n");
    const addedLine = diff.changes.find((change) => change.type === "added");

    expect(addedLine).toBeDefined();

    const result = svc.generateCherryPickResult(
      diff,
      new Set<number>([addedLine!.newLineNumber!]),
      new Set(),
    );

    expect(result.content).toContain("C");
    expect(typeof result.stats).toBe("object");
    expect(result.stats.modified).toBeGreaterThanOrEqual(0);
  });
});
