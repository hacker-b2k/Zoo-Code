import { applyBestProviderDefaults, inferModelTokenLimits } from "../providerProfileTools"

describe("applyBestProviderDefaults", () => {
	it("fills quality defaults when fields are missing without setting max output tokens", () => {
		const { settings, appliedDefaults } = applyBestProviderDefaults({
			apiProvider: "openai",
			openAiBaseUrl: "https://example.com/v1",
			openAiModelId: "gpt-4o",
		})

		expect(settings.enableReasoningEffort).toBe(true)
		expect(settings.reasoningEffort).toBe("high")
		expect(settings.includeMaxTokens).toBeUndefined()
		expect(settings.modelMaxTokens).toBeUndefined()
		expect(settings.openAiStreamingEnabled).toBe(true)
		expect((settings.openAiCustomModelInfo as { reasoningEffort?: string })?.reasoningEffort).toBe("high")
		expect((settings.openAiCustomModelInfo as { contextWindow?: number })?.contextWindow).toBe(128_000)
		expect((settings.openAiCustomModelInfo as { maxTokens?: number })?.maxTokens).toBeUndefined()
		// Image support must be persisted so Settings checkbox and chat upload agree
		expect((settings.openAiCustomModelInfo as { supportsImages?: boolean })?.supportsImages).toBe(true)
		expect((settings.openAiCustomModelInfo as { supportsPromptCache?: boolean })?.supportsPromptCache).toBe(false)
		expect(appliedDefaults).toEqual(
			expect.arrayContaining([
				"enableReasoningEffort",
				"reasoningEffort",
				"openAiStreamingEnabled",
				"openAiCustomModelInfo.reasoningEffort",
				"openAiCustomModelInfo.contextWindow",
				"openAiCustomModelInfo.supportsImages",
				"openAiCustomModelInfo.supportsPromptCache",
			]),
		)
		expect(appliedDefaults).not.toContain("modelMaxTokens")
		expect(appliedDefaults).not.toContain("includeMaxTokens")
		expect(appliedDefaults).not.toContain("openAiCustomModelInfo.maxTokens")
	})

	it("fills supportsImages on partial openAiCustomModelInfo without overriding explicit false", () => {
		const partial = applyBestProviderDefaults({
			apiProvider: "openai",
			openAiModelId: "gpt-4o",
			openAiCustomModelInfo: { contextWindow: 128_000, reasoningEffort: "high" },
		})
		expect((partial.settings.openAiCustomModelInfo as { supportsImages?: boolean }).supportsImages).toBe(true)

		const off = applyBestProviderDefaults({
			apiProvider: "openai",
			openAiModelId: "gpt-4o",
			openAiCustomModelInfo: { supportsImages: false, contextWindow: 128_000 },
		})
		expect((off.settings.openAiCustomModelInfo as { supportsImages?: boolean }).supportsImages).toBe(false)

		const customEp = applyBestProviderDefaults({
			apiProvider: "custom-endpoint",
			customEndpointModelInfo: { contextWindow: 64_000 },
		})
		expect((customEp.settings.customEndpointModelInfo as { supportsImages?: boolean }).supportsImages).toBe(true)
	})

	it("upgrades weak reasoningEffort low/medium to high and syncs openAiCustomModelInfo", () => {
		const { settings } = applyBestProviderDefaults({
			apiProvider: "openai",
			openAiModelId: "claude-sonnet-4",
			reasoningEffort: "low",
			openAiCustomModelInfo: { contextWindow: 0, supportsPromptCache: false, reasoningEffort: "medium" },
		})

		expect(settings.enableReasoningEffort).toBe(true)
		expect(settings.reasoningEffort).toBe("high")
		expect((settings.openAiCustomModelInfo as { reasoningEffort?: string }).reasoningEffort).toBe("high")
		expect((settings.openAiCustomModelInfo as { contextWindow?: number }).contextWindow).toBe(200_000)
		expect((settings.openAiCustomModelInfo as { maxTokens?: number }).maxTokens).toBeUndefined()
	})

	it("preserves explicit disable and high/xhigh and explicit max output", () => {
		const off = applyBestProviderDefaults({
			apiProvider: "openai",
			enableReasoningEffort: false,
			reasoningEffort: "low",
			includeMaxTokens: false,
			openAiStreamingEnabled: false,
			modelMaxTokens: 8192,
		})
		expect(off.settings.enableReasoningEffort).toBe(false)
		expect(off.settings.openAiStreamingEnabled).toBe(false)
		expect(off.settings.includeMaxTokens).toBe(false)
		expect(off.settings.modelMaxTokens).toBe(8192)

		const high = applyBestProviderDefaults({
			apiProvider: "openai",
			openAiModelId: "x",
			reasoningEffort: "xhigh",
			enableReasoningEffort: true,
		})
		expect(high.settings.reasoningEffort).toBe("xhigh")
		expect((high.settings.openAiCustomModelInfo as { reasoningEffort?: string }).reasoningEffort).toBe("xhigh")
	})

	it("sets awsUsePromptCache false for bedrock when unset", () => {
		const { settings } = applyBestProviderDefaults({
			apiProvider: "bedrock",
			apiModelId: "x",
			awsRegion: "us-east-1",
		})
		expect(settings.awsUsePromptCache).toBe(false)
	})

	it("defaults omitted apiProvider to custom-endpoint with custom format (no protocol guess)", () => {
		const { settings, appliedDefaults } = applyBestProviderDefaults({
			openAiBaseUrl: "https://relay.example/v1",
			openAiModelId: "mystery-model",
		})

		expect(settings.apiProvider).toBe("custom-endpoint")
		expect(settings.customEndpointFormat).toBe("custom")
		expect(settings.customEndpointBaseUrl).toBe("https://relay.example/v1")
		expect(settings.customEndpointModelId).toBe("mystery-model")
		expect(appliedDefaults).toEqual(
			expect.arrayContaining([
				"apiProvider",
				"customEndpointFormat",
				"customEndpointBaseUrl(from openAiBaseUrl)",
				"customEndpointModelId(from openAiModelId)",
			]),
		)
	})

	it("preserves explicit openai/anthropic and only defaults format on custom-endpoint", () => {
		const openai = applyBestProviderDefaults({
			apiProvider: "openai",
			openAiBaseUrl: "https://api.openai.com/v1",
			openAiModelId: "gpt-4o",
		})
		expect(openai.settings.apiProvider).toBe("openai")
		expect(openai.settings.customEndpointFormat).toBeUndefined()

		const custom = applyBestProviderDefaults({
			apiProvider: "custom-endpoint",
			customEndpointBaseUrl: "https://x.example",
			customEndpointModelId: "m",
		})
		expect(custom.settings.customEndpointFormat).toBe("custom")

		const customOpenAiFormat = applyBestProviderDefaults({
			apiProvider: "custom-endpoint",
			customEndpointFormat: "openai",
			customEndpointBaseUrl: "https://x.example",
			customEndpointModelId: "m",
		})
		expect(customOpenAiFormat.settings.customEndpointFormat).toBe("openai")
	})
})

describe("inferModelTokenLimits", () => {
	it("uses claude context and gpt-4o context", () => {
		expect(inferModelTokenLimits({ openAiModelId: "claude-opus-4" }).contextWindow).toBe(200_000)
		expect(inferModelTokenLimits({ openAiModelId: "gpt-4o-mini" }).contextWindow).toBe(128_000)
	})

	it("respects custom openAiCustomModelInfo context window only", () => {
		const r = inferModelTokenLimits({
			openAiModelId: "anything",
			openAiCustomModelInfo: { contextWindow: 256_000, maxTokens: 32_000 },
		})
		expect(r.contextWindow).toBe(256_000)
		expect((r as { maxTokens?: number }).maxTokens).toBeUndefined()
	})
})
