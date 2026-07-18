import type OpenAI from "openai"

const DESCRIPTION = `Delete an MCP server from config and clean up vault secrets. Requires user approval.`

export default {
	type: "function",
	function: {
		name: "delete_mcp_server",
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
			},
			required: ["name", "scope"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
