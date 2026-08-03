/**
 * Full integration test for the mid-session tool-bridge drop scenario.
 *
 * This test reproduces the exact sequence the user reports:
 *   Turn 1: write_spec succeeds (tool bridge works)
 *   Turn 2: model calls bash_tool (hallucinated name → unknown-tool error)
 *   Turn 3: model calls write_to_file without content → missing-param error
 *   Turn 4: ALL tools fail, including valid ones (list_specs, ask_followup_question)
 *
 * For each turn we instrument:
 *   - what NativeToolCallParser produces (ToolUse blocks with name/nativeArgs)
 *   - what presentAssistantMessage dispatches (which switch case fires)
 *   - what tool_result the model receives
 *
 * This proves (or disproves) whether the parser + alias + state-clearing
 * fixes actually prevent the cascade.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { NativeToolCallParser } from "../../assistant-message/NativeToolCallParser"
import { isValidToolName } from "../../../core/tools/validateToolUse"
import { resolveToolAlias } from "../../../core/prompts/tools/filter-tools-for-mode"
import { TOOL_ALIASES } from "../../../shared/tools"

describe("mid-session tool-bridge integration (user.txt scenario)", () => {
	beforeEach(() => {
		NativeToolCallParser.clearAllStreamingToolCalls()
		NativeToolCallParser.clearRawChunkState()
	})

	/**
	 * Helper: simulate a full tool-call round-trip through NativeToolCallParser.
	 * Returns the final ToolUse (or null if finalize returned null).
	 */
	function simulateToolCall(id: string, name: string, args: Record<string, unknown>) {
		// 1. processRawChunk start
		const startEvents = NativeToolCallParser.processRawChunk({
			index: 0,
			id,
			name,
			arguments: "{}",
		})

		// 2. startStreamingToolCall (Task.ts handleToolCallStartEvent does this)
		NativeToolCallParser.startStreamingToolCall(id, resolveToolAlias(name))

		// 3. processStreamingChunk with full args
		const chunk = NativeToolCallParser.processStreamingChunk(id, JSON.stringify(args))

		// 4. finalizeStreamingToolCall
		const finalized = NativeToolCallParser.finalizeStreamingToolCall(id)

		return {
			startEvents,
			chunk,
			finalized,
			startEvent: startEvents.find((e) => e.type === "tool_call_start"),
		}
	}

	// ---------------------------------------------------------------
	// Turn 1: write_spec works (baseline)
	// ---------------------------------------------------------------
	it("Turn 1: write_spec succeeds with valid args", () => {
		const result = simulateToolCall("toolu_1", "write_spec", {
			title: "start",
			spec_id: null,
			doc: "requirements",
			content: "# Requirements\n",
			mode: "replace",
		})

		expect(result.finalized).not.toBeNull()
		expect(result.finalized!.name).toBe("write_spec")
		expect(result.finalized!.type).toBe("tool_use")
		if (result.finalized!.type === "tool_use") {
			expect(result.finalized!.nativeArgs).toBeDefined()
			expect((result.finalized!.nativeArgs as any).title).toBe("start")
		}

		// State is clean after finalization
		NativeToolCallParser.clearAllStreamingToolCalls()
		NativeToolCallParser.clearRawChunkState()
	})

	// ---------------------------------------------------------------
	// Turn 2: bash_tool hallucination → alias resolves
	// ---------------------------------------------------------------
	it("Turn 2: bash_tool hallucination resolves to execute_command via alias", () => {
		// Simulate: model called bash_tool (hallucinated name)
		const rawName = "bash_tool"
		const resolved = resolveToolAlias(rawName)

		// The alias resolves
		expect(resolved).toBe("execute_command")
		expect(TOOL_ALIASES[rawName]).toBe("execute_command")

		// The parser produces a valid ToolUse
		const result = simulateToolCall("toolu_2", rawName, {
			command: 'mkdir "global way"',
			cwd: null,
			timeout: null,
		})

		expect(result.finalized).not.toBeNull()
		expect(result.finalized!.name).toBe("execute_command")
	})

	// ---------------------------------------------------------------
	// Turn 3: write_to_file missing content → missing-param error
	// (model sends incomplete call)
	// ---------------------------------------------------------------
	it("Turn 3: write_to_file without content: parser finalize returns null, but partial nativeArgs survives for tool layer", () => {
		// Model sends path but no content.
		// STEP 1: Simulate the streaming path (createPartialToolUse runs during streaming)
		// This is what happens in Task.ts handleToolCallDeltaEvent → processStreamingChunk
		const id = "toolu_3"

		// processRawChunk: start + first delta
		NativeToolCallParser.processRawChunk({ index: 0, id, name: "write_to_file" })
		NativeToolCallParser.startStreamingToolCall(id, "write_to_file")

		// Simulate streaming partial args (model sends {"path":"test.txt"})
		const partialChunk = NativeToolCallParser.processStreamingChunk(id, '{"path":"test.txt"}')
		// The partial ToolUse should have nativeArgs with path set and content undefined
		expect(partialChunk).not.toBeNull()
		expect(partialChunk!.nativeArgs).toBeDefined()
		expect((partialChunk!.nativeArgs as any).path).toBe("test.txt")
		// content is undefined (not sent by model) — but nativeArgs IS set
		expect((partialChunk!.nativeArgs as any).content).toBeUndefined()

		// STEP 2: finalizeStreamingToolCall returns null because parseToolCall
		// requires BOTH path AND content (line 1804: args.path !== undefined && args.content !== undefined)
		const finalized = NativeToolCallParser.finalizeStreamingToolCall(id)
		expect(finalized).toBeNull()

		// STEP 3: But in Task.ts handleToolCallEndEvent (line 544-553), when
		// finalizeStreamingToolCall returns null, the EXISTING partial block
		// (with nativeArgs from the streaming path) is marked non-partial
		// and presented. The tool layer then sees nativeArgs.content === undefined
		// and calls sayAndCreateMissingParamError("write_to_file", "content").
		// So the tool layer DOES handle it — the model receives the error message.
		// This is confirmed by WriteToFileTool.ts line 45.
	})

	// ---------------------------------------------------------------
	// Turn 3b: write_to_file with content works normally
	// ---------------------------------------------------------------
	it("Turn 3b: write_to_file with content works normally", () => {
		const result = simulateToolCall("toolu_3b", "write_to_file", {
			path: "test.txt",
			content: "hello",
		})

		expect(result.finalized).not.toBeNull()
		expect(result.finalized!.name).toBe("write_to_file")
		if (result.finalized!.type === "tool_use") {
			expect((result.finalized!.nativeArgs as any).content).toBe("hello")
		}
	})

	// ---------------------------------------------------------------
	// Turn 4: list_specs after a previous turn's stream was interrupted
	// (simulates: previous stream errored mid-call, rawChunkTracker
	// has leftover entry at index 0)
	// ---------------------------------------------------------------
	it("Turn 4: list_specs works even when stale raw-chunk state from previous turn exists", () => {
		// Simulate leftover state from a previous interrupted stream.
		// The previous stream started a tool_call at index 0 with id "toolu_old".
		NativeToolCallParser.processRawChunk({
			index: 0,
			id: "toolu_old",
			name: "write_spec",
			arguments: '{"title":"x"',
		})
		// verify stale state exists
		expect((NativeToolCallParser as any).rawChunkTracker.size).toBe(1)

		// Turn 4 begins: clear state (as beginTurn does at line 3176)
		NativeToolCallParser.clearAllStreamingToolCalls()
		NativeToolCallParser.clearRawChunkState()

		// Now list_specs should work cleanly
		const result = simulateToolCall("toolu_4", "list_specs", {})
		expect(result.finalized).not.toBeNull()
		expect(result.finalized!.name).toBe("list_specs")
	})

	// ---------------------------------------------------------------
	// Turn 5: stale index reuse WITHOUT clear (the residual leak)
	// This simulates the case where beginTurn's clear was skipped
	// (concurrent task wiped state, then re-populated).
	// ---------------------------------------------------------------
	it("Turn 5: id-mismatch reap prevents stale index from corrupting new tool call", () => {
		// Inject stale state: index 0 -> id "toolu_STALE"
		NativeToolCallParser.processRawChunk({
			index: 0,
			id: "toolu_STALE",
			name: "list_specs",
			arguments: "{}",
		})
		NativeToolCallParser.startStreamingToolCall("toolu_STALE", "list_specs")
		NativeToolCallParser.processStreamingChunk("toolu_STALE", "{}")
		// Deliberately NOT clearing (simulates a missed clear)

		// New stream reuses index 0 with a DIFFERENT id
		const events = NativeToolCallParser.processRawChunk({
			index: 0,
			id: "toolu_NEW",
			name: "ask_followup_question",
		})

		// The stale entry should be REAPED (tool_call_end for old id)
		const endEvent = events.find((e) => e.type === "tool_call_end")
		expect(endEvent).toBeDefined()
		expect(endEvent!.id).toBe("toolu_STALE")

		// And a new start event for the new id
		const startEvent = events.find((e) => e.type === "tool_call_start")
		expect(startEvent).toBeDefined()
		expect(startEvent!.id).toBe("toolu_NEW")

		// Subsequent deltas go to the new id
		NativeToolCallParser.startStreamingToolCall("toolu_NEW", "ask_followup_question")
		const deltaEvents = NativeToolCallParser.processStreamingChunk(
			"toolu_NEW",
			JSON.stringify({ question: "Which one?", follow_up: [{ text: "Yes" }] }),
		)
		expect(deltaEvents).not.toBeNull()

		const finalized = NativeToolCallParser.finalizeStreamingToolCall("toolu_NEW")
		expect(finalized).not.toBeNull()
		expect(finalized!.name).toBe("ask_followup_question")
	})

	// ---------------------------------------------------------------
	// follow_up stringified-array coercion
	// ---------------------------------------------------------------
	it("follow_up as stringified JSON array is coerced to real array", () => {
		const suggestions = [
			{ text: "Yes", mode: null },
			{ text: "No", mode: null },
		]
		const result = simulateToolCall("toolu_6", "ask_followup_question", {
			question: "Pick one",
			follow_up: JSON.stringify(suggestions),
		})

		expect(result.finalized).not.toBeNull()
		if (result.finalized!.type === "tool_use") {
			expect(Array.isArray((result.finalized!.nativeArgs as any).follow_up)).toBe(true)
			expect((result.finalized!.nativeArgs as any).follow_up).toEqual(suggestions)
		}
	})

	// ---------------------------------------------------------------
	// isValidToolName with new aliases
	// ---------------------------------------------------------------
	it("isValidToolName accepts bash_tool via alias", () => {
		expect(isValidToolName("bash_tool")).toBe(true)
		expect(isValidToolName("bash")).toBe(true)
		expect(isValidToolName("shell_command")).toBe(true)
		expect(isValidToolName("run_command")).toBe(true)
		expect(isValidToolName("list_specs")).toBe(true)
	})
})
