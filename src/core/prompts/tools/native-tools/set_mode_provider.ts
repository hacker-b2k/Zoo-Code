import type OpenAI from "openai"

const DESCRIPTION = `Bind a mode (e.g. code, architect) to a specific provider profile id so that mode uses that profile. Requires user approval.`

export default {
	type: "function",
	function: {
		name: "set_mode_provider",
		description: DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				mode_slug: {
					type: "string",
					description: "Mode slug (code, ask, architect, debug, orchestrator, or custom)",
				},
				name: {
					type: "string",
					description: "Provider profile name to bind to this mode",
				},
			},
			required: ["mode_slug", "name"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
