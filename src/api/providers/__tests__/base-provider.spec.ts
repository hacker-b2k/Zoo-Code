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
		return this.convertToolSchemaForOpenAI(schema)
	}

	// Expose protected method for testing
	public testConvertToolsForOpenAI(tools: any[] | undefined): any[] | undefined {
		return this.convertToolsForOpenAI(tools)
	}

	// Expose private method for testing
	public testHasFreeFormObjects(schema: any): boolean {
		return this.hasFreeFormObjects(schema)
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

		it("should recursively add additionalProperties: false to array item objects", () => {
			const schema = {
				type: "object",
				properties: {
					users: {
						type: "array",
						items: {
							type: "object",
							properties: {
								name: { type: "string" },
							},
						},
					},
				},
			}

			const result = provider.testConvertToolSchemaForOpenAI(schema)

			expect(result.additionalProperties).toBe(false)
			expect(result.properties.users.items.additionalProperties).toBe(false)
		})

		it("should handle deeply nested objects", () => {
			const schema = {
				type: "object",
				properties: {
					level1: {
						type: "object",
						properties: {
							level2: {
								type: "object",
								properties: {
									level3: {
										type: "object",
										properties: {
											value: { type: "string" },
										},
									},
								},
							},
						},
					},
				},
			}

			const result = provider.testConvertToolSchemaForOpenAI(schema)

			expect(result.additionalProperties).toBe(false)
			expect(result.properties.level1.additionalProperties).toBe(false)
			expect(result.properties.level1.properties.level2.additionalProperties).toBe(false)
			expect(result.properties.level1.properties.level2.properties.level3.additionalProperties).toBe(false)
		})

		it("should convert nullable types to non-nullable", () => {
			const schema = {
				type: "object",
				properties: {
					name: { type: ["string", "null"] },
				},
			}

			const result = provider.testConvertToolSchemaForOpenAI(schema)

			expect(result.properties.name.type).toBe("string")
		})

		it("should strip null from enum when converting nullable types", () => {
			const schema = {
				type: "object",
				properties: {
					scope: {
						type: ["string", "null"],
						enum: ["project", "global", "all", null],
					},
				},
			}

			const result = provider.testConvertToolSchemaForOpenAI(schema)

			expect(result.properties.scope.type).toBe("string")
			expect(result.properties.scope.enum).toEqual(["project", "global", "all"])
		})

		it("should return non-object schemas unchanged", () => {
			const schema = { type: "string" }
			const result = provider.testConvertToolSchemaForOpenAI(schema)

			expect(result).toEqual(schema)
		})

		it("should return null/undefined unchanged", () => {
			expect(provider.testConvertToolSchemaForOpenAI(null)).toBeNull()
			expect(provider.testConvertToolSchemaForOpenAI(undefined)).toBeUndefined()
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

		it("should apply schema conversion to non-MCP tools", () => {
			const tools = [
				{
					type: "function",
					function: {
						name: "read_file",
						description: "Read a file",
						parameters: {
							type: "object",
							properties: {
								path: { type: "string" },
							},
						},
					},
				},
			]

			const result = provider.testConvertToolsForOpenAI(tools)

			expect(result?.[0].function.parameters.additionalProperties).toBe(false)
			expect(result?.[0].function.parameters.required).toEqual(["path"])
		})

		it("should not apply schema conversion to MCP tools in base-provider", () => {
			// Note: In base-provider, MCP tools are passed through unchanged
			// The openai-native provider has its own handling for MCP tools
			const tools = [
				{
					type: "function",
					function: {
						name: "mcp--github--get_me",
						description: "Get current user",
						parameters: {
							type: "object",
							properties: {
								token: { type: "string" },
							},
							required: ["token"],
						},
					},
				},
			]

			const result = provider.testConvertToolsForOpenAI(tools)

			// MCP tools pass through original parameters in base-provider
			expect(result?.[0].function.parameters.additionalProperties).toBeUndefined()
		})

		it("should preserve non-function tools unchanged", () => {
			const tools = [
				{
					type: "other_type",
					data: "some data",
				},
			]

			const result = provider.testConvertToolsForOpenAI(tools)

			expect(result?.[0]).toEqual(tools[0])
		})

		it("should set strict: false for tools with free-form object parameters", () => {
			const tools = [
				{
					type: "function",
					function: {
						name: "manage_provider_profile",
						description: "Manage provider profile",
						parameters: {
							type: "object",
							properties: {
								action: { type: "string" },
								settings: {
									type: "object",
									additionalProperties: true,
								},
							},
							required: ["action", "settings"],
						},
					},
				},
			]

			const result = provider.testConvertToolsForOpenAI(tools)

			expect(result?.[0].function.strict).toBe(false)
		})

		it("should not apply schema conversion to tools with free-form objects", () => {
			const tools = [
				{
					type: "function",
					function: {
						name: "manage_provider_profile",
						description: "Manage provider profile",
						parameters: {
							type: "object",
							properties: {
								settings: {
									type: "object",
									additionalProperties: true,
								},
							},
							required: ["settings"],
						},
					},
				},
			]

			const result = provider.testConvertToolsForOpenAI(tools)

			// Parameters should be passed through unchanged (no strict schema conversion)
			expect(result?.[0].function.parameters.properties.settings.additionalProperties).toBe(true)
		})
	})
})
