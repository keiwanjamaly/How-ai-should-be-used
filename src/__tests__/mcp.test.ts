/**
 * Simple test runner for MCP types
 * Run with: npx ts-node src/__tests__/mcp.test.ts
 */

import {
	isValidMCPServerConfig,
	parseMCPServers,
	normalizeMCPServers,
	normalizeServerConfig,
	formatMCPServers,
	mergeMCPServers,
	getQualifiedToolName,
	parseQualifiedToolName,
	DEFAULT_MCP_SETTINGS,
	type MCPServers,
} from "../types/mcp.ts";
import { assertEqual, assertTrue, assertFalse, runTests } from "./testUtils.ts";

function testIsValidMCPServerConfig(): void {
	console.log("Test: isValidMCPServerConfig");

	// Valid local config
	assertTrue(
		isValidMCPServerConfig({
			type: "local",
			command: ["npx", "-y", "@modelcontextprotocol/server-everything"],
			enabled: true,
		}),
		"Should validate valid local config",
	);

	// Invalid - remote type
	assertFalse(
		isValidMCPServerConfig({
			type: "remote",
			command: ["npx"],
			enabled: true,
		}),
		"Should reject remote type",
	);

	// Invalid - missing command
	assertFalse(
		isValidMCPServerConfig({
			type: "local",
			enabled: true,
		}),
		"Should reject missing command",
	);

	// Invalid - empty command array
	assertFalse(
		isValidMCPServerConfig({
			type: "local",
			command: [],
			enabled: true,
		}),
		"Should reject empty command array",
	);

	// Valid with environment
	assertTrue(
		isValidMCPServerConfig({
			type: "local",
			command: ["npx"],
			enabled: true,
			environment: { API_KEY: "test" },
		}),
		"Should accept config with environment",
	);

	console.log("  PASSED");
}

function testParseMCPServers(): void {
	console.log("Test: parseMCPServers");

	// Valid JSON with multiple servers
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
	assertTrue(result !== null, "Should parse valid JSON");
	assertEqual(Object.keys(result!).length, 2, "Should have 2 servers");
	assertEqual(result!.server1.enabled, true, "server1 should be enabled");
	assertEqual(result!.server2.enabled, false, "server2 should be disabled");

	// Filter out invalid
	const mixedJson = JSON.stringify({
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
	});

	const mixedResult = parseMCPServers(mixedJson);
	assertTrue(mixedResult !== null, "Should parse mixed JSON");
	assertEqual(Object.keys(mixedResult!).length, 1, "Should filter invalid configs");
	assertTrue(mixedResult!.valid !== undefined, "Should keep valid config");

	// Invalid JSON
	assertEqual(parseMCPServers("not valid json"), null, "Should return null for invalid JSON");

	// Empty JSON
	assertEqual(parseMCPServers("{}"), {}, "Should return empty object for empty JSON");

	console.log("  PASSED");
}

function testFormatMCPServers(): void {
	console.log("Test: formatMCPServers");

	const servers: MCPServers = {
		test: {
			type: "local",
			command: ["npx"],
			enabled: true,
		},
	};

	const formatted = formatMCPServers(servers);
	assertTrue(formatted.includes('"type": "local"'), "Should include type field");
	assertTrue(formatted.includes('"command":'), "Should include command field");
	assertTrue(formatted.includes('"enabled": true'), "Should include enabled field");
	assertTrue(formatted.startsWith("{"), "Should start with brace");

	console.log("  PASSED");
}

function testMergeMCPServers(): void {
	console.log("Test: mergeMCPServers");

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
	assertEqual(Object.keys(merged).length, 2, "Should merge both server collections");
	assertTrue(merged.server1 !== undefined, "Should have server1");
	assertTrue(merged.server2 !== undefined, "Should have server2");

	// Test override
	const overrideServers: MCPServers = {
		server1: {
			type: "local",
			command: ["cmd2"],
			enabled: false,
		},
	};

	const overridden = mergeMCPServers(servers1, overrideServers);
	assertEqual(overridden.server1.command, ["cmd2"], "Later source should override");
	assertEqual(overridden.server1.enabled, false, "Later source should override enabled");

	console.log("  PASSED");
}

function testGetQualifiedToolName(): void {
	console.log("Test: getQualifiedToolName");

	assertEqual(
		getQualifiedToolName("my-server", "my-tool"),
		"my-server_my-tool",
		"Should combine with underscore",
	);

	assertEqual(
		getQualifiedToolName("server_test", "tool_test"),
		"server_test_tool_test",
		"Should handle names with underscores",
	);

	console.log("  PASSED");
}

function testParseQualifiedToolName(): void {
	console.log("Test: parseQualifiedToolName");

	const result1 = parseQualifiedToolName("my-server_my-tool");
	assertEqual(result1, { serverName: "my-server", toolName: "my-tool" }, "Should parse correctly");

	const result2 = parseQualifiedToolName("server_tool_a_b_c");
	assertEqual(
		result2,
		{ serverName: "server", toolName: "tool_a_b_c" },
		"Should handle tool names with underscores",
	);

	assertEqual(parseQualifiedToolName("invalid"), null, "Should return null for invalid name");
	assertEqual(parseQualifiedToolName(""), null, "Should return null for empty string");

	console.log("  PASSED");
}

function testDefaultMCPSettings(): void {
	console.log("Test: DEFAULT_MCP_SETTINGS");

	assertEqual(DEFAULT_MCP_SETTINGS.enabled, false, "Should be disabled by default");
	assertEqual(DEFAULT_MCP_SETTINGS.configFilePath, "", "Should have empty path by default");
	assertEqual(DEFAULT_MCP_SETTINGS.customMCPs, {}, "Should have empty customMCPs");
	assertEqual(DEFAULT_MCP_SETTINGS.enabledTools, {}, "Should have empty enabledTools");

	console.log("  PASSED");
}

function testNormalizeAltFormat(): void {
	console.log("Test: normalizeServerConfig - alt format");

	// Exact format the user pasted
	const altFormat = {
		command: "uvx",
		args: ["duckduckgo-mcp-server"],
		env: {
			DDG_SAFE_SEARCH: "MODERATE",
			DDG_REGION: "de-de",
		},
	};

	const result = normalizeServerConfig(altFormat);
	assertTrue(result !== null, "Should accept alt format");
	assertEqual(result!.type, "local", "Should set type to local");
	assertEqual(result!.command, ["uvx", "duckduckgo-mcp-server"], "Should merge command + args");
	assertEqual(result!.enabled, true, "Should default enabled to true");
	assertEqual(
		result!.environment,
		{ DDG_SAFE_SEARCH: "MODERATE", DDG_REGION: "de-de" },
		"Should map env to environment",
	);

	// Alt format wrapped in a named key (as it would appear in the textarea)
	const wrapped = JSON.stringify({ "duckduckgo": altFormat });
	const parsed = parseMCPServers(wrapped);
	assertTrue(parsed !== null, "Should parse wrapped alt format");
	assertEqual(Object.keys(parsed!).length, 1, "Should have 1 server");
	assertEqual(parsed!.duckduckgo.command, ["uvx", "duckduckgo-mcp-server"],
		"Should normalize command in parsed result");

	// Without args
	const noArgs = normalizeServerConfig({ command: "uvx" });
	assertTrue(noArgs !== null, "Should accept command with no args");
	assertEqual(noArgs!.command, ["uvx"], "Should produce single-element command");

	// Invalid - completely unrecognised shape
	assertEqual(normalizeServerConfig({ foo: "bar" }), null, "Should reject unrecognised shape");
	assertEqual(normalizeServerConfig({ command: 123 }), null, "Should reject numeric command");

	console.log("  PASSED");
}

function testNormalizeMCPServers(): void {
	console.log("Test: normalizeMCPServers");

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

	assertTrue(result !== null, "Should accept object input");
	assertEqual(Object.keys(result!).length, 1, "Should normalize valid entries and skip invalid ones");
	assertEqual(
		result!.duckduckgo.command,
		["uvx", "duckduckgo-mcp-server"],
		"Should normalize alt-format server maps from config files",
	);

	assertEqual(normalizeMCPServers([]), null, "Should reject array input");

	console.log("  PASSED");
}

runTests("MCP Types Tests", [
	testIsValidMCPServerConfig,
	testNormalizeAltFormat,
	testNormalizeMCPServers,
	testParseMCPServers,
	testFormatMCPServers,
	testMergeMCPServers,
	testGetQualifiedToolName,
	testParseQualifiedToolName,
	testDefaultMCPSettings,
]);
