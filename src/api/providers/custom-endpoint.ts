import { Anthropic } from "@anthropic-ai/sdk"

import { mergeOpenAiCompatibleModelInfo, type ModelInfo } from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"

import type { ApiStream } from "../transform/stream"

import type { SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"
import { BaseProvider } from "./base-provider"
import { OpenAiHandler } from "./openai"

/**
 * Map custom-endpoint settings onto the OpenAI-compatible field names so we can
 * reuse OpenAiHandler's full request path (URL normalize, free-endpoint auth,
 * temperature discipline, stream fallback, reasoning params, etc.).
 *
 * This is what makes custom-endpoint feel as fast as openai-compatible for the
 * same base URL / key / model — previously CustomEndpointHandler sent a thinner,
 * slower request shape (always temperature:0, no free-endpoint strip, no
 * empty-stream fallback, no base URL normalization).
 */
export function mapCustomEndpointOptionsToOpenAi(options: ApiHandlerOptions): ApiHandlerOptions {
	const apiKey = options.customEndpointApiKey || ""
	const authHeader = options.customEndpointApiKeyHeader
	const authPrefix = options.customEndpointApiKeyPrefix
	const usesCustomAuthHeader = !!(authHeader && authHeader !== "Authorization")

	const openAiHeaders: Record<string, string> = {
		...(options.openAiHeaders || {}),
	}

	// Custom auth header (e.g. X-Api-Key) lives on defaultHeaders; omit the SDK
	// Bearer key so free-endpoint fetch also strips Authorization.
	if (usesCustomAuthHeader) {
		openAiHeaders[authHeader!] = `${authPrefix || ""}${apiKey}`
	}

	return {
		...options,
		openAiBaseUrl: options.customEndpointBaseUrl,
		// Empty / missing key → OpenAiHandler free-endpoint path (no Authorization).
		// Custom non-Authorization header → also omit SDK key so Bearer is not sent.
		openAiApiKey: usesCustomAuthHeader ? undefined : apiKey || undefined,
		openAiModelId: options.customEndpointModelId,
		openAiCustomModelInfo: options.customEndpointModelInfo,
		openAiHeaders,
		// Match openai provider default: stream unless user explicitly disabled.
		openAiStreamingEnabled: options.openAiStreamingEnabled ?? true,
	}
}

/**
 * Handler for user-configured custom endpoints.
 *
 * Transport is OpenAI-compatible via OpenAiHandler (including format "custom").
 * Anthropic format is still routed through the same path until a dedicated
 * Anthropic Messages client is wired for custom endpoints.
 */
export class CustomEndpointHandler extends BaseProvider implements SingleCompletionHandler {
	private options: ApiHandlerOptions
	private delegate: OpenAiHandler

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options
		this.delegate = new OpenAiHandler(mapCustomEndpointOptionsToOpenAi(options))
	}

	private getModelId(): string {
		return this.options.customEndpointModelId || ""
	}

	private getModelInfo(): ModelInfo {
		return mergeOpenAiCompatibleModelInfo(this.options.customEndpointModelInfo)
	}

	override getModel(): { id: string; info: ModelInfo } {
		// Prefer delegate (includes getModelParams) so reasoning/maxTokens match openai path.
		const model = this.delegate.getModel()
		return {
			id: model.id || this.getModelId(),
			info: model.info ?? this.getModelInfo(),
		}
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		// Format is retained for future anthropic-native transport; runtime parity
		// with openai-compatible is the priority for speed and correctness.
		const format = this.options.customEndpointFormat || "custom"
		void format

		yield* this.delegate.createMessage(systemPrompt, messages, metadata)
	}

	async completePrompt(prompt: string): Promise<string> {
		return this.delegate.completePrompt(prompt)
	}
}
