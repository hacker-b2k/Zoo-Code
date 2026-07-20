import { Anthropic } from "@anthropic-ai/sdk"

import type { ModelInfo } from "@roo-code/types"

import type { ApiHandler, ApiHandlerCreateMessageMetadata } from "../index"
import { ApiStream } from "../transform/stream"
import { countTokens } from "../../utils/countTokens"
import { isMcpTool } from "../../utils/mcp-name"
import { getApiRequestTimeout } from "./utils/timeout-config"

/**
 * Base class for API providers that implements common functionality.
 */
export abstract class BaseProvider implements ApiHandler {
	protected readonly timeoutMs: number = getApiRequestTimeout()

	abstract createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream

	abstract getModel(): { id: string; info: ModelInfo }

	/**
	 * Checks whether a JSON Schema contains free-form objects (objects without `properties`).
	 * Free-form objects are incompatible with OpenAI strict mode, which requires
	 * `additionalProperties: false` and explicit `properties` on every object.
	 * When a tool schema contains free-form objects, strict mode must be disabled.
	 */
	private hasFreeFormObjects(schema: any, _path: string = ""): boolean {
		if (!schema || typeof schema !== "object") {
			return false
		}

		if (schema.type === "object" && !schema.properties) {
			return true
		}

		if (schema.properties) {
			for (const [key, prop] of Object.entries(schema.properties)) {
				if (this.hasFreeFormObjects(prop, `${_path}.${key}`)) {
					return true
				}
			}
		}

		if (schema.items) {
			if (Array.isArray(schema.items)) {
				for (const item of schema.items) {
					if (this.hasFreeFormObjects(item, `${_path}[]`)) {
						return true
					}
				}
			} else if (this.hasFreeFormObjects(schema.items, `${_path}[]`)) {
				return true
			}
		}

		for (const keyword of ["anyOf", "oneOf", "allOf"]) {
			if (Array.isArray(schema[keyword])) {
				for (const variant of schema[keyword]) {
					if (this.hasFreeFormObjects(variant, `${_path}.${keyword}`)) {
						return true
					}
				}
			}
		}

		return false
	}

	/**
	 * Converts an array of tools to be compatible with OpenAI's strict mode.
	 * Filters for function tools, applies schema conversion to their parameters,
	 * and ensures all tools have consistent strict: true values.
	 *
	 * Tools with free-form objects (objects without `properties`) get strict: false
	 * because strict mode requires `additionalProperties: false` + explicit `properties`
	 * on every object, which is incompatible with schemas that accept arbitrary keys.
	 */
	protected convertToolsForOpenAI(tools: any[] | undefined): any[] | undefined {
		if (!tools) {
			return undefined
		}

		return tools.map((tool) => {
			if (tool.type !== "function") {
				return tool
			}

			// MCP tools use the 'mcp--' prefix - disable strict mode for them
			// to preserve optional parameters from the MCP server schema
			const isMcp = isMcpTool(tool.function.name)

			// Tools with free-form objects (e.g., settings/secrets maps) can't use strict mode
			// because strict requires additionalProperties: false + explicit properties on every object
			const hasFreeForm = !isMcp && this.hasFreeFormObjects(tool.function.parameters)

			return {
				...tool,
				function: {
					...tool.function,
					strict: !isMcp && !hasFreeForm,
					parameters:
						isMcp || hasFreeForm
							? tool.function.parameters
							: this.convertToolSchemaForOpenAI(tool.function.parameters),
				},
			}
		})
	}

	/**
	 * Converts tool schemas to be compatible with OpenAI's strict mode by:
	 * - Ensuring all properties are in the required array (strict mode requirement)
	 * - Converting nullable types (["type", "null"]) to non-nullable ("type")
	 * - Adding additionalProperties: false to all object schemas (required by OpenAI Responses API)
	 * - Recursively processing nested objects and arrays
	 *
	 * This matches the behavior of ensureAllRequired in openai-native.ts
	 */
	protected convertToolSchemaForOpenAI(schema: any): any {
		if (!schema || typeof schema !== "object" || schema.type !== "object") {
			return schema
		}

		const result = { ...schema }

		// OpenAI Responses API requires additionalProperties: false on all object schemas
		// Only add if not already set to false (to avoid unnecessary mutations)
		if (result.additionalProperties !== false) {
			result.additionalProperties = false
		}

		if (result.properties) {
			const allKeys = Object.keys(result.properties)
			// OpenAI strict mode requires ALL properties to be in required array
			result.required = allKeys

			// Recursively process nested objects and convert nullable types
			const newProps = { ...result.properties }
			for (const key of allKeys) {
				const prop = newProps[key]

				// Handle nullable types by removing null
				if (prop && Array.isArray(prop.type) && prop.type.includes("null")) {
					const nonNullTypes = prop.type.filter((t: string) => t !== "null")
					prop.type = nonNullTypes.length === 1 ? nonNullTypes[0] : nonNullTypes
					// Also strip null from enum arrays if present (strict mode rejects non-string enum values for string types)
					if (Array.isArray(prop.enum)) {
						prop.enum = prop.enum.filter((v: unknown) => v !== null)
					}
				}

				// Recursively process nested objects
				if (prop && prop.type === "object") {
					newProps[key] = this.convertToolSchemaForOpenAI(prop)
				} else if (prop && prop.type === "array" && prop.items?.type === "object") {
					newProps[key] = {
						...prop,
						items: this.convertToolSchemaForOpenAI(prop.items),
					}
				}
			}
			result.properties = newProps
		}

		return result
	}

	/**
	 * Default token counting implementation using tiktoken.
	 * Providers can override this to use their native token counting endpoints.
	 *
	 * @param content The content to count tokens for
	 * @returns A promise resolving to the token count
	 */
	async countTokens(content: Anthropic.Messages.ContentBlockParam[]): Promise<number> {
		if (content.length === 0) {
			return 0
		}

		return countTokens(content, { useWorker: true })
	}
}
