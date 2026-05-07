import { describe, expect, it } from "vitest";
import {
  DEFAULT_MCP_SETTINGS,
  formatMCPServers,
  getQualifiedToolName,
  isValidMCPServerConfig,
  mergeMCPServers,
  normalizeMCPServers,
  normalizeServerConfig,
  parseMCPServers,
  parseQualifiedToolName,
  type MCPServers,
} from "../types/mcp.ts";

describe("MCP types", () => {
  it("validates local MCP server configs", () => {
    expect(isValidMCPServerConfig({
      type: "local",
      command: ["npx", "-y", "@modelcontextprotocol/server-everything"],
      enabled: true,
    })).toBe(true);

    expect(isValidMCPServerConfig({
      type: "remote",
      command: ["npx"],
      enabled: true,
    })).toBe(false);

    expect(isValidMCPServerConfig({
      type: "local",
      enabled: true,
    })).toBe(false);

    expect(isValidMCPServerConfig({
      type: "local",
      command: [],
      enabled: true,
    })).toBe(false);

    expect(isValidMCPServerConfig({
      type: "local",
      command: ["npx"],
      enabled: true,
      environment: { API_KEY: "test" },
    })).toBe(true);
  });

  it("normalizes the alternate command/args/env format", () => {
    const altFormat = {
      command: "uvx",
      args: ["duckduckgo-mcp-server"],
      env: {
        DDG_SAFE_SEARCH: "MODERATE",
        DDG_REGION: "de-de",
      },
    };

    const result = normalizeServerConfig(altFormat);
    expect(result).not.toBeNull();
    expect(result?.type).toBe("local");
    expect(result?.command).toEqual(["uvx", "duckduckgo-mcp-server"]);
    expect(result?.enabled).toBe(true);
    expect(result?.environment).toEqual({
      DDG_SAFE_SEARCH: "MODERATE",
      DDG_REGION: "de-de",
    });

    const parsed = parseMCPServers(JSON.stringify({ duckduckgo: altFormat }));
    expect(parsed).not.toBeNull();
    expect(Object.keys(parsed ?? {})).toHaveLength(1);
    expect(parsed?.duckduckgo.command).toEqual(["uvx", "duckduckgo-mcp-server"]);

    const noArgs = normalizeServerConfig({ command: "uvx" });
    expect(noArgs).not.toBeNull();
    expect(noArgs?.command).toEqual(["uvx"]);

    expect(normalizeServerConfig({ foo: "bar" })).toBeNull();
    expect(normalizeServerConfig({ command: 123 })).toBeNull();
  });

  it("normalizes MCP server maps and skips invalid entries", () => {
    const result = normalizeMCPServers({
      duckduckgo: {
        command: "uvx",
        args: ["duckduckgo-mcp-server"],
        env: {
          DDG_REGION: "de-de",
        },
      },
      invalid: {
        foo: "bar",
      },
    });

    expect(result).not.toBeNull();
    expect(Object.keys(result ?? {})).toHaveLength(1);
    expect(result?.duckduckgo.command).toEqual(["uvx", "duckduckgo-mcp-server"]);
    expect(normalizeMCPServers([])).toBeNull();
  });

  it("parses MCP server JSON", () => {
    const validJson = JSON.stringify({
      server1: {
        type: "local",
        command: ["cmd1"],
        enabled: true,
      },
      server2: {
        type: "local",
        command: ["cmd2"],
        enabled: false,
      },
    });

    const result = parseMCPServers(validJson);
    expect(result).not.toBeNull();
    expect(Object.keys(result ?? {})).toHaveLength(2);
    expect(result?.server1.enabled).toBe(true);
    expect(result?.server2.enabled).toBe(false);

    const mixedResult = parseMCPServers(JSON.stringify({
      valid: {
        type: "local",
        command: ["cmd1"],
        enabled: true,
      },
      invalid: {
        type: "remote",
        command: ["cmd2"],
        enabled: true,
      },
    }));
    expect(mixedResult).not.toBeNull();
    expect(Object.keys(mixedResult ?? {})).toHaveLength(1);
    expect(mixedResult?.valid).toBeDefined();

    expect(parseMCPServers("not valid json")).toBeNull();
    expect(parseMCPServers("{}")).toEqual({});
  });

  it("formats MCP servers for display", () => {
    const servers: MCPServers = {
      test: {
        type: "local",
        command: ["npx"],
        enabled: true,
      },
    };

    const formatted = formatMCPServers(servers);
    expect(formatted).toContain('"type": "local"');
    expect(formatted).toContain('"command":');
    expect(formatted).toContain('"enabled": true');
    expect(formatted.startsWith("{")).toBe(true);
  });

  it("merges server collections with later overrides", () => {
    const servers1: MCPServers = {
      server1: {
        type: "local",
        command: ["cmd1"],
        enabled: true,
      },
    };
    const servers2: MCPServers = {
      server2: {
        type: "local",
        command: ["cmd2"],
        enabled: true,
      },
    };

    const merged = mergeMCPServers(servers1, servers2);
    expect(Object.keys(merged)).toHaveLength(2);
    expect(merged.server1).toBeDefined();
    expect(merged.server2).toBeDefined();

    const overridden = mergeMCPServers(servers1, {
      server1: {
        type: "local",
        command: ["cmd2"],
        enabled: false,
      },
    });

    expect(overridden.server1.command).toEqual(["cmd2"]);
    expect(overridden.server1.enabled).toBe(false);
  });

  it("builds and parses qualified tool names", () => {
    expect(getQualifiedToolName("my-server", "my-tool")).toBe("my-server_my-tool");
    expect(getQualifiedToolName("server_test", "tool_test")).toBe("server_test_tool_test");
    expect(parseQualifiedToolName("my-server_my-tool")).toEqual({
      serverName: "my-server",
      toolName: "my-tool",
    });
    expect(parseQualifiedToolName("server_tool_a_b_c")).toEqual({
      serverName: "server",
      toolName: "tool_a_b_c",
    });
    expect(parseQualifiedToolName("invalid")).toBeNull();
    expect(parseQualifiedToolName("")).toBeNull();
  });

  it("exposes the default MCP settings", () => {
    expect(DEFAULT_MCP_SETTINGS.enabled).toBe(false);
    expect(DEFAULT_MCP_SETTINGS.configFilePath).toBe("");
    expect(DEFAULT_MCP_SETTINGS.customMCPs).toEqual({});
    expect(DEFAULT_MCP_SETTINGS.enabledTools).toEqual({});
  });
});
