import {
	isSecretStateKey,
	isProviderName,
	providerNames,
	SECRET_STATE_KEYS,
	getModelId,
	openAiModelInfoSaneDefaults,
	type ProviderSettings,
	type ProviderName,
} from "@roo-code/types"

import type { Task } from "../../task/Task"

/** Field hints for common providers — guides the agent without requiring Settings UI. */
export const PROVIDER_FIELD_HINTS: Partial<
	Record<ProviderName, { required: string[]; optional: string[]; secretKeys: string[] }>
> = {
	openai: {
		required: ["openAiBaseUrl", "openAiModelId"],
		optional: ["openAiHeaders", "openAiStreamingEnabled", "openAiUseAzure", "azureApiVersion"],
		secretKeys: ["openAiApiKey"],
	},
	openrouter: {
		required: ["openRouterModelId"],
		optional: ["openRouterBaseUrl", "openRouterSpecificProvider"],
		secretKeys: ["openRouterApiKey"],
	},
	anthropic: {
		required: ["apiModelId"],
		optional: ["anthropicBaseUrl", "anthropicUseAuthToken", "anthropicBeta1MContext"],
		secretKeys: ["apiKey"],
	},
	ollama: {
		required: ["ollamaModelId"],
		optional: ["ollamaBaseUrl", "ollamaNumCtx"],
		secretKeys: ["ollamaApiKey"],
	},
	gemini: {
		required: ["apiModelId"],
		optional: ["googleGeminiBaseUrl"],
		secretKeys: ["geminiApiKey"],
	},
	"openai-native": {
		required: ["apiModelId"],
		optional: ["openAiNativeBaseUrl", "openAiNativeServiceTier"],
		secretKeys: ["openAiNativeApiKey"],
	},
	lmstudio: {
		required: ["lmStudioModelId"],
		optional: ["lmStudioBaseUrl", "lmStudioDraftModelId", "lmStudioSpeculativeDecodingEnabled"],
		secretKeys: [],
	},
	bedrock: {
		required: ["apiModelId", "awsRegion"],
		optional: [
			"awsUseProfile",
			"awsProfile",
			"awsUseCrossRegionInference",
			"awsUseApiKey",
			"awsBedrockEndpoint",
			"awsBedrockEndpointEnabled",
		],
		secretKeys: ["awsAccessKey", "awsSecretKey", "awsSessionToken", "awsApiKey"],
	},
	mistral: {
		required: ["apiModelId"],
		optional: ["mistralCodestralUrl"],
		secretKeys: ["mistralApiKey"],
	},
	deepseek: {
		required: ["apiModelId"],
		optional: [],
		secretKeys: ["deepSeekApiKey"],
	},
	xai: {
		required: ["apiModelId"],
		optional: [],
		secretKeys: ["xaiApiKey"],
	},
	vertex: {
		required: ["apiModelId", "vertexProjectId", "vertexRegion"],
		optional: ["vertexKeyFile", "vertexJsonCredentials", "vertex1MContext"],
		secretKeys: ["vertexApiKey"],
	},
	/** Prefer when user gives URL/key/model but does NOT name the wire protocol. */
	"custom-endpoint": {
		required: ["customEndpointBaseUrl", "customEndpointModelId"],
		optional: [
			"customEndpointFormat",
			"customEndpointApiKeyHeader",
			"customEndpointApiKeyPrefix",
			"customEndpointModelInfo",
		],
		secretKeys: ["customEndpointApiKey"],
	},
}

/** Weak / placeholder reasoning levels that agent best-setup upgrades to high quality. */
const WEAK_REASONING_EFFORTS = new Set(["", "disable", "none", "minimal", "low", "medium"])

/**
 * Infer context window from model id / custom info for agent setup.
 * Intentionally does NOT invent max output tokens — large forced max_output
 * reserves context and shortens long coding chats; leave output empty so the
 * runtime/provider defaults apply.
 */
export function inferModelTokenLimits(settings: Record<string, unknown>): {
	contextWindow: number
} {
	const pickCustomInfo = (value: unknown): Record<string, unknown> | undefined =>
		value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined

	const custom = pickCustomInfo(settings.customEndpointModelInfo) ?? pickCustomInfo(settings.openAiCustomModelInfo)

	const customCtx =
		typeof custom?.contextWindow === "number" && custom.contextWindow > 0 ? custom.contextWindow : undefined

	const modelId = String(
		settings.customEndpointModelId ??
			settings.openAiModelId ??
			settings.openRouterModelId ??
			settings.apiModelId ??
			settings.ollamaModelId ??
			settings.lmStudioModelId ??
			"",
	).toLowerCase()

	if (customCtx !== undefined) return { contextWindow: customCtx }
	if (/claude|opus|sonnet|haiku/.test(modelId)) return { contextWindow: 200_000 }
	if (/gemini.*2\.5|gemini-2\.5|gemini-3|1m|1000000/.test(modelId)) return { contextWindow: 1_000_000 }
	if (/gemini/.test(modelId)) return { contextWindow: 1_000_000 }
	if (/gpt-4o|gpt-4\.1|gpt-4-turbo|o1|o3|o4|gpt-5/.test(modelId)) return { contextWindow: 128_000 }
	if (/deepseek|qwen|kimi|llama|mistral|glm|nemotron|gpt-oss/.test(modelId)) return { contextWindow: 128_000 }
	return { contextWindow: 128_000 } // safe large default for openai-compat unknown models
}

/**
 * Fill / upgrade "best effort" quality defaults for agent-driven provider setup.
 *
 * - Reasoning: force enable + high (OpenAI-compat UI reads openAiCustomModelInfo.reasoningEffort;
 *   weak agent values like low/medium are upgraded so Settings does not show "low").
 * - Context window: set openAiCustomModelInfo.contextWindow to model-aware max when unset
 *   (needed for sliding window / UI). Do NOT auto-set max output (modelMaxTokens /
 *   openAiCustomModelInfo.maxTokens / includeMaxTokens) — empty is better for long coding
 *   chats so the provider runtime does not reserve a huge completion budget from context.
 * - Image support: set openAiCustomModelInfo.supportsImages when missing so Settings
 *   checkbox and chat upload stay in sync (partial objects must not leave supportsImages
 *   undefined — chat treats that as disabled while Settings shows ?? true).
 * - Streaming / prompt-cache: same as before.
 *
 * Explicit user intent to disable reasoning (enableReasoningEffort=false) is preserved.
 * Explicit high/xhigh/max effort is preserved. Explicit max-output / supportsImages=false
 * values are left alone.
 */
export function applyBestProviderDefaults(
	settings: Record<string, unknown>,
	options?: { hadIncomingSecrets?: boolean },
): { settings: Record<string, unknown>; appliedDefaults: string[] } {
	const out: Record<string, unknown> = { ...settings }
	const appliedDefaults: string[] = []
	let apiProvider = typeof out.apiProvider === "string" ? out.apiProvider : undefined

	const setIfMissing = (key: string, value: unknown) => {
		if (out[key] === undefined || out[key] === null) {
			out[key] = value
			appliedDefaults.push(key)
		}
	}

	const forceSet = (key: string, value: unknown) => {
		if (out[key] !== value) {
			out[key] = value
			appliedDefaults.push(key)
		}
	}

	// PROTOCOL GUESSING GUARD:
	// If apiProvider is omitted, do NOT assume openai/anthropic. Prefer Custom Endpoint +
	// custom request format so models cannot mis-place a generic URL under the wrong section.
	// Only remaps openAi* connection fields when customEndpoint* are empty.
	// Explicit apiProvider from agent/user is never overridden (even if it looks wrong).
	if (!apiProvider) {
		const looksLikeNamedOpenRouter =
			out.openRouterModelId !== undefined ||
			out.openRouterApiKey !== undefined ||
			out.openRouterBaseUrl !== undefined

		if (looksLikeNamedOpenRouter) {
			forceSet("apiProvider", "openrouter")
			apiProvider = "openrouter"
		} else {
			forceSet("apiProvider", "custom-endpoint")
			apiProvider = "custom-endpoint"

			// Agents often fill openai-compat field names by habit — map them into custom-endpoint.
			if (out.customEndpointBaseUrl === undefined && out.openAiBaseUrl !== undefined) {
				out.customEndpointBaseUrl = out.openAiBaseUrl
				appliedDefaults.push("customEndpointBaseUrl(from openAiBaseUrl)")
			}
			if (out.customEndpointModelId === undefined && out.openAiModelId !== undefined) {
				out.customEndpointModelId = out.openAiModelId
				appliedDefaults.push("customEndpointModelId(from openAiModelId)")
			}
			if (out.customEndpointModelInfo === undefined && out.openAiCustomModelInfo !== undefined) {
				out.customEndpointModelInfo = out.openAiCustomModelInfo
				appliedDefaults.push("customEndpointModelInfo(from openAiCustomModelInfo)")
			}
			// Secret may land in settings object before stripSecrets — remap if present.
			if (out.customEndpointApiKey === undefined && typeof out.openAiApiKey === "string") {
				out.customEndpointApiKey = out.openAiApiKey
				appliedDefaults.push("customEndpointApiKey(from openAiApiKey)")
			}
		}
	}

	// Custom Endpoint: default request format is "custom" (Settings "Custom" request format).
	// Agents must only set openai/anthropic format when the user named that protocol.
	if (apiProvider === "custom-endpoint") {
		setIfMissing("customEndpointFormat", "custom")
	}

	// Reasoning: enable unless the agent/user explicitly disabled it
	if (out.enableReasoningEffort === false) {
		// respect explicit off
	} else {
		forceSet("enableReasoningEffort", true)
		const effort = typeof out.reasoningEffort === "string" ? out.reasoningEffort.toLowerCase() : ""
		if (!effort || WEAK_REASONING_EFFORTS.has(effort)) {
			forceSet("reasoningEffort", "high")
		}
	}

	const { contextWindow } = inferModelTokenLimits(out)

	// Do NOT auto-set includeMaxTokens / modelMaxTokens / openAiCustomModelInfo.maxTokens.
	// Empty max-output keeps more of the context window for long agent coding threads;
	// runtime uses provider/model defaults when these fields are unset.

	// OpenAI-compatible streaming (explicit openai providers only — not custom-endpoint)
	if (apiProvider === "openai" || apiProvider === "openai-native") {
		setIfMissing("openAiStreamingEnabled", true)
	}

	// Avoid unexpected prompt-cache behavior on custom / multi-tenant endpoints
	if (apiProvider === "bedrock") {
		setIfMissing("awsUsePromptCache", false)
	}
	if (apiProvider === "litellm" || "litellmUsePromptCache" in out) {
		setIfMissing("litellmUsePromptCache", false)
	}

	// OpenAI-compat Settings UI reads reasoning + context from openAiCustomModelInfo — not only top-level fields.
	// Do NOT treat leftover openAi* fields as openai when apiProvider is custom-endpoint (protocol guard remaps those).
	const isOpenAiCompat = apiProvider === "openai" || apiProvider === "openai-native"

	if (isOpenAiCompat) {
		const prev =
			out.openAiCustomModelInfo &&
			typeof out.openAiCustomModelInfo === "object" &&
			!Array.isArray(out.openAiCustomModelInfo)
				? { ...(out.openAiCustomModelInfo as Record<string, unknown>) }
				: {}

		let touched = false

		// Reasoning effort on custom model info (what ThinkingBudget shows for openai)
		if (out.enableReasoningEffort !== false) {
			const customEffort = typeof prev.reasoningEffort === "string" ? prev.reasoningEffort.toLowerCase() : ""
			const topEffort = typeof out.reasoningEffort === "string" ? out.reasoningEffort.toLowerCase() : "high"
			const desiredEffort =
				topEffort && !WEAK_REASONING_EFFORTS.has(topEffort)
					? topEffort
					: customEffort && !WEAK_REASONING_EFFORTS.has(customEffort)
						? customEffort
						: "high"
			if (prev.reasoningEffort !== desiredEffort) {
				prev.reasoningEffort = desiredEffort
				touched = true
				appliedDefaults.push("openAiCustomModelInfo.reasoningEffort")
			}
			// Keep top-level in sync for non-openai handlers
			if (out.reasoningEffort !== desiredEffort) {
				forceSet("reasoningEffort", desiredEffort)
			}
		}

		if (prev.contextWindow === undefined || prev.contextWindow === null || prev.contextWindow === 0) {
			prev.contextWindow = contextWindow
			touched = true
			appliedDefaults.push("openAiCustomModelInfo.contextWindow")
		}

		// Leave maxTokens empty / -1 when unset — do not invent a large completion budget
		if (prev.supportsPromptCache === undefined) {
			prev.supportsPromptCache = openAiModelInfoSaneDefaults.supportsPromptCache
			touched = true
			appliedDefaults.push("openAiCustomModelInfo.supportsPromptCache")
		}

		// Chat upload gates on truthy supportsImages; Settings checkbox uses ?? true.
		// Persist the sane default so agent partial writes cannot desync the two.
		if (prev.supportsImages === undefined) {
			prev.supportsImages = openAiModelInfoSaneDefaults.supportsImages
			touched = true
			appliedDefaults.push("openAiCustomModelInfo.supportsImages")
		}

		// Advertise effort levels so UI select includes high (not only low)
		if (prev.supportsReasoningEffort === undefined) {
			prev.supportsReasoningEffort = ["low", "medium", "high", "xhigh"]
			touched = true
			appliedDefaults.push("openAiCustomModelInfo.supportsReasoningEffort")
		}

		if (touched) {
			out.openAiCustomModelInfo = prev
		}
	} else {
		// Non-openai: fill context / capability flags if agent provided partial custom model object
		const customInfo = out.openAiCustomModelInfo
		if (customInfo && typeof customInfo === "object" && !Array.isArray(customInfo)) {
			const info = { ...(customInfo as Record<string, unknown>) }
			let touched = false
			if (info.contextWindow === undefined || info.contextWindow === null || info.contextWindow === 0) {
				info.contextWindow = contextWindow
				touched = true
				appliedDefaults.push("openAiCustomModelInfo.contextWindow")
			}
			if (info.supportsPromptCache === undefined) {
				info.supportsPromptCache = openAiModelInfoSaneDefaults.supportsPromptCache
				touched = true
				appliedDefaults.push("openAiCustomModelInfo.supportsPromptCache")
			}
			if (info.supportsImages === undefined) {
				info.supportsImages = openAiModelInfoSaneDefaults.supportsImages
				touched = true
				appliedDefaults.push("openAiCustomModelInfo.supportsImages")
			}
			if (touched) out.openAiCustomModelInfo = info
		}
	}

	// custom-endpoint stores model info separately — create/fill so Settings + chat capabilities stay correct
	if (apiProvider === "custom-endpoint") {
		const prev =
			out.customEndpointModelInfo &&
			typeof out.customEndpointModelInfo === "object" &&
			!Array.isArray(out.customEndpointModelInfo)
				? { ...(out.customEndpointModelInfo as Record<string, unknown>) }
				: {}

		let touched = false

		if (out.enableReasoningEffort !== false) {
			const customEffort = typeof prev.reasoningEffort === "string" ? prev.reasoningEffort.toLowerCase() : ""
			const topEffort = typeof out.reasoningEffort === "string" ? out.reasoningEffort.toLowerCase() : "high"
			const desiredEffort =
				topEffort && !WEAK_REASONING_EFFORTS.has(topEffort)
					? topEffort
					: customEffort && !WEAK_REASONING_EFFORTS.has(customEffort)
						? customEffort
						: "high"
			if (prev.reasoningEffort !== desiredEffort) {
				prev.reasoningEffort = desiredEffort
				touched = true
				appliedDefaults.push("customEndpointModelInfo.reasoningEffort")
			}
		}

		if (prev.contextWindow === undefined || prev.contextWindow === null || prev.contextWindow === 0) {
			prev.contextWindow = contextWindow
			touched = true
			appliedDefaults.push("customEndpointModelInfo.contextWindow")
		}
		if (prev.supportsPromptCache === undefined) {
			prev.supportsPromptCache = openAiModelInfoSaneDefaults.supportsPromptCache
			touched = true
			appliedDefaults.push("customEndpointModelInfo.supportsPromptCache")
		}
		if (prev.supportsImages === undefined) {
			prev.supportsImages = openAiModelInfoSaneDefaults.supportsImages
			touched = true
			appliedDefaults.push("customEndpointModelInfo.supportsImages")
		}
		if (prev.supportsReasoningEffort === undefined) {
			prev.supportsReasoningEffort = ["low", "medium", "high", "xhigh"]
			touched = true
			appliedDefaults.push("customEndpointModelInfo.supportsReasoningEffort")
		}
		if (touched) out.customEndpointModelInfo = prev
	}

	void options // reserved for future secret-aware defaults
	return { settings: out, appliedDefaults }
}

/**
 * Redact secret values from a provider settings object.
 * Secrets become `{ present: true/false }` instead of the raw value.
 * Never returns secret strings.
 */
export function redactProviderSettings(settings: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(settings)) {
		if (isSecretStateKey(key)) {
			out[key] = { present: typeof value === "string" && value.length > 0 }
			continue
		}
		// Avoid echoing nested objects that might hold credentials
		if (key.toLowerCase().includes("secret") || key.toLowerCase().includes("password")) {
			out[key] = { present: value !== undefined && value !== null && value !== "" }
			continue
		}
		out[key] = value
	}
	return out
}

/** Strip secret keys from a settings payload (for manage_provider_profile non-secret path). */
export function stripSecretsFromSettings(settings: Record<string, unknown>): {
	nonSecret: Record<string, unknown>
	secrets: Record<string, string>
} {
	const nonSecret: Record<string, unknown> = {}
	const secrets: Record<string, string> = {}
	for (const [key, value] of Object.entries(settings)) {
		if (isSecretStateKey(key)) {
			if (typeof value === "string") {
				secrets[key] = value
			}
			continue
		}
		nonSecret[key] = value
	}
	return { nonSecret, secrets }
}

export function getClineProvider(task: Task) {
	const provider = task.providerRef.deref()
	if (!provider) {
		throw new Error("Extension provider is not available")
	}
	return provider
}

/** Compact payload — avoid dumping every provider with full SECRET_STATE_KEYS (that bloated tool results and slowed the next API request). */
export function listProviderTypesPayload() {
	const commonProviders = (Object.keys(PROVIDER_FIELD_HINTS) as ProviderName[]).map((apiProvider) => ({
		apiProvider,
		fields: PROVIDER_FIELD_HINTS[apiProvider]!,
	}))
	const otherProviderNames = providerNames.filter((name) => !(name in PROVIDER_FIELD_HINTS))
	return {
		// Prefer manage_provider_profile one-shot; this list is only for rare field-name lookup.
		skipWhen: "User already gave URL + model + key → call manage_provider_profile once; do not list first.",
		commonProviders,
		otherProviderNames,
		quickMap: {
			unknownProtocol: {
				apiProvider: "custom-endpoint",
				fields: ["customEndpointBaseUrl", "customEndpointModelId", "customEndpointFormat=custom"],
				secret: "customEndpointApiKey",
			},
			openaiCompatible: {
				apiProvider: "openai",
				fields: ["openAiBaseUrl", "openAiModelId"],
				secret: "openAiApiKey",
			},
			anthropic: { apiProvider: "anthropic", fields: ["apiModelId"], secret: "apiKey" },
			openrouter: { apiProvider: "openrouter", fields: ["openRouterModelId"], secret: "openRouterApiKey" },
		},
		notes: [
			"SAVE-ONLY: manage_provider_profile with settings+secrets; never activates. Switch via activate_provider_profile.",
			"Unknown protocol → custom-endpoint + customEndpointFormat=custom (never guess openai/anthropic).",
			"Defaults: reasoning high, context when unset, supportsImages when unset; max output left empty.",
		],
	}
}

export function isValidApiProvider(value: unknown): value is ProviderName {
	return isProviderName(value)
}

export function summarizeProfileEntry(entry: {
	name: string
	id: string
	apiProvider?: string
	modelId?: string
	active?: boolean
}) {
	return {
		name: entry.name,
		id: entry.id,
		apiProvider: entry.apiProvider,
		modelId: entry.modelId,
		active: entry.active === true,
	}
}

export function modelIdFromSettings(settings: ProviderSettings): string | undefined {
	return getModelId(settings)
}
