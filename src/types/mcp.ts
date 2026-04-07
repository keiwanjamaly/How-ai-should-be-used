/**
 * MCP (Model Context Protocol) type definitions
 * Based on the opencode MCP configuration format
 */

/**
 * Local MCP server configuration
 * Uses stdio transport via command execution
 */
export interface LocalMCPServer {
	type: "local";
	/** Command and arguments to run the MCP server */
	command: string[];
	/** Environment variables to set when running the server */
	environment?: Record<string, string>;
	/** Whether this MCP server is enabled */
	enabled: boolean;
	/** Optional timeout for connection in ms (default: 5000) */
	timeout?: number;
}

/**
 * Alternative input format (e.g. Cursor/Claude Desktop style):
 * { "command": "uvx", "args": ["duckduckgo-mcp-server"], "env": { ... } }
 * We normalize this to LocalMCPServer on parse.
 */
interface AltFormatServer {
	command: string;
	args?: string[];
	env?: Record<string, string>;
	type?: string;
	enabled?: boolean;
	timeout?: number;
}

/**
 * MCP server configuration union type
 * (Remote will be added later when needed)
 */
export type MCPServerConfig = LocalMCPServer;

/**
 * Collection of MCP servers keyed by name
 */
export type MCPServers = Record<string, MCPServerConfig>;

/**
 * MCP tool definition as returned by the server
 */
export interface MCPTool {
	/** Tool name */
	name: string;
	/** Tool description */
	description?: string;
	/** JSON schema for the tool's input */
	inputSchema: unknown;
}

/**
 * Result from executing an MCP tool
 */
export interface MCPToolResult {
	/** Whether the execution was successful */
	success: boolean;
	/** Result content (for success) */
	content?: string;
	/** Error message (for failure) */
	error?: string;
	/** Structured execution details for UI/debugging */
	call?: {
		serverName: string;
		toolName: string;
		qualifiedToolName: string;
		argumentsText: string;
		durationMs: number;
		startedAt: number;
		success: boolean;
		resultText?: string;
		errorText?: string;
	};
}

/**
 * MCP settings for the plugin
 */
export interface MCPSettings {
	/** Master enable/disable for MCP feature */
	enabled: boolean;
	/** Absolute path to external MCP config file */
	configFilePath: string;
	/** Custom MCP servers defined inline in settings */
	customMCPs: MCPServers;
	/** Tool-level enablement map (toolName -> enabled) */
	enabledTools: Record<string, boolean>;
}

/**
 * External config file format (e.g., opencode.json)
 */
export interface ExternalMCPConfig {
	/** MCP servers keyed by name */
	mcp?: MCPServers;
}

/**
 * Default MCP settings
 */
export const DEFAULT_MCP_SETTINGS: MCPSettings = {
	enabled: false,
	configFilePath: "",
	customMCPs: {},
	enabledTools: {},
};

/**
 * Try to normalize any recognized server config shape into a LocalMCPServer.
 * Returns null if the value cannot be interpreted as a valid server.
 *
 * Accepted shapes:
 *  1. Canonical: { type:"local", command:["cmd","arg"], enabled:true, environment:{} }
 *  2. Alt format: { command:"cmd", args:["arg"], env:{} }  (Cursor/Claude Desktop style)
 */
export function normalizeServerConfig(value: unknown): LocalMCPServer | null {
	if (typeof value !== "object" || value === null) {
		return null;
	}

	const raw = value as Record<string, unknown>;

	// ── Canonical format ────────────────────────────────────────────────────
	if (Array.isArray(raw.command)) {
		if (
			raw.command.length === 0 ||
			!raw.command.every((c) => typeof c === "string")
		) {
			return null;
		}
		if (raw.type !== undefined && raw.type !== "local") return null;
		if (raw.enabled !== undefined && typeof raw.enabled !== "boolean") return null;
		if (raw.environment !== undefined && (typeof raw.environment !== "object" || raw.environment === null)) return null;
		if (raw.timeout !== undefined && typeof raw.timeout !== "number") return null;

		return {
			type: "local",
			command: raw.command as string[],
			enabled: raw.enabled !== false, // default true
			environment: raw.environment as Record<string, string> | undefined,
			timeout: raw.timeout as number | undefined,
		};
	}

	// ── Alt format: command is a string, args is an optional array ──────────
	if (typeof raw.command === "string" && raw.command.trim()) {
		const alt = raw as unknown as AltFormatServer;
		const args = Array.isArray(alt.args) ? alt.args : [];
		if (!args.every((a) => typeof a === "string")) return null;

		// env → environment
		const environment =
			alt.env && typeof alt.env === "object" ? alt.env : undefined;

		return {
			type: "local",
			command: [alt.command, ...args],
			enabled: alt.enabled !== false, // default true
			environment,
			timeout: alt.timeout,
		};
	}

	return null;
}

/**
 * @deprecated Use normalizeServerConfig instead. Kept for backwards compat.
 */
export function isValidMCPServerConfig(value: unknown): value is MCPServerConfig {
	return normalizeServerConfig(value) !== null;
}

/**
 * Parse and validate MCP servers from JSON string.
 * Accepts a map of server configs in any supported format, normalizes them.
 * Returns null only if the string is not valid JSON at all.
 * Individual invalid entries are silently skipped.
 */
export function parseMCPServers(json: string): MCPServers | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		return null;
	}

	return normalizeMCPServers(parsed);
}

/**
 * Normalize a raw server map into validated MCP servers.
 * Returns null if the top-level value is not an object.
 */
export function normalizeMCPServers(value: unknown): MCPServers | null {
	const parsed = value;

	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return null;
	}

	const validated: MCPServers = {};
	for (const [name, config] of Object.entries(parsed as Record<string, unknown>)) {
		const normalized = normalizeServerConfig(config);
		if (normalized) {
			validated[name] = normalized;
		}
	}

	return validated;
}

/**
 * Format and normalize MCP servers to a formatted JSON string
 */
export function formatMCPServers(servers: MCPServers): string {
	return JSON.stringify(servers, null, 2);
}

/**
 * Merge MCP servers from multiple sources
 * Later sources override earlier ones for the same server name
 */
export function mergeMCPServers(...sources: MCPServers[]): MCPServers {
	return Object.assign({}, ...sources);
}

/**
 * Get all tools from a server with their fully qualified names
 */
export function getQualifiedToolName(serverName: string, toolName: string): string {
	return `${serverName}_${toolName}`;
}

/**
 * Parse a qualified tool name into server and tool components
 */
export function parseQualifiedToolName(qualifiedName: string): {
	serverName: string;
	toolName: string;
} | null {
	const parts = qualifiedName.split("_");
	if (parts.length < 2) {
		return null;
	}
	const serverName = parts[0];
	const toolName = parts.slice(1).join("_");
	return { serverName, toolName };
}
