import type OpenAI from "openai"

const DESCRIPTION = `SWITCH the active provider profile (Save ≠ Switch). Use AFTER manage_provider_profile saved a complete profile, and only when the user wants to use that profile now. Same effect as selecting the profile in the Settings dropdown. Does not create/update settings — only activates. Requires user approval. Do NOT call this during partial setup; keep the current provider active so running agents are not interrupted.`

export default {
	type: "function",
	function: {
		name: "activate_provider_profile",
		description: DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				name: {
					type: "string",
					description: "Profile name to activate",
				},
			},
			required: ["name"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
