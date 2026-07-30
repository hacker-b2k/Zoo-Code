// npx vitest run src/core/assistant-message/__tests__/ToolCallPipeline.integration.spec.ts

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { ToolCallPipeline } from "../ToolCallPipeline"
import { NativeToolCallParser } from "../NativeToolCallParser"
import type { ToolUse } from "../../../shared/tools"

describe("ToolCallPipeline — integration scenarios", () => {
	let pipeline: ToolCallPipeline

	beforeEach(() => {
		NativeToolCallParser.clearAllStreamingToolCalls()
		NativeToolCallParser.clearRawChunkState()
		pipeline = new ToolCallPipeline()
		pipeline.beginTurn()
	})

	afterEach(() => {
		pipeline.reset()
	})

	it("(a) native tool_calls: finalize detects native tools in content", () => {
		const toolUse: ToolUse = {
			type: "tool_use",
			name: "read_file",
			id: "call_native",
			params: {},
			partial: false,
			nativeArgs: { files: [{ path: "README.md" }] } as ToolUse["nativeArgs"],
		}

		const result = pipeline.finalize({
			assistantMessage: "",
			assistantMessageContent: [toolUse],
			currentStreamingContentIndex: 0,
		})

		expect(result.recoveredTextToolCount).toBe(0)
		expect(pipeline.didToolUse).toBe(true)
		expect(pipeline.state.providerModeValue).toBe("native")
		expect(pipeline.shouldSendTools).toBe(true)
		expect(pipeline.systemPromptVariant).toBe("native")
		expect(pipeline.shouldInjectTextMode).toBe(false)
		expect(pipeline.shouldShowNoToolsBanner).toBe(false)
	})

	it("(b) XML tool_call markup: recovery produces ToolUse blocks", () => {
		const xml = '<tool_call>{"name":"write_to_file","arguments":{"path":"test.txt","content":"hello"}}</tool_call>'
		const result = pipeline.finalize({
			assistantMessage: xml,
			assistantMessageContent: [{ type: "text", content: xml, partial: false }],
			currentStreamingContentIndex: 0,
		})

		expect(result.recoveredTextToolCount).toBeGreaterThan(0)
		expect(pipeline.didToolUse).toBe(true)
		expect(pipeline.state.providerModeValue).toBe("text_recovered")
		expect(pipeline.shouldSendTools).toBe(true)
		expect(pipeline.systemPromptVariant).toBe("text")
		expect(pipeline.shouldInjectTextMode).toBe(true)
		expect(pipeline.shouldShowNoToolsBanner).toBe(false)

		const tools = result.assistantMessageContent.filter((b) => b.type === "tool_use")
		expect(tools.length).toBeGreaterThan(0)
		if (tools[0].type === "tool_use") {
			expect(tools[0].name).toBe("write_to_file")
		}
	})

	it("(c) mixed: native tool + text recovery — native wins, no recovery", () => {
		const toolUse: ToolUse = {
			type: "tool_use",
			name: "list_files",
			id: "call_mixed",
			params: {},
			partial: false,
			nativeArgs: { path: "." } as ToolUse["nativeArgs"],
		}
		const textWithXml = '<tool_call>{"name":"read_file","arguments":{"path":"x.ts"}}</tool_call>'

		const result = pipeline.finalize({
			assistantMessage: textWithXml,
			assistantMessageContent: [{ type: "text", content: textWithXml, partial: false }, toolUse],
			currentStreamingContentIndex: 1,
		})

		expect(result.recoveredTextToolCount).toBe(0)
		expect(pipeline.didToolUse).toBe(true)
		expect(pipeline.state.providerModeValue).toBe("native")
		expect(pipeline.systemPromptVariant).toBe("native")
	})

	it("(d) no-tool: first turn injects text mode, no banner", () => {
		const result = pipeline.finalize({
			assistantMessage: "Let me think about this...",
			assistantMessageContent: [{ type: "text", content: "Let me think about this...", partial: false }],
			currentStreamingContentIndex: 0,
		})

		expect(result.recoveredTextToolCount).toBe(0)
		expect(pipeline.didToolUse).toBe(false)
		expect(pipeline.state.providerModeValue).toBe("unknown")
		expect(pipeline.shouldInjectTextMode).toBe(true)
		expect(pipeline.shouldShowNoToolsBanner).toBe(false)
		expect(pipeline.shouldSendTools).toBe(true)
	})

	it("(e) no-tool: second consecutive turn stays unknown (no lock-in), still sends tools", () => {
		// First turn
		pipeline.finalize({
			assistantMessage: "Still thinking...",
			assistantMessageContent: [{ type: "text", content: "Still thinking...", partial: false }],
			currentStreamingContentIndex: 0,
		})
		expect(pipeline.state.providerModeValue).toBe("unknown")
		expect(pipeline.shouldShowNoToolsBanner).toBe(false)

		// Second turn
		pipeline.beginTurn()
		pipeline.finalize({
			assistantMessage: "No tools needed.",
			assistantMessageContent: [{ type: "text", content: "No tools needed.", partial: false }],
			currentStreamingContentIndex: 0,
		})
		// No-lock: never becomes text_only, always sends tools
		expect(pipeline.state.providerModeValue).toBe("unknown")
		expect(pipeline.shouldSendTools).toBe(true)
		expect(pipeline.shouldShowNoToolsBanner).toBe(false)
		expect(pipeline.systemPromptVariant).toBe("text")
		expect(pipeline.shouldInjectTextMode).toBe(true)
	})

	it("(f) reset on provider change restores unknown state", () => {
		// Drive to text_recovered (no lock-in)
		pipeline.finalize({
			assistantMessage: "no tool",
			assistantMessageContent: [{ type: "text", content: "no tool", partial: false }],
			currentStreamingContentIndex: 0,
		})
		pipeline.beginTurn()
		pipeline.finalize({
			assistantMessage: "still no tool",
			assistantMessageContent: [{ type: "text", content: "still no tool", partial: false }],
			currentStreamingContentIndex: 0,
		})
		// No-lock: stays unknown, never text_only
		expect(pipeline.state.providerModeValue).toBe("unknown")

		// Reset (simulates abort/provider change)
		pipeline.reset()
		pipeline.beginTurn()

		// Now native tool works again
		const toolUse: ToolUse = {
			type: "tool_use",
			name: "read_file",
			id: "call_after_reset",
			params: {},
			partial: false,
			nativeArgs: { files: [{ path: "README.md" }] } as ToolUse["nativeArgs"],
		}
		pipeline.finalize({
			assistantMessage: "",
			assistantMessageContent: [toolUse],
			currentStreamingContentIndex: 0,
		})
		expect(pipeline.state.providerModeValue).toBe("native")
		expect(pipeline.shouldSendTools).toBe(true)
		expect(pipeline.systemPromptVariant).toBe("native")
	})

	it("(g) native activity then recovery on next turn: pipeline tracks per-turn state", () => {
		// Turn 1: native tools
		const toolUse: ToolUse = {
			type: "tool_use",
			name: "list_files",
			id: "call_turn1",
			params: {},
			partial: false,
			nativeArgs: { path: "." } as ToolUse["nativeArgs"],
		}
		pipeline.finalize({
			assistantMessage: "",
			assistantMessageContent: [toolUse],
			currentStreamingContentIndex: 0,
		})
		expect(pipeline.state.providerModeValue).toBe("native")
		expect(pipeline.didToolUse).toBe(true)

		// Turn 2: text-only
		pipeline.beginTurn()
		pipeline.finalize({
			assistantMessage: "No tools this time.",
			assistantMessageContent: [{ type: "text", content: "No tools this time.", partial: false }],
			currentStreamingContentIndex: 0,
		})
		// Provider stays native (proven in turn 1)
		expect(pipeline.state.providerModeValue).toBe("native")
		expect(pipeline.didToolUse).toBe(false)
		// No text-mode injection for native providers
		expect(pipeline.shouldInjectTextMode).toBe(false)
		// Banner shows because consecutiveNoToolCount >= 2 is false (it's 1)
		// Actually, consecutiveNoToolCount is 1 here — banner threshold is 2
		expect(pipeline.shouldShowNoToolsBanner).toBe(false)
	})
})
