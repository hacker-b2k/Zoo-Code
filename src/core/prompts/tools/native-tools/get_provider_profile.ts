import type OpenAI from "openai"

const DESCRIPTION = `Get one provider profile by name with secrets redacted (secret fields show { present: true/false } only, never raw keys).`

const NAME_DESCRIPTION = `Exact profile name to load`

export default {
	type: "function",
	function: {
		name: "get_provider_profile",
		description: DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				name: {
					type: "string",
					description: NAME_DESCRIPTION,
				},
			},
			required: ["name"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
