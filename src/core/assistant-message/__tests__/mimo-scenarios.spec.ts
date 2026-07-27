/**
 * End-to-end simulations of the two field-reported Xiaomi MiMo failure
 * scenarios, exercised against the REAL production pipeline pieces:
 *
 *   native path:  processRawChunk / startStreamingToolCall / processStreamingChunk
 *                 / finalizeStreamingToolCall  (what Task.ts drives per chunk)
 *   text path:    looksLikeTextToolCall + applyTextualToolCallRecovery
 *                 (what Task.ts runs post-stream)
 *
 * A tool block is "executable" exactly when the execution layer accepts it:
 * presentAssistantMessage requires an id, and BaseTool.handle requires
 * nativeArgs — both are asserted here.
 */
import { NativeToolCallParser } from "../NativeToolCallParser"
import { looksLikeTextToolCall } from "../TextToolCallParser"
import {
	applyTextualToolCallRecovery,
	hasExecutableNativeToolUse,
	type RecoverableAssistantBlock,
} from "../textToolCallRecovery"
import type { ToolUse } from "../../../shared/tools"

function expectExecutable(block: RecoverableAssistantBlock, toolName: string): ToolUse {
	expect(block.type).toBe("tool_use")
	const tool = block as ToolUse
	expect(tool.name).toBe(toolName)
	expect(tool.id).toBeDefined()
	expect(tool.id!.length).toBeGreaterThan(0)
	// BaseTool.handle hard-requirement: without nativeArgs the call fails with
	// "Tool call is missing native arguments (nativeArgs)."
	expect(tool.nativeArgs).toBeDefined()
	return tool
}

/** Simulate Task.ts's native chunk pipeline for one streamed tool call. */
function simulateNativeStream(name: string, argumentChunks: unknown[]): ToolUse | null {
	const id = "mimo_call_1"
	// First provider chunk carries id+name (this is what makes processRawChunk
	// emit tool_call_start and stop buffering deltas).
	NativeToolCallParser.processRawChunk({ index: 0, id, name })
	NativeToolCallParser.startStreamingToolCall(id, name)
	for (const chunk of argumentChunks) {
		// processRawChunk normalizes provider output (incl. non-string arguments)
		const events = NativeToolCallParser.processRawChunk({ index: 0, arguments: chunk })
		for (const event of events) {
			if (event.type === "tool_call_delta") {
				NativeToolCallParser.processStreamingChunk(id, event.delta)
			}
		}
	}
	return NativeToolCallParser.finalizeStreamingToolCall(id) as ToolUse | null
}

/** Simulate Task.ts's post-stream text recovery for a chunked text stream. */
function simulateTextRecovery(textChunks: string[]) {
	const assistantMessage = textChunks.join("")
	const recovered = applyTextualToolCallRecovery({
		assistantMessage,
		assistantMessageContent: [{ type: "text", content: assistantMessage, partial: true }],
		currentStreamingContentIndex: 0,
	})
	return { assistantMessage, recovered }
}

describe("MiMo field-failure scenarios (regression)", () => {
	beforeEach(() => {
		NativeToolCallParser.clearAllStreamingToolCalls()
		NativeToolCallParser.clearRawChunkState()
	})

	describe('Scenario (a): MiMo dedicated provider — "delete all the spec"', () => {
		it("A1: delete_spec emitted as text/XML markup → recovered into an executable tool", () => {
			const { recovered } = simulateTextRecovery([
				`I'll delete all specs now.\n<tool_call>\n<function=delete_spec>\n`,
				`<parameter=delete_all>true</parameter>\n</function>\n</tool_call>`,
			])
			expect(recovered.applied).toBe(true)
			expect(recovered.recoveredCount).toBe(1)
			const toolBlocks = recovered.assistantMessageContent.filter((b) => b.type === "tool_use")
			expect(toolBlocks).toHaveLength(1)
			const tool = expectExecutable(toolBlocks[0], "delete_spec")
			expect(tool.nativeArgs).toMatchObject({ delete_all: true })
			expect(hasExecutableNativeToolUse(recovered.assistantMessageContent)).toBe(true)
		})

		it("A2: delete_spec native tool_call with arguments truncated at max_tokens → salvaged", () => {
			// Previously: strict JSON.parse threw → finalize returned null → the block
			// executed without nativeArgs → "missing nativeArgs" serialization error.
			const result = simulateNativeStream("delete_spec", ['{"spec_ids": ["a1b2c3", "d4e5f6"], "title_cont'])
			expect(result).not.toBeNull()
			expect(result!.nativeArgs).toBeDefined()
			expect((result!.nativeArgs as { spec_ids?: string[] }).spec_ids).toEqual(["a1b2c3", "d4e5f6"])
		})

		it("A3: spawn_worker native tool_call with long message cut mid-string → salvaged", () => {
			// The exact reported failure: long multi-line message parameter, stream cut
			// at max_tokens → previously "missing nativeArgs".
			const truncatedArgs = [
				'{"name":"spec-cleaner","role":"Delete every spec in the workspace',
				' pack and verify with list_specs.","mode":null,"mes',
				'sage":"Step 1: call list_specs. Step 2: delete each spec by id. Step 3: conf',
			]
			const result = simulateNativeStream("spawn_worker", truncatedArgs)
			expect(result).not.toBeNull()
			const args = result!.nativeArgs as { name: string; message: string }
			expect(args.name).toBe("spec-cleaner")
			expect(args.message).toContain("Step 1: call list_specs.")
		})

		it("A4: spawn_worker as text/XML with multi-line message and multiple params → executable", () => {
			const { recovered } = simulateTextRecovery([
				`<tool_call>\n<function=spawn_worker>\n<parameter=name>researcher</parameter>\n`,
				`<parameter=message>Phase 1: list all specs.\nPhase 2: delete them one by one.\n`,
				`Phase 3: verify the workspace is empty.</parameter>\n`,
				`<parameter=mode>code</parameter>\n</function>\n</tool_call>`,
			])
			expect(recovered.applied).toBe(true)
			const tool = expectExecutable(
				recovered.assistantMessageContent.find((b) => b.type === "tool_use")!,
				"spawn_worker",
			)
			const args = tool.nativeArgs as { name: string; message: string; mode: string }
			expect(args.name).toBe("researcher")
			expect(args.message).toContain("Phase 2: delete them one by one.")
			expect(args.mode).toBe("code")
		})
	})

	describe("Scenario (b): MiMo via generic OpenAI Compatible — file listing command", () => {
		it("B1: execute_command as text/XML (verbatim reported shape) → recovered into an executable tool", () => {
			const { assistantMessage, recovered } = simulateTextRecovery([
				`<tool_call>\n<function=execute_command>\n`,
				`<parameter=command>ls -R "d:/New folder"</parameter>\n`,
				`<parameter=cwd>d:/New folder</parameter>\n`,
				`<parameter=timeout>10</parameter>\n</function>\n</tool_call>`,
			])
			// Task's mid-stream deferral gate must also recognize this shape.
			expect(looksLikeTextToolCall(assistantMessage)).toBe(true)
			expect(recovered.applied).toBe(true)
			const tool = expectExecutable(
				recovered.assistantMessageContent.find((b) => b.type === "tool_use")!,
				"execute_command",
			)
			expect(tool.nativeArgs).toEqual({
				command: 'ls -R "d:/New folder"',
				cwd: "d:/New folder",
				timeout: 10,
			})
			// Markup must not leak into the text shown to the user / sent back to the API.
			expect(recovered.assistantMessage).not.toContain("<tool_call>")
		})

		it("B2: same command arriving split across many small streaming chunks → recovered", () => {
			const full = `<tool_call>\n<function=execute_command>\n<parameter=command>ls -R "d:/New folder"</parameter>\n</function>\n</tool_call>`
			const chunks: string[] = []
			for (let i = 0; i < full.length; i += 7) {
				chunks.push(full.slice(i, i + 7))
			}
			const { recovered } = simulateTextRecovery(chunks)
			expect(recovered.applied).toBe(true)
			const tool = expectExecutable(
				recovered.assistantMessageContent.find((b) => b.type === "tool_use")!,
				"execute_command",
			)
			expect(tool.nativeArgs).toMatchObject({ command: 'ls -R "d:/New folder"' })
		})

		it("B3: native path still preferred — recovery does not fire when a native tool exists", () => {
			// Regression guard: valid native tool_calls must remain the untouched path.
			const nativeTool = simulateNativeStream("execute_command", ['{"command":"ls -R ."}'])
			expect(nativeTool).not.toBeNull()
			expect(nativeTool!.nativeArgs).toMatchObject({ command: "ls -R ." })

			const recovered = applyTextualToolCallRecovery({
				assistantMessage: "",
				assistantMessageContent: [{ ...nativeTool!, id: "mimo_call_1" } as RecoverableAssistantBlock],
				currentStreamingContentIndex: 1,
			})
			expect(recovered.applied).toBe(false)
		})
	})

	describe("Scenario (c): duplicate message regression — prose + markup must not double-emit", () => {
		/**
		 * Regression for the duplicate "Zoo said" message bug reported after the
		 * text/XML cleanup fix. The failure mode:
		 *
		 * 1. Model says clean prose ("I'll read the spec now.") — no markup in
		 *    the assistantMessage at that point, so the deferral gate does NOT
		 *    fire and the prose is said as a partial=true text message.
		 * 2. Model then emits `<tool_call>…` markup — deferral gate engages,
		 *    markup is suppressed from the stream but prose was already said.
		 * 3. Post-stream `applyTextualToolCallRecovery` fires, strips markup
		 *    from `assistantMessage`, and the Task stale-partial cleanup loop
		 *    must find the prose message and REPLACE it with the cleaned text
		 *    instead of calling `say("text", …)` again.
		 *
		 * The old stale-partial detection only matched messages containing
		 * markup text (`looksLikeTextToolCall(m.text)`). The prose message had
		 * no markup → not matched → `say("text", recovery.assistantMessage)`
		 * fired → the same prose appeared twice in the chat.
		 *
		 * This test simulates the recovery pipeline with a clineMessages array
		 * containing a prose-only partial message and asserts the cleanup
		 * produces exactly one text message, never two.
		 */
		it("prose said before markup must not be duplicated after recovery", () => {
			const proseText = "I'll read the spec now."
			const fullStream =
				proseText +
				"\n<tool_call>\n<function=read_spec>\n<parameter=doc>design</parameter>\n</function>\n</tool_call>"

			// Simulate recovery on the full accumulated stream
			const recovered = applyTextualToolCallRecovery({
				assistantMessage: fullStream,
				assistantMessageContent: [{ type: "text", content: fullStream, partial: true }] as any[],
				currentStreamingContentIndex: 0,
			})

			expect(recovered.applied).toBe(true)

			// The cleaned assistantMessage must contain the prose exactly once
			const cleanedText = recovered.assistantMessage.trim()
			const proseOccurrences = cleanedText.split(proseText).length - 1
			expect(proseOccurrences).toBe(1)

			// No markup should remain in the cleaned text
			expect(cleanedText).not.toContain("<tool_call>")
			expect(cleanedText).toContain(proseText)
		})

		it("pure markup stream (no prose) must leave assistantMessage empty after recovery", () => {
			const fullStream =
				"<tool_call>\n<function=read_spec>\n<parameter=doc>design</parameter>\n</function>\n</tool_call>"

			const recovered = applyTextualToolCallRecovery({
				assistantMessage: fullStream,
				assistantMessageContent: [{ type: "text", content: fullStream, partial: true }] as any[],
				currentStreamingContentIndex: 0,
			})

			expect(recovered.applied).toBe(true)
			// Pure markup: no prose to preserve
			expect(recovered.assistantMessage.trim()).toBe("")
		})

		it("mixed prose + markup: recovered tool_use must be present and executable", () => {
			const proseText = "Reading the design spec."
			const fullStream =
				proseText +
				"\n<tool_call>\n<function=read_spec>\n<parameter=doc>design</parameter>\n</function>\n</tool_call>"

			const recovered = applyTextualToolCallRecovery({
				assistantMessage: fullStream,
				assistantMessageContent: [{ type: "text", content: fullStream, partial: true }] as any[],
				currentStreamingContentIndex: 0,
			})

			expect(recovered.applied).toBe(true)
			const toolBlocks = recovered.assistantMessageContent.filter((b) => b.type === "tool_use")
			expect(toolBlocks).toHaveLength(1)
			const tool = toolBlocks[0] as any
			expect(tool.name).toBe("read_spec")
			expect(tool.nativeArgs).toBeDefined()
			expect(tool.nativeArgs.doc).toBe("design")
		})
	})
})
