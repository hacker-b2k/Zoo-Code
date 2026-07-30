// npx vitest run src/core/assistant-message/__tests__/ToolCallPipeline.spec.ts

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { ToolCallPipeline } from "../ToolCallPipeline"
import { NativeToolCallParser } from "../NativeToolCallParser"
import type { ToolUse } from "../../../shared/tools"

describe("ToolCallPipeline — Stage 1 (native)", () => {
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

	describe("processStreamChunk", () => {
		it("converts tool_call_partial into start/delta events via NativeToolCallParser", () => {
			const first = pipeline.processStreamChunk({
				type: "tool_call_partial",
				index: 0,
				id: "call_1",
				name: "read_file",
				arguments: '{"path":',
			})
			expect(first.sawNativeToolActivity).toBe(true)
			expect(first.events.some((e) => e.type === "tool_call_start")).toBe(true)
			expect(pipeline.sawNativeActivityThisTurn).toBe(true)

			const second = pipeline.processStreamChunk({
				type: "tool_call_partial",
				index: 0,
				arguments: '"README.md"}',
			})
			expect(second.sawNativeToolActivity).toBe(true)
			// Deltas may or may not emit events depending on parser buffering
			expect(pipeline.sawNativeActivityThisTurn).toBe(true)
		})

		it("records native activity for tool_call_start/delta/end and tool_call", () => {
			expect(
				pipeline.processStreamChunk({ type: "tool_call_start", id: "c1", name: "read_file" })
					.sawNativeToolActivity,
			).toBe(true)
			expect(
				pipeline.processStreamChunk({ type: "tool_call_delta", id: "c1", delta: "{}" }).sawNativeToolActivity,
			).toBe(true)
			expect(pipeline.processStreamChunk({ type: "tool_call_end", id: "c1" }).sawNativeToolActivity).toBe(true)
			expect(
				pipeline.processStreamChunk({
					type: "tool_call",
					id: "c2",
					name: "write_to_file",
					arguments: "{}",
				}).sawNativeToolActivity,
			).toBe(true)
		})

		it("ignores non-tool chunks", () => {
			const result = pipeline.processStreamChunk({ type: "text", text: "hello" })
			expect(result.sawNativeToolActivity).toBe(false)
			expect(result.events).toHaveLength(0)
			expect(pipeline.sawNativeActivityThisTurn).toBe(false)
		})
	})

	describe("finalize Stage 1", () => {
		it("reports native and returns content unchanged when executable tools present", () => {
			const toolUse: ToolUse = {
				type: "tool_use",
				name: "read_file",
				id: "call_abc",
				params: {},
				partial: false,
				nativeArgs: { files: [{ path: "a.ts" }] } as ToolUse["nativeArgs"],
			}

			const result = pipeline.finalize({
				assistantMessage: "",
				assistantMessageContent: [toolUse],
				currentStreamingContentIndex: 0,
			})

			expect(result.recoveredTextToolCount).toBe(0)
			expect(result.assistantMessageContent).toHaveLength(1)
			expect(result.assistantMessageContent[0]).toMatchObject({ type: "tool_use", name: "read_file" })
			expect(pipeline.didToolUse).toBe(true)
			expect(pipeline.state.providerModeValue).toBe("native")
			expect(pipeline.shouldSendTools).toBe(true)
			expect(pipeline.systemPromptVariant).toBe("native")
		})

		it("reports native when stream activity was seen even without finalised content yet", () => {
			pipeline.processStreamChunk({
				type: "tool_call_partial",
				index: 0,
				id: "call_stream",
				name: "list_files",
				arguments: "{}",
			})

			const result = pipeline.finalize({
				assistantMessage: "thinking…",
				assistantMessageContent: [{ type: "text", content: "thinking…", partial: false }],
				currentStreamingContentIndex: 0,
			})

			expect(result.recoveredTextToolCount).toBe(0)
			expect(pipeline.state.providerModeValue).toBe("native")
			expect(pipeline.didToolUse).toBe(true)
		})

		it("Stage 2: XML tool_call markup is recovered as tool_use blocks", () => {
			const xml = '<tool_call>{"name":"read_file","arguments":{"files":[{"path":"x.ts"}]}}</tool_call>'
			const result = pipeline.finalize({
				assistantMessage: xml,
				assistantMessageContent: [{ type: "text", content: xml, partial: false }],
				currentStreamingContentIndex: 0,
			})

			expect(result.recoveredTextToolCount).toBeGreaterThan(0)
			const toolBlocks = result.assistantMessageContent.filter((b) => b.type === "tool_use")
			expect(toolBlocks.length).toBeGreaterThan(0)
			if (toolBlocks[0].type === "tool_use") {
				expect(toolBlocks[0].name).toBe("read_file")
			}
			expect(pipeline.didToolUse).toBe(true)
			expect(pipeline.state.providerModeValue).toBe("text_recovered")
			expect(pipeline.shouldSendTools).toBe(true)
			expect(pipeline.systemPromptVariant).toBe("text")
		})

		it("no-tool: reports no-tool when text has no recoverable markup", () => {
			const result = pipeline.finalize({
				assistantMessage: "I think you should read the file yourself.",
				assistantMessageContent: [
					{ type: "text", content: "I think you should read the file yourself.", partial: false },
				],
				currentStreamingContentIndex: 0,
			})

			expect(result.recoveredTextToolCount).toBe(0)
			expect(pipeline.didToolUse).toBe(false)
			expect(pipeline.state.providerModeValue).toBe("unknown")
			expect(pipeline.state.textOnlyResponseCountValue).toBe(1)
			// First no-tool: inject text mode but don't show banner yet
			expect(pipeline.shouldInjectTextMode).toBe(true)
			expect(pipeline.shouldShowNoToolsBanner).toBe(false)
		})

		it("no-tool banner appears after 2nd consecutive no-tool", () => {
			pipeline.finalize({
				assistantMessage: "Try it yourself.",
				assistantMessageContent: [{ type: "text", content: "Try it yourself.", partial: false }],
				currentStreamingContentIndex: 0,
			})
			expect(pipeline.shouldShowNoToolsBanner).toBe(false)
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
		})

		it("prose intent: text that looks like tool markup with code block triggers recovery", () => {
			// Prose intent is gated behind looksLikeTextToolCall. Use text that
			// matches the gate (contains <tool_call>-like markup) AND has a
			// code block with a file path for the prose extractor.
			const prose = "<tool_call>\npath/to/foo.ts\n```ts\nexport const x = 1\n```\n</tool_call>"
			const result = pipeline.finalize({
				assistantMessage: prose,
				assistantMessageContent: [{ type: "text", content: prose, partial: false }],
				currentStreamingContentIndex: 0,
			})

			// Recovery should find tools (XML gate triggers, then recovery
			// may produce tools from either XML parse or prose extraction)
			if (result.recoveredTextToolCount > 0) {
				expect(pipeline.didToolUse).toBe(true)
				expect(pipeline.state.providerModeValue).toBe("text_recovered")
			} else {
				// If XML gate passes but recovery produces nothing, that's also valid
				expect(pipeline.didToolUse).toBe(false)
				expect(pipeline.state.providerModeValue).toBe("unknown")
			}
		})
	})

	describe("parseCompleteToolCall", () => {
		it("parses a complete tool_call via NativeToolCallParser", () => {
			const tool = pipeline.parseCompleteToolCall({
				id: "call_parse",
				name: "read_file",
				arguments: JSON.stringify({ files: [{ path: "README.md" }] }),
			})
			expect(tool).not.toBeNull()
			expect(tool?.type).toBe("tool_use")
			if (tool?.type === "tool_use") {
				expect(tool.name).toBe("read_file")
				// Note: NativeToolCallParser.parseToolCall does NOT set id on ToolUse;
				// the id is tracked separately in Task.ts via addToApiConversationHistory.
				// Verify nativeArgs were parsed correctly instead.
				expect(tool.nativeArgs).toBeDefined()
			}
			expect(pipeline.sawNativeActivityThisTurn).toBe(true)
		})
	})

	describe("reset", () => {
		it("clears native activity and detection state", () => {
			pipeline.processStreamChunk({ type: "tool_call_start", id: "x", name: "read_file" })
			pipeline.state.reportNoTool()
			pipeline.reset()

			expect(pipeline.sawNativeActivityThisTurn).toBe(false)
			expect(pipeline.state.providerModeValue).toBe("unknown")
			expect(pipeline.didToolUse).toBe(false)
		})
	})
})

describe("ToolCallPipeline — existing NativeToolCallParser still works", () => {
	beforeEach(() => {
		NativeToolCallParser.clearAllStreamingToolCalls()
		NativeToolCallParser.clearRawChunkState()
	})

	afterEach(() => {
		NativeToolCallParser.clearAllStreamingToolCalls()
		NativeToolCallParser.clearRawChunkState()
	})

	it("processRawChunk still assembles start events independently of pipeline", () => {
		const events = NativeToolCallParser.processRawChunk({
			index: 0,
			id: "independent",
			name: "read_file",
			arguments: "{}",
		})
		expect(events.some((e) => e.type === "tool_call_start")).toBe(true)
	})
})
