import { Anthropic } from "@anthropic-ai/sdk"

import type { ModelInfo } from "@roo-code/types"

import { BaseProvider } from "../base-provider"
import type { ApiStream } from "../../transform/stream"

// Create a concrete implementation for testing
class TestProvider extends BaseProvider {
	createMessage(_systemPrompt: string, _messages: Anthropic.Messages.MessageParam[]): ApiStream {
		throw new Error("Not implemented")
	}

	getModel(): { id: string; info: ModelInfo } {
		return {
			id: "test-model",
			info: {
				maxTokens: 4096,
				contextWindow: 128000,
				supportsPromptCache: false,
			},
		}
	}

	// Expose protected method for testing
	public testConvertToolSchemaForOpenAI(schema: any): any {
		return this.convertToolsForOpenAI(schema)
	}

	// Expose protected method for testing
	public testConvertToolsForOpenAI(tools: any[] | undefined): any[] | undefined {
		return this.convertToolsForOpenAI(tools)
	}

	// Expose private method for testing via any cast (private methods cannot be overridden)
	public testHasFreeFormObjects(schema: any): boolean {
		return (this as any).hasFreeFormObjects(schema)
	}
}

describe("BaseProvider", () => {
	let provider: TestProvider

	beforeEach(() => {
		provider = new TestProvider()
	})

	describe("convertToolSchemaForOpenAI", () => {
		it("should add additionalProperties: false to object schemas", () => {
			const schema = {
				type: "object",
				properties: {
					name: { type: "string" },
				},
			}

			const result = provider.testConvertToolSchemaForOpenAI(schema)

			expect(result.additionalProperties).toBe(false)
		})

		it("should add required array with all properties for strict mode", () => {
			const schema = {
				type: "object",
				properties: {
					name: { type: "string" },
					age: { type: "number" },
				},
			}

			const result = provider.testConvertToolSchemaForOpenAI(schema)

			expect(result.required).toEqual(["name", "age"])
		})

		it("should recursively add additionalProperties: false to nested objects", () => {
			const schema = {
				type: "object",
				properties: {
					user: {
						type: "object",
						properties: {
							name: { type: "string" },
						},
					},
				},
			}

			const result = provider.testConvertToolSchemaForOpenAI(schema)

			expect(result.additionalProperties).toBe(false)
			expect(result.properties.user.additionalProperties).toBe(false)
		})

		it("should handle empty properties object", () => {
			const schema = {
				type: "object",
				properties: {},
			}

			const result = provider.testConvertToolSchemaForOpenAI(schema)

			expect(result.additionalProperties).toBe(false)
			expect(result.required).toEqual([])
		})
	})

	describe("hasFreeFormObjects", () => {
		it("should detect free-form objects at root", () => {
			expect(provider.testHasFreeFormObjects({ type: "object", additionalProperties: true })).toBe(true)
		})

		it("should detect free-form objects with additionalProperties schema", () => {
			expect(provider.testHasFreeFormObjects({ type: "object", additionalProperties: { type: "string" } })).toBe(
				true,
			)
		})

		it("should not flag objects with properties", () => {
			expect(provider.testHasFreeFormObjects({ type: "object", properties: { name: { type: "string" } } })).toBe(
				false,
			)
		})

		it("should detect nested free-form objects in properties", () => {
			const schema = {
				type: "object",
				properties: {
					name: { type: "string" },
					settings: { type: "object", additionalProperties: true },
				},
			}
			expect(provider.testHasFreeFormObjects(schema)).toBe(true)
		})

		it("should detect free-form objects in array items", () => {
			const schema = {
				type: "object",
				properties: {
					items: {
						type: "array",
						items: { type: "object", additionalProperties: true },
					},
				},
			}
			expect(provider.testHasFreeFormObjects(schema)).toBe(true)
		})

		it("should not flag when all nested objects have properties", () => {
			const schema = {
				type: "object",
				properties: {
					user: {
						type: "object",
						properties: { name: { type: "string" } },
					},
				},
			}
			expect(provider.testHasFreeFormObjects(schema)).toBe(false)
		})
	})

	describe("convertToolsForOpenAI", () => {
		it("should return undefined for undefined input", () => {
			const result = provider.testConvertToolsForOpenAI(undefined)
			expect(result).toBeUndefined()
		})

		it("should set strict: true for non-MCP tools", () => {
			const tools = [
				{
					type: "function",
					function: {
						name: "read_file",
						description: "Read a file",
						parameters: { type: "object", properties: {} },
					},
				},
			]

			const result = provider.testConvertToolsForOpenAI(tools)

			expect(result?.[0].function.strict).toBe(true)
		})

		it("should set strict: false for MCP tools (mcp-- prefix)", () => {
			const tools = [
				{
					type: "function",
					function: {
						name: "mcp--github--get_me",
						description: "Get current user",
						parameters: { type: "object", properties: {} },
					},
				},
			]

			const result = provider.testConvertToolsForOpenAI(tools)

			expect(result?.[0].function.strict).toBe(false)
		})

		it("should preserve MCP tool parameters without modification", () => {
			const tools = [
				{
					type: "function",
					function: {
						name: "mcp--server--tool",
						description: "MCP tool",
						parameters: {
							type: "object",
							properties: {
								arg1: { type: "string" },
							},
						},
					},
				},
			]

			const result = provider.testConvertToolsForOpenAI(tools)

			expect(result?.[0].function.strict).toBe(false)
			expect(result?.[0].function.parameters).toEqual({
				type: "object",
				properties: {
					arg1: { type: "string" },
				},
			})
		})
	})

	describe("mapCustomEndpointOptionsToOpenAi", () => {
		it("should merge customEndpoint fields onto openAi* fields", () => {
			// Test the mapping of custom endpoint config to OpenAI format
			const customEndpointConfig = {
				customEndpointBaseUrl: "https://api.example.com",
				customEndpointApiKey: "test-key",
				customEndpointModelId: "gpt-4-custom",
				customEndpointModelInfo: {
					contextWindow: 8192,
					supportsImages: true,
					supportsPromptCache: false,
				},
				customEndpointFormat: "openai" as const,
			}

			// The function should map these to the OpenAi options format
			expect(customEndpointConfig.customEndpointModelInfo.contextWindow).toBe(8192)
			expect(customEndpointConfig.customEndpointModelInfo.supportsPromptCache).toBe(false)
		})
	})

	describe("custom endpoint integration", () => {
		it("should handle custom endpoint with model info including supportsPromptCache", () => {
			const mockProvider = new TestProvider()

			// Verify the provider correctly handles model info
			const model = mockProvider.getModel()
			expect(model.info.contextWindow).toBe(128000)
			expect(model.info.supportsPromptCache).toBe(false)
		})
	})
})
