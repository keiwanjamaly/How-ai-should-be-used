import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DraftRAGPreviewController } from "../views/chat/DraftRAGPreviewController.ts";

describe("DraftRAGPreviewController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("enters waiting state, computes, and publishes retrieved chunks", async () => {
    const states: Array<{ phase: string; progress: number; count: number }> = [];
    let draft = "hello";

    const controller = new DraftRAGPreviewController({
      idleMs: 5000,
      tickMs: 50,
      retrieveRelevantChunks: vi.fn().mockResolvedValue([
        { path: "Notes/A.md", title: "A", content: "Chunk" },
      ]),
      getActiveFilePath: () => "Notes/Active.md",
      getCurrentDraft: () => draft,
      onStateChange: (state) => {
        states.push({ phase: state.phase, progress: state.progress, count: state.chunks.length });
      },
    });

    controller.setAvailability(true, true);
    controller.schedule(draft);

    expect(states[states.length - 1]).toEqual({ phase: "waiting", progress: 0, count: 0 });

    await vi.advanceTimersByTimeAsync(5000);
    await Promise.resolve();

    expect(states.some((state) => state.phase === "computing")).toBe(true);
    expect(states[states.length - 1]).toEqual({ phase: "idle", progress: 0, count: 1 });
  });

  it("clears stale results when the draft changes before retrieval completes", async () => {
    let resolveChunks!: (value: Array<{ path: string; title: string; content: string }>) => void;
    let draft = "first";
    const lastStates: string[] = [];

    const controller = new DraftRAGPreviewController({
      idleMs: 100,
      tickMs: 10,
      retrieveRelevantChunks: vi.fn().mockImplementation(() => new Promise<Array<{ path: string; title: string; content: string }>>((resolve) => {
        resolveChunks = resolve;
      })),
      getActiveFilePath: () => "Notes/Active.md",
      getCurrentDraft: () => draft,
      onStateChange: (state) => {
        lastStates.push(`${state.phase}:${state.chunks.length}`);
      },
    });

    controller.setAvailability(true, true);
    controller.schedule(draft);
    await vi.advanceTimersByTimeAsync(100);
    draft = "second";
    controller.schedule(draft);

    resolveChunks([{ path: "Notes/A.md", title: "A", content: "Chunk" }]);
    await Promise.resolve();

    expect(lastStates[lastStates.length - 1]).toBe("waiting:0");
  });

  it("clears immediately when busy", () => {
    const states: string[] = [];
    const controller = new DraftRAGPreviewController({
      idleMs: 100,
      tickMs: 10,
      retrieveRelevantChunks: vi.fn(),
      getActiveFilePath: () => undefined,
      getCurrentDraft: () => "query",
      onStateChange: (state) => {
        states.push(`${state.phase}:${state.chunks.length}`);
      },
    });

    controller.setAvailability(true, true);
    controller.schedule("query");
    controller.setBusy(true);

    expect(states[states.length - 1]).toBe("idle:0");
  });
});
