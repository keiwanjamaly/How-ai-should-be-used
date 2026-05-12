import type { VaultChunk } from "../../services/VaultRAGService";

export type DraftRAGPreviewPhase = "idle" | "waiting" | "computing";

export interface DraftRAGPreviewState {
  phase: DraftRAGPreviewPhase;
  progress: number;
  chunks: VaultChunk[];
}

export interface DraftRAGPreviewControllerOptions {
  idleMs: number;
  tickMs: number;
  retrieveRelevantChunks: (query: string, activeFilePath?: string) => Promise<VaultChunk[]>;
  getActiveFilePath: () => string | undefined;
  getCurrentDraft: () => string;
  onStateChange: (state: DraftRAGPreviewState) => void;
}

export class DraftRAGPreviewController {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private requestId = 0;
  private pluginEnabled = false;
  private localEnabled = false;
  private busy = false;
  private state: DraftRAGPreviewState = {
    phase: "idle",
    progress: 0,
    chunks: [],
  };

  constructor(private readonly options: DraftRAGPreviewControllerOptions) {}

  getState(): DraftRAGPreviewState {
    return {
      phase: this.state.phase,
      progress: this.state.progress,
      chunks: [...this.state.chunks],
    };
  }

  setAvailability(pluginEnabled: boolean, localEnabled: boolean): void {
    this.pluginEnabled = pluginEnabled;
    this.localEnabled = localEnabled;
    if (!pluginEnabled || !localEnabled) {
      this.clear();
    }
  }

  setBusy(isBusy: boolean): void {
    this.busy = isBusy;
    if (isBusy) {
      this.clear();
    }
  }

  schedule(draft: string): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (!this.shouldPreview(draft)) {
      this.clear();
      return;
    }

    this.startWaiting();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.refresh(draft);
    }, this.options.idleMs);
  }

  clear(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    this.stopTicking();
    this.requestId += 1;
    this.publish({
      phase: "idle",
      progress: 0,
      chunks: [],
    });
  }

  private shouldPreview(draft: string): boolean {
    return this.pluginEnabled && this.localEnabled && !this.busy && draft.length > 0;
  }

  private async refresh(draft: string): Promise<void> {
    if (!this.shouldPreview(draft)) {
      this.clear();
      return;
    }

    const requestId = ++this.requestId;
    this.stopTicking();
    this.publish({
      phase: "computing",
      progress: 1,
      chunks: [],
    });

    try {
      const chunks = await this.options.retrieveRelevantChunks(
        draft,
        this.options.getActiveFilePath(),
      );

      if (requestId !== this.requestId) {
        return;
      }

      const currentDraft = this.options.getCurrentDraft().trim();
      if (!this.shouldPreview(currentDraft) || currentDraft !== draft) {
        return;
      }

      this.publish({
        phase: "idle",
        progress: 0,
        chunks,
      });
    } catch {
      if (requestId !== this.requestId) {
        return;
      }

      this.publish({
        phase: "idle",
        progress: 0,
        chunks: [],
      });
    }
  }

  private startWaiting(): void {
    this.stopTicking();
    this.publish({
      phase: "waiting",
      progress: 0,
      chunks: [],
    });
    this.tickTimer = setInterval(() => {
      if (this.state.phase !== "waiting") {
        this.stopTicking();
        return;
      }

      const progress = Math.min(
        this.state.progress + (this.options.tickMs / this.options.idleMs),
        1,
      );
      this.publish({
        phase: "waiting",
        progress,
        chunks: [],
      });

      if (progress >= 1) {
        this.stopTicking();
      }
    }, this.options.tickMs);
  }

  private stopTicking(): void {
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private publish(state: DraftRAGPreviewState): void {
    this.state = state;
    this.options.onStateChange(this.getState());
  }
}
