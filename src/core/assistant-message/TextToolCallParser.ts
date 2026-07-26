import { type ToolName } from "@roo-code/types"

import type { ToolUse, McpToolUse } from "../../shared/tools"
import { NativeToolCallParser } from "./NativeToolCallParser"

/**
 * Recover tool calls that models emit as plain assistant text instead of
 * provider-native `tool_calls` stream chunks.
 *
 * Without recovery, Task sees only text → noToolsUsed → "Model Response Incomplete"
 * / "Zoo is having trouble...". This is a permanent backend recovery path for
 * gateways and models that ignore or partially support native function calling.
 *
 * Supported shapes (case-insensitive tags, flexible whitespace):
 *
 * JSON body (Qwen / many OpenAI-compatible gateways):
 * 1. <tool_call>{"name":"read_file","arguments":{...}}</tool_call>
 * 2. <tool_call>{"name":"read_file","parameters":{...}}</tool_call>
 * 3. <tool_call name="read_file">{"path":"..."}</tool_call>
 * 4. <function_call>...</function_call> (same JSON body variants)
 *
 * MiniMax / Hermes / Qwen-agent XML (common when native tools fail):
 * 5. <tool_call>
 *      <function=write_spec>
 *        <parameter=title>...</parameter>
 *        <parameter=doc>requirements</parameter>
 *      </function>
 *    </tool_call>
 * 6. Bare <function=name>…</function> without outer tool_call
 * 7. Unclosed trailing </tool_call> / </function> (stream truncation)
 *
 * Values "None" / "null" / "undefined" / empty are normalized before native parse
 * so nullable tool fields (e.g. write_spec.spec_id) work after XML recovery.
 */

export type TextToolCallParseResult = {
	/** Parsed tool uses with synthetic native ids (required by presentAssistantMessage). */
	toolUses: Array<ToolUse | McpToolUse>
	/** Assistant text with tool-call markup removed (may be empty). */
	cleanedText: string
	/** True when at least one tool call was recovered from text. */
	recovered: boolean
}

type Span = { start: number; end: number }

/** Outer wrapper tags that historically held JSON tool bodies (must be closed). */
const OUTER_CLOSED_BLOCK_RE =
	/<\s*(?:tool_call|function_call|toolcall|invoke)\b([^>]*)>([\s\S]*?)<\s*\/\s*(?:tool_call|function_call|toolcall|invoke)\s*>/gi

/**
 * Outer MiniMax-style tool_call (closed or unclosed to EOS). Used after closed-pass
 * so unclosed streams still recover.
 */
const OUTER_TOOL_CALL_LOOSE_RE = /<\s*tool_call\b[^>]*>\s*([\s\S]*?)(?:<\s*\/\s*tool_call\s*>|(?=$))/gi

/** <function=name>…</function> or unclosed to end of segment. */
const FUNCTION_EQ_BLOCK_RE = /<\s*function\s*=\s*([a-zA-Z0-9_.:-]+)\s*>\s*([\s\S]*?)(?:<\s*\/\s*function\s*>|(?=$))/gi

/** <parameter=name>value</parameter> */
const PARAMETER_EQ_RE = /<\s*parameter\s*=\s*([a-zA-Z0-9_.:-]+)\s*>([\s\S]*?)<\s*\/\s*parameter\s*>/gi

/** Alternate: <function name="x"> or <tool name="x"> */
const FUNCTION_NAME_ATTR_BLOCK_RE =
	/<\s*(?:function|tool)\b([^>]*\bname\s*=\s*["']([^"']+)["'][^>]*)>([\s\S]*?)(?:<\s*\/\s*(?:function|tool)\s*>|(?=$))/gi

const NAME_ATTR_RE = /\bname\s*=\s*["']([^"']+)["']/i

// Require a tool-call surface — bare <parameter= alone is too weak (false positives).
const LOOKS_LIKE_TEXT_TOOL_RE =
	/<\s*(?:tool_call|function_call|toolcall|invoke)\b|<\s*function\s*=|<\s*function\b[^>]*\bname\s*=|<\s*tool\b[^>]*\bname\s*=/i

let textToolCallSeq = 0

function nextSyntheticId(name: string): string {
	textToolCallSeq += 1
	const safe = name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40) || "tool"
	return `text_call_${safe}_${Date.now().toString(36)}_${textToolCallSeq}`
}

/**
 * Normalize XML/text parameter values into JSON-friendly primitives.
 * Models often emit Python/JSON sentinels as plain text inside <parameter>.
 */
function coerceParameterValue(raw: string): unknown {
	const value = raw.replace(/^\s+/, "").replace(/\s+$/, "")
	if (value === "") {
		return ""
	}

	const lower = value.toLowerCase()
	if (lower === "none" || lower === "null" || lower === "undefined" || lower === "nil") {
		return null
	}
	if (lower === "true") {
		return true
	}
	if (lower === "false") {
		return false
	}

	if (/^-?\d+$/.test(value)) {
		const n = Number(value)
		if (Number.isSafeInteger(n)) {
			return n
		}
	}
	if (/^-?\d+\.\d+$/.test(value)) {
		const n = Number(value)
		if (!Number.isNaN(n)) {
			return n
		}
	}

	if (
		(value.startsWith("{") && value.endsWith("}")) ||
		(value.startsWith("[") && value.endsWith("]")) ||
		(value.startsWith('"') && value.endsWith('"'))
	) {
		try {
			return JSON.parse(value)
		} catch {
			// keep as string
		}
	}

	return value
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
		if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
			return trimmed
		}
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

function parseParameterEqBody(inner: string): Record<string, unknown> {
	const args: Record<string, unknown> = {}
	PARAMETER_EQ_RE.lastIndex = 0
	let match: RegExpExecArray | null
	while ((match = PARAMETER_EQ_RE.exec(inner)) !== null) {
		const key = match[1]?.trim()
		if (!key) {
			continue
		}
		args[key] = coerceParameterValue(match[2] ?? "")
	}
	return args
}

function extractNameAndArgumentsFromJson(
	inner: string,
	tagAttributes: string,
): { name: string; arguments: string } | null {
	const attrName = tagAttributes.match(NAME_ATTR_RE)?.[1]?.trim()
	const body = inner.trim()

	if (!body) {
		if (attrName) {
			return { name: attrName, arguments: "{}" }
		}
		return null
	}

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
										if (attrName) {
											const { name: _n, tool: _t, function: _f, ...rest } = parsed
											return Object.keys(rest).length > 0 ? rest : {}
										}
										return {}
									})()

			return { name: name.trim(), arguments: stringifyArguments(rawArgs) }
		}
	} catch {
		// Fall through
	}

	if (attrName) {
		if (/<\s*parameter\s*=/i.test(body)) {
			return { name: attrName, arguments: JSON.stringify(parseParameterEqBody(body)) }
		}
		return { name: attrName, arguments: stringifyArguments(body) }
	}

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

type XmlFnHit = { name: string; arguments: string }

function extractAllXmlFunctions(segment: string): XmlFnHit[] {
	const out: XmlFnHit[] = []
	if (!segment) {
		return out
	}

	FUNCTION_EQ_BLOCK_RE.lastIndex = 0
	let match: RegExpExecArray | null
	while ((match = FUNCTION_EQ_BLOCK_RE.exec(segment)) !== null) {
		const name = match[1]?.trim()
		if (!name) {
			continue
		}
		out.push({
			name,
			arguments: JSON.stringify(parseParameterEqBody(match[2] ?? "")),
		})
	}

	if (out.length > 0) {
		return out
	}

	FUNCTION_NAME_ATTR_BLOCK_RE.lastIndex = 0
	while ((match = FUNCTION_NAME_ATTR_BLOCK_RE.exec(segment)) !== null) {
		const name = match[2]?.trim()
		if (!name) {
			continue
		}
		const inner = match[3] ?? ""
		if (/<\s*parameter\s*=/i.test(inner)) {
			out.push({ name, arguments: JSON.stringify(parseParameterEqBody(inner)) })
		} else {
			const extracted = extractNameAndArgumentsFromJson(inner, `name="${name}"`)
			out.push({
				name: extracted?.name ?? name,
				arguments: extracted?.arguments ?? "{}",
			})
		}
	}

	return out
}

function toToolUse(name: string, argsJson: string): ToolUse | McpToolUse | null {
	const id = nextSyntheticId(name)
	try {
		// Reuse the single native parser so recovered tools share validation,
		// alias resolution, MCP naming, and typed nativeArgs with the stream path.
		const toolUse = NativeToolCallParser.parseToolCall({
			id,
			name: name as ToolName,
			arguments: argsJson,
		})
		if (!toolUse) {
			return null
		}
		// presentAssistantMessage requires id (rejects id-less blocks as invalid XML).
		;(toolUse as ToolUse | McpToolUse).id = id
		toolUse.partial = false
		// Do NOT set usedLegacyFormat: that flag means "legacy file-param shape"
		// (read_file migration telemetry), not "recovered from assistant text".
		// Recovered calls are still nativeArgs-based execution.
		return toolUse
	} catch (error) {
		console.error(
			`[TextToolCallParser] Failed to convert text tool call '${name}':`,
			error instanceof Error ? error.message : String(error),
		)
		return null
	}
}

function isSpanCovered(spans: Span[], start: number, end: number): boolean {
	return spans.some((s) => start >= s.start && end <= s.end)
}

function mergeSpans(spans: Span[]): Span[] {
	if (spans.length === 0) {
		return []
	}
	const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end)
	const merged: Span[] = [{ ...sorted[0] }]
	for (let i = 1; i < sorted.length; i++) {
		const cur = sorted[i]
		const last = merged[merged.length - 1]
		if (cur.start <= last.end) {
			last.end = Math.max(last.end, cur.end)
		} else {
			merged.push({ ...cur })
		}
	}
	return merged
}

function dedupeToolUses(toolUses: Array<ToolUse | McpToolUse>): Array<ToolUse | McpToolUse> {
	const seen = new Set<string>()
	const out: Array<ToolUse | McpToolUse> = []
	for (const t of toolUses) {
		const key = t.id ?? `${t.name}:${JSON.stringify((t as ToolUse).nativeArgs ?? (t as ToolUse).params ?? {})}`
		if (seen.has(key)) {
			continue
		}
		seen.add(key)
		out.push(t)
	}
	return out
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
	const replacements: Span[] = []

	const mark = (start: number, end: number) => {
		replacements.push({ start, end })
	}

	const pushTools = (fns: XmlFnHit[]): boolean => {
		let any = false
		for (const fn of fns) {
			const toolUse = toToolUse(fn.name, fn.arguments)
			if (toolUse) {
				toolUses.push(toolUse)
				any = true
			}
		}
		return any
	}

	// ── Pass A: closed outer tags (JSON and/or nested MiniMax XML) ──────────
	OUTER_CLOSED_BLOCK_RE.lastIndex = 0
	let match: RegExpExecArray | null
	while ((match = OUTER_CLOSED_BLOCK_RE.exec(text)) !== null) {
		const start = match.index
		const end = start + match[0].length
		const attrs = match[1] ?? ""
		const inner = match[2] ?? ""

		if (/<\s*function\s*=/i.test(inner) || /<\s*function\b[^>]*\bname\s*=/i.test(inner)) {
			const xmlFns = extractAllXmlFunctions(inner)
			if (xmlFns.length > 0 && pushTools(xmlFns)) {
				mark(start, end)
				continue
			}
		}

		if (/<\s*parameter\s*=/i.test(inner)) {
			const attrName = attrs.match(NAME_ATTR_RE)?.[1]?.trim()
			const xmlFns = extractAllXmlFunctions(inner)
			if (xmlFns.length > 0 && pushTools(xmlFns)) {
				mark(start, end)
				continue
			}
			if (attrName) {
				const toolUse = toToolUse(attrName, JSON.stringify(parseParameterEqBody(inner)))
				if (toolUse) {
					toolUses.push(toolUse)
					mark(start, end)
					continue
				}
			}
		}

		const extracted = extractNameAndArgumentsFromJson(inner, attrs)
		if (extracted) {
			const toolUse = toToolUse(extracted.name, extracted.arguments)
			if (toolUse) {
				toolUses.push(toolUse)
				mark(start, end)
			}
		}
	}

	// ── Pass B: loose <tool_call> (incl. unclosed) not already covered ──────
	OUTER_TOOL_CALL_LOOSE_RE.lastIndex = 0
	while ((match = OUTER_TOOL_CALL_LOOSE_RE.exec(text)) !== null) {
		const start = match.index
		const end = start + match[0].length
		const inner = match[1] ?? ""

		if (isSpanCovered(replacements, start, end)) {
			continue
		}

		const xmlFns = extractAllXmlFunctions(inner)
		if (xmlFns.length > 0) {
			if (pushTools(xmlFns)) {
				mark(start, end)
			}
			continue
		}

		const extracted = extractNameAndArgumentsFromJson(inner, "")
		if (extracted) {
			const toolUse = toToolUse(extracted.name, extracted.arguments)
			if (toolUse) {
				toolUses.push(toolUse)
				mark(start, end)
			}
		}
	}

	// ── Pass C: bare <function=name>… not already covered ───────────────────
	FUNCTION_EQ_BLOCK_RE.lastIndex = 0
	while ((match = FUNCTION_EQ_BLOCK_RE.exec(text)) !== null) {
		const start = match.index
		const end = start + match[0].length
		if (isSpanCovered(replacements, start, end)) {
			continue
		}
		const name = match[1]?.trim()
		if (!name) {
			continue
		}
		const toolUse = toToolUse(name, JSON.stringify(parseParameterEqBody(match[2] ?? "")))
		if (toolUse) {
			toolUses.push(toolUse)
			mark(start, end)
		}
	}

	let cleanedText = text
	if (replacements.length > 0) {
		const merged = mergeSpans(replacements)
		cleanedText = text
		for (let i = merged.length - 1; i >= 0; i--) {
			const { start, end } = merged[i]
			cleanedText = cleanedText.slice(0, start) + cleanedText.slice(end)
		}
		cleanedText = cleanedText
			.replace(/[ \t]+\n/g, "\n")
			.replace(/\n{3,}/g, "\n\n")
			.trim()
	}

	const uniqueTools = dedupeToolUses(toolUses)

	return {
		toolUses: uniqueTools,
		cleanedText,
		recovered: uniqueTools.length > 0,
	}
}

/**
 * True when the text looks like it may contain a textual tool call worth parsing.
 * Cheap pre-check before full parse.
 */
export function looksLikeTextToolCall(text: string): boolean {
	if (!text) {
		return false
	}
	return LOOKS_LIKE_TEXT_TOOL_RE.test(text)
}

/** Test helper — reset synthetic id sequence. */
export function resetTextToolCallSeqForTests(): void {
	textToolCallSeq = 0
}
