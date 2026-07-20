import type OpenAI from "openai"

const DESCRIPTION = `List configured MCP servers (project and/or global). Returns name, scope, type, disabled, live status, and redacted config (secrets shown as *** / vault refs only). Never returns secret values.`

export default {
	type: "function",
	function: {
		name: "list_mcp_config",
		description: DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				scope: {
					type: ["string", "null"],
					description: "project | global | all (default all)",
					enum: ["project", "global", "all", null],
				},
			},
			required: ["scope"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
