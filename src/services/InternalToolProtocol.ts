export const PROPOSE_ACTIVE_NOTE_REPLACEMENT_TOOL = "propose_active_note_replacement";
export const PROPOSE_ACTIVE_SELECTION_REPLACEMENT_TOOL = "propose_active_selection_replacement";

export interface ActiveNoteReplacementArgs {
  proposedContent: string;
  message?: string;
}

export interface ActiveSelectionReplacementArgs {
  replacement: string;
  message?: string;
}

export interface CodexActiveNoteReplacementEnvelope {
  type: "active_note_replacement";
  message: string;
  proposedContent: string;
}

export interface CodexActiveSelectionReplacementEnvelope {
  type: "active_selection_replacement";
  message: string;
  replacement: string;
}

export const ACTIVE_NOTE_REPLACEMENT_TOOL_SCHEMA = {
  type: "object",
  properties: {
    proposedContent: {
      type: "string",
      description: "The full replacement content for the active markdown note.",
    },
    message: {
      type: "string",
      description: "A short summary of the proposed note update to show in chat.",
    },
  },
  required: ["proposedContent"],
  additionalProperties: false,
};

export const ACTIVE_SELECTION_REPLACEMENT_TOOL_SCHEMA = {
  type: "object",
  properties: {
    replacement: {
      type: "string",
      description: "The replacement text for the current editor selection.",
    },
    message: {
      type: "string",
      description: "A short summary of the proposed selection update to show in chat.",
    },
  },
  required: ["replacement"],
  additionalProperties: false,
};

export function buildCodexEditInstruction(): string {
  return [
    "If you want to replace the currently active markdown note or the current editor selection, do not describe the replacement in prose.",
    "Instead, respond with a single JSON object and nothing else.",
    "Use one of these exact shapes:",
    "{\"type\":\"active_note_replacement\",\"message\":\"short summary\",\"proposedContent\":\"full replacement content\"}",
    "{\"type\":\"active_selection_replacement\",\"message\":\"short summary\",\"replacement\":\"replacement text for the current selection\"}",
    `If tool calling is available, prefer calling "${PROPOSE_ACTIVE_NOTE_REPLACEMENT_TOOL}" or "${PROPOSE_ACTIVE_SELECTION_REPLACEMENT_TOOL}" instead of returning JSON.`,
    "For normal answers that do not propose replacing the active note, respond normally in markdown.",
  ].join("\n");
}

export function buildToolUseInstruction(hasSelection: boolean): string {
  const selectionRule = hasSelection
    ? `If the user asks to change only the selected text, call "${PROPOSE_ACTIVE_SELECTION_REPLACEMENT_TOOL}" instead of rewriting the whole note.`
    : `If the user asks to change the active note, call "${PROPOSE_ACTIVE_NOTE_REPLACEMENT_TOOL}" instead of pasting a rewritten note in prose.`;

  return [
    "When the user asks you to modify note content, use the available edit tools rather than responding with raw replacement text.",
    selectionRule,
    `Use "${PROPOSE_ACTIVE_NOTE_REPLACEMENT_TOOL}" only when the requested change genuinely applies to the whole active note.`,
    "For non-edit requests, answer normally.",
  ].join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseCodexEditEnvelope(
  response: string,
): CodexActiveNoteReplacementEnvelope | CodexActiveSelectionReplacementEnvelope | null {
  const trimmed = response.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  const message = typeof parsed.message === "string" ? parsed.message.trim() : "";
  if (!message) {
    return null;
  }

  if (parsed.type === "active_note_replacement") {
    const proposedContent = typeof parsed.proposedContent === "string"
      ? parsed.proposedContent.trim()
      : "";

    if (!proposedContent) {
      return null;
    }

    return {
      type: "active_note_replacement",
      message,
      proposedContent,
    };
  }

  if (parsed.type === "active_selection_replacement") {
    const replacement = typeof parsed.replacement === "string"
      ? parsed.replacement.trim()
      : "";

    if (!replacement) {
      return null;
    }

    return {
      type: "active_selection_replacement",
      message,
      replacement,
    };
  }

  return null;
}
