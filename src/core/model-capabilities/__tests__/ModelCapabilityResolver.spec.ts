import { describe, expect, it } from "vitest"

import {
	BEDROCK_1M_CONTEXT_MODEL_IDS,
	openAiModelInfoSaneDefaults,
	vscodeLlmModels,
	type ModelInfo,
	type ProviderSettings,
} from "@roo-code/types"

import { ContextWindowRegistry } from "../ContextWindowRegistry"
import { DEFAULT_SAFE_FALLBACK_CONTEXT_WINDOW, ModelCapabilityResolver } from "../ModelCapabilityResolver"
import type { ProviderAdapter } from "../provider-adapter"

function createModel(overrides: Partial<ModelInfo> = {}): ModelInfo {
	return {
		contextWindow: 200_000,
		maxTokens: 8_000,
		supportsPromptCache: true,
		...overrides,
	}
}

function createSettings(overrides: Partial<ProviderSettings> = {}): ProviderSettings {
	return {
		apiProvider: "anthropic",
		apiModelId: "claude-sonnet-4-20250514",
		...overrides,
	}
}

describe("ContextWindowRegistry", () => {
	it("resolves the highest-priority matching adapter", () => {
		const lowPriorityAdapter: ProviderAdapter = {
			id: "low-priority",
			priority: 10,
			canResolve: () => true,
			resolve: () => ({ contextWindow: 100_000 }),
		}
		const highPriorityAdapter: ProviderAdapter = {
			id: "high-priority",
			priority: 100,
			canResolve: () => true,
			resolve: () => ({ contextWindow: 300_000 }),
		}
		const registry = new ContextWindowRegistry()
		registry.registerMany([lowPriorityAdapter, highPriorityAdapter])

		const resolved = registry.resolve({
			provider: "anthropic",
			settings: createSettings(),
			modelId: "claude-sonnet-4-20250514",
			model: createModel(),
			protocol: "anthropic",
		})

		expect(resolved?.adapter.id).toBe("high-priority")
		expect(resolved?.result.contextWindow).toBe(300_000)
	})

	it("returns undefined when no adapter matches", () => {
		const registry = new ContextWindowRegistry()
		registry.register({
			id: "never",
			canResolve: () => false,
			resolve: () => ({ contextWindow: 123_456 }),
		})

		expect(
			registry.resolve({
				provider: "anthropic",
				settings: createSettings(),
				modelId: "claude-sonnet-4-20250514",
				model: createModel(),
				protocol: "anthropic",
			}),
		).toBeUndefined()
	})
})

describe("ModelCapabilityResolver", () => {
	it("uses safe fallback when model contextWindow is invalid", () => {
		const resolver = new ModelCapabilityResolver()
		const result = resolver.resolve({
			settings: createSettings(),
			model: createModel({ contextWindow: 0 }),
		})

		expect(result.contextWindow).toBe(DEFAULT_SAFE_FALLBACK_CONTEXT_WINDOW)
		expect(result.contextWindowSource).toBe("safe_fallback")
		expect(result.warnings).toContain("invalid_model_context_window")
	})

	it("applies adapter overrides and preserves protocol detection", () => {
		const registry = new ContextWindowRegistry()
		registry.register({
			id: "bedrock-1m",
			priority: 100,
			canResolve: (request) => request.provider === "bedrock" && request.settings.awsBedrock1MContext === true,
			resolve: () => ({
				contextWindow: 1_000_000,
				contextWindowSource: "provider_setting",
				modelOverrides: { maxTokens: 16_000 },
			}),
		})
		const resolver = new ModelCapabilityResolver({ registry })

		const result = resolver.resolve({
			settings: createSettings({ apiProvider: "bedrock", awsBedrock1MContext: true }),
			model: createModel({ contextWindow: 200_000, maxTokens: 8_000 }),
			modelId: "anthropic.claude-sonnet-4",
		})

		expect(result.protocol).toBe("anthropic")
		expect(result.contextWindow).toBe(1_000_000)
		expect(result.contextWindowSource).toBe("provider_setting")
		expect(result.modelInfo.maxTokens).toBe(16_000)
	})

	it("prefers handler condense override and clamps it to contextWindow", () => {
		const registry = new ContextWindowRegistry()
		registry.register({
			id: "vscode-adapter",
			priority: 100,
			canResolve: () => true,
			resolve: () => ({
				contextWindow: 128_000,
				condenseContextWindow: 256_000,
				condenseContextWindowSource: "provider_adapter",
			}),
		})
		const resolver = new ModelCapabilityResolver({ registry })

		const result = resolver.resolve({
			settings: createSettings({ apiProvider: "vscode-lm", apiModelId: undefined }),
			model: createModel({ contextWindow: 128_000 }),
			modelId: "copilot/claude-sonnet-4",
			condenseContextWindow: 512_000,
		})

		expect(result.condenseContextWindow).toBe(128_000)
		expect(result.condenseContextWindowSource).toBe("handler_override")
		expect(result.warnings).toContain("condense_window_exceeds_context_window")
	})

	it("records invalid condense override warnings without crashing", () => {
		const resolver = new ModelCapabilityResolver()
		const result = resolver.resolve({
			settings: createSettings(),
			model: createModel(),
			condenseContextWindow: -1,
		})

		expect(result.condenseContextWindow).toBe(result.contextWindow)
		expect(result.warnings).toContain("invalid_condense_context_window")
	})

	it("registers the Bedrock 1M context adapter by default", () => {
		const resolver = new ModelCapabilityResolver()
		const tier = {
			contextWindow: 1_000_000,
			inputPrice: 6,
			outputPrice: 30,
			cacheWritesPrice: 7.5,
			cacheReadsPrice: 0.6,
		}

		const result = resolver.resolve({
			settings: createSettings({ apiProvider: "bedrock", awsBedrock1MContext: true }),
			model: createModel({
				contextWindow: 200_000,
				inputPrice: 3,
				outputPrice: 15,
				cacheWritesPrice: 3.75,
				cacheReadsPrice: 0.3,
				tiers: [tier],
			}),
			modelId: `us.${BEDROCK_1M_CONTEXT_MODEL_IDS[0]}`,
		})

		expect(result.contextWindow).toBe(1_000_000)
		expect(result.contextWindowSource).toBe("provider_setting")
		expect(result.modelInfo.inputPrice).toBe(tier.inputPrice)
		expect(result.modelInfo.outputPrice).toBe(tier.outputPrice)
		expect(result.modelInfo.cacheWritesPrice).toBe(tier.cacheWritesPrice)
		expect(result.modelInfo.cacheReadsPrice).toBe(tier.cacheReadsPrice)
	})

	it("registers the VS Code LM condense-window adapter by default", () => {
		const resolver = new ModelCapabilityResolver()
		const result = resolver.resolve({
			settings: createSettings({
				apiProvider: "vscode-lm",
				apiModelId: undefined,
				vsCodeLmModelSelector: { vendor: "copilot", family: "claude-opus-4.8" },
			}),
			model: createModel({ contextWindow: 679_560, maxTokens: -1 }),
			modelId: "copilot/claude-opus-4.8/claude-opus-4.8",
		})

		expect(result.contextWindow).toBe(679_560)
		expect(result.contextWindowSource).toBe("model_info")
		expect(result.condenseContextWindow).toBe(vscodeLlmModels["claude-opus-4.8"].maxInputTokens)
		expect(result.condenseContextWindowSource).toBe("provider_adapter")
	})

	it("fills secondary fields from provider defaults and uses safe fallback for unknown context window", () => {
		const resolver = new ModelCapabilityResolver()
		const result = resolver.resolve({
			settings: createSettings({ apiProvider: "openai", openAiModelId: "custom-model", apiModelId: undefined }),
			model: createModel({ contextWindow: 0, maxTokens: undefined, supportsImages: undefined }),
			modelId: "custom-model",
		})

		// Context window is unknown → safe fallback, NOT the old 128k synthetic default
		expect(result.contextWindow).toBe(DEFAULT_SAFE_FALLBACK_CONTEXT_WINDOW)
		expect(result.contextWindowSource).toBe("safe_fallback")
		expect(result.contextWindowState).toBe("safe_fallback")
		expect(result.contextWindowValue).toBeUndefined()
		// Secondary fields still filled from provider defaults
		expect(result.modelInfo.maxTokens).toBe(openAiModelInfoSaneDefaults.maxTokens)
		expect(result.modelInfo.supportsImages).toBe(openAiModelInfoSaneDefaults.supportsImages)
		expect(result.warnings).toContain("invalid_model_context_window")
	})
})
