import type OpenAI from "openai"

const DESCRIPTION = `Set or clear one env or header secret for an MCP server via the credential vault. Value is NEVER echoed in tool results or approval metadata. Requires user approval. Server must already exist (manage_mcp_server first).`

export default {
	type: "function",
	function: {
		name: "set_mcp_secret",
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
				channel: {
					type: "string",
					description: "env or header",
					enum: ["env", "header"],
				},
				key: {
					type: "string",
					description: "Env var or header name (e.g. GITHUB_TOKEN, Authorization)",
				},
				value: {
					type: ["string", "null"],
					description: "Secret value. Empty or null clears the secret.",
				},
			},
			required: ["name", "scope", "channel", "key", "value"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
