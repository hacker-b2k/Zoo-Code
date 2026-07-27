import type { ToolUse, McpToolUse, TextContent } from "../../shared/tools"
import { looksLikeTextToolCall, parseTextToolCalls, stripMalformedToolCallMarkup } from "./TextToolCallParser"

/**
 * Content blocks that participate in textual tool-call recovery.
 * Matches Task.assistantMessageContent shape for the recovery path.
 */
export type RecoverableAssistantBlock = TextContent | ToolUse | McpToolUse

export type TextualToolCallRecoveryState = {
	assistantMessage: string
	assistantMessageContent: RecoverableAssistantBlock[]
	currentStreamingContentIndex: number
}

export type TextualToolCallRecoveryResult = TextualToolCallRecoveryState & {
	/** True when at least one tool was recovered and content/index were updated. */
	applied: boolean
	/** Number of recovered tool_use / mcp_tool_use blocks appended. */
	recoveredCount: number
}

/**
 * True when a block is already a complete native/MCP tool that BaseTool can execute.
 * Id-only shells (partial stream that never got nativeArgs) must NOT block text recovery.
 */
export function hasExecutableNativeToolUse(blocks: readonly RecoverableAssistantBlock[]): boolean {
	return blocks.some((block) => {
		if (block.type === "mcp_tool_use") {
			return true
		}
		if (block.type === "tool_use") {
			// BaseTool.handle requires nativeArgs; missing nativeArgs → not executable.
			return (block as ToolUse).nativeArgs !== undefined
		}
		return false
	})
}

/**
 * Apply post-stream textual tool-call recovery to assistant state.
 *
 * Permanent architecture for models/gateways that emit tools as assistant text
 * (JSON-in-tags or MiniMax/Hermes XML) instead of native stream tool_calls:
 *
 * 1. Skip when an executable native/MCP tool already exists (avoid double-exec).
 * 2. Parse markup → ToolUse with id + nativeArgs (same as native path).
 * 3. Strip markup from text; drop empty text blocks.
 * 4. Drop incomplete native tool shells (no nativeArgs) so recovery is sole path.
 * 5. Append recovered tools as partial=true (Task presents after history save).
 * 6. Clamp presenter index so recovered tools are not OOB-skipped, without
 *    skipping unpresented leading text when the stream deferred presentation.
 *
 * Pure function — Task applies the returned state; unit tests cover the wiring.
 */
export function applyTextualToolCallRecovery(state: TextualToolCallRecoveryState): TextualToolCallRecoveryResult {
	const { assistantMessage } = state

	if (!assistantMessage || !looksLikeTextToolCall(assistantMessage)) {
		return {
			...cloneState(state),
			applied: false,
			recoveredCount: 0,
		}
	}

	// Shallow-copy blocks so we never mutate the caller's array in place until
	// Task assigns the result (tests can also re-use input safely).
	let assistantMessageContent = state.assistantMessageContent.map((block) => ({
		...block,
	})) as RecoverableAssistantBlock[]
	let currentStreamingContentIndex = state.currentStreamingContentIndex

	if (hasExecutableNativeToolUse(assistantMessageContent)) {
		return {
			assistantMessage,
			assistantMessageContent,
			currentStreamingContentIndex,
			applied: false,
			recoveredCount: 0,
		}
	}

	const recovered = parseTextToolCalls(assistantMessage)
	if (!recovered.recovered || recovered.toolUses.length === 0) {
		// Malformed/garbled tool-call fragments: nothing valid to execute, but
		// the user must never see raw broken XML. Strip structural tag-shaped
		// tokens (conservative — never touches plain English prose).
		const strippedMessage = stripMalformedToolCallMarkup(assistantMessage)
		const messageChanged = strippedMessage !== assistantMessage
		if (messageChanged) {
			// Update text blocks with the stripped version
			for (const block of assistantMessageContent) {
				if (block.type === "text") {
					block.content = strippedMessage
					block.partial = false
				}
			}
			// Drop empty text blocks after stripping
			if (!strippedMessage.trim()) {
				assistantMessageContent = assistantMessageContent.filter(
					(block) => block.type !== "text" || (block.content && block.content.trim()),
				)
			}
		}
		return {
			assistantMessage: strippedMessage,
			assistantMessageContent,
			currentStreamingContentIndex,
			applied: messageChanged,
			recoveredCount: 0,
		}
	}

	// Incomplete native shells (tool_use without nativeArgs) would block execution
	// and pollute API history — remove them; text recovery is the executable path.
	assistantMessageContent = assistantMessageContent.filter((block) => {
		if (block.type === "tool_use" && (block as ToolUse).nativeArgs === undefined) {
			return false
		}
		return true
	})

	// Strip markup from accumulated text + any text content blocks.
	const cleanedMessage = recovered.cleanedText
	for (const block of assistantMessageContent) {
		if (block.type === "text") {
			block.content = cleanedMessage
			block.partial = false
		}
	}

	// Drop empty text blocks so we don't persist useless text alongside tool_use.
	// CRITICAL: after filtering, currentStreamingContentIndex may point past the
	// array (text-only stream already presented those blocks).
	if (!cleanedMessage.trim()) {
		assistantMessageContent = assistantMessageContent.filter(
			(block) => block.type !== "text" || (block.content && block.content.trim()),
		)
	}

	const firstRecoveredIndex = assistantMessageContent.length
	for (const toolUse of recovered.toolUses) {
		// partial=true → Task includes them in partialBlocks → present AFTER
		// addToApiConversationHistory (same ordering as finalizeRawChunks tools).
		const recoveredBlock = { ...toolUse, partial: true } as ToolUse | McpToolUse
		assistantMessageContent.push(recoveredBlock)
	}

	// Clamp presenter index so recovered tools are not left OOB after text
	// filtering, but do NOT force-skip unpresented leading text (mid-stream
	// defer leaves index at 0 while tools are appended after the text block).
	//
	// Cases:
	// - index OOB after empty-text filter → clamp to firstRecoveredIndex
	// - index already past first recovered tool → clamp back
	// - index still on leading text (index < firstRecoveredIndex) → keep
	if (
		currentStreamingContentIndex > firstRecoveredIndex ||
		currentStreamingContentIndex >= assistantMessageContent.length
	) {
		currentStreamingContentIndex = firstRecoveredIndex
	}

	return {
		assistantMessage: cleanedMessage,
		assistantMessageContent,
		currentStreamingContentIndex,
		applied: true,
		recoveredCount: recovered.toolUses.length,
	}
}

function cloneState(state: TextualToolCallRecoveryState): TextualToolCallRecoveryState {
	return {
		assistantMessage: state.assistantMessage,
		assistantMessageContent: state.assistantMessageContent.map((block) => ({
			...block,
		})) as RecoverableAssistantBlock[],
		currentStreamingContentIndex: state.currentStreamingContentIndex,
	}
}
