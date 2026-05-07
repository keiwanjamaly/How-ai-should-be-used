import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet } from "@codemirror/view";
import { editorInfoField } from "obsidian";

interface HighlightRange {
  from: number;
  to: number;
}

interface HighlightState {
  range: HighlightRange | null;
  decorations: DecorationSet;
}

const cachedSelectionHighlightMark = Decoration.mark({
  class: "cm-oa-cached-selection",
});

const setCachedSelectionHighlightEffect = StateEffect.define<HighlightRange | null>();

const cachedSelectionHighlightField = StateField.define<HighlightState>({
  create() {
    return {
      range: null,
      decorations: Decoration.none,
    };
  },
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setCachedSelectionHighlightEffect)) {
        return createHighlightState(effect.value);
      }
    }

    if (!value.range || !transaction.docChanged) {
      return value;
    }

    const from = transaction.changes.mapPos(value.range.from, 1);
    const to = transaction.changes.mapPos(value.range.to, -1);
    const nextRange = from < to ? { from, to } : null;

    return {
      range: nextRange,
      decorations: nextRange
        ? value.decorations.map(transaction.changes)
        : Decoration.none,
    };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

const trackedEditorViews = new Set<EditorView>();
let activeHighlight: { filePath: string; range: HighlightRange } | null = null;

function createHighlightState(range: HighlightRange | null): HighlightState {
  if (!range || range.from >= range.to) {
    return {
      range: null,
      decorations: Decoration.none,
    };
  }

  return {
    range,
    decorations: Decoration.set([cachedSelectionHighlightMark.range(range.from, range.to)]),
  };
}

function getEditorFilePath(view: EditorView): string | null {
  const info = view.state.field(editorInfoField, false);
  const file = info?.file;
  return file?.path ?? null;
}

function syncHighlightForView(view: EditorView): void {
  const filePath = getEditorFilePath(view);
  const nextRange = activeHighlight && filePath === activeHighlight.filePath
    ? activeHighlight.range
    : null;
  const currentState = view.state.field(cachedSelectionHighlightField);
  const currentRange = currentState.range;
  const unchanged =
    currentRange?.from === nextRange?.from
    && currentRange?.to === nextRange?.to;

  if (unchanged) {
    return;
  }

  view.dispatch({
    effects: setCachedSelectionHighlightEffect.of(nextRange),
  });
}

export const cachedSelectionHighlightExtension: Extension = [
  cachedSelectionHighlightField,
  ViewPlugin.fromClass(class {
    constructor(private readonly view: EditorView) {
      trackedEditorViews.add(view);
      syncHighlightForView(view);
    }

    update() {
      syncHighlightForView(this.view);
    }

    destroy() {
      trackedEditorViews.delete(this.view);
    }
  }),
];

export function setCachedSelectionHighlight(
  filePath: string,
  range: HighlightRange,
): void {
  activeHighlight = {
    filePath,
    range,
  };

  for (const view of trackedEditorViews) {
    syncHighlightForView(view);
  }
}

export function clearCachedSelectionHighlight(): void {
  activeHighlight = null;

  for (const view of trackedEditorViews) {
    syncHighlightForView(view);
  }
}
