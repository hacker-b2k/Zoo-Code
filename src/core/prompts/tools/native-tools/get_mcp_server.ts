import type OpenAI from "openai"

const DESCRIPTION = `Get one MCP server detail from config + hub status. Secrets are redacted (*** / vault refs only). Never returns secret values.`

export default {
	type: "function",
	function: {
		name: "get_mcp_server",
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
					description: "project or global",
					enum: ["project", "global"],
				},
			},
			required: ["name", "scope"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
