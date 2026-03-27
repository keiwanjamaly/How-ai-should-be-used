import { App, PluginSettingTab, Setting } from "obsidian";
import type ObsidianAIChatPlugin from "./main";

export class ObsidianAIChatSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: ObsidianAIChatPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Obsidian AI Chat settings" });

    new Setting(containerEl)
      .setName("OpenRouter API key")
      .setDesc("Used to authenticate requests to OpenRouter.")
      .addText((text) => {
        text.inputEl.type = "password";

        return text
          .setPlaceholder("sk-or-v1-...")
          .setValue(this.plugin.settings.openRouter.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.openRouter.apiKey = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("OpenRouter model")
      .setDesc("Model slug, e.g. openai/gpt-4o-mini.")
      .addText((text) =>
        text
          .setPlaceholder("openai/gpt-4o-mini")
          .setValue(this.plugin.settings.openRouter.model)
          .onChange(async (value) => {
            this.plugin.settings.openRouter.model = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("System prompt")
      .setDesc("Optional default system prompt added before each chat request.")
      .addTextArea((text) => {
        text
          .setPlaceholder("You are a helpful assistant.")
          .setValue(this.plugin.settings.systemPrompt)
          .onChange(async (value) => {
            this.plugin.settings.systemPrompt = value;
            await this.plugin.saveSettings();
          });

        text.inputEl.rows = 6;
        text.inputEl.addClass("oa-settings-textarea");
      });
  }
}
