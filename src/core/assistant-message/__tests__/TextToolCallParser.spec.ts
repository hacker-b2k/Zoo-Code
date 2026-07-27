import {
	looksLikeTextToolCall,
	parseTextToolCalls,
	resetTextToolCallSeqForTests,
	textEndsWithIncompleteMarkup,
} from "../TextToolCallParser"

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

	describe("textEndsWithIncompleteMarkup", () => {
		it("detects partial opening tag tails", () => {
			expect(textEndsWithIncompleteMarkup("Some prose <to")).toBe(true)
			expect(textEndsWithIncompleteMarkup("Some prose <tool_cal")).toBe(true)
			expect(textEndsWithIncompleteMarkup("Some prose <")).toBe(true)
			expect(textEndsWithIncompleteMarkup("Some prose <function=execute_comma")).toBe(true)
		})

		it("detects partial closing tag tails", () => {
			expect(textEndsWithIncompleteMarkup("value </par")).toBe(true)
			expect(textEndsWithIncompleteMarkup("value </")).toBe(false) // bare "</" without a letter is not tag-ish
		})

		it("detects partial markdown fence tails", () => {
			expect(textEndsWithIncompleteMarkup("Here is the call:\n```")).toBe(true)
			expect(textEndsWithIncompleteMarkup("Here is the call:\n```jso")).toBe(true)
		})

		it("returns false for complete tags and plain prose", () => {
			expect(textEndsWithIncompleteMarkup("Some prose <b>bold</b>")).toBe(false)
			expect(textEndsWithIncompleteMarkup("Plain sentence.")).toBe(false)
			expect(textEndsWithIncompleteMarkup("Use `read_file` for that")).toBe(false) // single backticks are fine
			expect(textEndsWithIncompleteMarkup("a < b")).toBe(false)
			expect(textEndsWithIncompleteMarkup("")).toBe(false)
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

	describe("parseTextToolCalls — Xiaomi MiMo documented format", () => {
		it("recovers the exact MiMo execute_command payload from the field report", () => {
			// Verbatim shape from the user report: MiMo emits this inside
			// message.content instead of native tool_calls.
			const text = `<tool_call>
<function=execute_command>
<parameter=command>ls -R "d:/New folder"</parameter>
<parameter=cwd>d:/New folder</parameter>
<parameter=timeout>10</parameter>
</function>
</tool_call>`

			const result = parseTextToolCalls(text)
			expect(result.recovered).toBe(true)
			expect(result.toolUses).toHaveLength(1)
			expect(result.toolUses[0].name).toBe("execute_command")
			if (result.toolUses[0].type === "tool_use") {
				expect(result.toolUses[0].nativeArgs).toEqual({
					command: 'ls -R "d:/New folder"',
					cwd: "d:/New folder",
					timeout: 10,
				})
			}
		})

		it("recovers MiMo delete_spec with delete_all", () => {
			const text = `<tool_call>
<function=delete_spec>
<parameter=delete_all>true</parameter>
</function>
</tool_call>`
			const result = parseTextToolCalls(text)
			expect(result.recovered).toBe(true)
			expect(result.toolUses[0].name).toBe("delete_spec")
			if (result.toolUses[0].type === "tool_use") {
				expect(result.toolUses[0].nativeArgs).toMatchObject({ delete_all: true })
			}
		})

		it("recovers spawn_worker with long multi-line message containing quotes and JSON", () => {
			const text = `<tool_call>
<function=spawn_worker>
<parameter=name>researcher</parameter>
<parameter=mode>code</parameter>
<parameter=message>Investigate the parser.
Steps:
1. Read {"path": "src/index.ts"}
2. Run <command>npm test</command> and report "quoted" results.</parameter>
</function>
</tool_call>`
			const result = parseTextToolCalls(text)
			expect(result.recovered).toBe(true)
			expect(result.toolUses[0].name).toBe("spawn_worker")
			if (result.toolUses[0].type === "tool_use") {
				const args = result.toolUses[0].nativeArgs as { name: string; message: string }
				expect(args.name).toBe("researcher")
				expect(args.message).toContain("Investigate the parser.")
				expect(args.message).toContain('"quoted" results.')
			}
		})
	})

	describe("parseTextToolCalls — tolerant parameter scanner", () => {
		it("recovers Anthropic/invoke style with name attributes", () => {
			const text = `<tool_call>
<invoke name="read_file">
<parameter name="path">src/index.ts</parameter>
</invoke>
</tool_call>`
			const result = parseTextToolCalls(text)
			expect(result.recovered).toBe(true)
			expect(result.toolUses).toHaveLength(1) // no duplicate across passes
			expect(result.toolUses[0].name).toBe("read_file")
			if (result.toolUses[0].type === "tool_use") {
				expect(result.toolUses[0].nativeArgs).toMatchObject({ path: "src/index.ts" })
			}
		})

		it("recovers bare <invoke name=…> without an outer wrapper", () => {
			const text = `<invoke name="list_files">
<parameter name="path">.</parameter>
<parameter name="recursive">true</parameter>
</invoke>`
			const result = parseTextToolCalls(text)
			expect(result.recovered).toBe(true)
			expect(result.toolUses[0].name).toBe("list_files")
			if (result.toolUses[0].type === "tool_use") {
				expect(result.toolUses[0].nativeArgs).toMatchObject({ path: ".", recursive: true })
			}
		})

		it("recovers an unclosed trailing parameter (stream cut before </parameter>)", () => {
			const text = `<tool_call>
<function=execute_command>
<parameter=command>ls -la
</function>
</tool_call>`
			const result = parseTextToolCalls(text)
			expect(result.recovered).toBe(true)
			if (result.toolUses[0].type === "tool_use") {
				expect(result.toolUses[0].nativeArgs).toEqual({ command: "ls -la", cwd: undefined, timeout: undefined })
			}
		})

		it("recovers parameters with no closing </parameter> tags at all", () => {
			const text = `<tool_call>
<function=spawn_worker>
<parameter=name>researcher
<parameter=message>Do the thing
</function>
</tool_call>`
			const result = parseTextToolCalls(text)
			expect(result.recovered).toBe(true)
			if (result.toolUses[0].type === "tool_use") {
				expect(result.toolUses[0].nativeArgs).toMatchObject({
					name: "researcher",
					message: "Do the thing",
				})
			}
		})

		it("recovers a stream truncated mid-value (max_tokens cut)", () => {
			const text = `<tool_call>
<function=spawn_worker>
<parameter=name>researcher</parameter>
<parameter=message>Investigate the parser thoroughly. Step 1: read the`
			const result = parseTextToolCalls(text)
			expect(result.recovered).toBe(true)
			if (result.toolUses[0].type === "tool_use") {
				expect(result.toolUses[0].nativeArgs).toMatchObject({
					name: "researcher",
					message: "Investigate the parser thoroughly. Step 1: read the",
				})
			}
		})

		it("recovers a stream truncated mid-closing-tag and strips the partial tag", () => {
			const text = `<tool_call>
<function=execute_command>
<parameter=command>ls -la /tmp</par`
			const result = parseTextToolCalls(text)
			expect(result.recovered).toBe(true)
			if (result.toolUses[0].type === "tool_use") {
				expect(result.toolUses[0].nativeArgs).toEqual({
					command: "ls -la /tmp",
					cwd: undefined,
					timeout: undefined,
				})
			}
		})

		it("decodes XML entities inside parameter values", () => {
			const text = `<tool_call>
<function=write_to_file>
<parameter=path>test.txt</parameter>
<parameter=content>if (a &lt; b &amp;&amp; c &gt; d) { return &quot;x&quot;; }</parameter>
</function>
</tool_call>`
			const result = parseTextToolCalls(text)
			expect(result.recovered).toBe(true)
			if (result.toolUses[0].type === "tool_use") {
				expect(result.toolUses[0].nativeArgs).toEqual({
					path: "test.txt",
					content: 'if (a < b && c > d) { return "x"; }',
				})
			}
		})

		it("decodes entities with correct &amp; precedence (&amp;lt; → literal &lt;)", () => {
			const text = `<function=write_to_file>
<parameter=path>x.txt</parameter>
<parameter=content>&amp;lt;tag&amp;gt;</parameter>
</function>`
			const result = parseTextToolCalls(text)
			expect(result.recovered).toBe(true)
			if (result.toolUses[0].type === "tool_use") {
				expect(result.toolUses[0].nativeArgs).toEqual({ path: "x.txt", content: "&lt;tag&gt;" })
			}
		})
	})

	describe("parseTextToolCalls — markdown-fenced JSON tool calls", () => {
		it("recovers a bare fenced JSON tool call with no XML wrapper", () => {
			const text = '```json\n{"name":"list_files","arguments":{"path":"."}}\n```'
			const result = parseTextToolCalls(text)
			expect(result.recovered).toBe(true)
			expect(result.toolUses[0].name).toBe("list_files")
			expect(result.cleanedText.trim()).toBe("")
		})

		it("recovers fenced JSON inside <tool_call> tags", () => {
			const text = `<tool_call>\n\`\`\`json\n{"name":"list_files","arguments":{"path":"."}}\n\`\`\`\n</tool_call>`
			const result = parseTextToolCalls(text)
			expect(result.recovered).toBe(true)
			expect(result.toolUses[0].name).toBe("list_files")
		})

		it("recovers fenced JSON with nested arguments object", () => {
			const text = '```json\n{"name":"spawn_worker","arguments":{"name":"w1","message":"line1\\nline2"}}\n```'
			const result = parseTextToolCalls(text)
			expect(result.recovered).toBe(true)
			if (result.toolUses[0].type === "tool_use") {
				expect(result.toolUses[0].nativeArgs).toMatchObject({ name: "w1", message: "line1\nline2" })
			}
		})

		it("does NOT recover fenced JSON that is not a valid tool call (false-positive guard)", () => {
			const text = 'Here is an example:\n```json\n{"name":"just-data","value":1}\n```\nHope that helps.'
			const result = parseTextToolCalls(text)
			expect(result.recovered).toBe(false)
			expect(result.toolUses).toHaveLength(0)
			expect(result.cleanedText).toBe(text)
		})

		it("looksLikeTextToolCall detects fenced tool-call JSON", () => {
			expect(looksLikeTextToolCall('```json\n{"name":"list_files","arguments":{"path":"."}}\n```')).toBe(true)
		})

		it("looksLikeTextToolCall ignores fenced JSON without an arguments-like key", () => {
			expect(looksLikeTextToolCall('```json\n{"name":"just-data","value":1}\n```')).toBe(false)
		})
	})

	describe("parseTextToolCalls — mixed and chunked delivery", () => {
		it("recovers multiple tool calls of mixed formats in one response", () => {
			const text = `<tool_call><function=execute_command><parameter=command>ls</parameter></function></tool_call>
Some text between.
<tool_call>{"name":"list_files","arguments":{"path":"."}}</tool_call>`
			const result = parseTextToolCalls(text)
			expect(result.recovered).toBe(true)
			expect(result.toolUses).toHaveLength(2)
			expect(result.toolUses[0].name).toBe("execute_command")
			expect(result.toolUses[1].name).toBe("list_files")
			expect(result.cleanedText).toContain("Some text between.")
			expect(result.cleanedText).not.toContain("<tool_call>")
		})

		it("recovers from text that was accumulated across arbitrary streaming chunk splits", () => {
			// Chunked delivery: the full assistantMessage is identical regardless of
			// where stream chunk boundaries fell, so parsing the concatenation must
			// recover the same tool call.
			const chunks = [
				"<too",
				"l_call>\n<func",
				"tion=execute_command>\n<parameter=com",
				"mand>ls -R /s",
				"rc</parameter>\n</functi",
				"on>\n</tool_call>",
			]
			const assembled = chunks.join("")
			const result = parseTextToolCalls(assembled)
			expect(result.recovered).toBe(true)
			expect(result.toolUses[0].name).toBe("execute_command")
			if (result.toolUses[0].type === "tool_use") {
				expect(result.toolUses[0].nativeArgs).toEqual({
					command: "ls -R /src",
					cwd: undefined,
					timeout: undefined,
				})
			}
		})

		it("fails gracefully on malformed garbage that merely looks tag-ish", () => {
			const text = `<tool_call><function=><parameter=>junk</parameter></function></tool_call>`
			expect(() => parseTextToolCalls(text)).not.toThrow()
			const result = parseTextToolCalls(text)
			expect(result.recovered).toBe(false)
			expect(result.toolUses).toHaveLength(0)
		})
	})
})
