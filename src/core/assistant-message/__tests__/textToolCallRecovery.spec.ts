// npx vitest run src/core/assistant-message/__tests__/textToolCallRecovery.spec.ts

import { describe, it, expect, beforeEach, vi } from "vitest"
import { applyTextualToolCallRecovery, hasExecutableNativeToolUse } from "../textToolCallRecovery"
import { resetTextToolCallSeqForTests } from "../TextToolCallParser"
import type { ToolUse } from "../../../shared/tools"

/** Production MiniMax write_spec shape that previously never executed. */
const PRODUCTION_WRITE_SPEC_XML = `<tool_call>
<function=write_spec>
<parameter=title>Gaming Website - Steam Clone</parameter>
<parameter=spec_id>None</parameter>
<parameter=doc>requirements</parameter>
<parameter=content># Gaming Website Requirements
Local storage for cart/wishlist persistence</parameter>
<parameter=section_heading>None</parameter>
<parameter=old_string>None</parameter>
<parameter=new_string>None</parameter>
<parameter=replace_all>None</parameter>
</function>
</tool_call>`

const JSON_LIST_FILES = `<tool_call>{"name":"list_files","arguments":{"path":".","recursive":false}}</tool_call>`

describe("textToolCallRecovery", () => {
	beforeEach(() => {
		resetTextToolCallSeqForTests()
	})

	describe("hasExecutableNativeToolUse", () => {
		it("returns false for text-only content", () => {
			expect(hasExecutableNativeToolUse([{ type: "text", content: "hi", partial: false }])).toBe(false)
		})

		it("returns false for tool_use without nativeArgs (incomplete stream shell)", () => {
			expect(
				hasExecutableNativeToolUse([
					{
						type: "tool_use",
						name: "write_spec",
						params: {},
						partial: true,
						id: "call_broken",
					} as ToolUse,
				]),
			).toBe(false)
		})

		it("returns true for tool_use with nativeArgs", () => {
			expect(
				hasExecutableNativeToolUse([
					{
						type: "tool_use",
						name: "list_files",
						params: {},
						partial: false,
						id: "call_ok",
						nativeArgs: { path: ".", recursive: false },
					} as ToolUse,
				]),
			).toBe(true)
		})

		it("returns true for mcp_tool_use", () => {
			expect(
				hasExecutableNativeToolUse([
					{
						type: "mcp_tool_use",
						name: "mcp--srv--tool",
						serverName: "srv",
						toolName: "tool",
						arguments: {},
						partial: false,
						id: "mcp1",
					} as any,
				]),
			).toBe(true)
		})
	})

	describe("applyTextualToolCallRecovery â€” MiniMax write_spec E2E state", () => {
		it("recovers production write_spec XML, sets partial=true, id+nativeArgs, clamps OOB index", () => {
			// Simulates: pure-markup stream deferred present (index may still be 0),
			// OR mid-stream text already advanced index past end after empty strip.
			const result = applyTextualToolCallRecovery({
				assistantMessage: PRODUCTION_WRITE_SPEC_XML,
				assistantMessageContent: [
					{
						type: "text",
						content: PRODUCTION_WRITE_SPEC_XML,
						partial: true,
					},
				],
				// After mid-stream present of text-only, index is often 1 (past end
				// once empty text is stripped). This is the original non-execution bug.
				currentStreamingContentIndex: 1,
			})

			expect(result.applied).toBe(true)
			expect(result.recoveredCount).toBe(1)
			expect(result.assistantMessage).not.toContain("<tool_call>")
			expect(result.assistantMessageContent).toHaveLength(1)

			const tool = result.assistantMessageContent[0]
			expect(tool.type).toBe("tool_use")
			expect((tool as ToolUse).name).toBe("write_spec")
			expect(tool.partial).toBe(true) // must join partialBlocks â†’ present after history
			expect((tool as ToolUse).id?.startsWith("text_call_")).toBe(true)
			expect((tool as ToolUse).nativeArgs).toMatchObject({
				title: "Gaming Website - Steam Clone",
				spec_id: null,
				doc: "requirements",
			})
			expect(((tool as ToolUse).nativeArgs as { content?: string }).content).toContain(
				"# Gaming Website Requirements",
			)

			// Index must land ON the recovered tool (not OOB past end).
			expect(result.currentStreamingContentIndex).toBe(0)
			expect(result.currentStreamingContentIndex).toBeLessThan(result.assistantMessageContent.length)

			// didToolUse equivalent: recovered tool_use counts as real tool use
			const didToolUse = result.assistantMessageContent.some(
				(b) => b.type === "tool_use" || b.type === "mcp_tool_use",
			)
			expect(didToolUse).toBe(true)
		})

		it("keeps leading prose text and does not skip it when index is still 0", () => {
			const text = `I'll create the spec now.\n${PRODUCTION_WRITE_SPEC_XML}`
			const result = applyTextualToolCallRecovery({
				assistantMessage: text,
				assistantMessageContent: [{ type: "text", content: text, partial: true }],
				currentStreamingContentIndex: 0,
			})

			expect(result.applied).toBe(true)
			expect(result.assistantMessageContent.length).toBe(2)
			expect(result.assistantMessageContent[0].type).toBe("text")
			expect((result.assistantMessageContent[0] as { content: string }).content).toContain(
				"I'll create the spec now",
			)
			expect((result.assistantMessageContent[1] as ToolUse).name).toBe("write_spec")
			// Must present text first, then tool â€” do not jump to firstRecoveredIndex.
			expect(result.currentStreamingContentIndex).toBe(0)
		})

		it("clamps OOB index after empty markup strip when index advanced mid-stream", () => {
			const result = applyTextualToolCallRecovery({
				assistantMessage: PRODUCTION_WRITE_SPEC_XML,
				assistantMessageContent: [{ type: "text", content: PRODUCTION_WRITE_SPEC_XML, partial: false }],
				currentStreamingContentIndex: 5, // far past end
			})
			expect(result.applied).toBe(true)
			expect(result.currentStreamingContentIndex).toBe(0)
			expect(result.assistantMessageContent[0].type).toBe("tool_use")
		})
	})

	describe("applyTextualToolCallRecovery â€” JSON tool_call still works", () => {
		it("recovers JSON-in-tags list_files", () => {
			const result = applyTextualToolCallRecovery({
				assistantMessage: JSON_LIST_FILES,
				assistantMessageContent: [{ type: "text", content: JSON_LIST_FILES, partial: true }],
				currentStreamingContentIndex: 1,
			})
			expect(result.applied).toBe(true)
			expect(result.recoveredCount).toBe(1)
			expect((result.assistantMessageContent[0] as ToolUse).name).toBe("list_files")
			expect((result.assistantMessageContent[0] as ToolUse).nativeArgs).toMatchObject({
				path: ".",
				recursive: false,
			})
			expect(result.currentStreamingContentIndex).toBe(0)
		})
	})

	describe("applyTextualToolCallRecovery â€” native path remains primary", () => {
		it("does not recover when executable native tool already present", () => {
			const native: ToolUse = {
				type: "tool_use",
				name: "list_files",
				params: {},
				partial: false,
				id: "native_1",
				nativeArgs: { path: "src", recursive: true },
			} as ToolUse

			const result = applyTextualToolCallRecovery({
				assistantMessage: PRODUCTION_WRITE_SPEC_XML,
				assistantMessageContent: [native],
				currentStreamingContentIndex: 0,
			})

			expect(result.applied).toBe(false)
			expect(result.recoveredCount).toBe(0)
			expect(result.assistantMessageContent).toHaveLength(1)
			expect(result.assistantMessageContent[0]).toMatchObject({ id: "native_1" })
		})

		it("recovers when only incomplete native shell exists (no nativeArgs)", () => {
			const shell: ToolUse = {
				type: "tool_use",
				name: "write_spec",
				params: {},
				partial: true,
				id: "call_incomplete",
			} as ToolUse

			const result = applyTextualToolCallRecovery({
				assistantMessage: PRODUCTION_WRITE_SPEC_XML,
				assistantMessageContent: [{ type: "text", content: PRODUCTION_WRITE_SPEC_XML, partial: true }, shell],
				currentStreamingContentIndex: 0,
			})

			expect(result.applied).toBe(true)
			// Incomplete shell dropped; recovered tool appended
			const tools = result.assistantMessageContent.filter((b) => b.type === "tool_use")
			expect(tools).toHaveLength(1)
			expect((tools[0] as ToolUse).id?.startsWith("text_call_")).toBe(true)
			expect((tools[0] as ToolUse).nativeArgs).toBeDefined()
		})
	})

	describe("applyTextualToolCallRecovery â€” streaming / incomplete / unknown", () => {
		it("recovers unclosed MiniMax function (stream truncation)", () => {
			const truncated = `<tool_call>
<function=list_files>
<parameter=path>.</parameter>
<parameter=recursive>false</parameter>`
			const result = applyTextualToolCallRecovery({
				assistantMessage: truncated,
				assistantMessageContent: [{ type: "text", content: truncated, partial: true }],
				currentStreamingContentIndex: 0,
			})
			expect(result.applied).toBe(true)
			expect(
				result.assistantMessageContent.some(
					(b) => b.type === "tool_use" && (b as ToolUse).name === "list_files",
				),
			).toBe(true)
		})

		it("does not apply for plain prose (no false recovery)", () => {
			const result = applyTextualToolCallRecovery({
				assistantMessage: "Just thinking about the plan.",
				assistantMessageContent: [{ type: "text", content: "Just thinking about the plan.", partial: false }],
				currentStreamingContentIndex: 0,
			})
			expect(result.applied).toBe(false)
			expect(result.recoveredCount).toBe(0)
		})

		it("strips markup when only unknown tool names are present (no recovery, but no raw XML leak)", () => {
			const text = `<tool_call>
<function=definitely_not_a_real_tool>
<parameter=x>1</parameter>
</function>
</tool_call>`
			const result = applyTextualToolCallRecovery({
				assistantMessage: text,
				assistantMessageContent: [{ type: "text", content: text, partial: true }],
				currentStreamingContentIndex: 0,
			})
			// No valid tools recovered, but markup IS stripped from display
			expect(result.recoveredCount).toBe(0)
			expect(result.applied).toBe(true) // applied=true because message changed
			expect(result.assistantMessage).toBe("")
			expect(result.assistantMessage).not.toContain("<tool_call>")
		})
	})
})

describe("textToolCallRecovery â†’ presentAssistantMessage write_spec path", () => {
	it("recovered write_spec has id + nativeArgs required by BaseTool / presentAssistantMessage", () => {
		const result = applyTextualToolCallRecovery({
			assistantMessage: PRODUCTION_WRITE_SPEC_XML,
			assistantMessageContent: [{ type: "text", content: PRODUCTION_WRITE_SPEC_XML, partial: true }],
			currentStreamingContentIndex: 1,
		})

		const tool = result.assistantMessageContent.find((b) => b.type === "tool_use") as ToolUse
		expect(tool).toBeDefined()
		// presentAssistantMessage rejects missing id as legacy XML
		expect(tool.id).toBeTruthy()
		// BaseTool.handle requires nativeArgs
		expect(tool.nativeArgs).toBeDefined()
		expect((tool.nativeArgs as any).doc).toBe("requirements")

		// Simulate post-stream partialBlocks flip (Task does this before present)
		tool.partial = false
		expect(tool.partial).toBe(false)
	})
})
