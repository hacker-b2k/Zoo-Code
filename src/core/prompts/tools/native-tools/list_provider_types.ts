import type OpenAI from "openai"

const DESCRIPTION = `OPTIONAL field-name lookup. SKIP when user already gave base URL + model + API key — call manage_provider_profile once instead (do not list first). Use only when you truly do not know field/secret names for a rare provider.`

export default {
	type: "function",
	function: {
		name: "list_provider_types",
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
