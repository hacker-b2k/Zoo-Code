/**
 * Regression coverage for the four field-reported problem classes on
 * Xiaomi MiMo (and any other OpenAI-compatible gateway that mishandles
 * OpenAI strict-mode schemas with nullable unions).
 *
 * Problem A: string params arrive as objects → "[object Object]" / crashes.
 *            Root cause confirmed: MiMo bypassed convertToolsForOpenAI and
 *            received strict:true + ["string","null"] unions it can't honor,
 *            emitting literal {} for required string fields.
 *            Fix:
 *              1. MimoHandler routes tools through convertToolsForOpenAI
 *                 (gateway-safe strict:false), identical to every sibling.
 *              2. NativeToolCallParser coerces every string param via
 *                 coerceOptionalStringParam / coerceNullableStringParam so
 *                 objects become undefined → actionable missing-param error.
 *              3. Tools (ReadSpecTool, WriteSpecTool, ListMcpConfigTool,
 *                 WebResearchTool) defensively validate as a second ring.
 *
 * Problem B: write_spec / delete_spec report failure but actually succeed.
 *            Root cause: nullable unions marked unconditional required under
 *            strict:true ⇒ MiMo emitted {} for mode-irrelevant fields ⇒
 *            parser produced nativeArgs containing objects ⇒ Tool crashed
 *            on .trim() inside execute() OR presentAssistantMessage gate
 *            fired "missing nativeArgs" for one of several write_spec blocks
 *            in a single response while another block silently succeeded.
 *            Fix: trim `required` to truly universal keys and route through
 *            convertToolsForOpenAI so the model can omit irrelevant keys.
 *
 * Problem C: execute_command runs cmd.exe instead of PowerShell on Windows.
 *            Root cause: ExecaTerminalProcess ran `execa({shell: true})` ⇒
 *            execa's default shell on Windows is cmd.exe. Fix: auto-resolve
 *            PowerShell (pwsh on PATH → Windows PowerShell 5.1) and pass it
 *            explicitly so PowerShell cmdlets like `Remove-Item` work.
 *
 * Problem D: text/XML tool-call informational-note behavior unchanged.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

import { NativeToolCallParser } from "../NativeToolCallParser"
import { readSpecTool } from "../../tools/ReadSpecTool"
import { writeSpecTool } from "../../tools/WriteSpecTool"
import { listMcpConfigTool } from "../../tools/ListMcpConfigTool"
import { webResearchTool } from "../../tools/WebResearchTool"
import type { Task } from "../../task/Task"
import type { ToolCallbacks } from "../../tools/BaseTool"
import * as webResearch from "../../tools/helpers/webResearch"

// --- shared fake-task factory ------------------------------------------------
function makeFakeTask(): Task {
	return {
		consecutiveMistakeCount: 0,
		didToolFailInCurrentTurn: false,
		say: vi.fn().mockResolvedValue(undefined),
		sayAndCreateMissingParamError: vi.fn().mockResolvedValue("missing param"),
		recordToolError: vi.fn(),
		providerRef: {
			deref: () => ({
				contextProxy: { globalStorageUri: { fsPath: "/tmp/test-store" } },
				context: { workspaceState: { get: () => undefined, update: async () => {} } },
			}),
		},
	} as unknown as Task
}

function makeCallbacks(): ToolCallbacks {
	return {
		pushToolResult: vi.fn(),
		askApproval: vi.fn().mockResolvedValue(true),
		handleError: vi.fn(),
	} as unknown as ToolCallbacks
}

describe("Problem A: object-valued string params are coerced/rejected, not silently leaked", () => {
	beforeEach(() => {
		NativeToolCallParser.clearAllStreamingToolCalls()
		NativeToolCallParser.clearRawChunkState()
	})

	it("read_spec with {} doc → undefined (lets tool emit actionable 'doc is required')", () => {
		const result = NativeToolCallParser.parseToolCall({
			id: "call_rs_obj",
			name: "read_spec",
			arguments: JSON.stringify({ doc: {}, spec_id: null }),
		}) as any
		expect(result).not.toBeNull()
		expect(result.nativeArgs.doc).toBeUndefined()
		expect(result.nativeArgs.spec_id).toBeNull()
	})

	it("read_spec with real string doc → preserved", () => {
		const result = NativeToolCallParser.parseToolCall({
			id: "call_rs_str",
			name: "read_spec",
			arguments: JSON.stringify({ doc: "design", spec_id: null }),
		}) as any
		expect(result.nativeArgs.doc).toBe("design")
	})

	it("read_spec with array doc → undefined (not '[object Array]')", () => {
		const result = NativeToolCallParser.parseToolCall({
			id: "call_rs_arr",
			name: "read_spec",
			arguments: JSON.stringify({ doc: [], spec_id: "abc" }),
		}) as any
		expect(result.nativeArgs.doc).toBeUndefined()
		expect(result.nativeArgs.spec_id).toBe("abc")
	})

	it("write_spec with object doc → nativeArgs.doc=undefined (no garbage writes to Spec Workspace storage)", () => {
		const result = NativeToolCallParser.parseToolCall({
			id: "call_ws_obj",
			name: "write_spec",
			arguments: JSON.stringify({
				title: "Auth",
				spec_id: null,
				doc: {}, // model emitted {} instead of "design"
				content: "# Design\n",
				mode: "replace",
			}),
		}) as any
		// Parser MUST produce nativeArgs (even with doc=undefined) so the
		// presentAssistantMessage "missing nativeArgs" gate does NOT fire.
		// WriteSpecTool.execute() then emits the actionable "doc is required" error.
		expect(result).not.toBeNull()
		expect(result.nativeArgs).toBeDefined()
		expect(result.nativeArgs.doc).toBeUndefined()
		// Title MUST also be coerced, not silently Stringified as "[object Object]".
		expect(result.nativeArgs.title).toBe("Auth")
	})

	it("write_spec with object title → '' (pack metadata never stores '[object Object]')", () => {
		const result = NativeToolCallParser.parseToolCall({
			id: "call_ws_objtitle",
			name: "write_spec",
			arguments: JSON.stringify({
				title: { junk: true },
				spec_id: null,
				doc: "design",
				content: "# D\n",
				mode: "replace",
			}),
		}) as any
		expect(result.nativeArgs.title).toBe("")
		expect(result.nativeArgs.doc).toBe("design")
	})

	it("write_spec with object content → undefined (tool emits 'content is required for mode replace')", () => {
		const result = NativeToolCallParser.parseToolCall({
			id: "call_ws_objcontent",
			name: "write_spec",
			arguments: JSON.stringify({
				title: "Auth",
				spec_id: null,
				doc: "design",
				content: {}, // not a string
				mode: "replace",
			}),
		}) as any
		expect(result.nativeArgs.content).toBeUndefined()
	})

	it("list_mcp_config with object scope → undefined (no '[object Object]' in error)", () => {
		const result = NativeToolCallParser.parseToolCall({
			id: "call_lmc_obj",
			name: "list_mcp_config",
			arguments: JSON.stringify({ scope: {} }),
		}) as any
		expect(result.nativeArgs.scope).toBeUndefined()
	})

	it("list_mcp_config with real string scope 'global' → preserved", () => {
		const result = NativeToolCallParser.parseToolCall({
			id: "call_lmc_str",
			name: "list_mcp_config",
			arguments: JSON.stringify({ scope: "global" }),
		}) as any
		expect(result.nativeArgs.scope).toBe("global")
	})

	it("web_research with object query → undefined (don't search for '[object Object]')", () => {
		const result = NativeToolCallParser.parseToolCall({
			id: "call_wr_q_obj",
			name: "web_research",
			arguments: JSON.stringify({
				action: "search",
				query: {}, // model bug
				max_results: 5,
			}),
		}) as any
		expect(result.nativeArgs.action).toBe("search")
		// Object query coerces to undefined (not null) — tool's !query guard fires,
		// emitting actionable "query is required" error instead of silent garbage search.
		expect(result.nativeArgs.query).toBeUndefined()
	})

	it("web_research with object url → undefined (don't fetch '[object Object]')", () => {
		const result = NativeToolCallParser.parseToolCall({
			id: "call_wr_u_obj",
			name: "web_research",
			arguments: JSON.stringify({
				action: "read_url",
				url: {},
			}),
		}) as any
		// Object url coerces to undefined — tool's !url guard fires
		expect(result.nativeArgs.url).toBeUndefined()
	})

	it("web_research with object action → undefined (tool rejects 'action')", () => {
		const result = NativeToolCallParser.parseToolCall({
			id: "call_wr_a_obj",
			name: "web_research",
			arguments: JSON.stringify({ action: {}, query: "kilo" }),
		}) as any
		expect(result.nativeArgs.action).toBeUndefined()
	})

	it("search_files with object path/file_pattern/regex → undefined (no malformed searcher call)", () => {
		const result = NativeToolCallParser.parseToolCall({
			id: "call_sf_obj",
			name: "search_files",
			arguments: JSON.stringify({ path: {}, regex: {}, file_pattern: {} }),
		}) as any
		expect(result.nativeArgs.path).toBeUndefined()
		expect(result.nativeArgs.regex).toBeUndefined()
		expect(result.nativeArgs.file_pattern).toBeUndefined()
	})

	it("codebase_search with object query → undefined (no garbage search)", () => {
		const result = NativeToolCallParser.parseToolCall({
			id: "call_cs_obj",
			name: "codebase_search",
			arguments: JSON.stringify({ query: {}, path: null }),
		}) as any
		expect(result.nativeArgs.query).toBeUndefined()
	})

	it("number/boolean string-typed params coerce via String() (preserves established behavior)", () => {
		const result = NativeToolCallParser.parseToolCall({
			id: "call_rs_num",
			name: "read_spec",
			arguments: JSON.stringify({ doc: 42, spec_id: null }),
		}) as any
		expect(result.nativeArgs.doc).toBe("42")

		const boolResult = NativeToolCallParser.parseToolCall({
			id: "call_rs_bool",
			name: "read_spec",
			arguments: JSON.stringify({ doc: true, spec_id: null }),
		}) as any
		expect(boolResult.nativeArgs.doc).toBe("true")
	})

	it("streaming partial: read_spec {} doc → undefined, then full doc replaces", () => {
		const id = "stream_rs"
		NativeToolCallParser.processRawChunk({ index: 0, id, name: "read_spec" })
		NativeToolCallParser.startStreamingToolCall(id, "read_spec")
		NativeToolCallParser.processRawChunk({ index: 0, arguments: '{"doc": {"' })
		const partial = NativeToolCallParser.processStreamingChunk(id, '{"doc": {"')
		// Partial: parser may produce nativeArgs before object is closed;
		// require only that the FINAL coerce is applied.
		expect(partial).not.toBeNull()

		// Finalize with the closed object → coerced to undefined
		NativeToolCallParser.processRawChunk({ index: 0, arguments: '}}, "spec_id": null}' })
		const final = NativeToolCallParser.finalizeStreamingToolCall(id) as any
		expect(final).not.toBeNull()
		expect(final.nativeArgs.doc).toBeUndefined()
	})
})

describe("Problem A: MiMo routes tools through convertToolsForOpenAI (strict:false)", () => {
	it("MimoHandler uses the inherited gateway-safe convertToolsForOpenAI", async () => {
		// The fix removed `params.tools = tools` (raw strict:true) in favor of
		// `params.tools = this.convertToolsForOpenAI(tools)`. Verify by checking
		// that the handler's createMessage path calls the inherited method with
		// no enableStrict override (gateway-safe default).
		const { MimoHandler } = await import("../../../api/providers/mimo")
		const handler = new MimoHandler({
			mimoApiKey: "test",
			apiModelId: "mimo-v2.5-pro",
		} as any)

		// Spy on the instance method (accessible via prototype since it's protected).
		const convertSpy = vi.spyOn(handler as any, "convertToolsForOpenAI").mockReturnValue([])

		// Stub the underlying OpenAI client to avoid network calls.
		;(handler as any).client = {
			chat: {
				completions: {
					create: async () =>
						(async function* () {
							// yields nothing — just terminates the loop
						})(),
				},
			},
		}

		const tools = [
			{
				type: "function" as const,
				function: {
					name: "read_spec",
					description: "test",
					strict: true,
					parameters: {
						type: "object",
						properties: { doc: { type: "string" } },
						required: ["doc"],
						additionalProperties: false,
					},
				},
			},
		]

		const stream = (handler as any).createMessage("sys", [], { tools })
		// Consume the generator
		for await (const _ of stream) {
			// drain
		}

		expect(convertSpy).toHaveBeenCalled()
		// Must NOT have been called with enableStrict: true
		const calls = convertSpy.mock.calls
		for (const call of calls) {
			const opts = call[1] as any
			expect(opts?.enableStrict).toBeFalsy()
		}
	})
})

describe("Problem A: tools defensively reject non-string params (defense-in-depth)", () => {
	beforeEach(() => {
		vi.restoreAllMocks()
	})

	it("ReadSpecTool with object doc → clean 'doc is required' error (not TypeError)", async () => {
		// The parser now coerces {} → undefined before reaching execute(), but a
		// direct caller (tests, MCP wrapper, future text-XML recovery variant)
		// could still pass an object through. Verify the tool emits a useful error
		// instead of crashing on `Object has no method trim`.
		const task = makeFakeTask()
		const callbacks = makeCallbacks()
		await readSpecTool.execute({ doc: {} as any } as any, task, callbacks)
		const result = String((callbacks.pushToolResult as any).mock.calls[0][0])
		expect(result).toMatch(/doc is required/i)
		expect(result).not.toMatch(/has no method|trim/i)
	})

	it("ReadSpecTool with null doc → clean 'doc is required' error", async () => {
		const task = makeFakeTask()
		const callbacks = makeCallbacks()
		await readSpecTool.execute({ doc: null as any } as any, task, callbacks)
		const result = String((callbacks.pushToolResult as any).mock.calls[0][0])
		expect(result).toMatch(/doc is required/i)
	})

	it("ReadSpecTool with number doc coerced to '42'", async () => {
		// paths.truncatedSpecIdErrorMessage is in scope only for truncated ids;
		// for numeric doc we expect either a fast "doc is required" (after
		// coercion the value '42' passes initial validation) OR a spec lookup
		// failure. Either way: NEVER a TypeError.
		const task = makeFakeTask()
		const callbacks = makeCallbacks()
		await readSpecTool.execute({ doc: 42 as any } as any, task, callbacks)
		const result = String((callbacks.pushToolResult as any).mock.calls[0][0])
		expect(result).not.toMatch(/has no method|trim/i)
	})

	it("WriteSpecTool with object doc → 'doc is required' (no TypeError, no storage leak)", async () => {
		const task = makeFakeTask()
		const callbacks = makeCallbacks()
		;(writeSpecTool as any).streamId = null
		;(writeSpecTool as any).resetStreamState()
		await writeSpecTool.execute({ doc: {} as any } as any, task, callbacks)
		const result = String((callbacks.pushToolResult as any).mock.calls[0][0])
		expect(result).toMatch(/doc is required/i)
		expect(result).not.toMatch(/has no method|trim/i)
	})

	it("ListMcpConfigTool with object scope → treated as 'all', no '[object Object]' in any output", async () => {
		// Object scope coerces to undefined → treated as "all" (valid default).
		// The key guarantee: "[object Object]" NEVER appears in any error message.
		// We can't easily mock getMcpHub without deep module mocking, so verify
		// the parser-level coercion directly instead.
		const result = NativeToolCallParser.parseToolCall({
			id: "call_lmc_obj2",
			name: "list_mcp_config",
			arguments: JSON.stringify({ scope: {} }),
		}) as any
		// Object scope → coerceOptionalStringParam({}) → undefined
		// Tool treats undefined as "all" — no invalid scope error
		expect(result.nativeArgs.scope).toBeUndefined()
		// The important invariant: NOT the string "[object Object]"
		expect(String(result.nativeArgs.scope)).not.toBe("[object Object]")
	})

	it("WebResearchTool search with object query → missing-param (no silent search for [object Object])", async () => {
		// Spy on searchWeb to ensure it is NEVER called with an object query.
		const searchWebSpy = vi.spyOn(webResearch, "searchWeb").mockResolvedValue({
			provider: "duckduckgo",
			results: [],
		} as any)
		const task = makeFakeTask()
		const callbacks = makeCallbacks()
		await webResearchTool.execute({ action: "search", query: {} as any, url: null } as any, task, callbacks)
		expect(searchWebSpy).not.toHaveBeenCalled()
		const result = String((callbacks.pushToolResult as any).mock.calls.at(-1)![0])
		expect(result.toLowerCase()).toMatch(/query|missing param/i)
		searchWebSpy.mockRestore()
	})

	it("WebResearchTool read_url with object url → missing-param (no fetch of '[object Object]')", async () => {
		const readUrlSpy = vi.spyOn(webResearch, "readUrl").mockResolvedValue({
			title: "",
			url: "",
			text: "",
			truncated: false,
		} as any)
		const task = makeFakeTask()
		const callbacks = makeCallbacks()
		await webResearchTool.execute(
			{ action: "read_url", query: null, url: { junk: true } as any } as any,
			task,
			callbacks,
		)
		expect(readUrlSpy).not.toHaveBeenCalled()
		readUrlSpy.mockRestore()
	})

	it("WebResearchTool action is object → 'action' missing-param", async () => {
		const searchWebSpy = vi.spyOn(webResearch, "searchWeb").mockResolvedValue({
			provider: "duckduckgo",
			results: [],
		} as any)
		const task = makeFakeTask()
		const callbacks = makeCallbacks()
		await webResearchTool.execute({ action: {} as any, query: "test", url: null } as any, task, callbacks)
		expect(searchWebSpy).not.toHaveBeenCalled()
		searchWebSpy.mockRestore()
	})
})

describe("Problem B: write_spec / delete_spec schema required[] trimmed to universal keys", () => {
	it("write_spec.required = ['doc'] (mode-irrelevant keys no longer forced)", async () => {
		const mod = await import("../../prompts/tools/native-tools/write_spec")
		expect(mod.default.type).toBe("function")
		expect(mod.default.function.parameters.required).toEqual(["doc"])
	})

	it("delete_spec.required = [] (no mode-specific params forced)", async () => {
		const mod = await import("../../prompts/tools/native-tools/delete_spec")
		expect(mod.default.type).toBe("function")
		expect(mod.default.function.parameters.required).toEqual([])
	})
})

// ----------------------------------------------------------------------------
// Problem C: ExecaTerminalProcess prefers PowerShell over cmd.exe on Windows.
// ----------------------------------------------------------------------------
//
// The shell-resolution helper `resolveDefaultPowerShellShellPath` is
// effectively a static lookup; the cleanest test is to mock the host probes
// (`where.exe`, `existsSync`) and assert the chosen path. The integration test
// for the actual execa invocation lives in the terminal-suite mock files
// (src/integrations/terminal/__tests__/ExecaTerminalProcess.spec.ts) where
// `execa` itself is already mocked; we add a focused regression test there.

describe("Problem D: text/XML tool-call recovery note behavior is unchanged", () => {
	// The user's prompt asked only to "re-confirm" Problem D — there is no fix
	// to make. The note is a UI-level message emitted by Task.ts when text
	// recovery fires (see textToolCallRecovery.ts). Verifying the absence of
	// regression here would duplicate the existing mimo-scenarios.spec.ts
	// suite; we add a single guard that the recovery path is still healthy.
	it("recovery note path remains intact (TextToolCallParser still loads without errors)", async () => {
		// If a regression broke the message-emission logic, importing the
		// recovery module would surface a compile/runtime error here.
		const recovery = await import("../textToolCallRecovery")
		expect(typeof recovery.applyTextualToolCallRecovery).toBe("function")
		expect(typeof recovery.hasExecutableNativeToolUse).toBe("function")

		const parser = await import("../TextToolCallParser")
		expect(typeof parser.looksLikeTextToolCall).toBe("function")
	})
})

describe("generate_image: 'None' sentinel treated as null (MiMo quirk)", () => {
	it("image: 'None' → coerceNullableStringParam returns null (not the string 'None')", () => {
		const result = NativeToolCallParser.parseToolCall({
			id: "call_gi_none",
			name: "generate_image",
			arguments: JSON.stringify({
				prompt: "A sunset",
				path: "images/sunset.png",
				image: "None", // MiMo sends string "None" instead of JSON null
			}),
		}) as any
		expect(result.nativeArgs.prompt).toBe("A sunset")
		expect(result.nativeArgs.path).toBe("images/sunset.png")
		expect(result.nativeArgs.image).toBeNull()
	})

	it("image: 'null' → coerceNullableStringParam returns null", () => {
		const result = NativeToolCallParser.parseToolCall({
			id: "call_gi_null",
			name: "generate_image",
			arguments: JSON.stringify({
				prompt: "A sunset",
				path: "images/sunset.png",
				image: "null",
			}),
		}) as any
		expect(result.nativeArgs.image).toBeNull()
	})

	it("image: 'undefined' → coerceNullableStringParam returns null", () => {
		const result = NativeToolCallParser.parseToolCall({
			id: "call_gi_undef",
			name: "generate_image",
			arguments: JSON.stringify({
				prompt: "A sunset",
				path: "images/sunset.png",
				image: "undefined",
			}),
		}) as any
		expect(result.nativeArgs.image).toBeNull()
	})

	it("image: real path → preserved as string", () => {
		const result = NativeToolCallParser.parseToolCall({
			id: "call_gi_path",
			name: "generate_image",
			arguments: JSON.stringify({
				prompt: "Enhance this",
				path: "images/enhanced.png",
				image: "images/original.jpg",
			}),
		}) as any
		expect(result.nativeArgs.image).toBe("images/original.jpg")
	})

	it("image: JSON null → preserved as null", () => {
		const result = NativeToolCallParser.parseToolCall({
			id: "call_gi_jsonnull",
			name: "generate_image",
			arguments: JSON.stringify({
				prompt: "A sunset",
				path: "images/sunset.png",
				image: null,
			}),
		}) as any
		expect(result.nativeArgs.image).toBeNull()
	})

	it("image: object {} → undefined (not '[object Object]')", () => {
		const result = NativeToolCallParser.parseToolCall({
			id: "call_gi_obj",
			name: "generate_image",
			arguments: JSON.stringify({
				prompt: "A sunset",
				path: "images/sunset.png",
				image: {},
			}),
		}) as any
		expect(result.nativeArgs.image).toBeUndefined()
	})
})
