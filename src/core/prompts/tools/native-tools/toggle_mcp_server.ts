import type OpenAI from "openai"

const DESCRIPTION = `Enable or disable an existing MCP server (wraps hub toggle). disabled=true disconnects; disabled=false connects if MCP is globally enabled. Requires user approval.`

export default {
	type: "function",
	function: {
		name: "toggle_mcp_server",
		description: DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				name: {
					type: "string",
					description: "MCP server name",
				},
				scope: {
					type: "string",
					enum: ["project", "global"],
				},
				disabled: {
					type: "boolean",
					description: "true to disable, false to enable",
				},
			},
			required: ["name", "scope", "disabled"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
