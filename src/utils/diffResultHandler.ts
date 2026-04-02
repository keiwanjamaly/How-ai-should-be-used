import { Notice, TFile } from "obsidian";
import type { DiffModalResult } from "../components/DiffModal";
import type { DiffService } from "../services/DiffService";
import { formatErrorMessage } from "./errorUtils";

export interface DiffResultHandlerOptions {
  /** Called after successfully applying changes (accept or cherry-pick) */
  onApplied?: () => void | Promise<void>;
  /** Called when the user rejects changes. If not provided, a default "Changes rejected" notice is shown. */
  onRejected?: () => void | Promise<void>;
}

/**
 * Shared handler for DiffModal results. Both the plugin's showDiffModal and
 * ChatView's showDiffForChanges use the same accept/cherry-pick/reject logic;
 * this function consolidates it in one place.
 */
export async function handleDiffResult(
  result: DiffModalResult,
  file: TFile,
  diffService: DiffService,
  markAsSelfModified: (path: string) => void,
  options: DiffResultHandlerOptions = {},
): Promise<void> {
  if (result.action === "accept" && result.content) {
    try {
      markAsSelfModified(file.path);
      await diffService.acceptChanges(file, result.content);
      new Notice("Changes applied successfully");
      await options.onApplied?.();
    } catch (error) {
      new Notice(`Failed to apply changes: ${formatErrorMessage(error)}`);
    }
  } else if (result.action === "cherry-pick" && result.content) {
    try {
      markAsSelfModified(file.path);
      await diffService.acceptChanges(file, result.content);
      const accepted = result.acceptedLines?.size || 0;
      const rejected = result.rejectedLines?.size || 0;
      new Notice(`Applied ${accepted} changes, rejected ${rejected}`);
      await options.onApplied?.();
    } catch (error) {
      new Notice(
        `Failed to apply selected changes: ${formatErrorMessage(error)}`,
      );
    }
  } else if (result.action === "reject") {
    if (options.onRejected) {
      await options.onRejected();
    } else {
      new Notice("Changes rejected");
    }
  }
}
