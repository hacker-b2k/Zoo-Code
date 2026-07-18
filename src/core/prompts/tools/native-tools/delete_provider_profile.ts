import type OpenAI from "openai"

const DESCRIPTION = `Delete a provider profile. Cannot delete the last remaining profile. If the deleted profile was active, another profile is activated. Requires user approval.`

export default {
	type: "function",
	function: {
		name: "delete_provider_profile",
		description: DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				name: {
					type: "string",
					description: "Profile name to delete",
				},
			},
			required: ["name"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
