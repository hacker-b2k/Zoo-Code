import type { ToolUse } from "../../shared/tools"
import { NativeToolCallParser } from "./NativeToolCallParser"

/**
 * Text-based intent extractor — last-resort fallback for providers/models
 * that lack native function-calling support and write code as plain text.
 *
 * When a model responds with code blocks preceded by file paths (e.g.
 * "**src/app.tsx**\n```tsx\n...`), this module detects the pattern and
 * synthesises write_to_file tool calls so the agentic loop can continue.
 *
 * This is intentionally conservative: it only matches patterns where a
 * file path is explicitly mentioned near a code block. It never treats
 * standalone code samples as file writes.
 */

let intentCallSeq = 0

function nextIntentId(name: string): string {
	intentCallSeq += 1
	const safe = name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40) || "tool"
	return `intent_${safe}_${Date.now().toString(36)}_${intentCallSeq}`
}

/** Characters that can appear in a relative file path. */
const PATH_CHARS = `[a-zA-Z0-9_./@%\\-]`

/** Reasonable maximum file path length in a text response. */
const MAX_PATH_LENGTH = 300

/**
 * Patterns that precede a file path when a model is announcing a file
 * creation or modification. Ordered from most specific to least specific.
 */
const FILE_PATH_ANNOUNCE_RE = new RegExp(
	`(?:(?:create|write|add|generate|update|modify|edit|save|make)` +
		`\\s+(?:the\\s+)?(?:file|new\\s+file)?\\s*(?::|called|named)?\\s*)` +
		`(?:\\*\\*|[\`"])(${PATH_CHARS}{1,${MAX_PATH_LENGTH}})(?:\\*\\*|[\`"])`,
	"gi",
)

/**
 * Markdown-style bold/inline-code file path followed by a language-hinted
 * code block. Matches: "**src/app.tsx**" or "`src/app.tsx`" immediately
 * before a fenced code block.
 */
const BOLD_FILE_PATH_RE = new RegExp(
	`(?:\\*\\*|[\`"])(${PATH_CHARS}{1,${MAX_PATH_LENGTH}}` + `\\.(?:[a-zA-Z0-9]{1,20}))(?:\\*\\*|[\`"])\\s*\\n\`\`\``,
	"gi",
)

/**
 * A line that is ONLY a file path (possibly with a trailing colon), right
 * before a fenced code block. Matches:
 *   src/app.tsx
 *   ```
 */
const STANDALONE_PATH_BEFORE_FENCE_RE = new RegExp(
	`^(${PATH_CHARS}{1,${MAX_PATH_LENGTH}}\\.[a-zA-Z0-9]{1,20})\\s*:?\\s*$\\n\`\`\``,
	"gim",
)

type DetectedFileWrite = {
	path: string
	content: string
	startIndex: number
	endIndex: number
}

/** Extract the language hint from an opening fence line (```tsx). */
function extractLanguage(fenceLine: string): string {
	const match = /^```(\w*)/.exec(fenceLine)
	return match?.[1] ?? ""
}

/**
 * Find the closing fence for a code block starting at `startIndex`.
 * Returns the index after the closing ``` or undefined if not found.
 */
function findClosingFence(text: string, startIndex: number): number | undefined {
	// Find the end of the opening fence line.
	const afterOpen = text.indexOf("\n", startIndex)
	if (afterOpen === -1) return undefined

	// Search for a closing ``` at the start of a line.
	const searchFrom = afterOpen + 1
	let pos = searchFrom
	while (pos < text.length) {
		const lineStart = pos
		const lineEnd = text.indexOf("\n", pos)
		const line = lineEnd === -1 ? text.slice(pos) : text.slice(pos, lineEnd)

		if (/^\s*```\s*$/.test(line)) {
			return lineEnd === -1 ? text.length : lineEnd + 1
		}

		pos = lineEnd === -1 ? text.length : lineEnd + 1
	}

	return undefined
}

/**
 * Scan assistant text for file-write intent and return synthetic ToolUse
 * blocks for each detected file. Returns an empty array when no intent
 * is found — the caller should fall through to other strategies.
 */
export function extractFileWriteIntent(assistantText: string): ToolUse[] {
	if (!assistantText || assistantText.length < 20) {
		return []
	}

	const writes: DetectedFileWrite[] = []

	// Collect all fenced code blocks with their ranges.
	const fenceRe = /```(\w*)[^\n]*\n/g
	let fenceMatch: RegExpExecArray | null
	const codeBlocks: Array<{ lang: string; start: number; bodyStart: number; end: number }> = []

	while ((fenceMatch = fenceRe.exec(assistantText)) !== null) {
		const end = findClosingFence(assistantText, fenceMatch.index)
		if (end !== undefined) {
			codeBlocks.push({
				lang: extractLanguage(fenceMatch[0]),
				start: fenceMatch.index,
				bodyStart: fenceMatch.index + fenceMatch[0].length,
				end,
			})
		}
	}

	if (codeBlocks.length === 0) {
		return []
	}

	// For each code block, look backwards in the text for a nearby file path.
	for (const block of codeBlocks) {
		// Look at the 500 characters before the code block for a file path.
		const lookbackStart = Math.max(0, block.start - 500)
		const lookback = assistantText.slice(lookbackStart, block.start)

		let filePath: string | undefined

		// Try bold/inline-code path right before the fence.
		const boldMatches = [...lookback.matchAll(BOLD_FILE_PATH_RE)]
		if (boldMatches.length > 0) {
			const last = boldMatches[boldMatches.length - 1]
			filePath = last[1]
		}

		// Try standalone path on its own line before the fence.
		if (!filePath) {
			const standaloneMatches = [...lookback.matchAll(STANDALONE_PATH_BEFORE_FENCE_RE)]
			if (standaloneMatches.length > 0) {
				const last = standaloneMatches[standaloneMatches.length - 1]
				filePath = last[1]
			}
		}

		// Try "create/write file X" announcement.
		if (!filePath) {
			const announceMatches = [...lookback.matchAll(FILE_PATH_ANNOUNCE_RE)]
			if (announceMatches.length > 0) {
				const last = announceMatches[announceMatches.length - 1]
				filePath = last[1]
			}
		}

		if (filePath) {
			// Normalize: strip leading ./ and common non-path characters.
			filePath = filePath
				.replace(/^\.\//, "")
				.replace(/^["'`]|["'`]$/g, "")
				.trim()

			// Basic sanity: must contain at least one directory separator or
			// file extension, and not look like a language keyword or URL.
			if (
				filePath &&
				!filePath.startsWith("http") &&
				!filePath.startsWith("//") &&
				(filePath.includes("/") || filePath.includes(".")) &&
				filePath.length < MAX_PATH_LENGTH
			) {
				// Extract code content (between opening and closing fences).
				const codeContent = assistantText.slice(block.bodyStart, block.end).replace(/\n```\s*$/, "")

				// Avoid duplicates for the same path.
				if (!writes.some((w) => w.path === filePath) && codeContent.trim().length > 0) {
					writes.push({
						path: filePath,
						content: codeContent,
						startIndex: block.start,
						endIndex: block.end,
					})
				}
			}
		}
	}

	// Convert detected writes to ToolUse blocks via the shared parser.
	const toolUses: ToolUse[] = []
	for (const write of writes) {
		const syntheticArgs = { path: write.path, content: write.content }
		const id = nextIntentId("write_to_file")
		try {
			const parsed = NativeToolCallParser.parseToolCall({
				id,
				name: "write_to_file",
				arguments: JSON.stringify(syntheticArgs),
			})
			if (parsed) {
				toolUses.push(parsed as ToolUse)
			}
		} catch {
			// Parser rejected the arguments (e.g. invalid path). Skip silently.
		}
	}

	return toolUses
}
