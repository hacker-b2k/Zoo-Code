/**
 * Utility to consume an ApiStream and return the concatenated text response.
 * Used by pipeline stage executors to collect the full LLM output.
 */

import type { ApiHandler } from "../../api/index.js"
import type { ApiStreamChunk } from "../../api/transform/stream.js"
import type Anthropic from "@anthropic-ai/sdk"

/**
 * Call the LLM with a system prompt and a single user message,
 * collect the full text response, and return it.
 */
export async function callLlmForText(
	api: ApiHandler,
	systemPrompt: string,
	userMessage: string,
	taskId: string,
	abortSignal?: AbortSignal,
): Promise<string> {
	const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: userMessage }]

	const stream = api.createMessage(systemPrompt, messages, {
		taskId,
		abortSignal,
	})

	return collectStreamText(stream)
}

/**
 * Consume an ApiStream and concatenate all text chunks.
 */
export async function collectStreamText(stream: AsyncGenerator<ApiStreamChunk>): Promise<string> {
	const parts: string[] = []
	for await (const chunk of stream) {
		if (chunk.type === "text") {
			parts.push(chunk.text)
		}
	}
	return parts.join("")
}

/**
 * Extract a JSON object from a text response that may be wrapped
 * in markdown code fences. LLMs often output ```json ... ``` blocks.
 */
export function extractJsonFromText(text: string): unknown {
	// Try to find a JSON code block first
	const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
	if (codeBlockMatch) {
		return JSON.parse(codeBlockMatch[1]!.trim())
	}

	// Try to find a raw JSON object/array
	const jsonMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
	if (jsonMatch) {
		return JSON.parse(jsonMatch[1]!)
	}

	// Last resort: try to parse the entire text
	return JSON.parse(text.trim())
}
