import { App, PluginSettingTab, Setting } from "obsidian";
import type ObsidianAIChatPlugin from "./main";
import { DEFAULT_SETTINGS } from "./types";

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
      .setName("Favourite models")
      .setDesc("One model slug per line. These appear in the model selector in the chat header.")
      .addTextArea((text) => {
        text
          .setPlaceholder("openai/gpt-4o-mini\nanthropic/claude-3.5-sonnet")
          .setValue(this.plugin.settings.favoriteModels.join("\n"))
          .onChange(async (value) => {
            const models = value
              .split("\n")
              .map((s) => s.trim())
              .filter((s) => s.length > 0);
            this.plugin.settings.favoriteModels =
              models.length > 0 ? models : DEFAULT_SETTINGS.favoriteModels;
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 5;
        text.inputEl.addClass("oa-settings-textarea");
      });

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
