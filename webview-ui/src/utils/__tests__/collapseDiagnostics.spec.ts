/**
 * Diagnostic test suite: traces realistic messages through the entire
 * collapse pipeline to identify why auto-collapse is inconsistent.
 *
 * Run: npx vitest run src/utils/__tests__/collapseDiagnostics.spec.ts
 */
import type { ClineMessage } from "@roo-code/types"

import { analyzeMessage, isUserMessage, shouldNeverCollapse } from "../messageSize"

// ─── Realistic Message Fixtures ─────────────────────────────────────────────

/** Short user message (typical question) */
const SHORT_USER: ClineMessage = {
	type: "say",
	say: "user_feedback",
	ts: 1000,
	text: "Can you help me fix this bug?",
	partial: false,
}

/** Medium user message (15 lines — detailed question) */
const MEDIUM_USER: ClineMessage = {
	type: "say",
	say: "user_feedback",
	ts: 1001,
	text: Array.from(
		{ length: 15 },
		(_, i) => `User line ${i + 1}: This is a detailed description of the issue I'm seeing with the auth flow.`,
	).join("\n"),
	partial: false,
}

/** Long user message (35 lines — pasted error + context) */
const LONG_USER: ClineMessage = {
	type: "say",
	say: "user_feedback",
	ts: 1002,
	text: Array.from(
		{ length: 35 },
		(_, i) => `User line ${i + 1}: Context about the problem including pasted stack traces and configuration.`,
	).join("\n"),
	partial: false,
}

/** Short assistant text (typical quick response) */
const SHORT_ASSISTANT: ClineMessage = {
	type: "say",
	say: "text",
	ts: 2000,
	text: "Sure! I'll fix that for you. Let me update the function.",
	partial: false,
}

/** Medium assistant text (20 lines — explanation with code snippets) */
const MEDIUM_ASSISTANT: ClineMessage = {
	type: "say",
	say: "text",
	ts: 2001,
	text: Array.from(
		{ length: 20 },
		(_, i) => `Assistant line ${i + 1}: Here is a detailed explanation of the changes I'm making to the codebase.`,
	).join("\n"),
	partial: false,
}

/** Long assistant text (40 lines — detailed response) */
const LONG_ASSISTANT: ClineMessage = {
	type: "say",
	say: "text",
	ts: 2002,
	text: Array.from(
		{ length: 40 },
		(_, i) =>
			`Assistant line ${i + 1}: Detailed explanation covering multiple aspects of the implementation approach.`,
	).join("\n"),
	partial: false,
}

/** Very long assistant text (100 lines) */
const VERY_LONG_ASSISTANT: ClineMessage = {
	type: "say",
	say: "text",
	ts: 2003,
	text: Array.from(
		{ length: 100 },
		(_, i) => `Assistant line ${i + 1}: In-depth analysis of the system architecture and recommended changes.`,
	).join("\n"),
	partial: false,
}

/** Assistant text with a large code block (25 lines of code in a 35-line message) */
const ASSISTANT_WITH_CODE: ClineMessage = {
	type: "say",
	say: "text",
	ts: 2004,
	text: [
		"Here's the implementation:",
		"",
		"```typescript",
		...Array.from({ length: 25 }, (_, i) => `function line${i}() { return ${i} }`),
		"```",
		"",
		"Let me know if you have questions.",
	].join("\n"),
	partial: false,
}

/** Assistant text with a small code block (8 lines of code) */
const ASSISTANT_WITH_SMALL_CODE: ClineMessage = {
	type: "say",
	say: "text",
	ts: 2005,
	text: [
		"Here's a quick fix:",
		"",
		"```typescript",
		...Array.from({ length: 8 }, (_, i) => `const x${i} = ${i}`),
		"```",
		"",
		"That should do it!",
	].join("\n"),
	partial: false,
}

/** Terminal output (15 lines) */
const TERMINAL_OUTPUT: ClineMessage = {
	type: "say",
	say: "text",
	ts: 2006,
	text: [
		"$ npm install",
		"added 120 packages in 5s",
		"$ pnpm build",
		"$ turbo run build",
		"  4 tasks complete",
		"  0 tasks failed",
		"$ ls -la",
		"total 48",
		"drwxr-xr-x  5 user staff  160 Jan  1 10:00 .",
		"drwxr-xr-x  3 user staff   96 Jan  1 09:00 ..",
		"-rw-r--r--  1 user staff 1234 Jan  1 10:00 package.json",
		"-rw-r--r--  1 user staff 5678 Jan  1 10:00 index.ts",
		"$ git log --oneline",
		"abc1234 feat: add new feature",
		"def5678 fix: resolve bug",
	].join("\n"),
	partial: false,
}

/** Stack trace (12 lines) */
const STACK_TRACE: ClineMessage = {
	type: "say",
	say: "text",
	ts: 2007,
	text: [
		"Error: Cannot read property 'foo' of undefined",
		"    at processInput (src/main.ts:42:15)",
		"    at handleRequest (src/server.ts:108:20)",
		"    at async Module.run (src/index.ts:5:5)",
		"Error: Cannot read property 'bar' of null",
		"    at validate (src/utils.ts:22:10)",
		"    at check (src/validator.ts:55:30)",
		"    at async Module.init (src/app.ts:12:5)",
		"Traceback (most recent call last):",
		'  File "app.py", line 10, in <module>',
		"    main()",
		'  File "app.py", line 5, in main',
	].join("\n"),
	partial: false,
}

/** Ask followup message (should be blocked by shouldNeverCollapse) */
const ASK_FOLLOWUP: ClineMessage = {
	type: "ask",
	ask: "followup",
	ts: 3000,
	text: Array.from({ length: 40 }, (_, i) => `Followup line ${i + 1}: What approach should I take?`).join("\n"),
	partial: false,
}

/** Ask tool message (should be blocked by shouldNeverCollapse) */
const ASK_TOOL: ClineMessage = {
	type: "ask",
	ask: "tool",
	ts: 3001,
	text: JSON.stringify({
		tool: "readFile",
		path: "src/index.ts",
		content: Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n"),
	}),
	partial: false,
}

/** Ask completion_result (should be blocked by shouldNeverCollapse) */
const ASK_COMPLETION: ClineMessage = {
	type: "ask",
	ask: "completion_result",
	ts: 3002,
	text: Array.from(
		{ length: 40 },
		(_, i) => `Completion line ${i + 1}: Task finished successfully with detailed output.`,
	).join("\n"),
	partial: false,
}

/** Ask command (NOW eligible for auto-collapse — terminal output detection applies) */
const ASK_COMMAND: ClineMessage = {
	type: "ask",
	ask: "command",
	ts: 3003,
	text: Array.from({ length: 40 }, (_, i) => `Command line ${i + 1}: npm install some-package`).join("\n"),
	partial: false,
}

/** Partial (streaming) message */
const STREAMING_MESSAGE: ClineMessage = {
	type: "say",
	say: "text",
	ts: 4000,
	text: Array.from({ length: 50 }, (_, i) => `Streaming line ${i + 1}: Currently being typed...`).join("\n"),
	partial: true,
}

/** Error message */
const ERROR_MESSAGE: ClineMessage = {
	type: "say",
	say: "error",
	ts: 5000,
	text: Array.from({ length: 40 }, (_, i) => `Error detail ${i + 1}: Something went wrong.`).join("\n"),
	partial: false,
}

/** Completion result say message */
const SAY_COMPLETION: ClineMessage = {
	type: "say",
	say: "completion_result",
	ts: 5001,
	text: Array.from({ length: 40 }, (_, i) => `Completion line ${i + 1}: Here is the result.`).join("\n"),
	partial: false,
}

/** Checkpoint saved message */
const CHECKPOINT: ClineMessage = {
	type: "say",
	say: "checkpoint_saved",
	ts: 5002,
	text: "abc123hash",
	partial: false,
}

/** Reasoning message */
const REASONING: ClineMessage = {
	type: "say",
	say: "reasoning",
	ts: 6000,
	text: Array.from({ length: 40 }, (_, i) => `Thinking step ${i + 1}: Let me analyze this...`).join("\n"),
	partial: false,
}

/** Pasted user text (single line, 2000 chars — simulates a copy-pasted paragraph) */
const PASTED_USER: ClineMessage = {
	type: "say",
	say: "user_feedback",
	ts: 1003,
	text:
		"Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. " +
		"Additional context about the problem: I have a React application with a complex state management setup using Redux and React Query. The issue occurs when multiple components try to update the same piece of state simultaneously, causing race conditions and stale state bugs. I've tried using useCallback and useMemo but the problem persists. The error manifests as a white screen with no console errors, making it particularly difficult to debug. Here are the specific symptoms: 1) The app works fine on initial load, 2) After navigating between pages 3-4 times, the state becomes inconsistent, 3) API calls return correct data but the UI shows outdated information, 4) The issue is more pronounced on slower connections.",
	partial: false,
}

/** Pasted assistant code review (single line, ~1700 chars — must be >= 1600 so estimatedVisualLines >= 20) */
const PASTED_ASSISTANT: ClineMessage = {
	type: "say",
	say: "text",
	ts: 2008,
	text: "I've analyzed your codebase and here are my findings: The root cause of the race condition is in the useDataManager hook where multiple async operations share the same AbortController instance. When component A initiates a fetch and component B initiates another fetch before A completes, the AbortController from A gets reused, causing B's request to be aborted prematurely. The fix involves creating a separate AbortController per request using a ref-based registry. Additionally, the Redux middleware is missing proper error boundaries for async thunks, which means failed requests don't clean up their loading states. I recommend implementing a request deduplication layer using a Map keyed by URL+params, with automatic cleanup via WeakRef. For the stale UI issue, the React Query cache invalidation strategy needs to be updated to use optimistic updates with rollback on failure. Here's the implementation plan: Step 1) Refactor useDataManager to use per-request AbortController, Step 2) Add error boundaries to Redux async middleware, Step 3) Implement request deduplication with TTL-based eviction and LRU cache for hot entries, Step 4) Update React Query configuration for proper cache invalidation, Step 5) Add comprehensive unit tests covering concurrent request scenarios and edge cases with network timeouts. Furthermore, you should also investigate the middleware pipeline for potential ordering issues and ensure that all async thunks have proper cleanup handlers attached to prevent resource leaks. Consider adding a custom hook useAbortControllerRegistry that abstracts the creation and teardown lifecycle of per-request controllers.",
	partial: false,
}

// ─── Diagnostic Test Suite ──────────────────────────────────────────────────

const USER_THRESHOLD = 10 // new default for user messages
const ASSISTANT_THRESHOLD = 20 // 2× user threshold for assistant messages

interface DiagnosticResult {
	label: string
	messageType: string
	subtype: string
	lineCount: number
	isLast: boolean
	isPartial: boolean
	shouldNeverCollapseResult: boolean
	neverCollapseReason: string
	analyzeMessageCalled: boolean
	shouldCollapse: boolean | null
	collapseReason: string | null
	finalExpanded: boolean
	finalRenderedAs: string
}

function diagnoseMessage(label: string, msg: ClineMessage, isLast: boolean, threshold?: number): DiagnosticResult {
	// Per-type thresholds matching ChatView behavior (user=10, assistant=20)
	// isUserMessage() checks for all user-written subtypes (user_feedback, user_feedback_diff).
	const effectiveThreshold = threshold ?? (isUserMessage(msg) ? USER_THRESHOLD : ASSISTANT_THRESHOLD)
	const lines = (msg.text || "").split("\n")
	const lineCount = lines.length

	// Step 1: shouldNeverCollapse
	const neverCollapse = shouldNeverCollapse(msg, isLast)
	let neverCollapseReason = "none"
	if (isLast) neverCollapseReason = "isLast"
	else if (msg.partial) neverCollapseReason = "partial"
	else if (msg.type === "ask" && msg.ask !== "command") neverCollapseReason = "type=ask"
	else if (msg.say === "reasoning") neverCollapseReason = "say=reasoning"
	else if (msg.say === "error") neverCollapseReason = "say=error"
	else if (msg.say === "completion_result") neverCollapseReason = "say=completion_result"
	else if (msg.say === "checkpoint_saved") neverCollapseReason = "say=checkpoint_saved"

	// Step 2: analyzeMessage (only if not blocked by shouldNeverCollapse)
	let shouldCollapse: boolean | null = null
	let collapseReason: string | null = null
	let analyzeMessageCalled = false
	// Use analyzeMessage's returned lineCount for display — it may differ from
	// the raw newline count for character-based (estimated visual lines) collapses.
	let displayLineCount = lineCount

	if (!neverCollapse) {
		analyzeMessageCalled = true
		const decision = analyzeMessage(msg, effectiveThreshold)
		shouldCollapse = decision.shouldCollapse
		collapseReason = decision.reason
		displayLineCount = decision.lineCount
	}

	// Step 3: Simulate ChatView logic
	const expandedRows: Record<number, boolean> = {}
	const autoCollapseEnabled = true

	let finalExpanded = true
	let finalRenderedAs = "full"

	if (neverCollapse) {
		finalExpanded = true
		finalRenderedAs = "full (blocked by shouldNeverCollapse)"
	} else if (!autoCollapseEnabled) {
		finalExpanded = true
		finalRenderedAs = "full (feature disabled)"
	} else if (expandedRows[msg.ts] !== undefined) {
		finalExpanded = expandedRows[msg.ts]
		finalRenderedAs = finalExpanded ? "full (user override: expanded)" : "BUG: collapsed but no collapseDecision"
	} else if (shouldCollapse === true) {
		finalExpanded = false
		finalRenderedAs = "MessageCollapsePreview"
	} else {
		finalExpanded = true
		finalRenderedAs = "full (below threshold)"
	}

	return {
		label,
		messageType: msg.type,
		subtype: msg.type === "ask" ? msg.ask || "none" : msg.say || "none",
		lineCount: displayLineCount,
		isLast,
		isPartial: !!msg.partial,
		shouldNeverCollapseResult: neverCollapse,
		neverCollapseReason,
		analyzeMessageCalled,
		shouldCollapse,
		collapseReason,
		finalExpanded,
		finalRenderedAs,
	}
}

describe("Collapse Pipeline Diagnostics", () => {
	// ─── Diagnostic table: log everything ────────────────────────────────────

	it("diagnostic table: all message scenarios (NOT last message)", () => {
		const scenarios: [string, ClineMessage][] = [
			["Short user", SHORT_USER],
			["Medium user (15 lines)", MEDIUM_USER],
			["Long user (35 lines)", LONG_USER],
			["Short assistant", SHORT_ASSISTANT],
			["Medium assistant (20 lines)", MEDIUM_ASSISTANT],
			["Long assistant (40 lines)", LONG_ASSISTANT],
			["Very long assistant (100 lines)", VERY_LONG_ASSISTANT],
			["Assistant w/ code block (25-line code)", ASSISTANT_WITH_CODE],
			["Assistant w/ small code (8-line code)", ASSISTANT_WITH_SMALL_CODE],
			["Terminal output (15 lines)", TERMINAL_OUTPUT],
			["Stack trace (12 lines)", STACK_TRACE],
			["Ask followup (40 lines)", ASK_FOLLOWUP],
			["Ask tool (40 lines)", ASK_TOOL],
			["Ask completion_result (40 lines)", ASK_COMPLETION],
			["Ask command (40 lines)", ASK_COMMAND],
			["Streaming message (50 lines)", STREAMING_MESSAGE],
			["Error message (40 lines)", ERROR_MESSAGE],
			["Say completion_result (40 lines)", SAY_COMPLETION],
			["Checkpoint saved", CHECKPOINT],
			["Reasoning (40 lines)", REASONING],
		]

		const results = scenarios.map(([label, msg]) => diagnoseMessage(label, msg, false))

		// Print diagnostic table
		console.log("\n" + "=".repeat(200))
		console.log("COLLAPSE PIPELINE DIAGNOSTIC TABLE (NOT last message, user_threshold=10, assistant_threshold=20)")
		console.log("=".repeat(200))
		console.log(
			[
				"Label".padEnd(35),
				"Type".padEnd(6),
				"Subtype".padEnd(20),
				"Lines".padEnd(6),
				"Partial".padEnd(8),
				"Never?".padEnd(6),
				"Reason".padEnd(30),
				"analyze?".padEnd(9),
				"Collapse?".padEnd(10),
				"ContentReason".padEnd(15),
				"Final State",
			].join(" | "),
		)
		console.log("-".repeat(200))

		for (const r of results) {
			console.log(
				[
					r.label.padEnd(35),
					r.messageType.padEnd(6),
					r.subtype.padEnd(20),
					String(r.lineCount).padEnd(6),
					String(r.isPartial).padEnd(8),
					String(r.shouldNeverCollapseResult).padEnd(6),
					r.neverCollapseReason.padEnd(30),
					String(r.analyzeMessageCalled).padEnd(9),
					String(r.shouldCollapse).padEnd(10),
					(r.collapseReason || "n/a").padEnd(15),
					r.finalRenderedAs,
				].join(" | "),
			)
		}
		console.log("=".repeat(200))

		// ─── Assertions: prove what works and what doesn't ────────────────────

		// User messages
		const shortUser = results.find((r) => r.label === "Short user")!
		const mediumUser = results.find((r) => r.label === "Medium user (15 lines)")!
		const longUser = results.find((r) => r.label === "Long user (35 lines)")!

		expect(shortUser.finalExpanded).toBe(true) // 1 line < 10 user threshold
		expect(mediumUser.finalExpanded).toBe(false) // 15 lines >= 10 user threshold → collapses
		expect(longUser.finalExpanded).toBe(false) // 35 >= 10 → should collapse

		// Assistant messages
		const shortAsst = results.find((r) => r.label === "Short assistant")!
		const mediumAsst = results.find((r) => r.label === "Medium assistant (20 lines)")!
		const longAsst = results.find((r) => r.label === "Long assistant (40 lines)")!
		const veryLongAsst = results.find((r) => r.label === "Very long assistant (100 lines)")!

		expect(shortAsst.finalExpanded).toBe(true) // 1 line < 20 assistant threshold
		expect(mediumAsst.finalExpanded).toBe(false) // 20 >= 20 assistant threshold → collapses
		expect(longAsst.finalExpanded).toBe(false) // 40 >= 20 → should collapse
		expect(veryLongAsst.finalExpanded).toBe(false) // 100 >= 20 → should collapse

		// Content-type specific
		const withCode = results.find((r) => r.label.includes("code block"))!
		const smallCode = results.find((r) => r.label.includes("small code"))!
		const terminal = results.find((r) => r.label === "Terminal output (15 lines)")!
		const stack = results.find((r) => r.label === "Stack trace (12 lines)")!

		// 25-line code block > 15 threshold → should collapse
		expect(withCode.finalExpanded).toBe(false)
		expect(withCode.collapseReason).toBe("code-block")

		// 8-line code block: code-block not triggered (15 total ≤ 15), 14 total lines < 20 assistant threshold → won't collapse
		expect(smallCode.finalExpanded).toBe(true)

		// Terminal: 15 lines > 10 threshold → should collapse
		expect(terminal.finalExpanded).toBe(false)
		expect(terminal.collapseReason).toBe("terminal-output")

		// Stack trace: 12 lines > 10 threshold → should collapse
		expect(stack.finalExpanded).toBe(false)
		expect(stack.collapseReason).toBe("stack-trace")

		// Ask messages — non-command blocked, command allowed through
		const askFollowup = results.find((r) => r.label === "Ask followup (40 lines)")!
		const askTool = results.find((r) => r.label === "Ask tool (40 lines)")!
		const askCompletion = results.find((r) => r.label === "Ask completion_result (40 lines)")!
		const askCommand = results.find((r) => r.label === "Ask command (40 lines)")!

		expect(askFollowup.finalExpanded).toBe(true) // blocked by shouldNeverCollapse
		expect(askFollowup.neverCollapseReason).toBe("type=ask")
		expect(askTool.finalExpanded).toBe(true) // blocked
		expect(askCompletion.finalExpanded).toBe(true) // blocked
		expect(askCommand.finalExpanded).toBe(false) // command ask — now eligible for auto-collapse
		expect(askCommand.collapseReason).toBe("line-count") // text doesn't match terminal patterns, falls through to line-count

		// Special say types
		const streaming = results.find((r) => r.label === "Streaming message (50 lines)")!
		const error = results.find((r) => r.label === "Error message (40 lines)")!
		const sayCompletion = results.find((r) => r.label === "Say completion_result (40 lines)")!
		const checkpoint = results.find((r) => r.label === "Checkpoint saved")!
		const reasoning = results.find((r) => r.label === "Reasoning (40 lines)")!

		expect(streaming.finalExpanded).toBe(true) // blocked by partial
		expect(error.finalExpanded).toBe(true) // blocked by say=error
		expect(sayCompletion.finalExpanded).toBe(true) // blocked by say=completion_result
		expect(checkpoint.finalExpanded).toBe(true) // blocked by say=checkpoint_saved
		expect(reasoning.finalExpanded).toBe(true) // blocked by shouldNeverCollapse (reasoning has its own UI)
	})

	it("diagnostic: isLast effect on same long messages", () => {
		// Same long message when it IS the last message
		const lastLongAssistant = diagnoseMessage("Long assistant AS LAST", LONG_ASSISTANT, true)
		const lastLongUser = diagnoseMessage("Long user AS LAST", LONG_USER, true)

		console.log("\nisLast effect:")
		console.log(`  Long assistant (40 lines) as LAST → ${lastLongAssistant.finalRenderedAs}`)
		console.log(`  Long user (35 lines) as LAST → ${lastLongUser.finalRenderedAs}`)

		// isLast prevents collapse
		expect(lastLongAssistant.finalExpanded).toBe(true)
		expect(lastLongAssistant.neverCollapseReason).toBe("isLast")
		expect(lastLongUser.finalExpanded).toBe(true)
		expect(lastLongUser.neverCollapseReason).toBe("isLast")
	})

	it("diagnostic: threshold boundary analysis for plain text", () => {
		// Test exact boundary values
		const results: { lines: number; shouldCollapse: boolean }[] = []
		for (let lines = 5; lines <= 50; lines++) {
			const msg: ClineMessage = {
				type: "say",
				say: "text",
				ts: 9000 + lines,
				text: Array.from({ length: lines }, (_, i) => `Line ${i + 1}`).join("\n"),
				partial: false,
			}
			const decision = analyzeMessage(msg, USER_THRESHOLD)
			results.push({ lines, shouldCollapse: decision.shouldCollapse })
		}

		console.log("\nThreshold boundary (plain text, user threshold=10):")
		for (const r of results) {
			const marker = r.shouldCollapse ? " ← COLLAPSES" : ""
			console.log(
				`  ${String(r.lines).padStart(3)} lines: ${r.shouldCollapse ? "COLLAPSE" : "expand  "}${marker}`,
			)
		}

		// Find exact boundary
		const boundary = results.find((r) => r.shouldCollapse)
		expect(boundary).toBeDefined()
		expect(boundary!.lines).toBe(10) // Exactly 10 is the user threshold boundary

		// 9 should NOT collapse
		expect(results.find((r) => r.lines === 9)!.shouldCollapse).toBe(false)
		// 10 SHOULD collapse
		expect(results.find((r) => r.lines === 10)!.shouldCollapse).toBe(true)
	})

	it("diagnostic: code block threshold boundary", () => {
		// Test code block detection at various sizes.
		// Use a high threshold (50) so the line-count fallback doesn't interfere,
		// isolating the code-block detection (internal threshold = 15 lines).
		const ISOLATION_THRESHOLD = 50
		const results: { codeLines: number; totalLines: number; shouldCollapse: boolean; reason: string | null }[] = []

		for (let codeLines = 5; codeLines <= 25; codeLines++) {
			const text = [
				"Here's the code:",
				"",
				"```typescript",
				...Array.from({ length: codeLines }, (_, i) => `const x${i} = ${i}`),
				"```",
				"Let me know.",
			].join("\n")

			const msg: ClineMessage = {
				type: "say",
				say: "text",
				ts: 8000 + codeLines,
				text,
				partial: false,
			}
			const decision = analyzeMessage(msg, ISOLATION_THRESHOLD)
			results.push({
				codeLines,
				totalLines: text.split("\n").length,
				shouldCollapse: decision.shouldCollapse,
				reason: decision.reason,
			})
		}

		console.log("\nCode block threshold boundary (isolation threshold=50):")
		for (const r of results) {
			const marker = r.shouldCollapse ? ` ← COLLAPSES (${r.reason})` : ""
			console.log(
				`  ${String(r.codeLines).padStart(2)}-line code block (${String(r.totalLines).padStart(2)} total): ${r.shouldCollapse ? "COLLAPSE" : "expand  "}${marker}`,
			)
		}

		// NOTE: findLargestCodeBlock counts lines INCLUDING both fences.
		// So 13 code lines = 15 total block lines (NOT > 15, doesn't collapse)
		//    14 code lines = 16 total block lines (IS > 15, collapses)
		// With isolation threshold=50, total message lines won't trigger line-count fallback.
		const atBoundary = results.find((r) => r.codeLines === 13)!
		const aboveBoundary = results.find((r) => r.codeLines === 14)!

		console.log(
			`\n  13-line code block (15 total): ${atBoundary.shouldCollapse ? "COLLAPSES" : "does NOT collapse"}`,
		)
		console.log(
			`  14-line code block (16 total): ${aboveBoundary.shouldCollapse ? "COLLAPSES" : "does NOT collapse"}`,
		)

		expect(atBoundary.shouldCollapse).toBe(false) // 15 total block ≤ 15 internal threshold → doesn't collapse
		expect(aboveBoundary.shouldCollapse).toBe(true) // 16 total block > 15 internal threshold → collapses
	})

	it("diagnostic: realistic chat session simulation", () => {
		// Simulate a real chat session with alternating user/assistant messages
		const messages: ClineMessage[] = [
			{ type: "say", say: "user_feedback", ts: 100, text: "Help me implement auth", partial: false },
			{
				type: "say",
				say: "text",
				ts: 101,
				text: Array.from(
					{ length: 25 },
					(_, i) => `Line ${i + 1}: I'll help you implement authentication.`,
				).join("\n"),
				partial: false,
			},
			{ type: "say", say: "user_feedback", ts: 102, text: "Sounds good, go ahead", partial: false },
			{
				type: "say",
				say: "text",
				ts: 103,
				text: Array.from(
					{ length: 45 },
					(_, i) => `Line ${i + 1}: Here is the full implementation with error handling.`,
				).join("\n"),
				partial: false,
			},
			{ type: "say", say: "user_feedback", ts: 104, text: "Can you add tests?", partial: false },
			{
				type: "say",
				say: "text",
				ts: 105,
				text: Array.from(
					{ length: 55 },
					(_, i) => `Line ${i + 1}: Here are comprehensive tests for the auth module.`,
				).join("\n"),
				partial: false,
			},
		]

		console.log("\n" + "=".repeat(120))
		console.log("REALISTIC CHAT SESSION SIMULATION (6 messages, alternating user/assistant)")
		console.log("=".repeat(120))

		const totalMessages = messages.length
		for (let i = 0; i < messages.length; i++) {
			const msg = messages[i]
			const isLast = i === totalMessages - 1
			const result = diagnoseMessage(`[${i}] ${msg.type === "ask" ? msg.ask || "" : msg.say || ""}`, msg, isLast)
			console.log(
				`  [${i}] ${(msg.type === "ask" ? msg.ask || "" : msg.say || "").padEnd(20)} | ${String(result.lineCount).padStart(3)} lines | ` +
					`never=${result.shouldNeverCollapseResult ? result.neverCollapseReason.padEnd(15) : "false".padEnd(15)} | ` +
					`collapse=${String(result.shouldCollapse).padEnd(5)} | ${result.finalRenderedAs}`,
			)
		}
		console.log("=".repeat(120))

		// Message [1] = 25-line assistant text (NOT last) → SHOULD collapse (25 >= 20 assistant threshold)
		// Message [3] = 45-line assistant text (NOT last) → SHOULD collapse (45 >= 20 assistant threshold)
		// Message [5] = 55-line assistant text (IS last) → should NOT collapse (isLast)
		const msg1Result = diagnoseMessage("25-line assistant", messages[1], false)
		const msg3Result = diagnoseMessage("45-line assistant", messages[3], false)
		const msg5Result = diagnoseMessage("55-line assistant as last", messages[5], true)

		// 25-line assistant text DOES collapse (25 >= 20 assistant threshold)
		expect(msg1Result.finalExpanded).toBe(false)
		// 45-line assistant text DOES collapse
		expect(msg3Result.finalExpanded).toBe(false)
		// 55-line assistant text as LAST doesn't collapse (isLast)
		expect(msg5Result.finalExpanded).toBe(true)
		expect(msg5Result.neverCollapseReason).toBe("isLast")
	})

	it("diagnostic: edge case - message with empty/undefined text", () => {
		const emptyText: ClineMessage = { type: "say", say: "text", ts: 7001, text: "", partial: false }
		const undefinedText: ClineMessage = {
			type: "say",
			say: "text",
			ts: 7002,
			text: undefined as any,
			partial: false,
		}
		const whitespaceOnly: ClineMessage = {
			type: "say",
			say: "text",
			ts: 7003,
			text: "   \n\n  \n  ",
			partial: false,
		}

		const r1 = diagnoseMessage("Empty text", emptyText, false)
		const r2 = diagnoseMessage("Undefined text", undefinedText, false)
		const r3 = diagnoseMessage("Whitespace only", whitespaceOnly, false)

		console.log("\nEdge cases:")
		console.log(`  Empty text: ${r1.finalRenderedAs} (lineCount=${r1.lineCount})`)
		console.log(`  Undefined text: ${r2.finalRenderedAs} (lineCount=${r2.lineCount})`)
		console.log(`  Whitespace only: ${r3.finalRenderedAs} (lineCount=${r3.lineCount})`)

		expect(r1.finalExpanded).toBe(true)
		expect(r2.finalExpanded).toBe(true)
		expect(r3.finalExpanded).toBe(true)
	})

	it("diagnostic: edge case - message with mixed content types", () => {
		// A message with terminal output AND code block
		const mixed: ClineMessage = {
			type: "say",
			say: "text",
			ts: 7100,
			text: [
				"Here's what happened when I ran the command:",
				"",
				"$ npm run build",
				"> turbo run build",
				"  4 tasks complete",
				"",
				"$ npm test",
				"> vitest run",
				"  ✓ 15 tests passed",
				"  0 failed",
				"",
				"And here's the code I changed:",
				"",
				"```typescript",
				...Array.from({ length: 18 }, (_, i) => `function test${i}() { return ${i} }`),
				"```",
				"",
				"All tests passing now!",
			].join("\n"),
			partial: false,
		}

		const result = diagnoseMessage("Mixed terminal+code (32 lines)", mixed, false)
		console.log(`\nMixed content: ${result.finalRenderedAs}`)
		console.log(`  Content type detected: ${result.collapseReason}`)
		console.log(`  Line count: ${result.lineCount}`)

		// Should collapse via code-block (18-line code > 15 threshold)
		expect(result.finalExpanded).toBe(false)
		expect(result.collapseReason).toBe("code-block")
	})

	it("diagnostic: pasted plain text (single line, many characters) — Bug 1 scenario", () => {
		// PASTED_USER is a single-line 2000-char paragraph (user_feedback).
		// Old behavior: lineCount=1 < MIN_LINES_TO_COLLAPSE(5) → never collapsed.
		// New behavior: estimatedVisualLines = max(1, ceil(2000/80)) = 25 → 25 >= 10 user threshold → collapses.

		const pastedUserResult = diagnoseMessage("Pasted user paragraph (1 line, ~2000 chars)", PASTED_USER, false)
		console.log("\nPasted text (Bug 1 scenario):")
		console.log(`  User pasted paragraph: ${pastedUserResult.finalRenderedAs}`)
		console.log(`  lineCount (actual): ${(PASTED_USER.text || "").split("\n").length}`)
		console.log(`  collapse lineCount (estimated): ${pastedUserResult.lineCount}`)
		console.log(`  collapseReason: ${pastedUserResult.collapseReason}`)

		// The single-line pasted paragraph MUST collapse via character-based estimate
		expect(pastedUserResult.finalExpanded).toBe(false)
		expect(pastedUserResult.collapseReason).toBe("line-count")
		expect(pastedUserResult.shouldCollapse).toBe(true)
		// Reported lineCount should be the estimated visual lines, not the literal 1
		expect(pastedUserResult.lineCount).toBeGreaterThan(1)

		// PASTED_ASSISTANT is a single-line ~1650-char assistant text.
		// estimatedVisualLines = max(1, ceil(1650/80)) = 21 → 21 >= 20 assistant threshold → collapses.
		const pastedAsstResult = diagnoseMessage("Pasted assistant text (1 line, ~1600 chars)", PASTED_ASSISTANT, false)
		console.log(`  Assistant pasted text: ${pastedAsstResult.finalRenderedAs}`)
		console.log(`  collapseReason: ${pastedAsstResult.collapseReason}`)

		expect(pastedAsstResult.finalExpanded).toBe(false)
		expect(pastedAsstResult.collapseReason).toBe("line-count")

		// As last message, even pasted text should NOT collapse (isLast takes priority)
		const pastedAsLast = diagnoseMessage("Pasted user AS LAST", PASTED_USER, true)
		expect(pastedAsLast.finalExpanded).toBe(true)
		expect(pastedAsLast.neverCollapseReason).toBe("isLast")
	})
})
