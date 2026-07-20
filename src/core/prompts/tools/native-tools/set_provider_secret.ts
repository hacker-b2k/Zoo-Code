import type OpenAI from "openai"

const DESCRIPTION = `Set/clear ONE secret on an existing profile. Prefer manage_provider_profile secrets map for first-time setup (one call). Keys: customEndpointApiKey, openAiApiKey, openRouterApiKey, apiKey (anthropic). Never echoes values.`

export default {
	type: "function",
	function: {
		name: "set_provider_secret",
		description: DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				name: {
					type: "string",
					description: "Profile name",
				},
				key: {
					type: "string",
					description: "Secret field name (must be a known secret key)",
				},
				value: {
					type: ["string", "null"],
					description: "Secret value to store. Empty or null clears the secret.",
				},
			},
			required: ["name", "key", "value"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
