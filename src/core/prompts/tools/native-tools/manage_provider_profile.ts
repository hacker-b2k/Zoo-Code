import type OpenAI from "openai"

const DESCRIPTION = `SAVE-ONLY provider create/update in Zoo Settings (not workspace code). Does NOT change the active provider — running agents keep working. To SWITCH active profile, call activate_provider_profile separately (or user picks in Settings dropdown).

When user gave URL + model + key (optional protocol): call THIS tool first — action=upsert, settings+secrets in one call. No list_provider_types, no list_provider_profiles, no repo explore. activate is ignored if sent (always save-only).

Protocol → fields:
- Unknown protocol → apiProvider=custom-endpoint, customEndpointBaseUrl, customEndpointModelId, customEndpointFormat=custom, secrets.customEndpointApiKey
- User said OpenAI-compatible → apiProvider=openai, openAiBaseUrl, openAiModelId, secrets.openAiApiKey
- User said Anthropic → apiProvider=anthropic, apiModelId, secrets.apiKey
- User said OpenRouter → apiProvider=openrouter, openRouterModelId, secrets.openRouterApiKey
Omit apiProvider → tool forces custom-endpoint+format custom. Tool fills reasoning/context/supportsImages; leave max output empty. After save: stop unless user asked to switch — then activate_provider_profile.`

export default {
	type: "function",
	function: {
		name: "manage_provider_profile",
		description: DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				action: {
					type: "string",
					description: "create | update | upsert",
					enum: ["create", "update", "upsert"],
				},
				name: {
					type: "string",
					description: "Profile display name (unique)",
				},
				activate: {
					type: ["boolean", "null"],
					description:
						"IGNORED. manage_provider_profile never activates. Pass null/false. To switch the active provider use activate_provider_profile after a complete save.",
				},
				settings: {
					type: "object",
					description:
						"Non-secret ProviderSettings. Prefer apiProvider=custom-endpoint when protocol is unknown: { apiProvider: 'custom-endpoint', customEndpointBaseUrl, customEndpointModelId, customEndpointFormat: 'custom' }. Use openai/anthropic only when user named that protocol. Omit quality fields for auto-defaults.",
					additionalProperties: true,
				},
				secrets: {
					type: ["object", "null"],
					description:
						"Optional map of secret key to value. custom-endpoint: customEndpointApiKey. openai: openAiApiKey. anthropic: apiKey. openrouter: openRouterApiKey. Never returned in results.",
					additionalProperties: { type: "string" },
				},
			},
			required: ["action", "name", "settings", "activate", "secrets"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
