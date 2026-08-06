import {
	getApiProtocol,
	getModelId,
	isProviderName,
	type ContextWindowState,
	type ContextWindowValueSource,
	type EndpointProfile,
	type ModelCapabilityResolutionWarning,
	type ModelInfo,
	type ProviderName,
	type ProviderSettings,
	type ResolvedModelCapabilities,
} from "@roo-code/types"

import { ContextWindowRegistry } from "./ContextWindowRegistry"
import { createDefaultContextWindowRegistry } from "./provider-adapters"

export interface ResolveModelCapabilitiesInput {
	settings: ProviderSettings
	model: ModelInfo
	modelId?: string
	provider?: ProviderName
	condenseContextWindow?: number
}

export interface ModelCapabilityResolverOptions {
	registry?: ContextWindowRegistry
	safeFallbackContextWindow?: number
}

export const DEFAULT_SAFE_FALLBACK_CONTEXT_WINDOW = 32_768

export class ModelCapabilityResolver {
	private readonly registry: ContextWindowRegistry
	private readonly safeFallbackContextWindow: number

	constructor(options: ModelCapabilityResolverOptions = {}) {
		this.registry = options.registry ?? createDefaultContextWindowRegistry()
		this.safeFallbackContextWindow =
			normalizePositiveInteger(options.safeFallbackContextWindow) ?? DEFAULT_SAFE_FALLBACK_CONTEXT_WINDOW
	}

	resolve(input: ResolveModelCapabilitiesInput): ResolvedModelCapabilities {
		const provider = input.provider ?? getProviderFromSettings(input.settings)
		const modelId = input.modelId ?? getModelId(input.settings) ?? ""
		const protocol = getApiProtocol(provider, modelId)
		const warnings: ModelCapabilityResolutionWarning[] = []

		const baseContextWindow = this.normalizeWithFallback({
			value: input.model.contextWindow,
			fallbackValue: this.safeFallbackContextWindow,
			preferredSource: "model_info",
			fallbackSource: "safe_fallback",
			warning: "invalid_model_context_window",
			warnings,
		})

		let contextWindow = baseContextWindow.value
		let contextWindowSource = baseContextWindow.source
		let contextWindowState = baseContextWindow.state
		let contextWindowValue = baseContextWindow.actualValue
		let condenseContextWindow = contextWindow
		let condenseContextWindowSource: ContextWindowValueSource = contextWindowSource
		let condenseContextWindowState = contextWindowState
		let condenseContextWindowValue = contextWindowValue
		let modelInfoOverrides: Partial<ModelInfo> | undefined

		const resolution = this.registry.resolve({
			provider,
			settings: input.settings,
			modelId,
			model: input.model,
			protocol,
			condenseContextWindow: input.condenseContextWindow,
		})

		if (resolution) {
			const adapterContextWindow = normalizePositiveInteger(resolution.result.contextWindow)
			const adapterContextWindowValue = normalizePositiveInteger(resolution.result.contextWindowValue)
			if (adapterContextWindow !== undefined) {
				contextWindow = adapterContextWindow
				contextWindowSource = resolution.result.contextWindowSource ?? "provider_adapter"
				contextWindowState = resolution.result.contextWindowState ?? "confirmed"
				contextWindowValue = adapterContextWindowValue ?? adapterContextWindow
			} else if (resolution.result.contextWindow !== undefined) {
				warnings.push("adapter_returned_invalid_context_window")
			} else if (contextWindowValue === undefined) {
				if (adapterContextWindowValue !== undefined) {
					contextWindowState = resolution.result.contextWindowState ?? "confirmed"
					contextWindowValue = adapterContextWindowValue
				} else if (resolution.result.contextWindowState) {
					contextWindowState = resolution.result.contextWindowState
				}
			}

			const adapterCondenseContextWindow = normalizePositiveInteger(resolution.result.condenseContextWindow)
			const adapterCondenseContextWindowValue = normalizePositiveInteger(
				resolution.result.condenseContextWindowValue,
			)
			if (adapterCondenseContextWindow !== undefined) {
				condenseContextWindow = adapterCondenseContextWindow
				condenseContextWindowSource = resolution.result.condenseContextWindowSource ?? "provider_adapter"
				condenseContextWindowState = resolution.result.condenseContextWindowState ?? "confirmed"
				condenseContextWindowValue = adapterCondenseContextWindowValue ?? adapterCondenseContextWindow
			} else if (resolution.result.condenseContextWindow !== undefined) {
				warnings.push("adapter_returned_invalid_condense_context_window")
			} else if (condenseContextWindowValue === undefined) {
				if (adapterCondenseContextWindowValue !== undefined) {
					condenseContextWindowState = resolution.result.condenseContextWindowState ?? "confirmed"
					condenseContextWindowValue = adapterCondenseContextWindowValue
				} else if (resolution.result.condenseContextWindowState) {
					condenseContextWindowState = resolution.result.condenseContextWindowState
				}
			}

			if (resolution.result.warnings?.length) {
				warnings.push(...resolution.result.warnings)
			}

			modelInfoOverrides = resolution.result.modelOverrides
		}

		const handlerCondenseContextWindow = normalizePositiveInteger(input.condenseContextWindow)
		if (handlerCondenseContextWindow !== undefined) {
			condenseContextWindow = handlerCondenseContextWindow
			condenseContextWindowSource = "handler_override"
			condenseContextWindowState = "confirmed"
			condenseContextWindowValue = handlerCondenseContextWindow
		} else if (input.condenseContextWindow !== undefined) {
			warnings.push("invalid_condense_context_window")
		}

		if (condenseContextWindow > contextWindow) {
			condenseContextWindow = contextWindow
			condenseContextWindowState = contextWindowState
			condenseContextWindowValue = contextWindowValue
			warnings.push("condense_window_exceeds_context_window")
		}

		const modelInfo: ModelInfo = {
			...input.model,
			...modelInfoOverrides,
			contextWindow,
		}

		return {
			provider,
			modelId,
			protocol,
			endpointProfile: buildEndpointProfile({ provider, protocol, settings: input.settings }),
			modelInfo,
			contextWindow,
			contextWindowState,
			contextWindowValue,
			contextWindowSource,
			condenseContextWindow,
			condenseContextWindowState,
			condenseContextWindowValue,
			condenseContextWindowSource,
			warnings,
		}
	}

	private normalizeWithFallback({
		value,
		fallbackValue,
		preferredSource,
		fallbackSource,
		warning,
		warnings,
	}: {
		value: number | undefined
		fallbackValue: number
		preferredSource: ContextWindowValueSource
		fallbackSource: ContextWindowValueSource
		warning: ModelCapabilityResolutionWarning
		warnings: ModelCapabilityResolutionWarning[]
	}): {
		value: number
		source: ContextWindowValueSource
		state: ContextWindowState
		actualValue: number | undefined
	} {
		const normalizedValue = normalizePositiveInteger(value)
		if (normalizedValue !== undefined) {
			return {
				value: normalizedValue,
				source: preferredSource,
				state: "confirmed",
				actualValue: normalizedValue,
			}
		}

		warnings.push(warning)
		return {
			value: fallbackValue,
			source: fallbackSource,
			state: "safe_fallback",
			actualValue: undefined,
		}
	}
}

function buildEndpointProfile({
	provider,
	protocol,
	settings,
}: {
	provider: ProviderName | undefined
	protocol: "anthropic" | "openai"
	settings: ProviderSettings
}): EndpointProfile | undefined {
	if (!provider) {
		return undefined
	}

	const baseUrl = getProviderBaseUrl(provider, settings)

	return {
		provider,
		baseUrl,
		protocol,
		source: baseUrl ? "manual" : "provider",
		isOpenAiCompatible: protocol === "openai",
		isAnthropicCompatible: protocol === "anthropic",
	}
}

function getProviderBaseUrl(provider: ProviderName, settings: ProviderSettings): string | undefined {
	switch (provider) {
		case "anthropic":
			return settings.anthropicBaseUrl
		case "openrouter":
			return settings.openRouterBaseUrl
		case "openai":
			return settings.openAiBaseUrl
		case "openai-native":
			return settings.openAiNativeBaseUrl
		case "ollama":
			return settings.ollamaBaseUrl
		case "lmstudio":
			return settings.lmStudioBaseUrl
		case "requesty":
			return settings.requestyBaseUrl
		case "litellm":
			return settings.litellmBaseUrl
		case "deepseek":
			return settings.deepSeekBaseUrl
		case "poe":
			return settings.poeBaseUrl
		case "moonshot":
			return settings.moonshotBaseUrl
		case "minimax":
			return settings.minimaxBaseUrl
		case "mimo":
			return settings.mimoBaseUrl
		case "gemini":
			return settings.googleGeminiBaseUrl
		case "zoo-gateway":
			return settings.zooGatewayBaseUrl
		default:
			return undefined
	}
}

function normalizePositiveInteger(value: number | undefined): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return undefined
	}

	return Math.floor(value)
}

function getProviderFromSettings(settings: ProviderSettings): ProviderName | undefined {
	return isProviderName(settings.apiProvider) ? settings.apiProvider : undefined
}
