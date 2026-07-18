// npx vitest run api/providers/__tests__/custom-endpoint.spec.ts

import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ApiHandlerOptions } from "../../../shared/api"
import { CustomEndpointHandler, mapCustomEndpointOptionsToOpenAi } from "../custom-endpoint"

const mockCreate = vi.fn()

vi.mock("openai", () => {
	const mockConstructor = vi.fn()
	return {
		__esModule: true,
		default: mockConstructor.mockImplementation(function () {
			return {
				chat: {
					completions: {
						create: mockCreate.mockImplementation(async (options) => {
							if (!options.stream) {
								return {
									id: "test-completion",
									choices: [
										{
											message: { role: "assistant", content: "Test response", refusal: null },
											finish_reason: "stop",
											index: 0,
										},
									],
									usage: {
										prompt_tokens: 10,
										completion_tokens: 5,
										total_tokens: 15,
									},
								}
							}

							return {
								[Symbol.asyncIterator]: async function* () {
									yield {
										choices: [
											{
												delta: { content: "Test response" },
												index: 0,
											},
										],
										usage: null,
									}
									yield {
										choices: [
											{
												delta: {},
												index: 0,
											},
										],
										usage: {
											prompt_tokens: 10,
											completion_tokens: 5,
											total_tokens: 15,
										},
									}
								},
							}
						}),
					},
				},
			}
		}),
	}
})

vi.mock("../../../shared/package", () => ({
	Package: {
		name: "zoo-code",
		version: "1.0.0",
		outputChannel: "Zoo-Code",
		sha: "test-sha",
	},
}))

vi.mock("../utils/timeout-config", () => ({
	getApiRequestTimeout: vi.fn().mockReturnValue(600_000),
}))

describe("mapCustomEndpointOptionsToOpenAi", () => {
	it("maps customEndpoint fields onto openAi* for OpenAiHandler parity", () => {
		const mapped = mapCustomEndpointOptionsToOpenAi({
			customEndpointBaseUrl: "https://example.com/v1",
			customEndpointApiKey: "sk-test",
			customEndpointModelId: "gpt-test",
			customEndpointModelInfo: { contextWindow: 128000, reasoningEffort: "high" },
			customEndpointFormat: "custom",
		})

		expect(mapped.openAiBaseUrl).toBe("https://example.com/v1")
		expect(mapped.openAiApiKey).toBe("sk-test")
		expect(mapped.openAiModelId).toBe("gpt-test")
		expect(mapped.openAiCustomModelInfo).toEqual({ contextWindow: 128000, reasoningEffort: "high" })
		expect(mapped.openAiStreamingEnabled).toBe(true)
	})

	it("omits openAiApiKey for free/no-auth endpoints so Authorization is stripped", () => {
		const mapped = mapCustomEndpointOptionsToOpenAi({
			customEndpointBaseUrl: "https://g4f.space/v1",
			customEndpointModelId: "auto",
		})
		expect(mapped.openAiApiKey).toBeUndefined()
	})

	it("puts non-Authorization auth header into openAiHeaders and omits SDK api key", () => {
		const mapped = mapCustomEndpointOptionsToOpenAi({
			customEndpointBaseUrl: "https://gateway.example/v1",
			customEndpointApiKey: "secret",
			customEndpointApiKeyHeader: "X-Api-Key",
			customEndpointApiKeyPrefix: "Key ",
			customEndpointModelId: "m1",
		})

		expect(mapped.openAiApiKey).toBeUndefined()
		expect(mapped.openAiHeaders?.["X-Api-Key"]).toBe("Key secret")
	})

	it("preserves explicit openAiStreamingEnabled false", () => {
		const mapped = mapCustomEndpointOptionsToOpenAi({
			customEndpointBaseUrl: "https://example.com/v1",
			customEndpointModelId: "m",
			openAiStreamingEnabled: false,
		})
		expect(mapped.openAiStreamingEnabled).toBe(false)
	})
})

describe("CustomEndpointHandler", () => {
	let handler: CustomEndpointHandler
	let mockOptions: ApiHandlerOptions

	beforeEach(() => {
		mockOptions = {
			customEndpointBaseUrl: "https://api.openai.com/v1",
			customEndpointApiKey: "test-api-key",
			customEndpointModelId: "gpt-4",
			customEndpointFormat: "openai",
		}
		handler = new CustomEndpointHandler(mockOptions)
		mockCreate.mockClear()
		vi.mocked(OpenAI).mockClear()
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	it("constructs OpenAI client with normalized base URL like OpenAiHandler", () => {
		vi.mocked(OpenAI).mockClear()
		new CustomEndpointHandler({
			...mockOptions,
			customEndpointBaseUrl: "https://custom.openai.com",
		})
		expect(vi.mocked(OpenAI)).toHaveBeenCalledWith(
			expect.objectContaining({
				baseURL: "https://custom.openai.com/v1",
			}),
		)
	})

	it("getModel uses customEndpoint model id and merged info", () => {
		const h = new CustomEndpointHandler({
			...mockOptions,
			customEndpointModelId: "my-model",
			customEndpointModelInfo: { contextWindow: 64000, supportsImages: true },
		})
		const model = h.getModel()
		expect(model.id).toBe("my-model")
		expect(model.info.contextWindow).toBe(64000)
		expect(model.info.supportsImages).toBe(true)
	})

	it("omits temperature by default (parity with openai-compatible)", async () => {
		const stream = handler.createMessage("sys", [
			{ role: "user", content: [{ type: "text" as const, text: "hi" }] },
		] as Anthropic.Messages.MessageParam[])
		for await (const _ of stream) {
			// drain
		}

		expect(mockCreate).toHaveBeenCalled()
		const body = mockCreate.mock.calls[0][0]
		expect(body).not.toHaveProperty("temperature")
	})

	it("does not force temperature: 0 when modelTemperature is unset", async () => {
		const stream = handler.createMessage("sys", [
			{ role: "user", content: [{ type: "text" as const, text: "hi" }] },
		] as Anthropic.Messages.MessageParam[])
		for await (const _ of stream) {
			// drain
		}
		const body = mockCreate.mock.calls[0][0]
		expect(body.temperature).toBeUndefined()
	})

	it("sends modelTemperature when user sets it", async () => {
		handler = new CustomEndpointHandler({
			...mockOptions,
			modelTemperature: 0.7,
		})
		const stream = handler.createMessage("sys", [
			{ role: "user", content: [{ type: "text" as const, text: "hi" }] },
		] as Anthropic.Messages.MessageParam[])
		for await (const _ of stream) {
			// drain
		}
		expect(mockCreate.mock.calls[0][0].temperature).toBe(0.7)
	})

	it("streams text content via the openai-compatible path", async () => {
		const chunks: any[] = []
		for await (const chunk of handler.createMessage("You are helpful.", [
			{ role: "user", content: [{ type: "text" as const, text: "Hello" }] },
		] as Anthropic.Messages.MessageParam[])) {
			chunks.push(chunk)
		}
		expect(chunks.some((c) => c.type === "text" && c.text === "Test response")).toBe(true)
	})
})
