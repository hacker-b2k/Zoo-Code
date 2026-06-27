import { Anthropic } from "@anthropic-ai/sdk"
import * as vscode from "vscode"

const IMAGE_NOT_SUPPORTED_MESSAGE = "not supported by VSCode LM API"

type VsCodeLanguageModelDataPartCtor = new (data: Uint8Array, mimeType: string) => vscode.LanguageModelTextPart

function createVsCodeLmImagePart(part: Anthropic.ImageBlockParam): unknown {
	const LanguageModelDataPart = (vscode as unknown as { LanguageModelDataPart?: VsCodeLanguageModelDataPartCtor })
		.LanguageModelDataPart

	console.log(
		`[IMAGE-TRACE] createVsCodeLmImagePart: LanguageModelDataPart=${LanguageModelDataPart ? "AVAILABLE" : "MISSING"}, source.type=${part.source?.type}, media_type=${part.source?.media_type}, data_length=${part.source?.type === "base64" ? part.source.data?.length : "N/A"}`,
	)

	if (!LanguageModelDataPart || part.source.type !== "base64") {
		console.log(
			`[IMAGE-TRACE] createVsCodeLmImagePart: FALLING BACK to LanguageModelTextPart (DataPart missing=${!LanguageModelDataPart}, sourceType=${part.source?.type})`,
		)
		return new vscode.LanguageModelTextPart(
			`[Image (${part.source?.type || "Unknown source-type"}): ${part.source?.media_type || "unknown media-type"} ${IMAGE_NOT_SUPPORTED_MESSAGE}]`,
		)
	}

	console.log(
		`[IMAGE-TRACE] createVsCodeLmImagePart: Creating LanguageModelDataPart with mimeType=${part.source.media_type}, dataLength=${part.source.data.length}`,
	)
	return new LanguageModelDataPart(Buffer.from(part.source.data, "base64"), part.source.media_type)
}

/**
 * Safely converts a value into a plain object.
 */
function asObjectSafe(value: any): object {
	// Handle null/undefined
	if (!value) {
		return {}
	}

	try {
		// Handle strings that might be JSON
		if (typeof value === "string") {
			return JSON.parse(value)
		}

		// Handle pre-existing objects
		if (typeof value === "object") {
			return { ...value }
		}

		return {}
	} catch (error) {
		console.warn("Roo Code <Language Model API>: Failed to parse object:", error)
		return {}
	}
}

export function convertToVsCodeLmMessages(
	anthropicMessages: Anthropic.Messages.MessageParam[],
): vscode.LanguageModelChatMessage[] {
	const vsCodeLmMessages: vscode.LanguageModelChatMessage[] = []

	for (const anthropicMessage of anthropicMessages) {
		// [IMAGE-TRACE] Log message structure
		if (Array.isArray(anthropicMessage.content)) {
			const imageCount = anthropicMessage.content.filter((b: any) => b.type === "image").length
			if (imageCount > 0) {
				console.log(
					`[IMAGE-TRACE] convertToVsCodeLmMessages: input message role=${anthropicMessage.role}, content blocks=${anthropicMessage.content.length}, image blocks=${imageCount}`,
				)
			}
		}

		// Handle simple string messages
		if (typeof anthropicMessage.content === "string") {
			vsCodeLmMessages.push(
				anthropicMessage.role === "assistant"
					? vscode.LanguageModelChatMessage.Assistant(anthropicMessage.content)
					: vscode.LanguageModelChatMessage.User(anthropicMessage.content),
			)
			continue
		}

		// Handle complex message structures
		switch (anthropicMessage.role) {
			case "user": {
				const { nonToolMessages, toolMessages } = anthropicMessage.content.reduce<{
					nonToolMessages: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[]
					toolMessages: Anthropic.ToolResultBlockParam[]
				}>(
					(acc, part) => {
						if (part.type === "tool_result") {
							acc.toolMessages.push(part)
						} else if (part.type === "text" || part.type === "image") {
							acc.nonToolMessages.push(part)
						}
						return acc
					},
					{ nonToolMessages: [], toolMessages: [] },
				)

				// Process tool messages first then non-tool messages
				const contentParts = [
					// Convert tool messages to ToolResultParts
					...toolMessages.map((toolMessage) => {
						// Process tool result content into TextParts
						const toolContentParts: vscode.LanguageModelTextPart[] =
							typeof toolMessage.content === "string"
								? [new vscode.LanguageModelTextPart(toolMessage.content)]
								: (toolMessage.content?.map((part) => {
										if (part.type === "image") {
											return createVsCodeLmImagePart(part) as vscode.LanguageModelTextPart
										}
										return new vscode.LanguageModelTextPart(part.text)
									}) ?? [new vscode.LanguageModelTextPart("")])

						return new vscode.LanguageModelToolResultPart(toolMessage.tool_use_id, toolContentParts)
					}),

					// Convert non-tool messages to TextParts after tool messages
					...nonToolMessages.map((part) => {
						if (part.type === "image") {
							return createVsCodeLmImagePart(part)
						}
						return new vscode.LanguageModelTextPart(part.text)
					}),
				]

				// Add single user message with all content parts
				vsCodeLmMessages.push(vscode.LanguageModelChatMessage.User(contentParts as any))
				break
			}

			case "assistant": {
				const { nonToolMessages, toolMessages } = anthropicMessage.content.reduce<{
					nonToolMessages: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[]
					toolMessages: Anthropic.ToolUseBlockParam[]
				}>(
					(acc, part) => {
						if (part.type === "tool_use") {
							acc.toolMessages.push(part)
						} else if (part.type === "text" || part.type === "image") {
							acc.nonToolMessages.push(part)
						}
						return acc
					},
					{ nonToolMessages: [], toolMessages: [] },
				)

				// Process non-tool messages first, then tool messages
				// Tool calls must come at the end so they are properly followed by user message with tool results
				const contentParts = [
					// Convert non-tool messages to TextParts first
					...nonToolMessages.map((part) => {
						if (part.type === "image") {
							return createVsCodeLmImagePart(part)
						}
						return new vscode.LanguageModelTextPart(part.text)
					}),

					// Convert tool messages to ToolCallParts after text
					...toolMessages.map(
						(toolMessage) =>
							new vscode.LanguageModelToolCallPart(
								toolMessage.id,
								toolMessage.name,
								asObjectSafe(toolMessage.input),
							),
					),
				]

				// Add the assistant message to the list of messages
				vsCodeLmMessages.push(vscode.LanguageModelChatMessage.Assistant(contentParts as any))
				break
			}
		}
	}

	return vsCodeLmMessages
}

export function convertToAnthropicRole(vsCodeLmMessageRole: vscode.LanguageModelChatMessageRole): string | null {
	switch (vsCodeLmMessageRole) {
		case vscode.LanguageModelChatMessageRole.Assistant:
			return "assistant"
		case vscode.LanguageModelChatMessageRole.User:
			return "user"
		default:
			return null
	}
}

/**
 * Extracts the text content from a VS Code Language Model chat message.
 * @param message A VS Code Language Model chat message.
 * @returns The extracted text content.
 */
export function extractTextCountFromMessage(message: vscode.LanguageModelChatMessage): string {
	let text = ""
	if (Array.isArray(message.content)) {
		for (const item of message.content) {
			if (item instanceof vscode.LanguageModelTextPart) {
				text += item.value
			}
			if (item instanceof vscode.LanguageModelToolResultPart) {
				text += item.callId
				for (const part of item.content) {
					if (part instanceof vscode.LanguageModelTextPart) {
						text += part.value
					}
				}
			}
			if (item instanceof vscode.LanguageModelToolCallPart) {
				text += item.name
				text += item.callId
				if (item.input && Object.keys(item.input).length > 0) {
					try {
						text += JSON.stringify(item.input)
					} catch (error) {
						console.error("Roo Code <Language Model API>: Failed to stringify tool call input:", error)
					}
				}
			}
		}
	} else if (typeof message.content === "string") {
		text += message.content
	}
	return text
}
