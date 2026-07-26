import { type ToolName } from "@roo-code/types"

import type { ToolUse, McpToolUse } from "../../shared/tools"
import { NativeToolCallParser } from "./NativeToolCallParser"

/**
 * Models on some third-party gateways (e.g. qwen-3.8-max via logfare) emit tool
 * calls as plain text inside XML-ish tags instead of OpenAI-style `tool_calls`
 * stream chunks. Without recovery, Task sees only text and fires noToolsUsed /
 * "Model Response Incomplete".
 *
 * Supported shapes (case-insensitive tags, flexible whitespace):
 * 1. <tool_call>{"name":"read_file","arguments":{...}}</tool_call>
 * 2. <tool_call>{"name":"read_file","parameters":{...}}</tool_call>
 * 3. <tool_call>{"name":"read_file","arguments":"{...json string...}"}</tool_call>
 * 4. <tool_call name="read_file">{"path":"..."}</tool_call>
 * 5. <function_call>...</function_call> (same JSON body variants)
 * 6. Bare JSON object with name + arguments when wrapped only by whitespace
 *    after an opening tag that was truncated mid-stream (best-effort).
 */

export type TextToolCallParseResult = {
	/** Parsed tool uses with synthetic native ids (required by presentAssistantMessage). */
	toolUses: Array<ToolUse | McpToolUse>
	/** Assistant text with tool-call markup removed (may be empty). */
	cleanedText: string
	/** True when at least one tool call was recovered from text. */
	recovered: boolean
}

const TOOL_CALL_BLOCK_RE =
	/<\s*(?:tool_call|function_call|toolcall|invoke)\b([^>]*)>([\s\S]*?)<\s*\/\s*(?:tool_call|function_call|toolcall|invoke)\s*>/gi

const NAME_ATTR_RE = /\bname\s*=\s*["']([^"']+)["']/i

let textToolCallSeq = 0

function nextSyntheticId(name: string): string {
	textToolCallSeq += 1
	const safe = name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40) || "tool"
	return `text_call_${safe}_${Date.now().toString(36)}_${textToolCallSeq}`
}

function stringifyArguments(value: unknown): string {
	if (value === undefined || value === null) {
		return "{}"
	}
	if (typeof value === "string") {
		const trimmed = value.trim()
		if (!trimmed) {
			return "{}"
		}
		// Already a JSON object/array string — keep as-is for parseToolCall.
		if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
			return trimmed
		}
		// Plain string argument — wrap so parseToolCall gets an object if needed.
		try {
			JSON.parse(trimmed)
			return trimmed
		} catch {
			return JSON.stringify({ value: trimmed })
		}
	}
	if (typeof value === "object") {
		return JSON.stringify(value)
	}
	return JSON.stringify({ value })
}

/**
 * Normalize a single JSON body (or attribute-name + body) into name + arguments JSON string.
 */
function extractNameAndArguments(inner: string, tagAttributes: string): { name: string; arguments: string } | null {
	const attrName = tagAttributes.match(NAME_ATTR_RE)?.[1]?.trim()
	const body = inner.trim()

	if (!body) {
		if (attrName) {
			return { name: attrName, arguments: "{}" }
		}
		return null
	}

	// Prefer JSON object body.
	try {
		const parsed = JSON.parse(body) as Record<string, unknown>
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			const name =
				(typeof parsed.name === "string" && parsed.name) ||
				(typeof parsed.tool === "string" && parsed.tool) ||
				(typeof parsed.function === "string" && parsed.function) ||
				(typeof (parsed as { tool_name?: unknown }).tool_name === "string" &&
					(parsed as { tool_name: string }).tool_name) ||
				attrName

			if (!name || typeof name !== "string") {
				return null
			}

			const rawArgs =
				parsed.arguments !== undefined
					? parsed.arguments
					: parsed.parameters !== undefined
						? parsed.parameters
						: parsed.input !== undefined
							? parsed.input
							: parsed.args !== undefined
								? parsed.args
								: (() => {
										// Body is the args object itself when name came from attribute.
										if (attrName) {
											const { name: _n, tool: _t, function: _f, ...rest } = parsed
											return Object.keys(rest).length > 0 ? rest : {}
										}
										return {}
									})()

			return { name: name.trim(), arguments: stringifyArguments(rawArgs) }
		}
	} catch {
		// Fall through — try name\n{json} or bare name lines.
	}

	// Attribute name + non-JSON body treated as raw args string.
	if (attrName) {
		return { name: attrName, arguments: stringifyArguments(body) }
	}

	// "tool_name\n{...}" or "tool_name {...}"
	const lineMatch = body.match(/^([a-zA-Z0-9_.:-]+)\s*[\n\r]+([\s\S]+)$/)
	if (lineMatch) {
		return { name: lineMatch[1].trim(), arguments: stringifyArguments(lineMatch[2].trim()) }
	}

	const spaceJson = body.match(/^([a-zA-Z0-9_.:-]+)\s+(\{[\s\S]*\})$/)
	if (spaceJson) {
		return { name: spaceJson[1].trim(), arguments: stringifyArguments(spaceJson[2].trim()) }
	}

	return null
}

function toToolUse(name: string, argsJson: string): ToolUse | McpToolUse | null {
	const id = nextSyntheticId(name)
	try {
		const toolUse = NativeToolCallParser.parseToolCall({
			id,
			name: name as ToolName,
			arguments: argsJson,
		})
		if (!toolUse) {
			return null
		}
		;(toolUse as ToolUse | McpToolUse).id = id
		if (toolUse.type === "tool_use") {
			toolUse.usedLegacyFormat = true
			toolUse.partial = false
		} else {
			toolUse.partial = false
		}
		return toolUse
	} catch (error) {
		console.error(
			`[TextToolCallParser] Failed to convert text tool call '${name}':`,
			error instanceof Error ? error.message : String(error),
		)
		return null
	}
}

/**
 * Extract textual tool calls from assistant message text and convert them to
 * native ToolUse / McpToolUse blocks with synthetic ids.
 *
 * Safe to call when native tool_calls already exist — returns recovered:false
 * if no markup matches (caller should skip when native tools already present).
 */
export function parseTextToolCalls(text: string): TextToolCallParseResult {
	if (!text || !text.trim()) {
		return { toolUses: [], cleanedText: text ?? "", recovered: false }
	}

	const toolUses: Array<ToolUse | McpToolUse> = []
	let cleanedText = text
	let recovered = false

	// Reset lastIndex for global regex reuse.
	TOOL_CALL_BLOCK_RE.lastIndex = 0

	const replacements: Array<{ start: number; end: number }> = []
	let match: RegExpExecArray | null

	while ((match = TOOL_CALL_BLOCK_RE.exec(text)) !== null) {
		const full = match[0]
		const attrs = match[1] ?? ""
		const inner = match[2] ?? ""
		const extracted = extractNameAndArguments(inner, attrs)
		if (!extracted) {
			continue
		}

		const toolUse = toToolUse(extracted.name, extracted.arguments)
		if (!toolUse) {
			continue
		}

		toolUses.push(toolUse)
		recovered = true
		replacements.push({ start: match.index, end: match.index + full.length })
	}

	if (replacements.length > 0) {
		// Remove matched spans from end to start so indices stay valid.
		cleanedText = text
		for (let i = replacements.length - 1; i >= 0; i--) {
			const { start, end } = replacements[i]
			cleanedText = cleanedText.slice(0, start) + cleanedText.slice(end)
		}
		// Collapse leftover blank runs from removed blocks.
		cleanedText = cleanedText
			.replace(/[ \t]+\n/g, "\n")
			.replace(/\n{3,}/g, "\n\n")
			.trim()
	}

	return { toolUses, cleanedText, recovered }
}

/**
 * True when the text looks like it may contain a textual tool call worth parsing.
 * Cheap pre-check before full parse.
 */
export function looksLikeTextToolCall(text: string): boolean {
	if (!text) {
		return false
	}
	return /<\s*(?:tool_call|function_call|toolcall|invoke)\b/i.test(text)
}

/** Test helper — reset synthetic id sequence. */
export function resetTextToolCallSeqForTests(): void {
	textToolCallSeq = 0
}
