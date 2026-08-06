import type OpenAI from "openai"

const DESCRIPTION = `Admit/update/patch an MCP server in Zoo MCP settings only (project .roo/mcp.json or global mcp_settings.json + SecretStorage). NEVER rewrites application/source code.

SPEED RULES:
- One-shot when the user provides command/url: manage_mcp_server with full config. Do not read repo files to figure out MCP.
- For add and run / test / connect: use intent=start (enabled + connect). For install only: intent=install_only (default on admit).
- Prefer real MCP servers (JSON-RPC). Do NOT use dummy processes like node -e setInterval - they will time out (-32001).
- Example real smoke: type=stdio, command=npx, args=["-y","@modelcontextprotocol/server-everything"] (or another known MCP package).
- After intent=start, check status in the tool result. If not connected: refresh_mcp_servers then list_mcp_config. Only use_mcp_tool after status=connected.
- Secrets: use set_mcp_secret; avoid leaving raw API keys in plaintext when vault is available.`

export default {
	type: "function",
	function: {
		name: "manage_mcp_server",
		description: DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				action: {
					type: "string",
					description: "admit | update | patch",
					enum: ["admit", "update", "patch"],
				},
				name: {
					type: "string",
					description: "Server name (unique within scope)",
				},
				scope: {
					type: "string",
					description: "project (.roo/mcp.json) or global (mcp_settings.json) - config only, not source",
					enum: ["project", "global"],
				},
				intent: {
					type: ["string", "null"],
					description:
						"install_only (disabled, no start), start (enable/connect), preserve (keep disabled). Use start when user wants run/test. Default install_only on admit.",
					enum: ["install_only", "start", "preserve", null],
				},
				config: {
					type: "object",
					description:
						"Server config: type (stdio|sse|streamable-http), command, args, url, cwd, env (non-secret), headers (non-secret), alwaysAllow, timeout, disabled. Must be a real MCP process for connect to succeed.",
					additionalProperties: true,
				},
			},
			required: ["action", "name", "scope", "intent", "config"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
