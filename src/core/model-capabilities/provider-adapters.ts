import {
	AWS_INFERENCE_PROFILE_MAPPING,
	BEDROCK_1M_CONTEXT_MODEL_IDS,
	litellmDefaultModelInfo,
	openAiModelInfoSaneDefaults,
	vscodeLlmDefaultModelId,
	vscodeLlmModels,
	type ModelInfo,
	type ProviderName,
} from "@roo-code/types"

import { ContextWindowRegistry } from "./ContextWindowRegistry"
import {
	DEFAULT_PROVIDER_ADAPTER_PRIORITY,
	type ModelCapabilityResolutionRequest,
	type ProviderAdapter,
} from "./provider-adapter"

export const BEDROCK_1M_CONTEXT_ADAPTER_ID = "bedrock-1m-context"
export const VSCODE_LM_CONTEXT_WINDOW_ADAPTER_ID = "vscode-lm-context-window"
export const PROVIDER_DEFAULT_MODEL_INFO_ADAPTER_ID = "provider-default-model-info"

const BEDROCK_1M_CONTEXT_WINDOW = 1_000_000
const VS_CODE_LM_SELECTOR_SEPARATOR = "/"

type VsCodeLmStaticModelInfo = ModelInfo & { maxInputTokens?: number }

const OPENAI_COMPATIBLE_DEFAULT_PROVIDERS = new Set<ProviderName>(["openai", "ollama", "lmstudio"])
const LITELLM_DEFAULT_PROVIDERS = new Set<ProviderName>(["litellm"])

export const bedrock1MContextAdapter: ProviderAdapter = {
	id: BEDROCK_1M_CONTEXT_ADAPTER_ID,
	priority: DEFAULT_PROVIDER_ADAPTER_PRIORITY + 100,
	canResolve: (request) =>
		request.provider === "bedrock" &&
		request.settings.awsBedrock1MContext === true &&
		isBedrock1MContextModel(request.modelId),
	resolve: ({ model }) => {
		const tier = model.tiers?.[0]

		return {
			contextWindow: tier?.contextWindow ?? BEDROCK_1M_CONTEXT_WINDOW,
			contextWindowSource: "provider_setting",
			modelOverrides: {
				inputPrice: tier?.inputPrice ?? model.inputPrice,
				outputPrice: tier?.outputPrice ?? model.outputPrice,
				cacheWritesPrice: tier?.cacheWritesPrice ?? model.cacheWritesPrice,
				cacheReadsPrice: tier?.cacheReadsPrice ?? model.cacheReadsPrice,
			},
		}
	},
}

export const vscodeLmContextWindowAdapter: ProviderAdapter = {
	id: VSCODE_LM_CONTEXT_WINDOW_ADAPTER_ID,
	priority: DEFAULT_PROVIDER_ADAPTER_PRIORITY + 90,
	canResolve: (request) => request.provider === "vscode-lm",
	resolve: (request) => {
		const staticModel = getVsCodeLmStaticModel(request)
		const maxInputTokens = normalizePositiveInteger(staticModel?.maxInputTokens)

		if (maxInputTokens === undefined) {
			return undefined
		}

		const contextWindow = normalizePositiveInteger(staticModel?.contextWindow)
		const modelContextWindow = normalizePositiveInteger(request.model.contextWindow)

		return {
			...(modelContextWindow === undefined && contextWindow !== undefined
				? { contextWindow, contextWindowSource: "provider_adapter" as const }
				: {}),
			condenseContextWindow: maxInputTokens,
			condenseContextWindowSource: "provider_adapter",
		}
	},
}

export const providerDefaultModelInfoAdapter: ProviderAdapter = {
	id: PROVIDER_DEFAULT_MODEL_INFO_ADAPTER_ID,
	priority: DEFAULT_PROVIDER_ADAPTER_PRIORITY - 100,
	canResolve: (request) => getDefaultModelInfoForProvider(request.provider) !== undefined,
	resolve: (request) => {
		if (normalizePositiveInteger(request.model.contextWindow) !== undefined) {
			return undefined
		}

		const defaultModelInfo = getDefaultModelInfoForProvider(request.provider)
		if (!defaultModelInfo) {
			return undefined
		}

		// Fill secondary capability fields from provider defaults, but never synthesize
		// a context window here. The resolver's safe fallback remains the runtime guard.
		return {
			modelOverrides: mergeMissingModelDefaults(request.model, defaultModelInfo),
		}
	},
}

export const defaultProviderAdapters: ProviderAdapter[] = [
	bedrock1MContextAdapter,
	vscodeLmContextWindowAdapter,
	providerDefaultModelInfoAdapter,
]

export function createDefaultContextWindowRegistry(): ContextWindowRegistry {
	const registry = new ContextWindowRegistry()
	registry.registerMany(defaultProviderAdapters)
	return registry
}

function isBedrock1MContextModel(modelId: string): boolean {
	const baseModelId = stripBedrockInferenceProfilePrefix(modelId)
	return BEDROCK_1M_CONTEXT_MODEL_IDS.includes(baseModelId as (typeof BEDROCK_1M_CONTEXT_MODEL_IDS)[number])
}

function stripBedrockInferenceProfilePrefix(modelId: string): string {
	if (!modelId) {
		return modelId
	}

	for (const [, inferenceProfile] of AWS_INFERENCE_PROFILE_MAPPING) {
		if (modelId.startsWith(inferenceProfile)) {
			return modelId.substring(inferenceProfile.length)
		}
	}

	return modelId.startsWith("global.") ? modelId.substring("global.".length) : modelId
}

function getVsCodeLmStaticModel(request: ModelCapabilityResolutionRequest): VsCodeLmStaticModelInfo | undefined {
	const family = request.settings.vsCodeLmModelSelector?.family ?? getVsCodeLmFamilyFromModelId(request.modelId)
	return family
		? (vscodeLlmModels[family as keyof typeof vscodeLlmModels] ?? vscodeLlmModels[vscodeLlmDefaultModelId])
		: vscodeLlmModels[vscodeLlmDefaultModelId]
}

function getVsCodeLmFamilyFromModelId(modelId: string): string | undefined {
	if (modelId in vscodeLlmModels) {
		return modelId
	}

	return modelId.split(VS_CODE_LM_SELECTOR_SEPARATOR).find((part) => part in vscodeLlmModels)
}

function getDefaultModelInfoForProvider(provider: ProviderName | undefined): ModelInfo | undefined {
	if (!provider) {
		return undefined
	}

	if (OPENAI_COMPATIBLE_DEFAULT_PROVIDERS.has(provider)) {
		return openAiModelInfoSaneDefaults
	}

	if (LITELLM_DEFAULT_PROVIDERS.has(provider)) {
		return litellmDefaultModelInfo
	}

	return undefined
}

function mergeMissingModelDefaults(model: ModelInfo, defaults: ModelInfo): Partial<ModelInfo> {
	return {
		maxTokens: model.maxTokens ?? defaults.maxTokens,
		maxThinkingTokens: model.maxThinkingTokens ?? defaults.maxThinkingTokens,
		supportsImages: model.supportsImages ?? defaults.supportsImages,
		supportsPromptCache: model.supportsPromptCache ?? defaults.supportsPromptCache,
		inputPrice: model.inputPrice ?? defaults.inputPrice,
		outputPrice: model.outputPrice ?? defaults.outputPrice,
		cacheWritesPrice: model.cacheWritesPrice ?? defaults.cacheWritesPrice,
		cacheReadsPrice: model.cacheReadsPrice ?? defaults.cacheReadsPrice,
	}
}

function normalizePositiveInteger(value: number | undefined): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return undefined
	}

	return Math.floor(value)
}
