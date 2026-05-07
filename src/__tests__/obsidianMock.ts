export class App {}
export class ButtonComponent {}
export class Component {}
export class ItemView {}
export class MarkdownView {}
export class Modal {}
export class Notice {}
export class Plugin {}
export class PluginSettingTab {}
export class Setting {}
export class TFile {
  path = "";
}
export class Vault {}
export class WorkspaceLeaf {}

export const Platform = {
  isDesktop: true,
  isMobile: false,
};

export const editorInfoField = {};

export function normalizePath(path: string): string {
  return path;
}

export function setIcon(): void {}

export const MarkdownRenderer = {
  render: async () => {},
};

export async function requestUrl(): Promise<{ status: number; json: unknown }> {
  return {
    status: 200,
    json: {},
  };
}
