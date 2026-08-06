import type OpenAI from "openai"

const DESCRIPTION = `Force MCP hub to re-read config and reconnect all servers. Use after external edits or to recover from stale connections. Requires user approval.`

export default {
	type: "function",
	function: {
		name: "refresh_mcp_servers",
		description: DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {},
			required: [],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
