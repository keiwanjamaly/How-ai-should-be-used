import { App, Notice, Platform, PluginSettingTab, Setting } from "obsidian";
import type ObsidianAIChatPlugin from "./main";
import {
  formatMCPServers,
  parseMCPServers,
  type MCPTool,
} from "./types/mcp";
import { MCPService } from "./services/MCPService";
import { DEFAULT_SETTINGS } from "./types";
import { getCodexLoginStatus } from "./services/CodexCli";
import { normalizeExtensions } from "./utils/vaultEmbeddings";

export class ObsidianAIChatSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: ObsidianAIChatPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Obsidian AI Chat settings" });

    new Setting(containerEl)
      .setName("Chat provider")
      .setDesc("Choose how the chat panel authenticates and sends requests.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("openrouter", "OpenRouter (API key)")
          .addOption("chatgpt", "ChatGPT via Codex OAuth")
          .setValue(this.plugin.settings.provider)
          .onChange(async (value) => {
            this.plugin.settings.provider = value as "openrouter" | "chatgpt";
            await this.plugin.saveSettings();
            this.display();
          }),
      );

    if (this.plugin.settings.provider === "chatgpt") {
      this.displayChatGPTSettings(containerEl);
    } else {
      this.displayOpenRouterSettings(containerEl);
    }

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

    this.displayVaultRAGSettings(containerEl);

    // MCP Settings Section
    this.displayMCPSettings(containerEl);
  }

  private displayVaultRAGSettings(containerEl: HTMLElement): void {
    containerEl.createEl("h3", { text: "Vault RAG", cls: "oa-settings-section" });

    new Setting(containerEl)
      .setName("Enable vault embeddings")
      .setDesc("Embed eligible text files through OpenRouter, store them on disk, and retrieve the most relevant snippets during chat.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.vaultRAG.enabled)
          .onChange(async (value) => {
            this.plugin.settings.vaultRAG.enabled = value;
            await this.plugin.saveSettings();
            await this.plugin.refreshVaultRAGIndex();
            this.display();
          }),
      );

    if (!this.plugin.settings.vaultRAG.enabled) {
      return;
    }

    if (this.plugin.settings.provider === "chatgpt") {
      new Setting(containerEl)
        .setName("OpenRouter API key for embeddings")
        .setDesc("Vault embeddings use OpenRouter even when chat replies are using Codex OAuth.")
        .addText((text) => {
          text.inputEl.type = "password";
          return text
            .setPlaceholder("sk-or-v1-...")
            .setValue(this.plugin.settings.openRouter.apiKey)
            .onChange(async (value) => {
              this.plugin.settings.openRouter.apiKey = value.trim();
              await this.plugin.saveSettings();
              await this.plugin.refreshVaultRAGIndex();
            });
        });
    } else {
      containerEl.createEl("p", {
        text: "Vault embeddings reuse the OpenRouter API key above and store their SQLite index inside the plugin folder.",
        cls: "oa-settings-desc",
      });
    }

    new Setting(containerEl)
      .setName("Embedding model")
      .setDesc("OpenRouter embedding model slug used for the on-disk vault index.")
      .addText((text) =>
        text
          .setPlaceholder("openai/text-embedding-3-small")
          .setValue(this.plugin.settings.vaultRAG.embeddingModel)
          .onChange(async (value) => {
            this.plugin.settings.vaultRAG.embeddingModel =
              value.trim() || DEFAULT_SETTINGS.vaultRAG.embeddingModel;
            await this.plugin.saveSettings();
            await this.plugin.refreshVaultRAGIndex();
          }),
      );

    new Setting(containerEl)
      .setName("Included file extensions")
      .setDesc("Comma-separated list of text file extensions to embed, for example `.md, .txt`.")
      .addText((text) =>
        text
          .setPlaceholder(".md, .txt")
          .setValue(this.plugin.settings.vaultRAG.includeExtensions.join(", "))
          .onChange(async (value) => {
            const parsed = normalizeExtensions(value.split(","));
            this.plugin.settings.vaultRAG.includeExtensions =
              parsed.length > 0 ? parsed : DEFAULT_SETTINGS.vaultRAG.includeExtensions;
            await this.plugin.saveSettings();
            await this.plugin.refreshVaultRAGIndex();
          }),
      );

    new Setting(containerEl)
      .setName("Max retrieved snippets")
      .setDesc("Upper bound for retrieved vault snippets added to each request.")
      .addText((text) =>
        text
          .setPlaceholder("6")
          .setValue(String(this.plugin.settings.vaultRAG.maxChunks))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            this.plugin.settings.vaultRAG.maxChunks = Number.isFinite(parsed)
              ? Math.max(1, Math.min(parsed, 12))
              : DEFAULT_SETTINGS.vaultRAG.maxChunks;
            await this.plugin.saveSettings();
            await this.plugin.refreshVaultRAGIndex();
          }),
      );

    new Setting(containerEl)
      .setName("Chunk size")
      .setDesc("Approximate characters per indexed note chunk.")
      .addText((text) =>
        text
          .setPlaceholder("1200")
          .setValue(String(this.plugin.settings.vaultRAG.chunkSize))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            this.plugin.settings.vaultRAG.chunkSize = Number.isFinite(parsed)
              ? Math.max(300, Math.min(parsed, 4000))
              : DEFAULT_SETTINGS.vaultRAG.chunkSize;
            await this.plugin.saveSettings();
            await this.plugin.refreshVaultRAGIndex();
          }),
      );

    new Setting(containerEl)
      .setName("Max note size")
      .setDesc("Skip very large markdown files during retrieval to keep chat responsive.")
      .addText((text) =>
        text
          .setPlaceholder("300")
          .setValue(String(this.plugin.settings.vaultRAG.maxFileSizeKB))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            this.plugin.settings.vaultRAG.maxFileSizeKB = Number.isFinite(parsed)
              ? Math.max(25, Math.min(parsed, 2048))
              : DEFAULT_SETTINGS.vaultRAG.maxFileSizeKB;
            await this.plugin.saveSettings();
            await this.plugin.refreshVaultRAGIndex();
          }),
      );
  }

  private displayOpenRouterSettings(containerEl: HTMLElement): void {
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
            if (this.plugin.settings.vaultRAG.enabled) {
              await this.plugin.refreshVaultRAGIndex();
            }
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
      .setName("OCR model")
      .setDesc("Model used to extract text from uploaded PDF files. Must support document input (e.g. mistral/mistral-ocr-latest).")
      .addText((text) =>
        text
          .setPlaceholder("mistral/mistral-ocr-latest")
          .setValue(this.plugin.settings.ocrModel)
          .onChange(async (value) => {
            this.plugin.settings.ocrModel = value.trim() || "mistral/mistral-ocr-latest";
            await this.plugin.saveSettings();
          }),
      );
  }

  private displayChatGPTSettings(containerEl: HTMLElement): void {
    containerEl.createEl("p", {
      text: "This mode uses your local Codex CLI login, which can sign in with ChatGPT via device auth. No API key is stored in the plugin.",
      cls: "oa-settings-desc",
    });

    new Setting(containerEl)
      .setName("Codex CLI path")
      .setDesc("Path to the local Codex CLI binary used for ChatGPT OAuth-backed requests.")
      .addText((text) =>
        text
          .setPlaceholder("codex")
          .setValue(this.plugin.settings.chatgpt.cliPath)
          .onChange(async (value) => {
            this.plugin.settings.chatgpt.cliPath = value.trim() || "codex";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Default Codex model")
      .setDesc("The model preselected in the chat header dropdown.")
      .addText((text) =>
        text
          .setPlaceholder("gpt-5")
          .setValue(this.plugin.settings.chatgpt.model)
          .onChange(async (value) => {
            this.plugin.settings.chatgpt.model = value.trim() || DEFAULT_SETTINGS.chatgpt.model;
            await this.plugin.saveSettings();
          }),
      );

    const modelsStatusEl = containerEl.createEl("p", {
      text: `Available Codex models: ${this.plugin.getSelectableModels().join(", ") || "none cached yet"}`,
      cls: "oa-settings-desc",
    });

    new Setting(containerEl)
      .setName("Available Codex models")
      .setDesc("Fetched from the same Codex backend models endpoint used by the CLI.")
      .addButton((btn) =>
        btn.setButtonText("Refresh models").onClick(async () => {
          btn.setDisabled(true);
          modelsStatusEl.setText("Refreshing Codex models…");
          try {
            const models = await this.plugin.refreshCodexModels(true);
            modelsStatusEl.setText(`Available Codex models: ${models.join(", ") || "none"}`);
            this.display();
          } catch (error) {
            modelsStatusEl.setText(error instanceof Error ? error.message : String(error));
          } finally {
            btn.setDisabled(false);
          }
        }),
      );

    const statusEl = containerEl.createEl("p", {
      text: "Use `codex login --device-auth` in a terminal if you have not signed in yet.",
      cls: "oa-settings-desc",
    });

    new Setting(containerEl)
      .setName("Codex login status")
      .setDesc("Checks whether the local Codex CLI is already authenticated.")
      .addButton((btn) =>
        btn.setButtonText("Check status").onClick(async () => {
          btn.setDisabled(true);
          statusEl.setText("Checking Codex login status…");

          try {
            const status = await getCodexLoginStatus(this.plugin.settings.chatgpt.cliPath);
            statusEl.setText(status.summary);
          } catch (error) {
            statusEl.setText(error instanceof Error ? error.message : String(error));
          } finally {
            btn.setDisabled(false);
          }
        }),
      )
      .addButton((btn) =>
        btn.setButtonText("Copy login command").onClick(async () => {
          const command = `${this.plugin.settings.chatgpt.cliPath || "codex"} login --device-auth`;
          await navigator.clipboard.writeText(command);
          new Notice("Copied Codex login command to clipboard.");
        }),
      );

    containerEl.createEl("p", {
      text: "Plugin-managed MCP tools, PDF OCR, and vault embeddings remain OpenRouter-only for now.",
      cls: "oa-settings-desc",
    });
  }

  /**
   * Display MCP (Model Context Protocol) settings section
   */
  private displayMCPSettings(containerEl: HTMLElement): void {
    containerEl.createEl("h3", { text: "MCP Servers", cls: "oa-settings-section" });

    // Add explanatory text
    const desc = containerEl.createEl("p", {
      text: "Configure Model Context Protocol (MCP) servers to extend AI capabilities with custom tools. MCP servers are only available on desktop platforms.",
      cls: "oa-settings-desc",
    });

    if (!Platform.isDesktop) {
      desc.createEl("strong", {
        text: " (MCP is not available on mobile)",
        cls: "oa-warning",
      });
    }

    // Master enable toggle
    new Setting(containerEl)
      .setName("Enable MCP servers")
      .setDesc("Turn on to use MCP servers and tools")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.mcp.enabled)
          .onChange(async (value) => {
            this.plugin.settings.mcp.enabled = value;
            await this.plugin.saveSettings();
            await this.plugin.initializeMCP();
            this.display(); // Refresh to show/hide other options
          }),
      );

    if (!this.plugin.settings.mcp.enabled) {
      return; // Don't show other MCP settings if disabled
    }

    // Config file path
    let configPathValidation: HTMLElement | null = null;

    new Setting(containerEl)
      .setName("MCP config file path")
      .setDesc("Absolute path to a JSON config file (e.g., opencode.json format with mcp field)")
      .addText((text) => {
        text
          .setPlaceholder("/path/to/opencode.json")
          .setValue(this.plugin.settings.mcp.configFilePath)
          .onChange(async (value) => {
            const trimmed = value.trim();
            this.plugin.settings.mcp.configFilePath = trimmed;
            await this.plugin.saveSettings();

            // Validate file exists
            if (trimmed) {
              const exists = await MCPService.fileExists(trimmed);
              if (configPathValidation) {
                configPathValidation.textContent = exists
                  ? "✓ File exists"
                  : "✗ File not found";
                configPathValidation.className = exists
                  ? "oa-validation-success"
                  : "oa-validation-error";
              }

              if (exists) {
                await this.plugin.initializeMCP();
                this.display(); // Refresh to show discovered tools
              }
            } else {
              if (configPathValidation) {
                configPathValidation.textContent = "";
              }
              await this.plugin.initializeMCP();
            }
          });

        // Show validation message
        configPathValidation = text.inputEl.parentElement!.createEl("span", {
          cls: "oa-validation-message",
        });

        // Initial validation
        if (this.plugin.settings.mcp.configFilePath) {
          MCPService.fileExists(this.plugin.settings.mcp.configFilePath).then((exists) => {
            if (configPathValidation) {
              configPathValidation.textContent = exists ? "✓ File exists" : "✗ File not found";
              configPathValidation.className = exists
                ? "oa-validation-success"
                : "oa-validation-error";
            }
          });
        }
      });

    // Custom MCP JSON editor
    containerEl.createEl("h4", { text: "Custom MCP servers", cls: "oa-settings-subsection" });

    const customMCPDesc = containerEl.createEl("p", {
      text: "Define custom MCP servers in JSON format. These are merged with servers from the config file above. Two formats are accepted:",
      cls: "oa-settings-desc",
    });

    // Canonical format
    customMCPDesc.createEl("br");
    customMCPDesc.createEl("span", { text: "Canonical: ", cls: "oa-settings-label" });
    customMCPDesc.createEl("code", {
      text: '{"my-server": {"type": "local", "command": ["npx", "-y", "pkg"], "enabled": true}}',
      cls: "oa-code-example",
    });

    // Alt format
    customMCPDesc.createEl("br");
    customMCPDesc.createEl("span", { text: "Alt (Cursor/Claude Desktop): ", cls: "oa-settings-label" });
    customMCPDesc.createEl("code", {
      text: '{"my-server": {"command": "uvx", "args": ["pkg"], "env": {"KEY": "val"}}}',
      cls: "oa-code-example",
    });

    // Validation message for JSON editor
    let jsonValidationMsg: HTMLElement | null = null;

    new Setting(containerEl)
      .setName("Custom MCP JSON")
      .setDesc("JSON object with MCP server configurations. Formatted and saved when you leave the field.")
      .addTextArea((text) => {
        const formatted = formatMCPServers(this.plugin.settings.mcp.customMCPs);
        text
          .setPlaceholder('{"server-name": {"type": "local", "command": ["npx", "some-mcp"], "enabled": true}}')
          .setValue(formatted === "{}" ? "" : formatted);

        text.inputEl.rows = 10;
        text.inputEl.addClass("oa-settings-textarea");

        // Validate on every keystroke — only show feedback, no save yet
        text.onChange((value) => {
          if (!jsonValidationMsg) return;
          if (!value.trim()) {
            jsonValidationMsg.textContent = "";
            return;
          }
          const parsed = parseMCPServers(value);
          if (parsed !== null) {
            const count = Object.keys(parsed).length;
            let inputCount = count;
            try { inputCount = Object.keys(JSON.parse(value) as Record<string, unknown>).length; } catch { /* ignore */ }
            const skippedCount = inputCount - count;
            jsonValidationMsg.textContent =
              skippedCount > 0
                ? `✓ Valid — ${count} server(s) recognised, ${skippedCount} entry(s) skipped (unsupported format)`
                : `✓ Valid — ${count} server(s)`;
            jsonValidationMsg.className = "oa-validation-success";
          } else {
            jsonValidationMsg.textContent = "✗ Invalid JSON";
            jsonValidationMsg.className = "oa-validation-error";
          }
        });

        // Format, save and reinitialize only when the user leaves the field
        text.inputEl.addEventListener("blur", async () => {
          const value = text.getValue();

          if (!value.trim()) {
            this.plugin.settings.mcp.customMCPs = {};
            await this.plugin.saveSettings();
            await this.plugin.initializeMCP();
            if (jsonValidationMsg) jsonValidationMsg.textContent = "";
            this.display();
            return;
          }

          const parsed = parseMCPServers(value);
          if (parsed !== null) {
            this.plugin.settings.mcp.customMCPs = parsed;
            await this.plugin.saveSettings();
            await this.plugin.initializeMCP();
            // Replace textarea content with canonical formatted version
            text.setValue(formatMCPServers(parsed));
            // Refresh the tool list section
            this.display();
          }
          // If invalid, leave the text as-is so the user can keep editing
        });

        // Add validation message element
        jsonValidationMsg = text.inputEl.parentElement!.createEl("div", {
          cls: "oa-validation-message",
        });
      });

    // Tool enablement section
    this.displayToolEnablement(containerEl);
  }

  /**
   * Display tool enablement controls for discovered MCP tools
   */
  private displayToolEnablement(containerEl: HTMLElement): void {
    // Get available tools from MCP service
    const mcpService = this.plugin.mcpService;
    if (!mcpService?.getInitialized()) {
      return;
    }

    const tools = mcpService.getAvailableTools();
    if (tools.length === 0) {
      containerEl.createEl("p", {
        text: "No MCP tools available. Make sure your MCP servers are properly configured.",
        cls: "oa-info",
      });
      return;
    }

    containerEl.createEl("h4", { text: "Available MCP tools", cls: "oa-settings-subsection" });

    containerEl.createEl("p", {
      text: "Enable or disable individual tools. Disabled tools will not be available to the AI.",
      cls: "oa-settings-desc",
    });

    // Display tools grouped by server
    const toolsByServer = this.groupToolsByServer(tools);

    for (const [serverName, serverTools] of Object.entries(toolsByServer)) {
      const serverSection = containerEl.createEl("div", {
        cls: "oa-server-section",
      });

      serverSection.createEl("h5", {
        text: serverName,
        cls: "oa-server-name",
      });

      for (const tool of serverTools) {
        const isEnabled = this.plugin.settings.mcp.enabledTools[tool.name] !== false; // Default to true

        new Setting(serverSection)
          .setName(tool.name.replace(`${serverName}_`, ""))
          .setDesc(tool.description || "No description available")
          .addToggle((toggle) =>
            toggle.setValue(isEnabled).onChange(async (value) => {
              this.plugin.settings.mcp.enabledTools[tool.name] = value;
              await this.plugin.saveSettings();
            }),
          );
      }
    }
  }

  /**
   * Group tools by their server name
   */
  private groupToolsByServer(tools: MCPTool[]): Record<string, MCPTool[]> {
    const groups: Record<string, MCPTool[]> = {};

    for (const tool of tools) {
      const parts = tool.name.split("_");
      const serverName = parts[0] || "unknown";

      if (!groups[serverName]) {
        groups[serverName] = [];
      }
      groups[serverName].push(tool);
    }

    return groups;
  }
}
