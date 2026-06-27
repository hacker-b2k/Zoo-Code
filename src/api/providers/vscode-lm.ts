import { Anthropic } from "@anthropic-ai/sdk"
import * as vscode from "vscode"
import OpenAI from "openai"

import { type ModelInfo, openAiModelInfoSaneDefaults, vscodeLlmModels } from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"
import { SELECTOR_SEPARATOR, stringifyVsCodeLmModelSelector } from "../../shared/vsCodeSelectorUtils"
import { normalizeToolSchema } from "../../utils/json-schema"

import { ApiStream } from "../transform/stream"
import { convertToVsCodeLmMessages, extractTextCountFromMessage } from "../transform/vscode-lm-format"

import { BaseProvider } from "./base-provider"
import type { SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"

type VsCodeLmCapabilityValue = boolean | string | string[] | undefined

type VsCodeLmCapabilities = {
	imageInput?: boolean
	vision?: boolean
	supportsImages?: boolean
	supportsVision?: boolean
	supports_image_input?: boolean
	supports_vision?: boolean
	inputModalities?: string[]
	input_modalities?: string[]
	modalities?: string[]
}

type VsCodeLmModelWithCapabilities = vscode.LanguageModelChat & {
	capabilities?: VsCodeLmCapabilities
	imageInput?: boolean
	vision?: boolean
	supportsImages?: boolean
	supportsVision?: boolean
	supports_image_input?: boolean
	supports_vision?: boolean
	inputModalities?: string[]
	input_modalities?: string[]
	modalities?: string[]
}

const VS_CODE_LM_IMAGE_CAPABILITY_KEYS = [
	"imageInput",
	"vision",
	"supportsImages",
	"supportsVision",
	"supports_image_input",
	"supports_vision",
] as const

const VS_CODE_LM_MODALITY_KEYS = ["inputModalities", "input_modalities", "modalities"] as const

function imageCapabilityFromValue(value: VsCodeLmCapabilityValue): boolean | undefined {
	if (typeof value === "boolean") {
		return value
	}

	if (typeof value === "string") {
		return value.toLowerCase() === "image" || value.toLowerCase() === "vision" ? true : undefined
	}

	if (Array.isArray(value)) {
		return value.some((modality) => ["image", "vision"].includes(modality.toLowerCase()))
	}

	return undefined
}

function getVsCodeLmImageSupport(model: vscode.LanguageModelChat): boolean {
	const familyInfo = vscodeLlmModels[model.family as keyof typeof vscodeLlmModels]
	const modelWithCapabilities = model as VsCodeLmModelWithCapabilities
	const capabilityContainers: Array<Record<string, VsCodeLmCapabilityValue> | undefined> = [
		modelWithCapabilities.capabilities as Record<string, VsCodeLmCapabilityValue> | undefined,
		modelWithCapabilities as unknown as Record<string, VsCodeLmCapabilityValue>,
	]

	for (const container of capabilityContainers) {
		if (!container) {
			continue
		}

		for (const key of VS_CODE_LM_IMAGE_CAPABILITY_KEYS) {
			const capability = imageCapabilityFromValue(container[key])
			if (capability !== undefined) {
				console.log(
					`[IMAGE-TRACE] getVsCodeLmImageSupport: model=${model.id}, key=${key}, value=${container[key]}, result=${capability}`,
				)
				return capability
			}
		}

		for (const key of VS_CODE_LM_MODALITY_KEYS) {
			const capability = imageCapabilityFromValue(container[key])
			if (capability !== undefined) {
				console.log(
					`[IMAGE-TRACE] getVsCodeLmImageSupport: model=${model.id}, modalityKey=${key}, value=${JSON.stringify(container[key])}, result=${capability}`,
				)
				return capability
			}
		}
	}

	const result = familyInfo?.supportsImages ?? true
	console.log(
		`[IMAGE-TRACE] getVsCodeLmImageSupport: model=${model.id}, family=${model.family}, no capability keys found, familyInfo=${JSON.stringify(familyInfo)}, fallback result=${result}`,
	)
	return result
}

function getVsCodeLmModelInfo(model: vscode.LanguageModelChat): ModelInfo {
	const familyInfo = vscodeLlmModels[model.family as keyof typeof vscodeLlmModels]
	const supportsImages = getVsCodeLmImageSupport(model)

	return {
		maxTokens: -1,
		contextWindow:
			typeof model.maxInputTokens === "number"
				? Math.max(0, model.maxInputTokens)
				: (familyInfo?.contextWindow ?? openAiModelInfoSaneDefaults.contextWindow),
		supportsImages,
		supportsPromptCache: true,
		inputPrice: 0,
		outputPrice: 0,
		description: `VSCode Language Model: ${model.id}`,
	}
}

/**
 * Converts OpenAI-format tools to VSCode Language Model tools.
 * Normalizes the JSON Schema to draft 2020-12 compliant format required by
 * GitHub Copilot's backend, converting type: ["T", "null"] to anyOf format.
 * @param tools Array of OpenAI ChatCompletionTool definitions
 * @returns Array of VSCode LanguageModelChatTool definitions
 */
function convertToVsCodeLmTools(tools: OpenAI.Chat.ChatCompletionTool[]): vscode.LanguageModelChatTool[] {
	return tools
		.filter((tool) => tool.type === "function")
		.map((tool) => ({
			name: tool.function.name,
			description: tool.function.description || "",
			inputSchema: tool.function.parameters
				? normalizeToolSchema(tool.function.parameters as Record<string, unknown>)
				: undefined,
		}))
}

/**
 * Handles interaction with VS Code's Language Model API for chat-based operations.
 * This handler extends BaseProvider to provide VS Code LM specific functionality.
 *
 * @extends {BaseProvider}
 *
 * @remarks
 * The handler manages a VS Code language model chat client and provides methods to:
 * - Create and manage chat client instances
 * - Stream messages using VS Code's Language Model API
 * - Retrieve model information
 *
 * @example
 * ```typescript
 * const options = {
 *   vsCodeLmModelSelector: { vendor: "copilot", family: "gpt-4" }
 * };
 * const handler = new VsCodeLmHandler(options);
 *
 * // Stream a conversation
 * const systemPrompt = "You are a helpful assistant";
 * const messages = [{ role: "user", content: "Hello!" }];
 * for await (const chunk of handler.createMessage(systemPrompt, messages)) {
 *   console.log(chunk);
 * }
 * ```
 */
export class VsCodeLmHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	private client: vscode.LanguageModelChat | null
	private disposable: vscode.Disposable | null
	private currentRequestCancellation: vscode.CancellationTokenSource | null

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options
		this.client = null
		this.disposable = null
		this.currentRequestCancellation = null

		try {
			// Listen for model changes and reset client
			this.disposable = vscode.workspace.onDidChangeConfiguration((event) => {
				if (event.affectsConfiguration("lm")) {
					try {
						this.client = null
						this.ensureCleanState()
					} catch (error) {
						console.error("Error during configuration change cleanup:", error)
					}
				}
			})
			this.initializeClient()
		} catch (error) {
			// Ensure cleanup if constructor fails
			this.dispose()

			throw new Error(
				`Roo Code <Language Model API>: Failed to initialize handler: ${error instanceof Error ? error.message : "Unknown error"}`,
			)
		}
	}
	/**
	 * Initializes the VS Code Language Model client.
	 * This method is called during the constructor to set up the client.
	 * This useful when the client is not created yet and call getModel() before the client is created.
	 * @returns Promise<void>
	 * @throws Error when client initialization fails
	 */
	async initializeClient(): Promise<void> {
		try {
			// Check if the client is already initialized
			if (this.client) {
				console.debug("Roo Code <Language Model API>: Client already initialized")
				return
			}
			// Create a new client instance
			this.client = await this.createClient(this.options.vsCodeLmModelSelector || {})
			console.debug("Roo Code <Language Model API>: Client initialized successfully")
		} catch (error) {
			// Handle errors during client initialization
			const errorMessage = error instanceof Error ? error.message : "Unknown error"
			console.error("Roo Code <Language Model API>: Client initialization failed:", errorMessage)
			throw new Error(`Roo Code <Language Model API>: Failed to initialize client: ${errorMessage}`)
		}
	}
	/**
	 * Creates a language model chat client based on the provided selector.
	 *
	 * @param selector - Selector criteria to filter language model chat instances
	 * @returns Promise resolving to the first matching language model chat instance
	 * @throws Error when no matching models are found with the given selector
	 *
	 * @example
	 * const selector = { vendor: "copilot", family: "gpt-4o" };
	 * const chatClient = await createClient(selector);
	 */
	async createClient(selector: vscode.LanguageModelChatSelector): Promise<vscode.LanguageModelChat> {
		try {
			const models = await vscode.lm.selectChatModels(selector)

			// Use first available model or create a minimal model object
			if (models && Array.isArray(models) && models.length > 0) {
				return models[0]
			}

			// Create a minimal model if no models are available
			return {
				id: "default-lm",
				name: "Default Language Model",
				vendor: "vscode",
				family: "lm",
				version: "1.0",
				maxInputTokens: 8192,
				sendRequest: async (_messages, _options, _token) => {
					// Provide a minimal implementation
					return {
						stream: (async function* () {
							yield new vscode.LanguageModelTextPart(
								"Language model functionality is limited. Please check VS Code configuration.",
							)
						})(),
						text: (async function* () {
							yield "Language model functionality is limited. Please check VS Code configuration."
						})(),
					}
				},
				countTokens: async () => 0,
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error"
			throw new Error(`Roo Code <Language Model API>: Failed to select model: ${errorMessage}`)
		}
	}

	/**
	 * Creates and streams a message using the VS Code Language Model API.
	 *
	 * @param systemPrompt - The system prompt to initialize the conversation context
	 * @param messages - An array of message parameters following the Anthropic message format
	 * @param metadata - Optional metadata for the message
	 *
	 * @yields {ApiStream} An async generator that yields either text chunks or tool calls from the model response
	 *
	 * @throws {Error} When vsCodeLmModelSelector option is not provided
	 * @throws {Error} When the response stream encounters an error
	 *
	 * @remarks
	 * This method handles the initialization of the VS Code LM client if not already created,
	 * converts the messages to VS Code LM format, and streams the response chunks.
	 * Tool calls handling is currently a work in progress.
	 */
	dispose(): void {
		if (this.disposable) {
			this.disposable.dispose()
		}

		if (this.currentRequestCancellation) {
			this.currentRequestCancellation.cancel()
			this.currentRequestCancellation.dispose()
		}
	}

	/**
	 * Implements the ApiHandler countTokens interface method
	 * Provides token counting for Anthropic content blocks
	 *
	 * @param content The content blocks to count tokens for
	 * @returns A promise resolving to the token count
	 */
	override async countTokens(content: Array<Anthropic.Messages.ContentBlockParam>): Promise<number> {
		// Convert Anthropic content blocks to a string for VSCode LM token counting
		let textContent = ""

		for (const block of content) {
			if (block.type === "text") {
				textContent += block.text || ""
			} else if (block.type === "image") {
				// VSCode LM doesn't support images directly, so we'll just use a placeholder
				textContent += "[IMAGE]"
			}
		}

		return this.internalCountTokens(textContent)
	}

	/**
	 * Private implementation of token counting used internally by VsCodeLmHandler
	 */
	private async internalCountTokens(text: string | vscode.LanguageModelChatMessage): Promise<number> {
		// Check for required dependencies
		if (!this.client) {
			console.warn("Roo Code <Language Model API>: No client available for token counting")
			return 0
		}

		// Validate input
		if (!text) {
			console.debug("Roo Code <Language Model API>: Empty text provided for token counting")
			return 0
		}

		// Create a temporary cancellation token if we don't have one (e.g., when called outside a request)
		let cancellationToken: vscode.CancellationToken
		let tempCancellation: vscode.CancellationTokenSource | null = null

		if (this.currentRequestCancellation) {
			cancellationToken = this.currentRequestCancellation.token
		} else {
			tempCancellation = new vscode.CancellationTokenSource()
			cancellationToken = tempCancellation.token
		}

		try {
			// Handle different input types
			let tokenCount: number

			if (typeof text === "string") {
				tokenCount = await this.client.countTokens(text, cancellationToken)
			} else if (text instanceof vscode.LanguageModelChatMessage) {
				// For chat messages, ensure we have content
				if (!text.content || (Array.isArray(text.content) && text.content.length === 0)) {
					console.debug("Roo Code <Language Model API>: Empty chat message content")
					return 0
				}
				const countMessage = extractTextCountFromMessage(text)
				tokenCount = await this.client.countTokens(countMessage, cancellationToken)
			} else {
				console.warn("Roo Code <Language Model API>: Invalid input type for token counting")
				return 0
			}

			// Validate the result
			if (typeof tokenCount !== "number") {
				console.warn("Roo Code <Language Model API>: Non-numeric token count received:", tokenCount)
				return 0
			}

			if (tokenCount < 0) {
				console.warn("Roo Code <Language Model API>: Negative token count received:", tokenCount)
				return 0
			}

			return tokenCount
		} catch (error) {
			// Handle specific error types
			if (error instanceof vscode.CancellationError) {
				console.debug("Roo Code <Language Model API>: Token counting cancelled by user")
				return 0
			}

			const errorMessage = error instanceof Error ? error.message : "Unknown error"
			console.warn("Roo Code <Language Model API>: Token counting failed:", errorMessage)

			// Log additional error details if available
			if (error instanceof Error && error.stack) {
				console.debug("Token counting error stack:", error.stack)
			}

			return 0 // Fallback to prevent stream interruption
		} finally {
			// Clean up temporary cancellation token
			if (tempCancellation) {
				tempCancellation.dispose()
			}
		}
	}

	private async calculateTotalInputTokens(vsCodeLmMessages: vscode.LanguageModelChatMessage[]): Promise<number> {
		const messageTokens: number[] = await Promise.all(vsCodeLmMessages.map((msg) => this.internalCountTokens(msg)))

		return messageTokens.reduce((sum: number, tokens: number): number => sum + tokens, 0)
	}

	private ensureCleanState(): void {
		if (this.currentRequestCancellation) {
			this.currentRequestCancellation.cancel()
			this.currentRequestCancellation.dispose()
			this.currentRequestCancellation = null
		}
	}

	private async getClient(): Promise<vscode.LanguageModelChat> {
		if (!this.client) {
			console.debug("Roo Code <Language Model API>: Getting client with options:", {
				vsCodeLmModelSelector: this.options.vsCodeLmModelSelector,
				hasOptions: !!this.options,
				selectorKeys: this.options.vsCodeLmModelSelector ? Object.keys(this.options.vsCodeLmModelSelector) : [],
			})

			try {
				// Use default empty selector if none provided to get all available models
				const selector = this.options?.vsCodeLmModelSelector || {}
				console.debug("Roo Code <Language Model API>: Creating client with selector:", selector)
				this.client = await this.createClient(selector)
			} catch (error) {
				const message = error instanceof Error ? error.message : "Unknown error"
				console.error("Roo Code <Language Model API>: Client creation failed:", message)
				throw new Error(`Roo Code <Language Model API>: Failed to create client: ${message}`)
			}
		}

		return this.client
	}

	private cleanMessageContent(content: any): any {
		if (!content) {
			return content
		}

		if (typeof content === "string") {
			return content
		}

		if (Array.isArray(content)) {
			return content.map((item) => this.cleanMessageContent(item))
		}

		if (typeof content === "object") {
			const cleaned: any = {}
			for (const [key, value] of Object.entries(content)) {
				cleaned[key] = this.cleanMessageContent(value)
			}
			return cleaned
		}

		return content
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		// Ensure clean state before starting a new request
		this.ensureCleanState()
		const client: vscode.LanguageModelChat = await this.getClient()

		// [IMAGE-TRACE] Log incoming messages for image debugging
		for (let i = 0; i < messages.length; i++) {
			const msg = messages[i]
			if (Array.isArray(msg.content)) {
				const imageBlocks = msg.content.filter((b: any) => b.type === "image")
				if (imageBlocks.length > 0) {
					console.log(
						`[IMAGE-TRACE] createMessage input msg[${i}] role=${msg.role}: ${imageBlocks.length} image block(s) found`,
					)
					for (const img of imageBlocks) {
						const imgBlock = img as any
						console.log(
							`[IMAGE-TRACE]   image block: source.type=${imgBlock.source?.type}, media_type=${imgBlock.source?.media_type}, data_length=${imgBlock.source?.data?.length ?? "N/A"}`,
						)
					}
				}
			}
		}

		// Process messages
		const cleanedMessages = messages.map((msg) => ({
			...msg,
			content: this.cleanMessageContent(msg.content),
		}))

		// [IMAGE-TRACE] Check cleaned messages for images
		for (let i = 0; i < cleanedMessages.length; i++) {
			const msg = cleanedMessages[i]
			if (Array.isArray(msg.content)) {
				const imageBlocks = (msg.content as any[]).filter((b: any) => b.type === "image")
				if (imageBlocks.length > 0) {
					console.log(
						`[IMAGE-TRACE] cleanedMessages msg[${i}] role=${msg.role}: ${imageBlocks.length} image block(s) survived cleaning`,
					)
				}
			}
		}

		// Convert Anthropic messages to VS Code LM messages
		const vsCodeLmMessages: vscode.LanguageModelChatMessage[] = [
			vscode.LanguageModelChatMessage.Assistant(systemPrompt),
			...convertToVsCodeLmMessages(cleanedMessages),
		]

		// [IMAGE-TRACE] Check VS Code LM messages for data parts
		console.log(`[IMAGE-TRACE] convertToVsCodeLmMessages produced ${vsCodeLmMessages.length} messages`)
		for (let i = 0; i < vsCodeLmMessages.length; i++) {
			const m = vsCodeLmMessages[i] as any
			if (m.content && Array.isArray(m.content)) {
				const textParts = m.content.filter((p: any) => p instanceof vscode.LanguageModelTextPart)
				const dataParts = m.content.filter((p: any) => p.mimeType !== undefined)
				const toolCallParts = m.content.filter((p: any) => p instanceof vscode.LanguageModelToolCallPart)
				console.log(
					`[IMAGE-TRACE] vsCodeLmMsg[${i}] role=${m.role}: ${textParts.length} text, ${dataParts.length} data(parts with mimeType), ${toolCallParts.length} toolCalls`,
				)
			}
		}

		// Initialize cancellation token for the request
		this.currentRequestCancellation = new vscode.CancellationTokenSource()

		// Calculate input tokens before starting the stream
		const totalInputTokens: number = await this.calculateTotalInputTokens(vsCodeLmMessages)

		// Accumulate the text and count at the end of the stream to reduce token counting overhead.
		let accumulatedText: string = ""

		try {
			// Create the response stream with required options
			const requestOptions: vscode.LanguageModelChatRequestOptions = {
				justification: `Roo Code would like to use '${client.name}' from '${client.vendor}', Click 'Allow' to proceed.`,
				tools: convertToVsCodeLmTools(metadata?.tools ?? []),
			}

			const response: vscode.LanguageModelChatResponse = await client.sendRequest(
				vsCodeLmMessages,
				requestOptions,
				this.currentRequestCancellation.token,
			)

			// Consume the stream and handle both text and tool call chunks
			for await (const chunk of response.stream) {
				if (chunk instanceof vscode.LanguageModelTextPart) {
					// Validate text part value
					if (typeof chunk.value !== "string") {
						console.warn("Roo Code <Language Model API>: Invalid text part value received:", chunk.value)
						continue
					}

					accumulatedText += chunk.value
					yield {
						type: "text",
						text: chunk.value,
					}
				} else if (chunk instanceof vscode.LanguageModelToolCallPart) {
					try {
						// Validate tool call parameters
						if (!chunk.name || typeof chunk.name !== "string") {
							console.warn("Roo Code <Language Model API>: Invalid tool name received:", chunk.name)
							continue
						}

						if (!chunk.callId || typeof chunk.callId !== "string") {
							console.warn("Roo Code <Language Model API>: Invalid tool callId received:", chunk.callId)
							continue
						}

						// Ensure input is a valid object
						if (!chunk.input || typeof chunk.input !== "object") {
							console.warn("Roo Code <Language Model API>: Invalid tool input received:", chunk.input)
							continue
						}

						// Log tool call for debugging
						console.debug("Roo Code <Language Model API>: Processing tool call:", {
							name: chunk.name,
							callId: chunk.callId,
							inputSize: JSON.stringify(chunk.input).length,
						})

						// Yield native tool_call chunk when tools are provided
						if (metadata?.tools?.length) {
							const argumentsString = JSON.stringify(chunk.input)
							accumulatedText += argumentsString
							yield {
								type: "tool_call",
								id: chunk.callId,
								name: chunk.name,
								arguments: argumentsString,
							}
						}
					} catch (error) {
						console.error("Roo Code <Language Model API>: Failed to process tool call:", error)
						// Continue processing other chunks even if one fails
						continue
					}
				} else {
					console.warn("Roo Code <Language Model API>: Unknown chunk type received:", chunk)
				}
			}

			// Count tokens in the accumulated text after stream completion
			const totalOutputTokens: number = await this.internalCountTokens(accumulatedText)

			// Report final usage after stream completion
			yield {
				type: "usage",
				inputTokens: totalInputTokens,
				outputTokens: totalOutputTokens,
			}
		} catch (error: unknown) {
			this.ensureCleanState()

			if (error instanceof vscode.CancellationError) {
				throw new Error("Roo Code <Language Model API>: Request cancelled by user")
			}

			if (error instanceof Error) {
				console.error("Roo Code <Language Model API>: Stream error details:", {
					message: error.message,
					stack: error.stack,
					name: error.name,
				})

				// Return original error if it's already an Error instance
				throw error
			} else if (typeof error === "object" && error !== null) {
				// Handle error-like objects
				const errorDetails = JSON.stringify(error, null, 2)
				console.error("Roo Code <Language Model API>: Stream error object:", errorDetails)
				throw new Error(`Roo Code <Language Model API>: Response stream error: ${errorDetails}`)
			} else {
				// Fallback for unknown error types
				const errorMessage = String(error)
				console.error("Roo Code <Language Model API>: Unknown stream error:", errorMessage)
				throw new Error(`Roo Code <Language Model API>: Response stream error: ${errorMessage}`)
			}
		}
	}

	// Return model information based on the current client state
	override getModel(): { id: string; info: ModelInfo } {
		if (this.client) {
			// Validate client properties
			const requiredProps = {
				id: this.client.id,
				vendor: this.client.vendor,
				family: this.client.family,
				version: this.client.version,
				maxInputTokens: this.client.maxInputTokens,
			}

			// Log any missing properties for debugging
			for (const [prop, value] of Object.entries(requiredProps)) {
				if (!value && value !== 0) {
					console.warn(`Roo Code <Language Model API>: Client missing ${prop} property`)
				}
			}

			// Construct model ID using available information
			const modelParts = [this.client.vendor, this.client.family, this.client.version].filter(Boolean)

			const modelId = this.client.id || modelParts.join(SELECTOR_SEPARATOR)

			// Build model info with VS Code LM capabilities and conservative defaults for missing values
			const modelInfo: ModelInfo = getVsCodeLmModelInfo(this.client)

			console.log(
				`[IMAGE-TRACE] getModel() with client: id=${modelId}, supportsImages=${modelInfo.supportsImages}, client.id=${this.client.id}, client.family=${this.client.family}`,
			)
			return { id: modelId, info: modelInfo }
		}

		// Fallback when no client is available
		const fallbackId = this.options.vsCodeLmModelSelector
			? stringifyVsCodeLmModelSelector(this.options.vsCodeLmModelSelector)
			: "vscode-lm"

		console.log(
			`[IMAGE-TRACE] getModel() FALLBACK (no client): id=${fallbackId}, supportsImages=${openAiModelInfoSaneDefaults.supportsImages}`,
		)

		return {
			id: fallbackId,
			info: {
				...openAiModelInfoSaneDefaults,
				description: `VSCode Language Model (Fallback): ${fallbackId}`,
			},
		}
	}

	async completePrompt(prompt: string): Promise<string> {
		try {
			const client = await this.getClient()
			const response = await client.sendRequest(
				[vscode.LanguageModelChatMessage.User(prompt)],
				{},
				new vscode.CancellationTokenSource().token,
			)
			let result = ""
			for await (const chunk of response.stream) {
				if (chunk instanceof vscode.LanguageModelTextPart) {
					result += chunk.value
				}
			}
			return result
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`VSCode LM completion error: ${error.message}`)
			}
			throw error
		}
	}
}

// Static blacklist of VS Code Language Model IDs that should be excluded from the model list e.g. because they will never work
const VSCODE_LM_STATIC_BLACKLIST: string[] = ["claude-3.7-sonnet", "claude-3.7-sonnet-thought"]

export async function getVsCodeLmModels() {
	try {
		const models = (await vscode.lm.selectChatModels({})) || []
		return models
			.filter((model) => !VSCODE_LM_STATIC_BLACKLIST.includes(model.id))
			.map((model) => ({ ...model, info: getVsCodeLmModelInfo(model) }))
	} catch (error) {
		console.error(
			`Error fetching VS Code LM models: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
		)
		return []
	}
}
