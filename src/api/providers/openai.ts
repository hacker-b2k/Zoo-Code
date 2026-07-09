import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI, { AzureOpenAI } from "openai"
import axios from "axios"

import {
	type ModelInfo,
	azureOpenAiDefaultApiVersion,
	openAiModelInfoSaneDefaults,
	DEEP_SEEK_DEFAULT_TEMPERATURE,
	OPENAI_AZURE_AI_INFERENCE_PATH,
} from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"
import { Package } from "../../shared/package"

import { TagMatcher } from "../../utils/tag-matcher"

import { convertToOpenAiMessages } from "../transform/openai-format"
import { convertToR1Format } from "../transform/r1-format"
import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import { getModelParams } from "../transform/model-params"

import { DEFAULT_HEADERS } from "./constants"
import { BaseProvider } from "./base-provider"
import type { SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"
import { handleOpenAIError } from "./utils/openai-error-handler"
import { extractReasoningFromDelta } from "./utils/extract-reasoning"
import { analyzeOpenAiCompatibleBaseUrl, getOpenAiCompatibleModelsUrl } from "./utils/openai-base-url"

// TODO: Rename this to OpenAICompatibleHandler. Also, I think the
// `OpenAINativeHandler` can subclass from this, since it's obviously
// compatible with the OpenAI API. We can also rename it to `OpenAIHandler`.
export class OpenAiHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	protected client: OpenAI
	private readonly providerName = "OpenAI"

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options

		const analyzedBaseUrl = analyzeOpenAiCompatibleBaseUrl(this.options.openAiBaseUrl, "https://api.openai.com/v1")
		const baseURL = analyzedBaseUrl.baseUrl || this.options.openAiBaseUrl || "https://api.openai.com/v1"
		const apiKey = this.options.openAiApiKey ?? "not-provided"
		const isAzureAiInference = analyzedBaseUrl.isAzureAiInference
		const isAzureOpenAi = analyzedBaseUrl.isAzureOpenAi || options.openAiUseAzure

		const headers = {
			...DEFAULT_HEADERS,
			"User-Agent": `RooCode/${Package.version} ZooCode/${Package.version} (VSCode; OpenAI-Compatible)`,
			"X-Title": "Roo Code",
			...(this.options.openAiHeaders || {}),
		}

		if (isAzureAiInference) {
			// Azure AI Inference Service (e.g., for DeepSeek) uses a different path structure
			this.client = new OpenAI({
				baseURL,
				apiKey,
				defaultHeaders: headers,
				defaultQuery: { "api-version": this.options.azureApiVersion || "2024-05-01-preview" },
				timeout: this.timeoutMs,
			})
		} else if (isAzureOpenAi) {
			// Azure API shape slightly differs from the core API shape:
			// https://github.com/openai/openai-node?tab=readme-ov-file#microsoft-azure-openai
			this.client = new AzureOpenAI({
				baseURL,
				apiKey,
				apiVersion: this.options.azureApiVersion || azureOpenAiDefaultApiVersion,
				defaultHeaders: headers,
				timeout: this.timeoutMs,
			})
		} else {
			this.client = new OpenAI({
				baseURL,
				apiKey,
				defaultHeaders: headers,
				timeout: this.timeoutMs,
			})
		}
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const { info: modelInfo, reasoning } = this.getModel()
		const modelUrl = this.options.openAiBaseUrl ?? ""
		const modelId = this.options.openAiModelId ?? ""
		const enabledR1Format = this.options.openAiR1FormatEnabled ?? false
		const isAzureAiInference = this._isAzureAiInference(modelUrl)
		const deepseekReasoner = modelId.includes("deepseek-reasoner") || enabledR1Format

		if (modelId.includes("o1") || modelId.includes("o3") || modelId.includes("o4")) {
			yield* this.handleO3FamilyMessage(modelId, systemPrompt, messages, metadata)
			return
		}

		let systemMessage: OpenAI.Chat.ChatCompletionSystemMessageParam = {
			role: "system",
			content: systemPrompt,
		}

		if (this.options.openAiStreamingEnabled ?? true) {
			let convertedMessages

			if (deepseekReasoner) {
				convertedMessages = convertToR1Format([{ role: "user", content: systemPrompt }, ...messages])
			} else {
				if (modelInfo.supportsPromptCache) {
					systemMessage = {
						role: "system",
						content: [
							{
								type: "text",
								text: systemPrompt,
								// @ts-ignore-next-line
								cache_control: { type: "ephemeral" },
							},
						],
					}
				}

				convertedMessages = [systemMessage, ...convertToOpenAiMessages(messages)]

				if (modelInfo.supportsPromptCache) {
					// Note: the following logic is copied from openrouter:
					// Add cache_control to the last two user messages
					// (note: this works because we only ever add one user message at a time, but if we added multiple we'd need to mark the user message before the last assistant message)
					const lastTwoUserMessages = convertedMessages.filter((msg) => msg.role === "user").slice(-2)

					lastTwoUserMessages.forEach((msg) => {
						if (typeof msg.content === "string") {
							msg.content = [{ type: "text", text: msg.content }]
						}

						if (Array.isArray(msg.content)) {
							// NOTE: this is fine since env details will always be added at the end. but if it weren't there, and the user added a image_url type message, it would pop a text part before it and then move it after to the end.
							let lastTextPart = msg.content.filter((part) => part.type === "text").pop()

							if (!lastTextPart) {
								lastTextPart = { type: "text", text: "..." }
								msg.content.push(lastTextPart)
							}

							// @ts-ignore-next-line
							lastTextPart["cache_control"] = { type: "ephemeral" }
						}
					})
				}
			}

			const isGrokXAI = this._isGrokXAI(this.options.openAiBaseUrl)

			const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
				model: modelId,
				// Some OpenAI-Compatible models (e.g. claude-opus-4-7, claude-opus-4-8) reject
				// `temperature` as deprecated/unsupported, so honor the model's `supportsTemperature`
				// flag and omit it when that flag is false. Beyond that, only send `temperature` when
				// the user set a custom value or the model needs a specific default (deepseek-reasoner);
				// otherwise omit it so the server's own default applies instead of forcing 0.
				...(modelInfo.supportsTemperature !== false &&
					(this.options.modelTemperature != null || deepseekReasoner) && {
						temperature: this.options.modelTemperature ?? DEEP_SEEK_DEFAULT_TEMPERATURE,
					}),
				messages: convertedMessages,
				stream: true as const,
				...(isGrokXAI ? {} : { stream_options: { include_usage: true } }),
				...(reasoning && reasoning),
				tools: this.convertToolsForOpenAI(metadata?.tools),
				tool_choice: metadata?.tool_choice,
				parallel_tool_calls: metadata?.parallelToolCalls ?? true,
			}

			// Add max_tokens if needed
			this.addMaxTokensIfNeeded(requestOptions, modelInfo)

			let stream
			try {
				stream = await this.client.chat.completions.create(
					requestOptions,
					isAzureAiInference ? { path: OPENAI_AZURE_AI_INFERENCE_PATH } : {},
				)
			} catch (error) {
				throw handleOpenAIError(error, this.providerName)
			}

			const matcher = new TagMatcher(
				["think", "thought"],
				(chunk) =>
					({
						type: chunk.matched ? "reasoning" : "text",
						text: chunk.data,
					}) as const,
			)

			let lastUsage
			const activeToolCallIds = new Set<string>()
			let yieldedAssistantContent = false
			let streamedReasoningText = ""
			let streamFailure: any

			try {
				for await (const chunk of stream) {
					const delta = chunk.choices?.[0]?.delta ?? {}
					const finishReason = chunk.choices?.[0]?.finish_reason
					const text = extractOpenAiText(delta)

					if (text) {
						yieldedAssistantContent = true
						for (const chunk of matcher.update(text)) {
							yield chunk
						}
					}

					const reasoningText = extractReasoningFromDelta(delta)
					if (reasoningText) {
						streamedReasoningText += reasoningText
						yield { type: "reasoning", text: reasoningText }
					}

					yield* this.processToolCalls(delta, finishReason, activeToolCallIds)
					if (delta.tool_calls?.length) {
						yieldedAssistantContent = true
					}

					if (chunk.usage) {
						lastUsage = chunk.usage
					}
				}
			} catch (streamError: any) {
				if (yieldedAssistantContent) {
					throw handleOpenAIError(streamError, this.providerName)
				}
				streamFailure = streamError
			}

			// If streaming completed but yielded no assistant text/tool content, the proxy may
			// be non-standard or reasoning-only. Try non-streaming before surfacing an error.
			if (!yieldedAssistantContent) {
				try {
					const nonStreamOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
						...requestOptions,
						stream: false,
					}
					delete (nonStreamOptions as any).stream_options

					const response = await this.client.chat.completions.create(nonStreamOptions)
					const message = response.choices?.[0]?.message
					const content = extractOpenAiText(message) || streamedReasoningText.trim()
					let yieldedFallbackContent = false

					if (message?.tool_calls) {
						for (const toolCall of message.tool_calls) {
							if (toolCall.type === "function") {
								yieldedFallbackContent = true
								yield {
									type: "tool_call",
									id: toolCall.id,
									name: toolCall.function.name,
									arguments: toolCall.function.arguments,
								}
							}
						}
					}

					if (content) {
						yieldedFallbackContent = true
						for (const chunk of matcher.update(content)) {
							yield chunk
						}
						for (const chunk of matcher.final()) {
							yield chunk
						}
					}

					if (response.usage) {
						lastUsage = response.usage
					}

					if (yieldedFallbackContent) {
						if (lastUsage) {
							yield this.processUsageMetrics(lastUsage, modelInfo)
						}
						return
					}

					const streamErrorMessage = streamFailure?.message ? ` Stream error: ${streamFailure.message}` : ""
					throw new Error(
						`API at ${this.options.openAiBaseUrl || "OpenAI"} returned no assistant content. ` +
							`The model "${modelId}" may not be available on this endpoint, ` +
							`or the server may require different authentication/client headers.` +
							streamErrorMessage +
							` Response: ${JSON.stringify(message ?? "empty")}`,
					)
				} catch (fallbackError: any) {
					// If the non-streaming fallback also fails, report the combined error
					if (fallbackError.message?.includes("API at")) {
						throw fallbackError
					}
					throw handleOpenAIError(fallbackError, this.providerName)
				}
			}

			for (const chunk of matcher.final()) {
				yield chunk
			}

			if (lastUsage) {
				yield this.processUsageMetrics(lastUsage, modelInfo)
			}
		} else {
			const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
				model: modelId,
				messages: deepseekReasoner
					? convertToR1Format([{ role: "user", content: systemPrompt }, ...messages])
					: [systemMessage, ...convertToOpenAiMessages(messages)],
				// Tools are always present (minimum ALWAYS_AVAILABLE_TOOLS)
				tools: this.convertToolsForOpenAI(metadata?.tools),
				tool_choice: metadata?.tool_choice,
				parallel_tool_calls: metadata?.parallelToolCalls ?? true,
			}

			// Add max_tokens if needed
			this.addMaxTokensIfNeeded(requestOptions, modelInfo)

			let response
			try {
				response = await this.client.chat.completions.create(
					requestOptions,
					this._isAzureAiInference(modelUrl) ? { path: OPENAI_AZURE_AI_INFERENCE_PATH } : {},
				)
			} catch (error) {
				throw handleOpenAIError(error, this.providerName)
			}

			const message = response.choices?.[0]?.message
			let yieldedContent = false

			if (message?.tool_calls) {
				for (const toolCall of message.tool_calls) {
					if (toolCall.type === "function") {
						yieldedContent = true
						yield {
							type: "tool_call",
							id: toolCall.id,
							name: toolCall.function.name,
							arguments: toolCall.function.arguments,
						}
					}
				}
			}

			const content = extractOpenAiText(message)
			if (content) {
				yieldedContent = true
				yield {
					type: "text",
					text: content,
				}
			}

			if (!yieldedContent) {
				throw new Error(
					`API at ${this.options.openAiBaseUrl || "OpenAI"} returned no assistant content. ` +
						`Response: ${JSON.stringify(message ?? "empty")}`,
				)
			}

			yield this.processUsageMetrics(response.usage, modelInfo)
		}
	}

	protected processUsageMetrics(usage: any, _modelInfo?: ModelInfo): ApiStreamUsageChunk {
		return {
			type: "usage",
			inputTokens: usage?.prompt_tokens || 0,
			outputTokens: usage?.completion_tokens || 0,
			cacheWriteTokens: usage?.cache_creation_input_tokens || undefined,
			cacheReadTokens: usage?.cache_read_input_tokens || undefined,
		}
	}

	override getModel() {
		const id = this.options.openAiModelId ?? ""
		const info: ModelInfo = this.options.openAiCustomModelInfo ?? openAiModelInfoSaneDefaults
		const params = getModelParams({
			format: "openai",
			modelId: id,
			model: info,
			settings: this.options,
			defaultTemperature: 0,
		})
		return { id, info, ...params }
	}

	async completePrompt(prompt: string): Promise<string> {
		try {
			const isAzureAiInference = this._isAzureAiInference(this.options.openAiBaseUrl)
			const model = this.getModel()
			const modelInfo = model.info

			const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
				model: model.id,
				messages: [{ role: "user", content: prompt }],
			}

			// Add max_tokens if needed
			this.addMaxTokensIfNeeded(requestOptions, modelInfo)

			let response
			try {
				response = await this.client.chat.completions.create(
					requestOptions,
					isAzureAiInference ? { path: OPENAI_AZURE_AI_INFERENCE_PATH } : {},
				)
			} catch (error) {
				throw handleOpenAIError(error, this.providerName)
			}

			return response.choices?.[0]?.message.content || ""
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`${this.providerName} completion error: ${error.message}`)
			}

			throw error
		}
	}

	private async *handleO3FamilyMessage(
		modelId: string,
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const modelInfo = this.getModel().info
		const methodIsAzureAiInference = this._isAzureAiInference(this.options.openAiBaseUrl)

		if (this.options.openAiStreamingEnabled ?? true) {
			const isGrokXAI = this._isGrokXAI(this.options.openAiBaseUrl)

			const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
				model: modelId,
				messages: [
					{
						role: "developer",
						content: `Formatting re-enabled\n${systemPrompt}`,
					},
					...convertToOpenAiMessages(messages),
				],
				stream: true,
				...(isGrokXAI ? {} : { stream_options: { include_usage: true } }),
				reasoning_effort: modelInfo.reasoningEffort as "low" | "medium" | "high" | undefined,
				temperature: undefined,
				// Tools are always present (minimum ALWAYS_AVAILABLE_TOOLS)
				tools: this.convertToolsForOpenAI(metadata?.tools),
				tool_choice: metadata?.tool_choice,
				parallel_tool_calls: metadata?.parallelToolCalls ?? true,
			}

			// O3 family models do not support the deprecated max_tokens parameter
			// but they do support max_completion_tokens (the modern OpenAI parameter)
			// This allows O3 models to limit response length when includeMaxTokens is enabled
			this.addMaxTokensIfNeeded(requestOptions, modelInfo)

			let stream
			try {
				stream = await this.client.chat.completions.create(
					requestOptions,
					methodIsAzureAiInference ? { path: OPENAI_AZURE_AI_INFERENCE_PATH } : {},
				)
			} catch (error) {
				throw handleOpenAIError(error, this.providerName)
			}

			yield* this.handleStreamResponse(stream)
		} else {
			const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
				model: modelId,
				messages: [
					{
						role: "developer",
						content: `Formatting re-enabled\n${systemPrompt}`,
					},
					...convertToOpenAiMessages(messages),
				],
				reasoning_effort: modelInfo.reasoningEffort as "low" | "medium" | "high" | undefined,
				temperature: undefined,
				// Tools are always present (minimum ALWAYS_AVAILABLE_TOOLS)
				tools: this.convertToolsForOpenAI(metadata?.tools),
				tool_choice: metadata?.tool_choice,
				parallel_tool_calls: metadata?.parallelToolCalls ?? true,
			}

			// O3 family models do not support the deprecated max_tokens parameter
			// but they do support max_completion_tokens (the modern OpenAI parameter)
			// This allows O3 models to limit response length when includeMaxTokens is enabled
			this.addMaxTokensIfNeeded(requestOptions, modelInfo)

			let response
			try {
				response = await this.client.chat.completions.create(
					requestOptions,
					methodIsAzureAiInference ? { path: OPENAI_AZURE_AI_INFERENCE_PATH } : {},
				)
			} catch (error) {
				throw handleOpenAIError(error, this.providerName)
			}

			const message = response.choices?.[0]?.message
			if (message?.tool_calls) {
				for (const toolCall of message.tool_calls) {
					if (toolCall.type === "function") {
						yield {
							type: "tool_call",
							id: toolCall.id,
							name: toolCall.function.name,
							arguments: toolCall.function.arguments,
						}
					}
				}
			}

			yield {
				type: "text",
				text: message?.content || "",
			}
			yield this.processUsageMetrics(response.usage)
		}
	}

	private async *handleStreamResponse(stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>): ApiStream {
		const activeToolCallIds = new Set<string>()

		for await (const chunk of stream) {
			const delta = chunk.choices?.[0]?.delta
			const finishReason = chunk.choices?.[0]?.finish_reason

			if (delta) {
				if (delta.content) {
					yield {
						type: "text",
						text: delta.content,
					}
				}

				yield* this.processToolCalls(delta, finishReason, activeToolCallIds)
			}

			if (chunk.usage) {
				yield {
					type: "usage",
					inputTokens: chunk.usage.prompt_tokens || 0,
					outputTokens: chunk.usage.completion_tokens || 0,
				}
			}
		}
	}

	/**
	 * Helper generator to process tool calls from a stream chunk.
	 * Tracks active tool call IDs and yields tool_call_partial and tool_call_end events.
	 * @param delta - The delta object from the stream chunk
	 * @param finishReason - The finish_reason from the stream chunk
	 * @param activeToolCallIds - Set to track active tool call IDs (mutated in place)
	 */
	protected *processToolCalls(
		delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta | undefined,
		finishReason: string | null | undefined,
		activeToolCallIds: Set<string>,
	): Generator<
		| { type: "tool_call_partial"; index: number; id?: string; name?: string; arguments?: string }
		| { type: "tool_call_end"; id: string }
	> {
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

		// Emit tool_call_end events when finish_reason is "tool_calls"
		// This ensures tool calls are finalized even if the stream doesn't properly close
		if (finishReason === "tool_calls" && activeToolCallIds.size > 0) {
			for (const id of activeToolCallIds) {
				yield { type: "tool_call_end", id }
			}
			activeToolCallIds.clear()
		}
	}

	protected _getUrlHost(baseUrl?: string): string {
		return analyzeOpenAiCompatibleBaseUrl(baseUrl).host
	}

	private _isGrokXAI(baseUrl?: string): boolean {
		return analyzeOpenAiCompatibleBaseUrl(baseUrl).isGrokXAI
	}

	protected _isAzureAiInference(baseUrl?: string): boolean {
		return analyzeOpenAiCompatibleBaseUrl(baseUrl).isAzureAiInference
	}

	/**
	 * Adds max_completion_tokens to the request body if needed based on provider configuration
	 * Note: max_tokens is deprecated in favor of max_completion_tokens as per OpenAI documentation
	 * O3 family models handle max_tokens separately in handleO3FamilyMessage
	 */
	protected addMaxTokensIfNeeded(
		requestOptions:
			| OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming
			| OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
		modelInfo: ModelInfo,
	): void {
		// Only add max_completion_tokens if includeMaxTokens is true
		if (this.options.includeMaxTokens === true) {
			// Use user-configured modelMaxTokens if available, otherwise fall back to model's default maxTokens
			// Using max_completion_tokens as max_tokens is deprecated
			requestOptions.max_completion_tokens = this.options.modelMaxTokens || modelInfo.maxTokens
		}
	}
}

function extractOpenAiText(message: any): string {
	const values = [message?.content, message?.output_text, message?.text, message?.refusal]

	for (const value of values) {
		const text = normalizeOpenAiText(value)
		if (text) {
			return text
		}
	}

	return ""
}

function normalizeOpenAiText(value: unknown): string {
	if (typeof value === "string") {
		return value.trim() ? value : ""
	}

	if (!Array.isArray(value)) {
		return ""
	}

	return value
		.map((part) => {
			if (typeof part === "string") {
				return part
			}
			if (!part || typeof part !== "object") {
				return ""
			}

			const objectPart = part as Record<string, unknown>
			if (typeof objectPart.text === "string") {
				return objectPart.text
			}
			if (typeof objectPart.content === "string") {
				return objectPart.content
			}
			if (typeof objectPart.refusal === "string") {
				return objectPart.refusal
			}
			return ""
		})
		.join("")
}

export async function getOpenAiModels(baseUrl?: string, apiKey?: string, openAiHeaders?: Record<string, string>) {
	if (!baseUrl) {
		throw new Error("No base URL provided. Please configure a base URL in Image Generation settings.")
	}

	const analyzedBaseUrl = analyzeOpenAiCompatibleBaseUrl(baseUrl)
	if (!analyzedBaseUrl.isValid || !analyzedBaseUrl.baseUrl) {
		throw new Error(`Invalid base URL: "${baseUrl}". Please check the URL format.`)
	}

	const config: Record<string, any> = {}
	const headers: Record<string, string> = {
		...DEFAULT_HEADERS,
		"User-Agent": `RooCode/${Package.version} ZooCode/${Package.version} (VSCode; OpenAI-Compatible)`,
		"X-Title": "Roo Code",
		...(openAiHeaders || {}),
	}

	if (apiKey) {
		headers["Authorization"] = `Bearer ${apiKey}`
	}

	if (Object.keys(headers).length > 0) {
		config["headers"] = headers
	}

	try {
		const response = await axios.get(getOpenAiCompatibleModelsUrl(analyzedBaseUrl.baseUrl), config)
		const modelsArray = response.data?.data?.map((model: any) => model.id) || []
		return [...new Set<string>(modelsArray)]
	} catch (error) {
		if (axios.isAxiosError(error)) {
			const status = error.response?.status
			if (status === 401 || status === 403) {
				throw new Error(`Authentication failed (HTTP ${status}). Please check your API key.`)
			}
			if (status === 404) {
				throw new Error(
					`Models endpoint not found at "${getOpenAiCompatibleModelsUrl(analyzedBaseUrl.baseUrl)}". The server may not support model listing.`,
				)
			}
			throw new Error(
				`Failed to fetch models: ${error.message}${status ? ` (HTTP ${status})` : ""}. Check your base URL and API key.`,
			)
		}
		throw error
	}
}
