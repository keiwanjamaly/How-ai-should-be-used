import { App, TFile, normalizePath } from "obsidian";
import type { ObsidianAIChatSettings } from "../types";

export interface BibPDFContext {
  notePath: string;
  bibKey: string;
  bibPath: string;
  pdfPath: string;
  filename: string;
}

export interface BibPDFContextFailure {
  reason:
    | "no-active-file"
    | "file-context-disabled"
    | "not-markdown"
    | "no-bibkey"
    | "bib-plugin-config-missing"
    | "bib-file-not-found"
    | "bib-entry-missing"
    | "bib-pdf-field-missing"
    | "bib-pdf-root-missing"
    | "pdf-file-not-found";
  detail?: string;
}

interface CitationPluginSettings {
  citationExportPath?: string;
}

interface BibtexEntryViewSettings {
  bibFilePath?: string;
}

interface BibFileSource {
  kind: "vault" | "absolute";
  path: string;
}

export function extractFirstBibKey(noteContent: string): string | null {
  const match = /```bibkey\s*\n([\s\S]*?)\n```/m.exec(noteContent);
  const key = match?.[1]?.trim();
  return key || null;
}

function splitBibEntries(bibContent: string): string[] {
  return bibContent.split(/^@/m)
    .map((entry, index) => (index === 0 ? entry : `@${entry}`))
    .filter((entry) => entry.trim().startsWith("@"));
}

function findBibEntry(bibContent: string, bibKey: string): string | null {
  const normalizedKey = bibKey.trim().toLowerCase();
  for (const entry of splitBibEntries(bibContent)) {
    const header = /^@\s*[^{]+\{\s*([^,\s]+)\s*,/m.exec(entry);
    if (header?.[1]?.trim().toLowerCase() === normalizedKey) {
      return entry;
    }
  }
  return null;
}

function extractBibField(entry: string, fieldName: string): string | null {
  const fieldRegex = new RegExp(`\\b${fieldName}\\s*=\\s*([\\s\\S]*?)(?:,\\s*\\n\\s*[A-Za-z][\\w-]*\\s*=|\\s*\\n\\})`, "i");
  const match = fieldRegex.exec(entry);
  if (!match) {
    return null;
  }

  let value = match[1].trim().replace(/,$/, "").trim();
  if (
    (value.startsWith("{") && value.endsWith("}"))
    || (value.startsWith("\"") && value.endsWith("\""))
  ) {
    value = value.slice(1, -1).trim();
  }

  return value || null;
}

function parseJabRefAttachment(fileField: string): string | null {
  const candidates = fileField.split(";")
    .map((candidate) => candidate.trim())
    .filter(Boolean);

  for (const candidate of candidates) {
    const parts = candidate.split(":");
    const path = parts.length >= 3
      ? parts[1]?.trim()
      : candidate.trim();
    if (path?.toLowerCase().endsWith(".pdf")) {
      return path;
    }
  }

  return null;
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

export function resolveBibAttachmentPath(
  fileField: string,
  attachmentRoot: string,
): { path: string; filename: string } | null {
  const attachment = parseJabRefAttachment(fileField);
  if (!attachment) {
    return null;
  }

  if (isAbsolutePath(attachment)) {
    return {
      path: attachment,
      filename: attachment.split(/[\\/]/).pop() ?? attachment,
    };
  }

  if (!attachmentRoot.trim()) {
    return null;
  }

  const filename = attachment.split(/[\\/]/).pop()?.trim();
  if (!filename) {
    return null;
  }

  return {
    path: normalizePath(`${attachmentRoot.replace(/[\\/]+$/, "")}/${filename}`),
    filename,
  };
}

export class BibPDFContextService {
  constructor(
    private readonly app: App,
    private readonly getSettings: () => ObsidianAIChatSettings,
    private readonly readAbsoluteTextFile: (path: string) => Promise<string>,
    private readonly absoluteFileExists: (path: string) => Promise<boolean>,
  ) {}

  async resolveForActiveFile(
    activeFile: TFile | null,
    includeFileContext: boolean,
  ): Promise<BibPDFContext | BibPDFContextFailure> {
    if (!includeFileContext) {
      return { reason: "file-context-disabled" };
    }

    if (!activeFile) {
      return { reason: "no-active-file" };
    }

    if (!activeFile.path.toLowerCase().endsWith(".md")) {
      return { reason: "not-markdown" };
    }

    const noteContent = await this.app.vault.cachedRead(activeFile);
    const bibKey = extractFirstBibKey(noteContent);
    if (!bibKey) {
      return { reason: "no-bibkey" };
    }

    const bibSource = await this.resolveBibFilePath();
    if (!bibSource) {
      return { reason: "bib-plugin-config-missing" };
    }

    const bibContent = await this.readBibFile(bibSource);
    if (!bibContent) {
      return { reason: "bib-file-not-found", detail: bibSource.path };
    }

    const entry = findBibEntry(bibContent, bibKey);
    if (!entry) {
      return { reason: "bib-entry-missing", detail: bibKey };
    }

    const fileField = extractBibField(entry, "file");
    if (!fileField) {
      return { reason: "bib-pdf-field-missing", detail: bibKey };
    }

    const attachment = resolveBibAttachmentPath(
      fileField,
      this.getSettings().pdf.bibAttachmentRoot,
    );
    if (!attachment) {
      return this.getSettings().pdf.bibAttachmentRoot.trim()
        ? { reason: "bib-pdf-field-missing", detail: fileField }
        : { reason: "bib-pdf-root-missing" };
    }

    if (!await this.absoluteFileExists(attachment.path)) {
      return { reason: "pdf-file-not-found", detail: attachment.path };
    }

    return {
      notePath: activeFile.path,
      bibKey,
      bibPath: bibSource.path,
      pdfPath: attachment.path,
      filename: attachment.filename,
    };
  }

  private async resolveBibFilePath(): Promise<BibFileSource | null> {
    const bibtexSettingsPath = `${this.app.vault.configDir}/plugins/bibtex-entry-view/data.json`;
    const bibtexSettings = await this.readJSONFile<BibtexEntryViewSettings>(bibtexSettingsPath, false);
    const vaultBibPath = bibtexSettings?.bibFilePath?.trim();
    if (vaultBibPath) {
      return { kind: "vault", path: normalizePath(vaultBibPath) };
    }

    const citationSettingsPath = `${this.app.vault.configDir}/plugins/obsidian-citation-plugin/data.json`;
    const citationSettings = await this.readJSONFile<CitationPluginSettings>(citationSettingsPath, false);
    const citationPath = citationSettings?.citationExportPath?.trim();
    return citationPath ? { kind: "absolute", path: citationPath } : null;
  }

  private async readBibFile(source: BibFileSource): Promise<string | null> {
    if (source.kind === "vault") {
      const file = this.app.vault.getAbstractFileByPath(source.path);
      if (!(file instanceof TFile)) {
        return null;
      }

      return this.app.vault.cachedRead(file);
    }

    try {
      return await this.readAbsoluteTextFile(source.path);
    } catch {
      return null;
    }
  }

  private async readJSONFile<T>(path: string, absolute: boolean): Promise<T | null> {
    try {
      const content = absolute
        ? await this.readAbsoluteTextFile(path)
        : await this.app.vault.adapter.read(path);
      return JSON.parse(content) as T;
    } catch {
      return null;
    }
  }
}
