import { App, PluginSettingTab, Setting, Platform } from "obsidian";
import type ObsidianAIChatPlugin from "./main";
import {
  formatMCPServers,
  parseMCPServers,
  type MCPTool,
} from "./types/mcp";
import { MCPService } from "./services/MCPService";

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

    // MCP Settings Section
    this.displayMCPSettings(containerEl);
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
