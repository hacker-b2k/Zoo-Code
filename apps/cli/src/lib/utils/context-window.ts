import type { ProviderSettings } from "@roo-code/types"
import { getModelId } from "@roo-code/types"
import { ModelCapabilityResolver } from "@roo-code/core"
import type { ModelInfo } from "@roo-code/types"

import type { RouterModels } from "@/ui/store.js"

const DEFAULT_CONTEXT_WINDOW = 200_000

/**
 * Singleton resolver instance configured with CLI-safe defaults.
 * Uses DEFAULT_CONTEXT_WINDOW as the safe fallback to preserve backward
 * compatibility with the previous simple routerModels lookup.
 */
const resolver = new ModelCapabilityResolver({
	safeFallbackContextWindow: DEFAULT_CONTEXT_WINDOW,
})

/**
 * Resolves the context window for the current model using the
 * ModelCapabilityResolver from @roo-code/core.
 *
 * This applies the full adapter chain:
 * - Bedrock 1M context when awsBedrock1MContext is enabled
 * - VS Code LM condense-window adapter
 * - Provider default model info fallback (OpenAI-compatible, LiteLLM)
 * - Safe fallback when model info is invalid or missing
 *
 * Falls back to a simple routerModels lookup → DEFAULT_CONTEXT_WINDOW
 * when no routerModels or apiConfiguration are available.
 *
 * @param routerModels - The router models data containing model info per provider
 * @param apiConfiguration - The current API configuration with provider and model ID
 * @returns The resolved context window size
 */
export function getContextWindow(routerModels: RouterModels | null, apiConfiguration: ProviderSettings | null): number {
	if (!routerModels || !apiConfiguration) {
		return DEFAULT_CONTEXT_WINDOW
	}

	const provider = apiConfiguration.apiProvider
	const modelId = getModelId(apiConfiguration)

	if (!provider || !modelId) {
		return DEFAULT_CONTEXT_WINDOW
	}

	const providerModels = routerModels[provider]
	const routerContextWindow = providerModels?.[modelId]?.contextWindow

	// Build a minimal ModelInfo for the resolver.
	// When routerModels has no contextWindow for this model, pass 0 (invalid)
	// so the resolver applies its full fallback chain (adapters → safe fallback).
	const model: ModelInfo = {
		contextWindow: routerContextWindow ?? 0,
		supportsPromptCache: false,
	}

	const resolved = resolver.resolve({
		settings: apiConfiguration,
		model,
		modelId,
	})

	return resolved.contextWindow
}

export { DEFAULT_CONTEXT_WINDOW }
