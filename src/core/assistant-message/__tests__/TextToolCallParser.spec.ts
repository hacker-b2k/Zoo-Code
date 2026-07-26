import { looksLikeTextToolCall, parseTextToolCalls, resetTextToolCallSeqForTests } from "../TextToolCallParser"

describe("TextToolCallParser", () => {
	beforeEach(() => {
		resetTextToolCallSeqForTests()
	})

	describe("looksLikeTextToolCall", () => {
		it("detects <tool_call> tags", () => {
			expect(looksLikeTextToolCall('<tool_call>{"name":"ask_followup_question"}</tool_call>')).toBe(true)
		})

		it("detects <function_call> tags", () => {
			expect(looksLikeTextToolCall("<function_call>{}</function_call>")).toBe(true)
		})

		it("detects MiniMax <function=…> markup", () => {
			expect(
				looksLikeTextToolCall("<function=write_spec><parameter=doc>requirements</parameter></function>"),
			).toBe(true)
		})

		it("does not treat bare <parameter= as a tool call surface", () => {
			// Avoid false positives on docs/prose that mention parameter tags alone.
			expect(looksLikeTextToolCall("<parameter=title>x</parameter>")).toBe(false)
		})

		it("returns false for plain prose", () => {
			expect(looksLikeTextToolCall("Hello, how can I help?")).toBe(false)
		})
	})

	describe("parseTextToolCalls — qwen/logfare format", () => {
		it("recovers ask_followup_question from JSON inside <tool_call>", () => {
			const text = `<tool_call>
{"name": "ask_followup_question", "arguments": {"question": "What would you like to do?", "follow_up": [{"text": "Continue", "mode": null}, {"text": "Stop", "mode": null}]}}
</tool_call>`

			const result = parseTextToolCalls(text)

			expect(result.recovered).toBe(true)
			expect(result.toolUses).toHaveLength(1)
			const tool = result.toolUses[0]
			expect(tool.type).toBe("tool_use")
			expect(tool.name).toBe("ask_followup_question")
			expect(tool.id).toBeDefined()
			expect(tool.id!.startsWith("text_call_")).toBe(true)
			expect(tool.partial).toBe(false)
			if (tool.type === "tool_use") {
				// Recovered tools use nativeArgs path — not the legacy file-param flag
				expect(tool.usedLegacyFormat).toBeUndefined()
				expect(tool.nativeArgs).toMatchObject({
					question: "What would you like to do?",
				})
			}
			expect(result.cleanedText.trim()).toBe("")
		})

		it("preserves surrounding prose and strips only the markup", () => {
			const text = `Sure, let me ask.\n<tool_call>{"name":"ask_followup_question","arguments":{"question":"OK?","follow_up":[{"text":"Yes","mode":null}]}}</tool_call>\nThanks.`

			const result = parseTextToolCalls(text)

			expect(result.recovered).toBe(true)
			expect(result.toolUses[0].name).toBe("ask_followup_question")
			expect(result.cleanedText).toContain("Sure, let me ask.")
			expect(result.cleanedText).toContain("Thanks.")
			expect(result.cleanedText).not.toContain("<tool_call>")
		})

		it("accepts parameters key as alias for arguments", () => {
			const text = `<tool_call>{"name":"list_files","parameters":{"path":".","recursive":false}}</tool_call>`
			const result = parseTextToolCalls(text)
			expect(result.recovered).toBe(true)
			expect(result.toolUses[0].name).toBe("list_files")
		})

		it("accepts name attribute form", () => {
			const text = `<tool_call name="list_files">{"path":"src","recursive":true}</tool_call>`
			const result = parseTextToolCalls(text)
			expect(result.recovered).toBe(true)
			expect(result.toolUses[0].name).toBe("list_files")
			if (result.toolUses[0].type === "tool_use") {
				expect(result.toolUses[0].nativeArgs).toMatchObject({ path: "src" })
			}
		})

		it("recovers multiple tool calls in one message", () => {
			const text = `
<tool_call>{"name":"list_files","arguments":{"path":".","recursive":false}}</tool_call>
<tool_call>{"name":"ask_followup_question","arguments":{"question":"Next?","follow_up":[{"text":"A","mode":null}]}}</tool_call>
`
			const result = parseTextToolCalls(text)
			expect(result.recovered).toBe(true)
			expect(result.toolUses).toHaveLength(2)
			expect(result.toolUses[0].name).toBe("list_files")
			expect(result.toolUses[1].name).toBe("ask_followup_question")
			expect(result.toolUses[0].id).not.toBe(result.toolUses[1].id)
		})

		it("accepts function_call tag alias", () => {
			const text = `<function_call>{"name":"list_files","arguments":{"path":".","recursive":false}}</function_call>`
			const result = parseTextToolCalls(text)
			expect(result.recovered).toBe(true)
			expect(result.toolUses[0].name).toBe("list_files")
		})

		it("returns recovered:false for text without tool markup", () => {
			const result = parseTextToolCalls("Just a normal reply with no tools.")
			expect(result.recovered).toBe(false)
			expect(result.toolUses).toHaveLength(0)
			expect(result.cleanedText).toBe("Just a normal reply with no tools.")
		})

		it("skips invalid tool names without throwing", () => {
			const text = `<tool_call>{"name":"definitely_not_a_real_tool","arguments":{}}</tool_call>`
			const result = parseTextToolCalls(text)
			// parseToolCall returns null for unknown tools → no recovery
			expect(result.recovered).toBe(false)
			expect(result.toolUses).toHaveLength(0)
		})

		it("handles stringified arguments field", () => {
			const text = `<tool_call>{"name":"list_files","arguments":"{\\"path\\":\\".\\",\\"recursive\\":false}"}</tool_call>`
			const result = parseTextToolCalls(text)
			expect(result.recovered).toBe(true)
			expect(result.toolUses[0].name).toBe("list_files")
		})
	})

	describe("parseTextToolCalls — MiniMax / Hermes XML (function=/parameter=)", () => {
		it("recovers skill tool from production MiniMax payload", () => {
			const text = `<tool_call>
<function=skill>
<parameter=skill>frontend-design</parameter>
<parameter=args>Create a beautiful gaming website like Steam with game store, library, community features</parameter>
</function>
</tool_call>`

			const result = parseTextToolCalls(text)
			expect(result.recovered).toBe(true)
			expect(result.toolUses).toHaveLength(1)
			expect(result.toolUses[0].name).toBe("skill")
			expect(result.toolUses[0].id!.startsWith("text_call_")).toBe(true)
			if (result.toolUses[0].type === "tool_use") {
				expect(result.toolUses[0].nativeArgs).toEqual({
					skill: "frontend-design",
					args: "Create a beautiful gaming website like Steam with game store, library, community features",
				})
			}
			expect(result.cleanedText.trim()).toBe("")
		})

		it("recovers write_spec from the exact production failure shape", () => {
			// Mirrors user screenshot: model emits XML tool markup as assistant text
			// → previously "Zoo is having trouble" / Model Response Incomplete.
			const text = `<tool_call>
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

			const result = parseTextToolCalls(text)

			expect(result.recovered).toBe(true)
			expect(result.toolUses).toHaveLength(1)
			const tool = result.toolUses[0]
			expect(tool.type).toBe("tool_use")
			expect(tool.name).toBe("write_spec")
			expect(tool.id!.startsWith("text_call_")).toBe(true)
			expect(tool.partial).toBe(false)
			if (tool.type === "tool_use") {
				expect(tool.usedLegacyFormat).toBeUndefined()
				expect(tool.nativeArgs).toMatchObject({
					title: "Gaming Website - Steam Clone",
					spec_id: null,
					doc: "requirements",
				})
				expect((tool.nativeArgs as { content?: string }).content).toContain("# Gaming Website Requirements")
			}
			expect(result.cleanedText).not.toContain("<tool_call>")
			expect(result.cleanedText).not.toContain("<function=")
		})

		it("recovers bare <function=list_files> without outer tool_call", () => {
			const text = `<function=list_files>
<parameter=path>.</parameter>
<parameter=recursive>false</parameter>
</function>`

			const result = parseTextToolCalls(text)
			expect(result.recovered).toBe(true)
			expect(result.toolUses[0].name).toBe("list_files")
			if (result.toolUses[0].type === "tool_use") {
				expect(result.toolUses[0].nativeArgs).toMatchObject({ path: ".", recursive: false })
			}
		})

		it("recovers unclosed tool_call / function (stream truncation)", () => {
			const text = `<tool_call>
<function=list_files>
<parameter=path>src</parameter>
<parameter=recursive>true</parameter>`

			const result = parseTextToolCalls(text)
			expect(result.recovered).toBe(true)
			expect(result.toolUses[0].name).toBe("list_files")
			if (result.toolUses[0].type === "tool_use") {
				expect(result.toolUses[0].nativeArgs).toMatchObject({ path: "src", recursive: true })
			}
		})

		it("coerces None/null parameter sentinels on write_spec optional fields", () => {
			const text = `<function=write_spec>
<parameter=title>Pack</parameter>
<parameter=spec_id>None</parameter>
<parameter=doc>design</parameter>
<parameter=content># Design</parameter>
<parameter=section_heading>None</parameter>
<parameter=old_string>null</parameter>
<parameter=new_string>undefined</parameter>
</function>`
			const result = parseTextToolCalls(text)
			expect(result.recovered).toBe(true)
			expect(result.toolUses[0].name).toBe("write_spec")
			if (result.toolUses[0].type === "tool_use") {
				expect(result.toolUses[0].nativeArgs).toMatchObject({
					title: "Pack",
					spec_id: null,
					doc: "design",
					content: "# Design",
				})
				// Optional sentinels omitted — not literal "None"
				expect((result.toolUses[0].nativeArgs as Record<string, unknown>).section_heading).toBeUndefined()
				expect((result.toolUses[0].nativeArgs as Record<string, unknown>).old_string).toBeUndefined()
				expect((result.toolUses[0].nativeArgs as Record<string, unknown>).new_string).toBeUndefined()
			}
		})

		it("recovers ask_followup_question with JSON follow_up inside parameter body", () => {
			const text = `<function=ask_followup_question>
<parameter=question>Ready?</parameter>
<parameter=follow_up>[{"text":"Yes","mode":null}]</parameter>
</function>`
			const result = parseTextToolCalls(text)
			expect(result.recovered).toBe(true)
			expect(result.toolUses[0].name).toBe("ask_followup_question")
		})

		it("does not recover when only unknown tool names are present", () => {
			const text = `<tool_call>
<function=not_a_real_tool>
<parameter=x>1</parameter>
</function>
</tool_call>`
			const result = parseTextToolCalls(text)
			expect(result.recovered).toBe(false)
			expect(result.toolUses).toHaveLength(0)
		})

		it("recovers multiple bare MiniMax functions", () => {
			const text = `
<function=list_files>
<parameter=path>.</parameter>
<parameter=recursive>false</parameter>
</function>
<function=list_files>
<parameter=path>src</parameter>
<parameter=recursive>true</parameter>
</function>`
			const result = parseTextToolCalls(text)
			expect(result.recovered).toBe(true)
			expect(result.toolUses).toHaveLength(2)
			expect(result.toolUses[0].id).not.toBe(result.toolUses[1].id)
		})

		it("strips MiniMax markup from surrounding prose", () => {
			const text = `Planning next step.
<tool_call>
<function=list_files>
<parameter=path>.</parameter>
<parameter=recursive>false</parameter>
</function>
</tool_call>
Done.`
			const result = parseTextToolCalls(text)
			expect(result.recovered).toBe(true)
			expect(result.cleanedText).toContain("Planning next step.")
			expect(result.cleanedText).toContain("Done.")
			expect(result.cleanedText).not.toContain("<function=")
		})
	})
})
