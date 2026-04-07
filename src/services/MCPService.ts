/**
 * MCP Service - Manages Model Context Protocol servers and tools
 * Handles connection, discovery, and execution of MCP tools via stdio transport
 */

import { Notice, Platform } from "obsidian";
import { spawn, execFile } from "child_process";
import type { ChildProcess } from "child_process";
import type {
	LocalMCPServer,
	MCPTool,
	MCPToolResult,
	MCPServers,
	ExternalMCPConfig,
} from "../types/mcp";
import { getQualifiedToolName, normalizeMCPServers } from "../types/mcp";

/**
 * Cached login-shell PATH promise, resolved once on first use.
 * Storing the promise (not the value) prevents a race condition when
 * multiple servers call getShellPath() concurrently via Promise.all.
 * On macOS, GUI apps like Obsidian inherit a minimal system PATH that lacks
 * Homebrew, uv/uvx, nvm, etc. We need the full login shell PATH.
 */
let shellPathPromise: Promise<string> | null = null;

/**
 * Resolve the user's full login-shell PATH by spawning `$SHELL -l -c 'echo $PATH'`.
 * Falls back to process.env.PATH if the shell command fails.
 */
function getShellPath(): Promise<string> {
	if (!shellPathPromise) {
		shellPathPromise = new Promise((resolve) => {
			const shell = process.env.SHELL || "/bin/zsh";
			execFile(shell, ["-l", "-c", "echo $PATH"], { timeout: 5000 }, (error, stdout) => {
				if (error || !stdout.trim()) {
					resolve(process.env.PATH || "");
				} else {
					resolve(stdout.trim());
				}
			});
		});
	}
	return shellPathPromise;
}

/** MCP protocol version used in the initialize handshake */
const MCP_PROTOCOL_VERSION = "2024-11-05";

/**
 * JSON-RPC request structure for MCP protocol
 */
interface JSONRPCRequest {
	jsonrpc: "2.0";
	id: number;
	method: string;
	params?: unknown;
}

/**
 * JSON-RPC response structure
 */
interface JSONRPCResponse {
	jsonrpc: "2.0";
	id: number;
	result?: unknown;
	error?: {
		code: number;
		message: string;
		data?: unknown;
	};
}

/**
 * Manages MCP server connections and tool execution
 */
export class MCPService {
	/** Active MCP processes keyed by server name */
	private processes = new Map<string, ChildProcess>();

	/** Discovered tools for each server */
	private serverTools = new Map<string, MCPTool[]>();

	/** Request ID counter */
	private requestId = 0;

	/** Pending requests keyed by ID */
	private pendingRequests = new Map<
		number,
		{
			resolve: (result: unknown) => void;
			reject: (error: Error) => void;
			timer: NodeJS.Timeout;
		}
	>();

	/** Whether the service is initialized */
	private isInitialized = false;

	/** All available tools combined from all servers */
	private allTools: MCPTool[] = [];

	/** Map of qualified tool names to their server/tool info */
	private toolRegistry = new Map<
		string,
		{
			serverName: string;
			toolName: string;
			tool: MCPTool;
		}
	>();

	/**
	 * Initialize the MCP service with a set of servers
	 */
	async initialize(servers: MCPServers): Promise<void> {
		// Clean up existing connections
		await this.shutdown();

		this.isInitialized = false;
		this.allTools = [];
		this.toolRegistry.clear();
		this.serverTools.clear();

		// Start each enabled local server
		const startPromises: Promise<void>[] = [];
		for (const [name, config] of Object.entries(servers)) {
			if (config.enabled && config.type === "local") {
				startPromises.push(this.startServer(name, config));
			}
		}

		await Promise.all(startPromises);
		this.isInitialized = true;
	}

	/**
	 * Start a local MCP server process
	 */
	private async startServer(name: string, config: LocalMCPServer): Promise<void> {
		if (!Platform.isDesktop) {
			new Notice("MCP servers are only supported on desktop platforms");
			return;
		}

		try {
			const [command, ...args] = config.command;

			// Resolve the full login-shell PATH so tools like uvx, npx, etc.
			// are found even when Obsidian is launched as a GUI app on macOS.
			const shellPath = await getShellPath();

			const childProcess = spawn(command, args, {
				env: {
					...process.env,
					PATH: shellPath,
					...config.environment,
				},
				stdio: ["pipe", "pipe", "pipe"],
			});

			// Handle process errors
			childProcess.on("error", (error: Error) => {
				console.error(`MCP server "${name}" error:`, error);
				new Notice(`MCP server "${name}" failed to start: ${error.message}`);
				this.processes.delete(name);
			});

			// Handle stderr for logging
			childProcess.stderr?.on("data", (data: Buffer) => {
				console.log(`MCP server "${name}" stderr:`, data.toString());
			});

			// Handle process exit
			childProcess.on("exit", (code: number | null) => {
				if (code !== 0 && code !== null) {
					console.error(`MCP server "${name}" exited with code ${code}`);
					new Notice(`MCP server "${name}" stopped unexpectedly`);
				}
				this.processes.delete(name);
			});

			// Store the process
			this.processes.set(name, childProcess);

			// Set up message handling from stdout
			this.setupMessageHandling(name, childProcess);

			// Initialize the server and discover tools
			await this.initializeServer(name);

			new Notice(`MCP server "${name}" started successfully`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(`Failed to start MCP server "${name}":`, error);
			new Notice(`Failed to start MCP server "${name}": ${message}`);
		}
	}

	/**
	 * Set up message handling from MCP server stdout
	 */
	private setupMessageHandling(serverName: string, process: ChildProcess): void {
		let buffer = "";

		process.stdout?.on("data", (data: Buffer) => {
			buffer += data.toString();

			// Process complete messages (delimited by newlines)
			let newlineIndex: number;
			while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
				const message = buffer.slice(0, newlineIndex).trim();
				buffer = buffer.slice(newlineIndex + 1);

				if (message) {
					this.handleMessage(serverName, message);
				}
			}
		});
	}

	/**
	 * Handle an incoming JSON-RPC message
	 */
	private handleMessage(serverName: string, message: string): void {
		try {
			const response = JSON.parse(message) as JSONRPCResponse;

			// Handle responses to pending requests
			if (response.id !== undefined && this.pendingRequests.has(response.id)) {
				const request = this.pendingRequests.get(response.id);
				if (request) {
					clearTimeout(request.timer);
					this.pendingRequests.delete(response.id);

					if (response.error) {
						request.reject(
							new Error(`MCP error: ${response.error.message}`),
						);
					} else {
						request.resolve(response.result);
					}
				}
			}
		} catch (error) {
			console.error(`Failed to parse MCP message from "${serverName}":`, message, error);
		}
	}

	/**
	 * Send a JSON-RPC request to an MCP server
	 */
	private async sendRequest(
		serverName: string,
		method: string,
		params?: unknown,
		timeout = 10000,
	): Promise<unknown> {
		const process = this.processes.get(serverName);
		if (!process) {
			throw new Error(`MCP server "${serverName}" is not running`);
		}

		const id = ++this.requestId;

		const request: JSONRPCRequest = {
			jsonrpc: "2.0",
			id,
			method,
			params,
		};

		return new Promise((resolve, reject) => {
			// Guard: if stdin is null (process died), reject immediately
			// instead of silently hanging.
			if (!process.stdin || !process.stdin.writable) {
				reject(new Error(`MCP server "${serverName}" stdin is not writable`));
				return;
			}

			// Set up timeout
			const timer = setTimeout(() => {
				this.pendingRequests.delete(id);
				reject(new Error(`MCP request to "${serverName}" timed out`));
			}, timeout);

			// Store the pending request
			this.pendingRequests.set(id, { resolve, reject, timer });

			// Send the request
			const message = JSON.stringify(request) + "\n";
			process.stdin.write(message, (error) => {
				if (error) {
					clearTimeout(timer);
					this.pendingRequests.delete(id);
					reject(error);
				}
			});
		});
	}

	/**
	 * Send a JSON-RPC notification (no id, no response expected)
	 */
	private sendNotification(serverName: string, method: string, params?: unknown): void {
		const process = this.processes.get(serverName);
		if (!process) return;

		const notification = {
			jsonrpc: "2.0",
			method,
			...(params !== undefined ? { params } : {}),
		};
		process.stdin?.write(JSON.stringify(notification) + "\n");
	}

	/**
	 * Initialize the MCP server and discover available tools
	 */
	private async initializeServer(serverName: string): Promise<void> {
		try {
			// Send initialize request
			await this.sendRequest(serverName, "initialize", {
				protocolVersion: MCP_PROTOCOL_VERSION,
				capabilities: {},
				clientInfo: {
					name: "obsidian-ai-chat",
					version: "1.0.0",
				},
			});

			// Required by the MCP spec: send notifications/initialized after
			// the initialize handshake, before any other requests.
			this.sendNotification(serverName, "notifications/initialized");

			// Get available tools
			const result = (await this.sendRequest(
				serverName,
				"tools/list",
			)) as { tools: MCPTool[] } | undefined;

			if (result?.tools) {
				this.serverTools.set(serverName, result.tools);

				// Register tools with qualified names
				for (const tool of result.tools) {
					const qualifiedName = getQualifiedToolName(serverName, tool.name);
					this.toolRegistry.set(qualifiedName, {
						serverName,
						toolName: tool.name,
						tool,
					});
					this.allTools.push({
						...tool,
						name: qualifiedName,
					});
				}
			}
		} catch (error) {
			console.error(`Failed to initialize MCP server "${serverName}":`, error);
			new Notice(`Failed to initialize MCP server "${serverName}"`);
		}
	}

	/**
	 * Execute a tool call
	 */
	async executeTool(qualifiedToolName: string, args: unknown): Promise<MCPToolResult> {
		const toolInfo = this.toolRegistry.get(qualifiedToolName);
		if (!toolInfo) {
			return {
				success: false,
				error: `Tool "${qualifiedToolName}" not found`,
				call: {
					serverName: "unknown",
					toolName: qualifiedToolName,
					qualifiedToolName,
					argumentsText: this.safeStringify(args),
					durationMs: 0,
					startedAt: Date.now(),
					success: false,
					errorText: `Tool "${qualifiedToolName}" not found`,
				},
			};
		}

		const startedAt = Date.now();
		const argumentsText = this.safeStringify(args);

		try {
			const result = await this.sendRequest(
				toolInfo.serverName,
				"tools/call",
				{
					name: toolInfo.toolName,
					arguments: args,
				},
				30000, // 30 second timeout for tool execution
			);

			// Parse the result
			const toolResult = result as {
				content?: Array<{ type: string; text?: string }>;
				isError?: boolean;
			};

			// Guard against unexpected content shapes from MCP servers
			const content = Array.isArray(toolResult.content) ? toolResult.content : [];

			if (toolResult.isError) {
				const errorText = content
					.map((c) => c.text)
					.filter(Boolean)
					.join("\n");
				return {
					success: false,
					error: errorText || "Tool execution failed",
				};
			}

			const output = content
				.map((c) => c.text)
				.filter(Boolean)
				.join("\n");

			return {
				success: true,
				content: output,
				call: {
					serverName: toolInfo.serverName,
					toolName: toolInfo.toolName,
					qualifiedToolName,
					argumentsText,
					durationMs: Date.now() - startedAt,
					startedAt,
					success: true,
					resultText: output,
				},
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				error: message,
				call: {
					serverName: toolInfo.serverName,
					toolName: toolInfo.toolName,
					qualifiedToolName,
					argumentsText,
					durationMs: Date.now() - startedAt,
					startedAt,
					success: false,
					errorText: message,
				},
			};
		}
	}

	private safeStringify(value: unknown): string {
		if (typeof value === "string") {
			return value;
		}

		if (value === undefined) {
			return "{}";
		}

		try {
			return JSON.stringify(value, null, 2);
		} catch {
			return String(value);
		}
	}

	/**
	 * Get all available tools (optionally filtered by enabled tools)
	 */
	getAvailableTools(enabledTools?: Record<string, boolean>): MCPTool[] {
		if (!enabledTools) {
			return this.allTools;
		}

		return this.allTools.filter((tool) => {
			// If not in enabledTools map, default to enabled
			return enabledTools[tool.name] !== false;
		});
	}

	/**
	 * Check if the service is initialized
	 */
	getInitialized(): boolean {
		return this.isInitialized;
	}

	/**
	 * Get list of active servers
	 */
	getActiveServers(): string[] {
		return Array.from(this.processes.keys());
	}

	/**
	 * Shutdown all MCP servers
	 */
	async shutdown(): Promise<void> {
		// Cancel all pending requests
		for (const [id, request] of this.pendingRequests) {
			clearTimeout(request.timer);
			request.reject(new Error("MCP service shutdown"));
		}
		this.pendingRequests.clear();

		// Kill all processes
		for (const [name, process] of this.processes) {
			try {
				process.kill("SIGTERM");
				// Give it a moment to terminate gracefully
				await new Promise((resolve) => setTimeout(resolve, 100));
				// Force kill if still running
				if (!process.killed) {
					process.kill("SIGKILL");
				}
			} catch (error) {
				console.error(`Error stopping MCP server "${name}":`, error);
			}
		}

		this.processes.clear();
		this.serverTools.clear();
		this.allTools = [];
		this.toolRegistry.clear();
		this.isInitialized = false;
	}

	/**
	 * Load MCP configuration from an external file
	 */
	static async loadConfigFromFile(filePath: string): Promise<ExternalMCPConfig | null> {
		if (!filePath) {
			return null;
		}

		try {
			const fs = require("fs").promises;
			const content = await fs.readFile(filePath, "utf-8");
			const config = JSON.parse(content) as ExternalMCPConfig;

			// Validate that mcp field exists and contains valid server configs
			if (config.mcp && typeof config.mcp === "object") {
				const normalized = normalizeMCPServers(config.mcp);
				if (normalized) {
					return {
						...config,
						mcp: normalized,
					};
				}
			}

			return null;
		} catch (error) {
			console.error(`Failed to load MCP config from ${filePath}:`, error);
			return null;
		}
	}

	/**
	 * Check if a file exists at the given path
	 */
	static async fileExists(filePath: string): Promise<boolean> {
		if (!filePath) {
			return false;
		}

		try {
			const fs = require("fs").promises;
			await fs.access(filePath);
			return true;
		} catch {
			return false;
		}
	}
}
