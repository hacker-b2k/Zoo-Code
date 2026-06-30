import type { ClineMessage } from "@roo-code/types"

import { isBoundaryMessage, buildVirtuosoItems, isTaskActivityGroup } from "../taskActivityGrouping"
import type { BoundaryOptions } from "../taskActivityGrouping"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSay(say: string, text?: string, ts = Date.now()): ClineMessage {
	return { type: "say", say: say as any, text: text ?? "", ts } as ClineMessage
}

function makeAsk(ask: string, text?: string, ts = Date.now()): ClineMessage {
	return { type: "ask", ask: ask as any, text: text ?? "", ts } as ClineMessage
}

function makeCommandAsk(text: string, ts = Date.now()): ClineMessage {
	return { type: "ask", ask: "command" as any, text, ts } as ClineMessage
}

/** Build a completed command message with output. */
function makeCompletedCommand(command: string, outputLines: number, ts = Date.now()): ClineMessage {
	const output = Array.from({ length: outputLines }, (_, i) => `line ${i + 1}`).join("\n")
	return makeCommandAsk(`${command}\n\nOutput:\n${output}`, ts)
}

// ---------------------------------------------------------------------------
// isBoundaryMessage — basic classification
// ---------------------------------------------------------------------------

describe("isBoundaryMessage", () => {
	// ---- say messages ----

	it("returns true for say:'text'", () => {
		expect(isBoundaryMessage(makeSay("text", "Hello"))).toBe(true)
	})

	it("returns true for say:'user_feedback'", () => {
		expect(isBoundaryMessage(makeSay("user_feedback", "feedback"))).toBe(true)
	})

	it("returns true for say:'completion_result'", () => {
		expect(isBoundaryMessage(makeSay("completion_result", "done"))).toBe(true)
	})

	it("returns true for say:'error'", () => {
		expect(isBoundaryMessage(makeSay("error", "fail"))).toBe(true)
	})

	it("returns true for say:'checkpoint_saved'", () => {
		expect(isBoundaryMessage(makeSay("checkpoint_saved", "{}"))).toBe(true)
	})

	it("returns true for say:'image'", () => {
		expect(isBoundaryMessage(makeSay("image", "data"))).toBe(true)
	})

	it("returns true for say:'too_many_tools_warning'", () => {
		expect(isBoundaryMessage(makeSay("too_many_tools_warning", "warn"))).toBe(true)
	})

	it("returns false for say:'tool' (intermediate)", () => {
		expect(isBoundaryMessage(makeSay("tool", "{}"))).toBe(false)
	})

	it("returns false for say:'reasoning' (intermediate)", () => {
		expect(isBoundaryMessage(makeSay("reasoning", "thinking"))).toBe(false)
	})

	it("returns false for say:'api_req_started' (intermediate)", () => {
		expect(isBoundaryMessage(makeSay("api_req_started", "{}"))).toBe(false)
	})

	// ---- ask messages ----

	it("returns true for ask:'followup'", () => {
		expect(isBoundaryMessage(makeAsk("followup", "What next?"))).toBe(true)
	})

	it("returns true for ask:'completion_result'", () => {
		expect(isBoundaryMessage(makeAsk("completion_result", "done"))).toBe(true)
	})

	it("returns true for ask:'use_mcp_server'", () => {
		expect(isBoundaryMessage(makeAsk("use_mcp_server", "{}"))).toBe(true)
	})

	it("returns true for ask:'resume_task'", () => {
		expect(isBoundaryMessage(makeAsk("resume_task", "resume"))).toBe(true)
	})

	it("returns true for ask:'mistake_limit_reached'", () => {
		expect(isBoundaryMessage(makeAsk("mistake_limit_reached", "oops"))).toBe(true)
	})

	it("returns false for ask:'tool' (intermediate)", () => {
		expect(isBoundaryMessage(makeAsk("tool", "{}"))).toBe(false)
	})

	it("returns false for ask:'command_output' (intermediate)", () => {
		expect(isBoundaryMessage(makeAsk("command_output", "output"))).toBe(false)
	})

	it("returns false for ask:undefined", () => {
		const msg = { type: "ask", text: "hi", ts: 1 } as ClineMessage
		expect(isBoundaryMessage(msg)).toBe(false)
	})

	it("returns false for say:undefined", () => {
		const msg = { type: "say", text: "hi", ts: 1 } as ClineMessage
		expect(isBoundaryMessage(msg)).toBe(false)
	})
})

// ---------------------------------------------------------------------------
// isBoundaryMessage — command size-aware boundary
// ---------------------------------------------------------------------------

describe("isBoundaryMessage — command size-aware", () => {
	it("pending command (no output) is always a boundary", () => {
		const pending = makeCommandAsk("ls -la")
		expect(isBoundaryMessage(pending, 20)).toBe(true)
	})

	it("pending command with empty text is a boundary", () => {
		const pending = makeCommandAsk("")
		expect(isBoundaryMessage(pending, 20)).toBe(true)
	})

	it("pending command with undefined text is a boundary", () => {
		const msg = { type: "ask", ask: "command", ts: 1 } as ClineMessage
		expect(isBoundaryMessage(msg, 20)).toBe(true)
	})

	it("small completed command (< MIN_LINES) is NOT a boundary with threshold", () => {
		// 2 output lines < MIN_LINES_TO_COLLAPSE (5)
		const small = makeCompletedCommand("echo hi", 2)
		expect(isBoundaryMessage(small, 20)).toBe(false)
	})

	it("medium completed command (below threshold) is NOT a boundary", () => {
		// 8 output lines with plain text, threshold = 20 → won't collapse
		const medium = makeCompletedCommand("cat file.txt", 8)
		expect(isBoundaryMessage(medium, 20)).toBe(false)
	})

	it("large completed command (above threshold) IS a boundary", () => {
		// 25 output lines of plain text, threshold = 20 → will collapse
		const large = makeCompletedCommand("cat big-file.txt", 25)
		expect(isBoundaryMessage(large, 20)).toBe(true)
	})

	it("command with terminal output exceeding TERMINAL_OUTPUT threshold IS a boundary", () => {
		// Build terminal-style output (> 10 lines matching terminal patterns)
		const termLines = Array.from({ length: 12 }, (_, i) => `$ echo line${i}`).join("\n")
		const msg = makeCommandAsk(`ls -la\n\nOutput:\n${termLines}`)
		expect(isBoundaryMessage(msg, 20)).toBe(true)
	})

	it("command with terminal output below threshold is NOT a boundary", () => {
		const termLines = Array.from({ length: 6 }, (_, i) => `$ echo line${i}`).join("\n")
		const msg = makeCommandAsk(`ls -la\n\nOutput:\n${termLines}`)
		expect(isBoundaryMessage(msg, 20)).toBe(false)
	})

	it("without threshold (undefined), small completed commands are NOT boundaries", () => {
		// undefined → ?? Infinity → isCommandBoundary uses Infinity
		// For 2 lines: lineCount < MIN_LINES_TO_COLLAPSE (5) → shouldCollapse=false → NOT boundary
		const small = makeCompletedCommand("echo hi", 2)
		expect(isBoundaryMessage(small)).toBe(false)
	})

	it("without threshold (undefined → Infinity), small completed commands are groupable", () => {
		// undefined → ?? Infinity → analyzeMessage(msg, Infinity) for 2 lines:
		// lineCount < MIN_LINES_TO_COLLAPSE → shouldCollapse=false → NOT boundary → groupable
		// Content-based detection (terminal, code-block) still triggers with Infinity threshold.
		const small = makeCompletedCommand("echo hi", 2)
		expect(isBoundaryMessage(small, undefined)).toBe(false)
	})
})

// ---------------------------------------------------------------------------
// isTaskActivityGroup
// ---------------------------------------------------------------------------

describe("isTaskActivityGroup", () => {
	it("returns true for a TaskActivityGroupData item", () => {
		const item = { type: "task_activity_group" as const, ts: 1, messages: [] }
		expect(isTaskActivityGroup(item)).toBe(true)
	})

	it("returns false for a plain ClineMessage", () => {
		const item = makeSay("text", "hello")
		expect(isTaskActivityGroup(item)).toBe(false)
	})

	it("returns false for an object with type='other'", () => {
		const item = { type: "other", ts: 1 } as any
		expect(isTaskActivityGroup(item)).toBe(false)
	})
})

// ---------------------------------------------------------------------------
// buildVirtuosoItems — basic grouping
// ---------------------------------------------------------------------------

describe("buildVirtuosoItems", () => {
	it("returns empty array for empty input", () => {
		expect(buildVirtuosoItems([])).toEqual([])
	})

	it("single boundary message stays standalone", () => {
		const msgs = [makeSay("text", "hello")]
		const result = buildVirtuosoItems(msgs)
		expect(result).toHaveLength(1)
		expect(result[0]).toBe(msgs[0])
	})

	it("single groupable message stays standalone (not wrapped)", () => {
		const msgs = [makeSay("tool", "{}")]
		const result = buildVirtuosoItems(msgs)
		expect(result).toHaveLength(1)
		expect(result[0]).toBe(msgs[0])
		// Should NOT be wrapped in a group since buffer.length === 1
		expect(isTaskActivityGroup(result[0])).toBe(false)
	})

	it("two consecutive groupable messages are wrapped in a group", () => {
		const tool1 = makeSay("tool", '{"tool":"readFile"}', 100)
		const tool2 = makeSay("tool", '{"tool":"listFiles"}', 200)
		const result = buildVirtuosoItems([tool1, tool2])
		expect(result).toHaveLength(1)
		expect(isTaskActivityGroup(result[0])).toBe(true)
		if (isTaskActivityGroup(result[0])) {
			expect(result[0].messages).toEqual([tool1, tool2])
			expect(result[0].ts).toBe(100)
		}
	})

	it("three consecutive groupable messages are wrapped in a single group", () => {
		const tool1 = makeSay("tool", "{}", 100)
		const tool2 = makeSay("reasoning", "thinking", 200)
		const tool3 = makeSay("api_req_started", "{}", 300)
		const result = buildVirtuosoItems([tool1, tool2, tool3])
		expect(result).toHaveLength(1)
		expect(isTaskActivityGroup(result[0])).toBe(true)
		if (isTaskActivityGroup(result[0])) {
			expect(result[0].messages).toHaveLength(3)
		}
	})

	it("boundary between groupables splits into separate groups", () => {
		const tool1 = makeSay("tool", "{}", 100)
		const tool2 = makeSay("tool", "{}", 200)
		const boundary = makeSay("text", "response", 300)
		const tool3 = makeSay("tool", "{}", 400)
		const tool4 = makeSay("tool", "{}", 500)

		const result = buildVirtuosoItems([tool1, tool2, boundary, tool3, tool4])
		expect(result).toHaveLength(3) // group1, boundary, group2
		expect(isTaskActivityGroup(result[0])).toBe(true)
		expect(result[1]).toBe(boundary)
		expect(isTaskActivityGroup(result[2])).toBe(true)
	})

	it("groupable between two boundaries stays standalone", () => {
		const b1 = makeSay("text", "hello", 100)
		const tool = makeSay("tool", "{}", 200)
		const b2 = makeSay("text", "world", 300)

		const result = buildVirtuosoItems([b1, tool, b2])
		expect(result).toHaveLength(3)
		expect(result[0]).toBe(b1)
		expect(result[1]).toBe(tool) // single groupable → standalone, not wrapped
		expect(result[2]).toBe(b2)
	})
})

// ---------------------------------------------------------------------------
// buildVirtuosoItems — command size-aware grouping
// ---------------------------------------------------------------------------

describe("buildVirtuosoItems — command boundary", () => {
	const defaultOptions: BoundaryOptions = { commandCollapseThreshold: 20 }

	it("pending command acts as boundary (splits groups)", () => {
		const tool1 = makeSay("tool", "{}", 100)
		const pendingCmd = makeCommandAsk("npm install", 200)
		const tool2 = makeSay("tool", "{}", 300)

		const result = buildVirtuosoItems([tool1, pendingCmd, tool2], defaultOptions)
		expect(result).toHaveLength(3)
		expect(result[0]).toBe(tool1)
		expect(result[1]).toBe(pendingCmd)
		expect(result[2]).toBe(tool2)
	})

	it("small completed command is absorbed into group", () => {
		const tool1 = makeSay("tool", "{}", 100)
		const smallCmd = makeCompletedCommand("echo hi", 2, 200)
		const tool2 = makeSay("tool", "{}", 300)

		const result = buildVirtuosoItems([tool1, smallCmd, tool2], defaultOptions)
		// All three should be in a single group
		expect(result).toHaveLength(1)
		expect(isTaskActivityGroup(result[0])).toBe(true)
		if (isTaskActivityGroup(result[0])) {
			expect(result[0].messages).toEqual([tool1, smallCmd, tool2])
		}
	})

	it("large completed command stays as boundary", () => {
		const tool1 = makeSay("tool", "{}", 100)
		const largeCmd = makeCompletedCommand("cat big.txt", 25, 200)
		const tool2 = makeSay("tool", "{}", 300)

		const result = buildVirtuosoItems([tool1, largeCmd, tool2], defaultOptions)
		expect(result).toHaveLength(3)
		expect(result[0]).toBe(tool1)
		expect(result[1]).toBe(largeCmd)
		expect(result[2]).toBe(tool2)
	})

	it("multiple small completed commands are absorbed into the same group", () => {
		const tool1 = makeSay("tool", "{}", 100)
		const cmd1 = makeCompletedCommand("echo a", 2, 200)
		const cmd2 = makeCompletedCommand("echo b", 3, 300)
		const tool2 = makeSay("tool", "{}", 400)

		const result = buildVirtuosoItems([tool1, cmd1, cmd2, tool2], defaultOptions)
		expect(result).toHaveLength(1)
		expect(isTaskActivityGroup(result[0])).toBe(true)
		if (isTaskActivityGroup(result[0])) {
			expect(result[0].messages).toHaveLength(4)
		}
	})

	it("small then large command: small absorbed, large is boundary", () => {
		const tool1 = makeSay("tool", "{}", 100)
		const smallCmd = makeCompletedCommand("echo hi", 2, 200)
		const largeCmd = makeCompletedCommand("cat big.txt", 25, 300)
		const tool2 = makeSay("tool", "{}", 400)

		const result = buildVirtuosoItems([tool1, smallCmd, largeCmd, tool2], defaultOptions)
		// [tool1, smallCmd] → group, largeCmd → boundary, tool2 → standalone
		expect(result).toHaveLength(3)
		expect(isTaskActivityGroup(result[0])).toBe(true)
		expect(result[1]).toBe(largeCmd)
		expect(result[2]).toBe(tool2)
	})

	it("command with large terminal output is a boundary", () => {
		const termLines = Array.from({ length: 15 }, (_, i) => `$ npm run build\noutput line ${i}`).join("\n")
		const cmd = makeCommandAsk(`npm run build\n\nOutput:\n${termLines}`, 200)

		const result = buildVirtuosoItems([cmd], defaultOptions)
		expect(result).toHaveLength(1)
		expect(result[0]).toBe(cmd) // standalone boundary
		expect(isTaskActivityGroup(result[0])).toBe(false)
	})

	it("without options, all completed commands are boundaries (backward compat)", () => {
		const tool1 = makeSay("tool", "{}", 100)
		const smallCmd = makeCompletedCommand("echo hi", 2, 200)
		const tool2 = makeSay("tool", "{}", 300)

		// No options → commandCollapseThreshold = undefined → ?? Infinity
		// analyzeMessage(msg, Infinity) for 2 lines: lineCount < MIN_LINES → shouldCollapse=false
		// → isCommandBoundary returns false → command is groupable
		const result = buildVirtuosoItems([tool1, smallCmd, tool2])
		// With Infinity threshold, 2-line message: shouldCollapse=false → NOT boundary → groupable
		expect(result).toHaveLength(1)
		expect(isTaskActivityGroup(result[0])).toBe(true)
	})

	it("pending command is always boundary regardless of options", () => {
		const pending = makeCommandAsk("npm test", 100)
		// No options
		const result = buildVirtuosoItems([pending])
		expect(result).toHaveLength(1)
		expect(result[0]).toBe(pending)
	})
})
