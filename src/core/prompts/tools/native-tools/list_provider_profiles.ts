import type OpenAI from "openai"

const DESCRIPTION = `OPTIONAL list of existing profiles (no secrets). SKIP when adding a new provider with full credentials — use manage_provider_profile action=upsert directly. Use only to find an existing profile name to update/activate/delete.`

export default {
	type: "function",
	function: {
		name: "list_provider_profiles",
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
