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
				expect(tool.usedLegacyFormat).toBe(true)
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
})
