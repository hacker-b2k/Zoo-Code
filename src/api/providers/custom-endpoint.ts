import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import { openAiModelInfoSaneDefaults, type ModelInfo } from "@roo-code/types"

import { type ApiHandlerOptions, getModelMaxOutputTokens } from "../../shared/api"

import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { TagMatcher } from "../../utils/tag-matcher"
import { extractReasoningFromDelta } from "./utils/extract-reasoning"
import { handleOpenAIError } from "./utils/openai-error-handler"
import { DEFAULT_HEADERS } from "./constants"

import type { SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"
import { BaseProvider } from "./base-provider"
import { calculateApiCostOpenAI } from "../../shared/cost"

/**
 * Handler for user-configured custom endpoints.
 *
 * This provider allows users to configure any OpenAI-compatible (or
 * Anthropic-compatible) API endpoint, including Databricks, self-hosted
 * models (Ollama, LM Studio), enterprise API gateways, and other
 * non-auto-detected providers.
 */
export class CustomEndpointHandler extends BaseProvider implements SingleCompletionHandler {
	private options: ApiHandlerOptions
	private client: OpenAI

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options

		const baseUrl = this.getBaseUrl()
		const apiKey = this.getApiKey()
		const authHeader = options.customEndpointApiKeyHeader
		const authPrefix = options.customEndpointApiKeyPrefix

		// Build custom default headers for authentication
		const defaultHeaders: Record<string, string> = {
			...DEFAULT_HEADERS,
			...(options.openAiHeaders || {}),
		}

		// If a custom auth header is specified, add it; otherwise use the standard
		// Authorization approach (which the OpenAI SDK handles internally).
		if (authHeader && authHeader !== "Authorization") {
			defaultHeaders[authHeader] = `${authPrefix || ""}${apiKey || ""}`
		}

		this.client = new OpenAI({
			baseURL: baseUrl,
			apiKey: authHeader && authHeader !== "Authorization" ? "not-needed" : apiKey || "not-provided",
			defaultHeaders,
			timeout: this.timeoutMs,
		})
	}

	private getBaseUrl(): string {
		return this.options.customEndpointBaseUrl || ""
	}

	private getApiKey(): string {
		return this.options.customEndpointApiKey || ""
	}

	private getModelId(): string {
		return this.options.customEndpointModelId || ""
	}

	private getModelInfo(): ModelInfo {
		return this.options.customEndpointModelInfo || openAiModelInfoSaneDefaults
	}

	override getModel(): { id: string; info: ModelInfo } {
		return {
			id: this.getModelId(),
			info: this.getModelInfo(),
		}
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const { id: modelId, info: modelInfo } = this.getModel()
		const format = this.options.customEndpointFormat || "openai"

		if (format === "openai") {
			yield* this.createOpenAiMessage(systemPrompt, messages, modelId, modelInfo, metadata)
		} else if (format === "anthropic") {
			yield* this.createAnthropicMessage(systemPrompt, messages, modelId, modelInfo, metadata)
		} else {
			// Fall back to OpenAI-compatible for unknown formats
			yield* this.createOpenAiMessage(systemPrompt, messages, modelId, modelInfo, metadata)
		}
	}

	private async *createOpenAiMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		modelId: string,
		modelInfo: ModelInfo,
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		// Sanitize maxTokens: -1 and 0 mean "let the server decide" for custom
		// endpoints (openAiModelInfoSaneDefaults uses -1 as a sentinel). Only
		// forward positive values so providers that reject invalid params work.
		const rawMaxTokens =
			getModelMaxOutputTokens({
				modelId,
				model: modelInfo,
				settings: this.options,
				format: "openai",
			}) ?? undefined
		const maxTokens = rawMaxTokens && rawMaxTokens > 0 ? rawMaxTokens : undefined

		const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
			model: modelId,
			max_tokens: maxTokens,
			temperature: this.options.modelTemperature ?? 0,
			messages: [{ role: "system", content: systemPrompt }, ...convertToOpenAiMessages(messages)],
			stream: true,
			stream_options: { include_usage: true },
			tools: this.convertToolsForOpenAI(metadata?.tools),
			tool_choice: metadata?.tool_choice,
			parallel_tool_calls: metadata?.parallelToolCalls ?? true,
		}

		let stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
		try {
			stream = await this.client.chat.completions.create(params)
		} catch (error) {
			throw handleOpenAIError(error, "Custom Endpoint")
		}

		const matcher = new TagMatcher(
			["think", "thought"],
			(chunk) =>
				({
					type: chunk.matched ? "reasoning" : "text",
					text: chunk.data,
				}) as const,
		)

		let lastUsage: OpenAI.CompletionUsage | undefined
		const activeToolCallIds = new Set<string>()

		for await (const chunk of stream) {
			const delta = chunk.choices?.[0]?.delta
			const finishReason = chunk.choices?.[0]?.finish_reason

			if (delta?.content) {
				for (const processedChunk of matcher.update(delta.content)) {
					yield processedChunk
				}
			}

			const reasoningText = extractReasoningFromDelta(delta)
			if (reasoningText) {
				yield { type: "reasoning", text: reasoningText }
			}

			if (delta?.tool_calls) {
				for (const toolCall of delta.tool_calls) {
					if (toolCall.id) {
						activeToolCallIds.add(toolCall.id)
					}
					yield {
						type: "tool_call_partial",
						index: toolCall.index,
						id: toolCall.id,
						name: toolCall.function?.name,
						arguments: toolCall.function?.arguments,
					}
				}
			}

			if (finishReason === "tool_calls" && activeToolCallIds.size > 0) {
				for (const id of activeToolCallIds) {
					yield { type: "tool_call_end", id }
				}
				activeToolCallIds.clear()
			}

			if (chunk.usage) {
				lastUsage = chunk.usage
			}
		}

		if (lastUsage) {
			yield this.processUsageMetrics(lastUsage, modelInfo)
		}

		for (const processedChunk of matcher.final()) {
			yield processedChunk
		}
	}

	private async *createAnthropicMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		modelId: string,
		modelInfo: ModelInfo,
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		// For Anthropic-compatible endpoints, use the OpenAI-compatible path
		// but with the Anthropic Messages API URL pattern
		yield* this.createOpenAiMessage(systemPrompt, messages, modelId, modelInfo, metadata)
	}

	private processUsageMetrics(usage: any, modelInfo?: any): ApiStreamUsageChunk {
		const inputTokens = usage?.prompt_tokens || 0
		const outputTokens = usage?.completion_tokens || 0
		const cacheWriteTokens = usage?.prompt_tokens_details?.cache_write_tokens || 0
		const cacheReadTokens = usage?.prompt_tokens_details?.cached_tokens || 0

		const { totalCost } = modelInfo
			? calculateApiCostOpenAI(modelInfo, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens)
			: { totalCost: 0 }

		return {
			type: "usage",
			inputTokens,
			outputTokens,
			cacheWriteTokens: cacheWriteTokens || undefined,
			cacheReadTokens: cacheReadTokens || undefined,
			totalCost,
		}
	}

	async completePrompt(prompt: string): Promise<string> {
		const { id: modelId } = this.getModel()

		try {
			const response = await this.client.chat.completions.create({
				model: modelId,
				messages: [{ role: "user", content: prompt }],
			})

			return response.choices?.[0]?.message.content || ""
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`Custom Endpoint completion error: ${error.message}`)
			}
			throw error
		}
	}
}
