import type { ClineMessage } from "@roo-code/types"

import {
	findLargestCodeBlock,
	isTerminalOutput,
	isStackTrace,
	isLogOutput,
	analyzeMessage,
	getPreviewText,
	getContentTypeBadge,
	shouldNeverCollapse,
	isUserMessage,
	PREVIEW_LINES,
} from "../messageSize"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSayMessage(text: string, overrides?: Partial<ClineMessage>): ClineMessage {
	return {
		type: "say",
		say: "text",
		ts: Date.now(),
		text,
		partial: false,
		...overrides,
	}
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function makeAskMessage(text: string, overrides?: Partial<ClineMessage>): ClineMessage {
	return {
		type: "ask",
		ask: "followup",
		ts: Date.now(),
		text,
		partial: false,
		...overrides,
	}
}

function repeatLines(line: string, count: number): string {
	return Array.from({ length: count }, () => line).join("\n")
}

// ─── findLargestCodeBlock ────────────────────────────────────────────────────

describe("findLargestCodeBlock", () => {
	it("returns null for text with no code blocks", () => {
		expect(findLargestCodeBlock("hello world")).toBeNull()
	})

	it("returns null for unclosed code block", () => {
		expect(findLargestCodeBlock("```typescript\nconst x = 1\n")).toBeNull()
	})

	it("finds a single code block", () => {
		const text = "Before\n```typescript\nline 1\nline 2\nline 3\n```\nAfter"
		const result = findLargestCodeBlock(text)
		expect(result).not.toBeNull()
		expect(result!.lineCount).toBe(5) // closing index(5) - opening index(1) + 1
	})

	it("returns the largest of multiple code blocks", () => {
		const text = [
			"```js",
			"small",
			"```",
			"```python",
			"line 1",
			"line 2",
			"line 3",
			"line 4",
			"line 5",
			"```",
		].join("\n")
		const result = findLargestCodeBlock(text)
		expect(result).not.toBeNull()
		expect(result!.lineCount).toBe(7) // fence + 5 lines + fence
	})

	it("handles code blocks with language tag on closing fence", () => {
		const text = ["```ts", "code here", "```"].join("\n")
		const result = findLargestCodeBlock(text)
		// Closing ``` is detected as opening fence (since insideBlock is true),
		// so lineCount = 2 - 0 + 1 = 3
		expect(result).not.toBeNull()
	})
})

// ─── isTerminalOutput ────────────────────────────────────────────────────────

describe("isTerminalOutput", () => {
	it("returns false for plain text", () => {
		expect(isTerminalOutput("hello world")).toBe(false)
	})

	it("returns false with fewer than 3 matching lines", () => {
		const text = "$ echo hello\n$ echo world"
		expect(isTerminalOutput(text)).toBe(false)
	})

	it("detects shell prompts ($, #, >)", () => {
		const text = repeatLines("$ command arg", 3)
		expect(isTerminalOutput(text)).toBe(true)
	})

	it("detects ANSI escape sequences", () => {
		const text = ["\x1b[31mred text\x1b[0m", "\x1b[32mgreen\x1b[0m", "\x1b[34mblue\x1b[0m"].join("\n")
		expect(isTerminalOutput(text)).toBe(true)
	})

	it("detects ls -la output", () => {
		const text = [
			"total 64",
			"drwxr-xr-x  5 user staff  160 Jan  1 00:00 .",
			"drwxr-xr-x 10 user staff  320 Jan  1 00:00 ..",
		].join("\n")
		expect(isTerminalOutput(text)).toBe(true)
	})

	it("detects git log patterns", () => {
		const text = ["Author: Name <email>", "Date:   Mon Jan 1", "Merge: abc123 def456"].join("\n")
		expect(isTerminalOutput(text)).toBe(true)
	})

	it("detects npm/pnpm/yarn commands", () => {
		const text = ["npm install react", "pnpm add vue", "yarn add angular"].join("\n")
		expect(isTerminalOutput(text)).toBe(true)
	})

	it("detects mixed terminal patterns", () => {
		const text = ["$ ls -la", "total 64", "changed 5 files, 100 insertions(+)"].join("\n")
		expect(isTerminalOutput(text)).toBe(true)
	})
})

// ─── isStackTrace ────────────────────────────────────────────────────────────

describe("isStackTrace", () => {
	it("returns false for plain text", () => {
		expect(isStackTrace("hello world")).toBe(false)
	})

	it("returns false with fewer than 2 matching lines", () => {
		expect(isStackTrace("Error: something went wrong")).toBe(false)
	})

	it("detects JavaScript error + stack trace", () => {
		const text = [
			"TypeError: Cannot read properties of undefined",
			"    at Object.render (src/App.tsx:42:15)",
		].join("\n")
		expect(isStackTrace(text)).toBe(true)
	})

	it("detects Python traceback", () => {
		const text = ["Traceback (most recent call last):", '  File "app.py", line 10, in main'].join("\n")
		expect(isStackTrace(text)).toBe(true)
	})

	it("detects Java stack trace", () => {
		const text = [
			"Exception in thread main java.lang.NullPointerException",
			"	at com.example.App.main(App.java:10)",
		].join("\n")
		expect(isStackTrace(text)).toBe(true)
	})

	it("detects multiple error types", () => {
		const text = ["ReferenceError: x is not defined", "RangeError: Maximum call stack size exceeded"].join("\n")
		expect(isStackTrace(text)).toBe(true)
	})
})

// ─── isLogOutput ─────────────────────────────────────────────────────────────

describe("isLogOutput", () => {
	it("returns false for plain text", () => {
		expect(isLogOutput("hello world")).toBe(false)
	})

	it("returns false with fewer than 5 matching lines", () => {
		const text = repeatLines("[INFO] Application started", 4)
		expect(isLogOutput(text)).toBe(false)
	})

	it("detects bracketed log levels", () => {
		const text = repeatLines("[INFO] Application started", 5)
		expect(isLogOutput(text)).toBe(true)
	})

	it("detects colon-prefixed log levels", () => {
		const text = repeatLines("INFO: Starting process", 5)
		expect(isLogOutput(text)).toBe(true)
	})

	it("detects ISO timestamps", () => {
		const text = repeatLines("2024-01-15T10:30:00Z Application started", 5)
		expect(isLogOutput(text)).toBe(true)
	})

	it("detects date-time log format", () => {
		const text = repeatLines("2024-01-15 10:30:00 Starting service", 5)
		expect(isLogOutput(text)).toBe(true)
	})

	it("detects syslog format", () => {
		const text = repeatLines("Jan 15 10:30:00 hostname service[1234]: message", 5)
		expect(isLogOutput(text)).toBe(true)
	})

	it("detects mixed log patterns", () => {
		const lines = [
			"[INFO] Starting",
			"[WARN] Low memory",
			"ERROR: Disk full",
			"2024-01-15T10:30:00Z Recovery started",
			"[DEBUG] Cleanup complete",
		]
		expect(isLogOutput(lines.join("\n"))).toBe(true)
	})
})

// ─── analyzeMessage ──────────────────────────────────────────────────────────

describe("analyzeMessage", () => {
	const defaultThreshold = 30

	it("returns shouldCollapse=false for short messages (< 5 lines)", () => {
		const msg = makeSayMessage("line 1\nline 2\nline 3")
		const result = analyzeMessage(msg, defaultThreshold)
		expect(result.shouldCollapse).toBe(false)
		expect(result.reason).toBeNull()
	})

	it("returns shouldCollapse=false for messages under threshold with no special content", () => {
		const msg = makeSayMessage(repeatLines("plain text line", 20))
		const result = analyzeMessage(msg, defaultThreshold)
		expect(result.shouldCollapse).toBe(false)
	})

	it("collapses messages with large code blocks (priority 1)", () => {
		const codeBlock = ["```typescript", ...repeatLines("const x = 1", 20).split("\n"), "```"].join("\n")
		const msg = makeSayMessage("Here is code:\n" + codeBlock + "\nEnd of code.")
		const result = analyzeMessage(msg, defaultThreshold)
		expect(result.shouldCollapse).toBe(true)
		expect(result.reason).toBe("code-block")
	})

	it("collapses terminal output (priority 2)", () => {
		const text = repeatLines("$ npm install react", 20)
		const msg = makeSayMessage(text)
		const result = analyzeMessage(msg, defaultThreshold)
		expect(result.shouldCollapse).toBe(true)
		expect(result.reason).toBe("terminal-output")
	})

	it("collapses stack traces (priority 3)", () => {
		const text = [
			"TypeError: Cannot read properties of undefined",
			...Array.from({ length: 20 }, (_, i) => `    at Function.${i} (src/file${i}.ts:${i}:1)`),
		].join("\n")
		const msg = makeSayMessage(text)
		const result = analyzeMessage(msg, defaultThreshold)
		expect(result.shouldCollapse).toBe(true)
		expect(result.reason).toBe("stack-trace")
	})

	it("collapses log output (priority 4)", () => {
		const text = repeatLines("[INFO] 2024-01-15T10:30:00Z Application started", 20)
		const msg = makeSayMessage(text)
		const result = analyzeMessage(msg, defaultThreshold)
		expect(result.shouldCollapse).toBe(true)
		expect(result.reason).toBe("log-output")
	})

	it("collapses long plain text at user threshold (priority 5)", () => {
		const text = repeatLines("Just a plain text line", 35)
		const msg = makeSayMessage(text)
		const result = analyzeMessage(msg, 30)
		expect(result.shouldCollapse).toBe(true)
		expect(result.reason).toBe("line-count")
	})

	it("respects custom user threshold for line-count fallback", () => {
		const text = repeatLines("line", 10)
		const msg = makeSayMessage(text)
		// Threshold 8 should trigger collapse
		expect(analyzeMessage(msg, 8).shouldCollapse).toBe(true)
		// Threshold 15 should not
		expect(analyzeMessage(msg, 15).shouldCollapse).toBe(false)
	})

	it("handles messages with empty text", () => {
		const msg = makeSayMessage("")
		const result = analyzeMessage(msg, defaultThreshold)
		expect(result.shouldCollapse).toBe(false)
		expect(result.lineCount).toBe(1) // "".split("\n") = [""]
	})

	it("handles messages with undefined text", () => {
		const msg: ClineMessage = { type: "say", say: "text", ts: Date.now(), partial: false }
		const result = analyzeMessage(msg, defaultThreshold)
		expect(result.shouldCollapse).toBe(false)
	})

	it("reports correct lineCount", () => {
		const msg = makeSayMessage("a\nb\nc\nd\ne")
		const result = analyzeMessage(msg, defaultThreshold)
		expect(result.lineCount).toBe(5)
	})

	// ── Character-based collapse (Bug 1 fix) ──────────────────────────────

	it("collapses a single-line pasted paragraph exceeding threshold by character count", () => {
		// 30 * 80 = 2400 chars → estimatedVisualLines = 30 → 30 >= 30 threshold
		const msg = makeSayMessage("A".repeat(2400))
		const result = analyzeMessage(msg, 30)
		expect(result.shouldCollapse).toBe(true)
		expect(result.reason).toBe("line-count")
		// lineCount should reflect the estimated visual lines, not the literal 1
		expect(result.lineCount).toBe(30)
	})

	it("does NOT collapse a single-line message below both line and character thresholds", () => {
		// 200 chars → estimatedVisualLines = max(1, ceil(200/80)) = 3 → 3 < 30
		const msg = makeSayMessage("Short single line with some text.")
		const result = analyzeMessage(msg, 30)
		expect(result.shouldCollapse).toBe(false)
	})

	it("collapses a few-line message with long lines exceeding threshold via character estimate", () => {
		// 3 lines, each 800 chars → total 2402 chars (including 2 newlines) → estimatedVisualLines = max(3, ceil(2402/80)) = max(3, 31) = 31
		const longLine = "X".repeat(800)
		const msg = makeSayMessage([longLine, longLine, longLine].join("\n"))
		const result = analyzeMessage(msg, 30)
		expect(result.shouldCollapse).toBe(true)
		expect(result.reason).toBe("line-count")
		expect(result.lineCount).toBe(31)
	})

	it("respects user threshold for character-based collapse", () => {
		// 800 chars → estimatedVisualLines = ceil(800/80) = 10
		const msg = makeSayMessage("B".repeat(800))
		// Threshold 10: 10 >= 10 → collapse
		expect(analyzeMessage(msg, 10).shouldCollapse).toBe(true)
		// Threshold 15: 10 < 15 → no collapse
		expect(analyzeMessage(msg, 15).shouldCollapse).toBe(false)
	})

	it("does NOT collapse a very short message even with character estimation", () => {
		// 100 chars → estimatedVisualLines = max(1, ceil(100/80)) = 2 → 2 < MIN_LINES_TO_COLLAPSE (5)
		const msg = makeSayMessage("C".repeat(100))
		const result = analyzeMessage(msg, 30)
		expect(result.shouldCollapse).toBe(false)
	})

	it("code-block detection still takes priority over character-based fallback", () => {
		// Large code block in a short message should collapse via code-block, not line-count
		const codeBlock = ["```typescript", ...Array.from({ length: 20 }, (_, i) => `const x${i} = ${i}`), "```"].join(
			"\n",
		)
		const msg = makeSayMessage(codeBlock)
		const result = analyzeMessage(msg, 500) // very high threshold
		expect(result.shouldCollapse).toBe(true)
		expect(result.reason).toBe("code-block")
	})
})

// ─── getPreviewText ──────────────────────────────────────────────────────────

describe("getPreviewText", () => {
	it("returns first N lines of message text", () => {
		const msg = makeSayMessage("line1\nline2\nline3\nline4\nline5")
		expect(getPreviewText(msg, 3)).toBe("line1\nline2\nline3")
	})

	it("returns all text if fewer lines than maxLines", () => {
		const msg = makeSayMessage("line1\nline2")
		expect(getPreviewText(msg, 3)).toBe("line1\nline2")
	})

	it("returns empty string for empty message", () => {
		const msg = makeSayMessage("")
		expect(getPreviewText(msg)).toBe("")
	})

	it("handles undefined text", () => {
		const msg: ClineMessage = { type: "say", say: "text", ts: Date.now(), partial: false }
		expect(getPreviewText(msg)).toBe("")
	})

	it("uses PREVIEW_LINES as default", () => {
		const lines = Array.from({ length: 10 }, (_, i) => `line${i}`)
		const msg = makeSayMessage(lines.join("\n"))
		const result = getPreviewText(msg)
		const resultLines = result.split("\n")
		expect(resultLines.length).toBe(PREVIEW_LINES)
	})
})

// ─── getContentTypeBadge ─────────────────────────────────────────────────────

describe("getContentTypeBadge", () => {
	it("returns code icon for code-block", () => {
		const badge = getContentTypeBadge("code-block")
		expect(badge.icon).toBe("code")
		expect(badge.label).toBe("Code Block")
	})

	it("returns terminal icon for terminal-output", () => {
		const badge = getContentTypeBadge("terminal-output")
		expect(badge.icon).toBe("terminal")
		expect(badge.label).toBe("Terminal Output")
	})

	it("returns alert-triangle icon for stack-trace", () => {
		const badge = getContentTypeBadge("stack-trace")
		expect(badge.icon).toBe("alert-triangle")
		expect(badge.label).toBe("Stack Trace")
	})

	it("returns list icon for log-output", () => {
		const badge = getContentTypeBadge("log-output")
		expect(badge.icon).toBe("list")
		expect(badge.label).toBe("Log Output")
	})

	it("returns align-left icon for line-count", () => {
		const badge = getContentTypeBadge("line-count")
		expect(badge.icon).toBe("align-left")
		expect(badge.label).toBe("Long Message")
	})

	it("returns align-left icon for null reason", () => {
		const badge = getContentTypeBadge(null)
		expect(badge.icon).toBe("align-left")
		expect(badge.label).toBe("Long Message")
	})
})

// ─── shouldNeverCollapse ─────────────────────────────────────────────────────

describe("shouldNeverCollapse", () => {
	const baseMessage: ClineMessage = {
		type: "say",
		say: "text",
		ts: Date.now(),
		text: "content",
		partial: false,
	}

	it("returns true for isLast", () => {
		expect(shouldNeverCollapse(baseMessage, true)).toBe(true)
	})

	it("returns true for partial (streaming) messages", () => {
		const msg = { ...baseMessage, partial: true }
		expect(shouldNeverCollapse(msg, false)).toBe(true)
	})

	it("returns true for non-command ask messages", () => {
		const askMsg: ClineMessage = {
			type: "ask",
			ask: "followup",
			ts: Date.now(),
			text: "content",
			partial: false,
		}
		expect(shouldNeverCollapse(askMsg, false)).toBe(true)
	})

	it("returns false for command ask messages (allow auto-collapse)", () => {
		const commandMsg: ClineMessage = {
			type: "ask",
			ask: "command",
			ts: Date.now(),
			text: "$ ls -la\ntotal 0\ndrwxr-xr-x  1 user  staff  0 Jan  1 00:00 .\ndrwxr-xr-x  1 user  staff  0 Jan  1 00:00 ..",
			partial: false,
		}
		expect(shouldNeverCollapse(commandMsg, false)).toBe(false)
	})

	it("returns true for command ask messages that are last", () => {
		const commandMsg: ClineMessage = {
			type: "ask",
			ask: "command",
			ts: Date.now(),
			text: "content",
			partial: false,
		}
		expect(shouldNeverCollapse(commandMsg, true)).toBe(true)
	})

	it("returns true for error messages", () => {
		const msg = { ...baseMessage, say: "error" as const }
		expect(shouldNeverCollapse(msg, false)).toBe(true)
	})

	it("returns true for completion_result messages", () => {
		const msg = { ...baseMessage, say: "completion_result" as const }
		expect(shouldNeverCollapse(msg, false)).toBe(true)
	})

	it("returns true for checkpoint_saved messages", () => {
		const msg = { ...baseMessage, say: "checkpoint_saved" as const }
		expect(shouldNeverCollapse(msg, false)).toBe(true)
	})

	it("returns false for normal say messages that are not last", () => {
		expect(shouldNeverCollapse(baseMessage, false)).toBe(false)
	})

	it("returns true for reasoning messages (Thinking blocks have their own UI)", () => {
		const msg = { ...baseMessage, say: "reasoning" as const }
		expect(shouldNeverCollapse(msg, false)).toBe(true)
	})

	it("returns false for text messages", () => {
		const msg = { ...baseMessage, say: "text" as const }
		expect(shouldNeverCollapse(msg, false)).toBe(false)
	})

	it("combines conditions with OR (isLast takes precedence)", () => {
		const msg: ClineMessage = {
			type: "ask",
			ask: "tool",
			ts: Date.now(),
			text: "content",
			partial: true,
		}
		// Even though all three conditions are true, should still return true
		expect(shouldNeverCollapse(msg, true)).toBe(true)
	})
})

describe("isUserMessage", () => {
	const baseSay: ClineMessage = {
		type: "say",
		say: "text",
		ts: Date.now(),
		text: "content",
		partial: false,
	}

	it("returns true for user_feedback messages", () => {
		const msg = { ...baseSay, say: "user_feedback" as const }
		expect(isUserMessage(msg)).toBe(true)
	})

	it("returns true for user_feedback_diff messages", () => {
		const msg = { ...baseSay, say: "user_feedback_diff" as const }
		expect(isUserMessage(msg)).toBe(true)
	})

	it("returns false for text messages (assistant)", () => {
		expect(isUserMessage(baseSay)).toBe(false)
	})

	it("returns false for ask messages even with user_feedback subtype", () => {
		const msg: ClineMessage = {
			type: "ask",
			ask: "followup",
			ts: Date.now(),
			text: "content",
			partial: false,
		}
		expect(isUserMessage(msg)).toBe(false)
	})

	it("returns false for error messages", () => {
		const msg = { ...baseSay, say: "error" as const }
		expect(isUserMessage(msg)).toBe(false)
	})

	it("returns false for reasoning messages", () => {
		const msg = { ...baseSay, say: "reasoning" as const }
		expect(isUserMessage(msg)).toBe(false)
	})

	it("returns false for completion_result messages", () => {
		const msg = { ...baseSay, say: "completion_result" as const }
		expect(isUserMessage(msg)).toBe(false)
	})

	it("returns false for tool say messages", () => {
		const msg = { ...baseSay, say: "tool" as any }
		expect(isUserMessage(msg)).toBe(false)
	})
})
