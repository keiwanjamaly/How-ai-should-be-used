import { describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import { DEFAULT_SETTINGS, type ObsidianAIChatSettings } from "../types.ts";
import {
  BibPDFContextService,
  extractFirstBibKey,
  resolveBibAttachmentPath,
} from "../services/BibPDFContextService.ts";

function createSettings(
  overrides: Partial<ObsidianAIChatSettings> = {},
): ObsidianAIChatSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...overrides,
    openRouter: {
      ...DEFAULT_SETTINGS.openRouter,
      ...overrides.openRouter,
    },
    chatgpt: {
      ...DEFAULT_SETTINGS.chatgpt,
      ...overrides.chatgpt,
    },
    pdf: {
      ...DEFAULT_SETTINGS.pdf,
      ...overrides.pdf,
    },
    vaultRAG: {
      ...DEFAULT_SETTINGS.vaultRAG,
      ...overrides.vaultRAG,
    },
  };
}

function createMarkdownFile(path: string): TFile {
  const file = new TFile();
  file.path = path;
  return file;
}

function createApp(options: {
  noteContent?: string;
  bibPluginSettings?: Record<string, unknown>;
  citationPluginSettings?: Record<string, unknown>;
  vaultBibPath?: string;
  bibContentByPath?: Record<string, string>;
}) {
  const {
    noteContent = "",
    bibPluginSettings,
    citationPluginSettings,
    vaultBibPath,
    bibContentByPath = {},
  } = options;

  return {
    vault: {
      configDir: ".obsidian",
      cachedRead: vi.fn(async (file: TFile) => {
        if (file.path.endsWith(".md")) {
          return noteContent;
        }

        return bibContentByPath[file.path] ?? "";
      }),
      getAbstractFileByPath: vi.fn((path: string) => {
        if (path === vaultBibPath) {
          const file = new TFile();
          file.path = path;
          return file;
        }
        return null;
      }),
      adapter: {
        read: vi.fn(async (path: string) => {
          if (path.endsWith("bibtex-entry-view/data.json")) {
            if (bibPluginSettings === undefined) {
              throw new Error("missing");
            }
            return JSON.stringify(bibPluginSettings);
          }

          if (path.endsWith("obsidian-citation-plugin/data.json")) {
            if (citationPluginSettings === undefined) {
              throw new Error("missing");
            }
            return JSON.stringify(citationPluginSettings);
          }

          throw new Error(`unexpected path ${path}`);
        }),
      },
    },
  };
}

describe("BibPDFContextService helpers", () => {
  it("extracts the first bibkey block", () => {
    expect(extractFirstBibKey("Text\n```bibkey\nKEY123\n```\nMore")).toBe("KEY123");
  });

  it("resolves JabRef attachment filenames against the configured folder", () => {
    expect(resolveBibAttachmentPath(
      ":Folder/Example Paper.pdf:PDF;:Other.epub:EPUB",
      "/tmp/pdfs",
    )).toEqual({
      path: "/tmp/pdfs/Example Paper.pdf",
      filename: "Example Paper.pdf",
    });
  });
});

describe("BibPDFContextService", () => {
  it("resolves a bib-linked PDF via Bibtex Entry View settings", async () => {
    const app = createApp({
      noteContent: "```bibkey\nKURGANOV2000241\n```",
      bibPluginSettings: { bibFilePath: "Library.bib" },
      vaultBibPath: "Library.bib",
      bibContentByPath: {
        "Library.bib": "@Article{KURGANOV2000241,\n  file = {:Kurganov.pdf:PDF},\n}\n",
      },
    });
    const service = new BibPDFContextService(
      app as never,
      () => createSettings({ pdf: { ...DEFAULT_SETTINGS.pdf, bibAttachmentRoot: "/tmp/pdfs" } }),
      async () => "",
      async (path) => path === "/tmp/pdfs/Kurganov.pdf",
    );

    const result = await service.resolveForActiveFile(createMarkdownFile("Notes/Test.md"), true);

    expect(result).toEqual({
      notePath: "Notes/Test.md",
      bibKey: "KURGANOV2000241",
      bibPath: "Library.bib",
      pdfPath: "/tmp/pdfs/Kurganov.pdf",
      filename: "Kurganov.pdf",
    });
  });

  it("falls back to citation plugin export path when Bibtex Entry View is unavailable", async () => {
    const absoluteBibPath = "/Users/test/Library.bib";
    const service = new BibPDFContextService(
      createApp({
        noteContent: "```bibkey\nKURGANOV2000241\n```",
        citationPluginSettings: { citationExportPath: absoluteBibPath },
      }) as never,
      () => createSettings({ pdf: { ...DEFAULT_SETTINGS.pdf, bibAttachmentRoot: "/tmp/pdfs" } }),
      async (path) => {
        if (path === absoluteBibPath) {
          return "@Article{KURGANOV2000241,\n  file = {:Kurganov.pdf:PDF},\n}\n";
        }
        throw new Error("missing");
      },
      async (path) => path === "/tmp/pdfs/Kurganov.pdf",
    );

    const result = await service.resolveForActiveFile(createMarkdownFile("Notes/Test.md"), true);

    expect(result).toEqual({
      notePath: "Notes/Test.md",
      bibKey: "KURGANOV2000241",
      bibPath: absoluteBibPath,
      pdfPath: "/tmp/pdfs/Kurganov.pdf",
      filename: "Kurganov.pdf",
    });
  });

  it("reports a missing PDF root when the attachment is relative", async () => {
    const app = createApp({
      noteContent: "```bibkey\nKURGANOV2000241\n```",
      bibPluginSettings: { bibFilePath: "Library.bib" },
      vaultBibPath: "Library.bib",
      bibContentByPath: {
        "Library.bib": "@Article{KURGANOV2000241,\n  file = {:Kurganov.pdf:PDF},\n}\n",
      },
    });
    const service = new BibPDFContextService(
      app as never,
      () => createSettings(),
      async () => "",
      async () => false,
    );

    await expect(service.resolveForActiveFile(createMarkdownFile("Notes/Test.md"), true)).resolves.toEqual({
      reason: "bib-pdf-root-missing",
    });
  });
});
