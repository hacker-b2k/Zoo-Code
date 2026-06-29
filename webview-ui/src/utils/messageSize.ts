import type { ClineMessage } from "@roo-code/types"

/**
 * Auto-collapse heuristic for long messages.
 *
 * Content-type detection with type-specific thresholds, falling back to
 * a user-configured threshold for plain text.  The fallback uses an estimated
 * visual line count (max of actual lines and character-based estimate) so that
 * pasted paragraphs with few newlines are still evaluated correctly.
 */

// ─── Internal Constants ─────────────────────────────────────────────────────

/** A fenced code block larger than this triggers collapse. */
const CODE_BLOCK_COLLAPSE_THRESHOLD = 15

/** Terminal output with more than this many matching lines triggers collapse. */
const TERMINAL_OUTPUT_COLLAPSE_THRESHOLD = 10

/** Stack traces with more than this many matching lines trigger collapse. */
const STACK_TRACE_COLLAPSE_THRESHOLD = 10

/** Log output with more than this many matching lines triggers collapse. */
const LOG_OUTPUT_COLLAPSE_THRESHOLD = 15

/** Messages shorter than this are never collapsed regardless of content type. */
const MIN_LINES_TO_COLLAPSE = 5

/**
 * Estimated characters per visual line for plain text.
 * Used to compute an estimated visual line count for single-paragraph messages
 * where `text.split("\n").length` dramatically underestimates the visual size.
 * A typical terminal/editor wraps at ~80 characters.
 */
const CHARS_PER_ESTIMATED_LINE = 80

/** Number of lines shown in the collapsed preview. */
export const PREVIEW_LINES = 3

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CollapseDecision {
	shouldCollapse: boolean
	reason: "code-block" | "terminal-output" | "stack-trace" | "log-output" | "line-count" | null
	lineCount: number
}

// ─── Detection Functions ────────────────────────────────────────────────────

/**
 * Parses markdown fenced code blocks (triple backtick) and returns the line
 * count of the largest one, or null if no fenced code block is found.
 */
export function findLargestCodeBlock(text: string): { lineCount: number } | null {
	const fenceRegex = /^```/gm
	let insideBlock = false
	let blockStart = -1
	let largest: { lineCount: number } | null = null

	const lines = text.split("\n")
	for (let i = 0; i < lines.length; i++) {
		if (fenceRegex.test(lines[i])) {
			if (!insideBlock) {
				insideBlock = true
				blockStart = i
			} else {
				insideBlock = false
				const lineCount = i - blockStart + 1
				if (!largest || lineCount > largest.lineCount) {
					largest = { lineCount }
				}
			}
			// Reset lastIndex for the regex since we reuse it
			fenceRegex.lastIndex = 0
		}
	}
	return largest
}

/**
 * Checks whether the text matches terminal/shell output patterns.
 * Requires at least 3 matching pattern lines to avoid false positives.
 */
export function isTerminalOutput(text: string): boolean {
	const lines = text.split("\n")
	let matchCount = 0

	for (const line of lines) {
		// Shell prompts
		if (/^\s*[$>#]\s/.test(line)) {
			matchCount++
		}
		// ANSI escape sequences
		// eslint-disable-next-line no-control-regex
		else if (/\x1b\[[0-9;]*m/.test(line)) {
			matchCount++
		}
		// Common terminal output patterns (file listings, git, npm)
		else if (
			/^(?:total \d|drwx|-rw|d--)/.test(line) || // ls -la
			/^\s*\d+ files? changed/.test(line) || // git diff summary
			/^changed \d+ files?/.test(line) || // git diff alt
			/^(?:commit|Author|Date|Merge):\s/.test(line) || // git log
			/^(?:npm|yarn|pnpm)\s/.test(line) || // package manager
			/^added \d+ packages?/.test(line) // npm install
		) {
			matchCount++
		}

		if (matchCount >= 3) return true
	}
	return false
}

/**
 * Checks whether the text matches stack trace patterns.
 * Requires at least 2 matching pattern lines.
 */
export function isStackTrace(text: string): boolean {
	const lines = text.split("\n")
	let matchCount = 0

	for (const line of lines) {
		// JavaScript/TypeScript stack traces
		if (/\bat\s+.+\s+\(.+:\d+:\d+\)/.test(line)) {
			matchCount++
		}
		// JS error headers
		else if (
			/^(?:Error|TypeError|ReferenceError|SyntaxError|RangeError|URIError|EvalError|AggregateError):/.test(line)
		) {
			matchCount++
		}
		// Python traceback
		else if (/^Traceback \(most recent call last\):/.test(line)) {
			matchCount++
		}
		// Python traceback frames
		else if (/^\s+File ".+", line \d+/.test(line)) {
			matchCount++
		}
		// Java stack traces
		else if (/^(?:Exception in thread|Caused by:)/.test(line)) {
			matchCount++
		} else if (/^\s+at\s+[\w.$]+\([\w.]+:\d+\)/.test(line)) {
			matchCount++
		}

		if (matchCount >= 2) return true
	}
	return false
}

/**
 * Checks whether the text matches structured log output patterns.
 * Requires at least 5 matching pattern lines to distinguish from inline log references.
 */
export function isLogOutput(text: string): boolean {
	const lines = text.split("\n")
	let matchCount = 0

	for (const line of lines) {
		// Log level prefixes: [ERROR], [WARN], [INFO], [DEBUG]
		if (/^\s*\[(?:ERROR|WARN(?:ING)?|INFO|DEBUG|FATAL|TRACE)\]/i.test(line)) {
			matchCount++
		}
		// Log level with colon: ERROR:, WARN:, INFO:
		else if (/^(?:ERROR|WARN(?:ING)?|INFO|DEBUG|FATAL|TRACE):\s/i.test(line)) {
			matchCount++
		}
		// ISO timestamps: 2024-01-15T10:30:00
		else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(line)) {
			matchCount++
		}
		// Common log format: YYYY-MM-DD HH:MM:SS
		else if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/.test(line)) {
			matchCount++
		}
		// Syslog-style: Mon DD HH:MM:SS
		else if (/^[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}/.test(line)) {
			matchCount++
		}

		if (matchCount >= 5) return true
	}
	return false
}

// ─── Core Analysis ──────────────────────────────────────────────────────────

/**
 * Analyzes a message and returns a collapse decision.
 * The priority chain: code-block → terminal-output → stack-trace → log-output → line-count.
 */
export function analyzeMessage(message: ClineMessage, userThreshold: number): CollapseDecision {
	const text = message.text || ""
	const lines = text.split("\n")
	const lineCount = lines.length

	// Estimated visual line count: takes the larger of actual newline-separated
	// lines and a character-based estimate.  This handles pasted paragraphs that
	// have few newlines but wrap across many visual lines in the chat UI.
	const trimmedLength = text.trim().length
	const estimatedVisualLines = Math.max(lineCount, Math.ceil(trimmedLength / CHARS_PER_ESTIMATED_LINE))

	// Early exit: messages too small to collapse regardless of content type.
	// Both the actual line count AND the estimated visual size must be below
	// the minimum — a single-line 2 000-char paragraph should still be eligible.
	if (lineCount < MIN_LINES_TO_COLLAPSE && estimatedVisualLines < MIN_LINES_TO_COLLAPSE) {
		return { shouldCollapse: false, reason: null, lineCount }
	}

	// Priority 1: Large fenced code block
	const codeBlock = findLargestCodeBlock(text)
	if (codeBlock && codeBlock.lineCount > CODE_BLOCK_COLLAPSE_THRESHOLD) {
		return { shouldCollapse: true, reason: "code-block", lineCount }
	}

	// Priority 2: Terminal output
	if (isTerminalOutput(text) && lineCount > TERMINAL_OUTPUT_COLLAPSE_THRESHOLD) {
		return { shouldCollapse: true, reason: "terminal-output", lineCount }
	}

	// Priority 3: Stack trace
	if (isStackTrace(text) && lineCount > STACK_TRACE_COLLAPSE_THRESHOLD) {
		return { shouldCollapse: true, reason: "stack-trace", lineCount }
	}

	// Priority 4: Log output
	if (isLogOutput(text) && lineCount > LOG_OUTPUT_COLLAPSE_THRESHOLD) {
		return { shouldCollapse: true, reason: "log-output", lineCount }
	}

	// Priority 5: Plain-text fallback.
	// Uses estimatedVisualLines so that pasted text with few newlines but many
	// characters is still evaluated against the threshold.
	if (estimatedVisualLines >= userThreshold) {
		return { shouldCollapse: true, reason: "line-count", lineCount: estimatedVisualLines }
	}

	return { shouldCollapse: false, reason: null, lineCount }
}

// ─── Preview Helpers ────────────────────────────────────────────────────────

/**
 * Returns the first N lines of a message's text for the collapsed preview.
 */
export function getPreviewText(message: ClineMessage, maxLines: number = PREVIEW_LINES): string {
	const text = message.text || ""
	const lines = text.split("\n")
	return lines.slice(0, maxLines).join("\n")
}

/**
 * Returns the icon and label for a content type badge.
 */
export function getContentTypeBadge(reason: CollapseDecision["reason"]): { icon: string; label: string } {
	switch (reason) {
		case "code-block":
			return { icon: "code", label: "Code Block" }
		case "terminal-output":
			return { icon: "terminal", label: "Terminal Output" }
		case "stack-trace":
			return { icon: "alert-triangle", label: "Stack Trace" }
		case "log-output":
			return { icon: "list", label: "Log Output" }
		case "line-count":
			return { icon: "align-left", label: "Long Message" }
		default:
			return { icon: "align-left", label: "Long Message" }
	}
}

// ─── Never-Collapse Check ───────────────────────────────────────────────────

/**
 * Returns true if this message should NEVER be auto-collapsed.
 * Consolidates all blanket never-collapse rules:
 * - isLast (newest message)
 * - message.partial (streaming)
 * - message.type === "ask" (all ask messages need user interaction)
 * - message.say === "error" | "completion_result" | "checkpoint_saved"
 */
export function shouldNeverCollapse(message: ClineMessage, isLast: boolean): boolean {
	if (isLast) return true
	if (message.partial) return true
	// Allow "command" ask messages to be auto-collapsed — they contain terminal
	// output that can be very long. All other ask types remain protected.
	if (message.type === "ask" && message.ask !== "command") return true
	// Reasoning (Thinking) blocks have their own expand/collapse UI and should
	// never be replaced by the auto-collapse preview.
	if (message.say === "reasoning") return true
	if (message.say === "error") return true
	if (message.say === "completion_result") return true
	if (message.say === "checkpoint_saved") return true
	return false
}

/**
 * Returns true if this message was written by the user (as opposed to the assistant or system).
 * Used for per-type threshold selection: user messages collapse at a lower threshold than assistant messages.
 *
 * Current user-written message subtypes:
 * - "user_feedback" — free-text user messages (from chat input, askFollowupQuestion, attemptCompletion, etc.)
 * - "user_feedback_diff" — inline diff edits made by the user via DiffViewProvider
 *
 * If a new user-written message subtype is added in the future, add it here.
 * This single function is the source of truth for threshold selection in ChatView.
 */
export function isUserMessage(message: ClineMessage): boolean {
	return message.type === "say" && (message.say === "user_feedback" || message.say === "user_feedback_diff")
}
