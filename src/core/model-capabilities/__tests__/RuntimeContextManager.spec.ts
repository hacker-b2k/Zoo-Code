import { describe, expect, it, vi, beforeEach } from "vitest"

import type { Anthropic } from "@anthropic-ai/sdk"
import type { ClineMessage, ModelInfo, ProviderSettings } from "@roo-code/types"

import type { ApiHandler } from "../../../api"
import { manageContext, willManageContext } from "../../context-management"
import type { ApiMessage } from "../../task-persistence"
import { ContextWindowRegistry } from "../ContextWindowRegistry"
import { RuntimeContextManager } from "../RuntimeContextManager"
import type { ProviderAdapter } from "../provider-adapter"

vi.mock("../../context-management", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../context-management")>()

	return {
		...actual,
		willManageContext: vi.fn(() => false),
		manageContext: vi.fn(async (options: any) => ({
			messages: options.messages,
			summary: "",
			cost: 0,
			prevContextTokens: options.totalTokens,
		})),
	}
})

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

function createApiHandler({
	model = createModel(),
	modelId = "claude-sonnet-4-20250514",
	condenseContextWindow,
}: {
	model?: ModelInfo
	modelId?: string
	condenseContextWindow?: number
} = {}): ApiHandler {
	const handler: ApiHandler = {
		createMessage: vi.fn() as any,
		getModel: vi.fn(() => ({ id: modelId, info: model })),
		countTokens: vi.fn(async (content: Anthropic.Messages.ContentBlockParam[]) => {
			return content.reduce((total, block) => {
				return total + (block.type === "text" ? block.text.length : 100)
			}, 0)
		}),
	}

	if (condenseContextWindow !== undefined) {
		handler.getCondenseContextWindow = vi.fn(() => condenseContextWindow)
	}

	return handler
}

describe("RuntimeContextManager", () => {
	beforeEach(() => {
		vi.mocked(willManageContext).mockClear()
		vi.mocked(willManageContext).mockReturnValue(false)
		vi.mocked(manageContext).mockClear()
	})

	it("resolves runtime context through ModelCapabilityResolver and handler condense overrides", () => {
		const manager = new RuntimeContextManager()
		const apiHandler = createApiHandler({
			model: createModel({ contextWindow: 200_000, maxTokens: 12_000 }),
			condenseContextWindow: 128_000,
		})

		const runtime = manager.resolveRuntimeContext({
			apiHandler,
			settings: createSettings(),
		})

		expect(runtime.modelId).toBe("claude-sonnet-4-20250514")
		expect(runtime.contextWindow).toBe(128_000)
		expect(runtime.resolvedCapabilities.condenseContextWindowSource).toBe("handler_override")
		expect(runtime.modelInfo.contextWindow).toBe(200_000)
		expect(runtime.maxTokens).toBe(12_000)
		expect(runtime.useAvailableInputForContextPercent).toBe(true)
	})

	it("applies provider adapter capability overrides before computing max tokens", () => {
		const registry = new ContextWindowRegistry()
		const adapter: ProviderAdapter = {
			id: "test-adapter",
			canResolve: () => true,
			resolve: () => ({
				contextWindow: 100_000,
				modelOverrides: { maxTokens: 40_000 },
			}),
		}
		registry.register(adapter)
		const manager = new RuntimeContextManager({ registry })

		const runtime = manager.resolveRuntimeContext({
			apiHandler: createApiHandler({ model: createModel({ contextWindow: 200_000, maxTokens: 8_000 }) }),
			settings: createSettings({ apiProvider: "openai" }),
		})

		expect(runtime.modelInfo.contextWindow).toBe(100_000)
		expect(runtime.modelInfo.maxTokens).toBe(40_000)
		expect(runtime.maxTokens).toBe(20_000)
		expect(runtime.useAvailableInputForContextPercent).toBe(false)
	})

	it("evaluates context management using last message token estimates and runtime thresholds", async () => {
		vi.mocked(willManageContext).mockReturnValue(true)
		const manager = new RuntimeContextManager()
		const apiHandler = createApiHandler()
		const messages: ApiMessage[] = [
			{ role: "user", content: "previous" },
			{ role: "user", content: [{ type: "text", text: "hello" }] },
		]

		const result = await manager.evaluateContextManagement({
			messages,
			totalTokens: 150_000,
			apiHandler,
			settings: createSettings(),
			autoCondenseContext: true,
			autoCondenseContextPercent: 80,
			profileThresholds: { profileA: 75 },
			currentProfileId: "profileA",
		})

		expect(result.shouldManageContext).toBe(true)
		expect(result.lastMessageTokens).toBe(5)
		expect(apiHandler.countTokens).toHaveBeenCalledWith([{ type: "text", text: "hello" }])
		expect(willManageContext).toHaveBeenCalledWith(
			expect.objectContaining({
				contextWindow: 200_000,
				lastMessageTokens: 5,
				totalTokens: 150_000,
				useAvailableInputForContextPercent: false,
			}),
		)
	})

	it("delegates context management with resolved runtime limits", async () => {
		const manager = new RuntimeContextManager()
		const apiHandler = createApiHandler({ condenseContextWindow: 128_000 })
		const messages: ApiMessage[] = [{ role: "user", content: "hello" }]

		await manager.manageConversationContext({
			messages,
			totalTokens: 100_000,
			apiHandler,
			settings: createSettings(),
			autoCondenseContext: true,
			autoCondenseContextPercent: 90,
			systemPrompt: "system",
			taskId: "task-1",
			profileThresholds: {},
			currentProfileId: "default",
		})

		expect(manageContext).toHaveBeenCalledWith(
			expect.objectContaining({
				messages,
				contextWindow: 128_000,
				maxTokens: 8_000,
				useAvailableInputForContextPercent: true,
			}),
		)
	})

	it("computes token usage after applying the Task message combiner", () => {
		const manager = new RuntimeContextManager()
		const messages: ClineMessage[] = [
			{ ts: 1, type: "say", say: "api_req_started", text: '{"tokensIn":10,"tokensOut":5}' },
		]
		const combineMessages = vi.fn((input: ClineMessage[]) => [
			...input,
			{ ts: 2, type: "say" as const, say: "api_req_started" as const, text: '{"tokensIn":2}' },
		])

		const tokenUsage = manager.getTokenUsage(messages, combineMessages)

		expect(combineMessages).toHaveBeenCalledWith(messages)
		expect(tokenUsage.totalTokensIn).toBe(12)
		expect(tokenUsage.totalTokensOut).toBe(5)
	})
})
