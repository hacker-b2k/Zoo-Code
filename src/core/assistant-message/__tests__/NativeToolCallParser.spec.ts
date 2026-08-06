import { NativeToolCallParser } from "../NativeToolCallParser"
import { resolveToolAlias } from "../../prompts/tools/filter-tools-for-mode"

describe("NativeToolCallParser", () => {
	beforeEach(() => {
		NativeToolCallParser.clearAllStreamingToolCalls()
		NativeToolCallParser.clearRawChunkState()
	})

	describe("parseToolCall", () => {
		describe("read_file tool", () => {
			it("should parse minimal single-file read_file args", () => {
				const toolCall = {
					id: "toolu_123",
					name: "read_file" as const,
					arguments: JSON.stringify({
						path: "src/core/task/Task.ts",
					}),
				}

				const result = NativeToolCallParser.parseToolCall(toolCall)

				expect(result).not.toBeNull()
				expect(result?.type).toBe("tool_use")
				if (result?.type === "tool_use") {
					expect(result.nativeArgs).toBeDefined()
					const nativeArgs = result.nativeArgs as { path: string }
					expect(nativeArgs.path).toBe("src/core/task/Task.ts")
				}
			})

			it("should parse slice-mode params", () => {
				const toolCall = {
					id: "toolu_123",
					name: "read_file" as const,
					arguments: JSON.stringify({
						path: "src/core/task/Task.ts",
						mode: "slice",
						offset: 10,
						limit: 20,
					}),
				}

				const result = NativeToolCallParser.parseToolCall(toolCall)

				expect(result).not.toBeNull()
				expect(result?.type).toBe("tool_use")
				if (result?.type === "tool_use") {
					const nativeArgs = result.nativeArgs as {
						path: string
						mode?: string
						offset?: number
						limit?: number
					}
					expect(nativeArgs.path).toBe("src/core/task/Task.ts")
					expect(nativeArgs.mode).toBe("slice")
					expect(nativeArgs.offset).toBe(10)
					expect(nativeArgs.limit).toBe(20)
				}
			})

			it("should parse indentation-mode params", () => {
				const toolCall = {
					id: "toolu_123",
					name: "read_file" as const,
					arguments: JSON.stringify({
						path: "src/utils.ts",
						mode: "indentation",
						indentation: {
							anchor_line: 123,
							max_levels: 2,
							include_siblings: true,
							include_header: false,
						},
					}),
				}

				const result = NativeToolCallParser.parseToolCall(toolCall)

				expect(result).not.toBeNull()
				expect(result?.type).toBe("tool_use")
				if (result?.type === "tool_use") {
					const nativeArgs = result.nativeArgs as {
						path: string
						mode?: string
						indentation?: {
							anchor_line?: number
							max_levels?: number
							include_siblings?: boolean
							include_header?: boolean
						}
					}
					expect(nativeArgs.path).toBe("src/utils.ts")
					expect(nativeArgs.mode).toBe("indentation")
					expect(nativeArgs.indentation?.anchor_line).toBe(123)
					expect(nativeArgs.indentation?.include_siblings).toBe(true)
					expect(nativeArgs.indentation?.include_header).toBe(false)
				}
			})

			// Legacy format backward compatibility tests
			describe("legacy format backward compatibility", () => {
				it("should parse legacy files array format with single file", () => {
					const toolCall = {
						id: "toolu_legacy_1",
						name: "read_file" as const,
						arguments: JSON.stringify({
							files: [{ path: "src/legacy/file.ts" }],
						}),
					}

					const result = NativeToolCallParser.parseToolCall(toolCall)

					expect(result).not.toBeNull()
					expect(result?.type).toBe("tool_use")
					if (result?.type === "tool_use") {
						expect(result.usedLegacyFormat).toBe(true)
						const nativeArgs = result.nativeArgs as { files: Array<{ path: string }>; _legacyFormat: true }
						expect(nativeArgs._legacyFormat).toBe(true)
						expect(nativeArgs.files).toHaveLength(1)
						expect(nativeArgs.files[0].path).toBe("src/legacy/file.ts")
					}
				})

				it("should parse legacy files array format with multiple files", () => {
					const toolCall = {
						id: "toolu_legacy_2",
						name: "read_file" as const,
						arguments: JSON.stringify({
							files: [{ path: "src/file1.ts" }, { path: "src/file2.ts" }, { path: "src/file3.ts" }],
						}),
					}

					const result = NativeToolCallParser.parseToolCall(toolCall)

					expect(result).not.toBeNull()
					expect(result?.type).toBe("tool_use")
					if (result?.type === "tool_use") {
						expect(result.usedLegacyFormat).toBe(true)
						const nativeArgs = result.nativeArgs as { files: Array<{ path: string }>; _legacyFormat: true }
						expect(nativeArgs.files).toHaveLength(3)
						expect(nativeArgs.files[0].path).toBe("src/file1.ts")
						expect(nativeArgs.files[1].path).toBe("src/file2.ts")
						expect(nativeArgs.files[2].path).toBe("src/file3.ts")
					}
				})

				it("should parse legacy line_ranges as tuples", () => {
					const toolCall = {
						id: "toolu_legacy_3",
						name: "read_file" as const,
						arguments: JSON.stringify({
							files: [
								{
									path: "src/task.ts",
									line_ranges: [
										[1, 50],
										[100, 150],
									],
								},
							],
						}),
					}

					const result = NativeToolCallParser.parseToolCall(toolCall)

					expect(result).not.toBeNull()
					expect(result?.type).toBe("tool_use")
					if (result?.type === "tool_use") {
						expect(result.usedLegacyFormat).toBe(true)
						const nativeArgs = result.nativeArgs as {
							files: Array<{ path: string; lineRanges?: Array<{ start: number; end: number }> }>
							_legacyFormat: true
						}
						expect(nativeArgs.files[0].lineRanges).toHaveLength(2)
						expect(nativeArgs.files[0].lineRanges?.[0]).toEqual({ start: 1, end: 50 })
						expect(nativeArgs.files[0].lineRanges?.[1]).toEqual({ start: 100, end: 150 })
					}
				})

				it("should parse legacy line_ranges as objects", () => {
					const toolCall = {
						id: "toolu_legacy_4",
						name: "read_file" as const,
						arguments: JSON.stringify({
							files: [
								{
									path: "src/task.ts",
									line_ranges: [
										{ start: 10, end: 20 },
										{ start: 30, end: 40 },
									],
								},
							],
						}),
					}

					const result = NativeToolCallParser.parseToolCall(toolCall)

					expect(result).not.toBeNull()
					expect(result?.type).toBe("tool_use")
					if (result?.type === "tool_use") {
						expect(result.usedLegacyFormat).toBe(true)
						const nativeArgs = result.nativeArgs as {
							files: Array<{ path: string; lineRanges?: Array<{ start: number; end: number }> }>
						}
						expect(nativeArgs.files[0].lineRanges).toHaveLength(2)
						expect(nativeArgs.files[0].lineRanges?.[0]).toEqual({ start: 10, end: 20 })
						expect(nativeArgs.files[0].lineRanges?.[1]).toEqual({ start: 30, end: 40 })
					}
				})

				it("should parse legacy line_ranges as strings", () => {
					const toolCall = {
						id: "toolu_legacy_5",
						name: "read_file" as const,
						arguments: JSON.stringify({
							files: [
								{
									path: "src/task.ts",
									line_ranges: ["1-50", "100-150"],
								},
							],
						}),
					}

					const result = NativeToolCallParser.parseToolCall(toolCall)

					expect(result).not.toBeNull()
					expect(result?.type).toBe("tool_use")
					if (result?.type === "tool_use") {
						expect(result.usedLegacyFormat).toBe(true)
						const nativeArgs = result.nativeArgs as {
							files: Array<{ path: string; lineRanges?: Array<{ start: number; end: number }> }>
						}
						expect(nativeArgs.files[0].lineRanges).toHaveLength(2)
						expect(nativeArgs.files[0].lineRanges?.[0]).toEqual({ start: 1, end: 50 })
						expect(nativeArgs.files[0].lineRanges?.[1]).toEqual({ start: 100, end: 150 })
					}
				})

				it("should parse double-stringified files array (model quirk)", () => {
					// This tests the real-world case where some models double-stringify the files array
					// e.g., { files: "[{\"path\": \"...\"}]" } instead of { files: [{path: "..."}] }
					const toolCall = {
						id: "toolu_double_stringify",
						name: "read_file" as const,
						arguments: JSON.stringify({
							files: JSON.stringify([
								{ path: "src/services/example/service.ts" },
								{ path: "src/services/mcp/McpServerManager.ts" },
							]),
						}),
					}

					const result = NativeToolCallParser.parseToolCall(toolCall)

					expect(result).not.toBeNull()
					expect(result?.type).toBe("tool_use")
					if (result?.type === "tool_use") {
						expect(result.usedLegacyFormat).toBe(true)
						const nativeArgs = result.nativeArgs as {
							files: Array<{ path: string }>
							_legacyFormat: true
						}
						expect(nativeArgs._legacyFormat).toBe(true)
						expect(nativeArgs.files).toHaveLength(2)
						expect(nativeArgs.files[0].path).toBe("src/services/example/service.ts")
						expect(nativeArgs.files[1].path).toBe("src/services/mcp/McpServerManager.ts")
					}
				})

				it("should NOT set usedLegacyFormat for new format", () => {
					const toolCall = {
						id: "toolu_new",
						name: "read_file" as const,
						arguments: JSON.stringify({
							path: "src/new/format.ts",
							mode: "slice",
							offset: 1,
							limit: 100,
						}),
					}

					const result = NativeToolCallParser.parseToolCall(toolCall)

					expect(result).not.toBeNull()
					expect(result?.type).toBe("tool_use")
					if (result?.type === "tool_use") {
						expect(result.usedLegacyFormat).toBeUndefined()
					}
				})
			})
		})
	})

	describe("processStreamingChunk", () => {
		describe("read_file tool", () => {
			it("should emit a partial ToolUse with nativeArgs.path during streaming", () => {
				const id = "toolu_streaming_123"
				NativeToolCallParser.startStreamingToolCall(id, "read_file")

				// Simulate streaming chunks
				const fullArgs = JSON.stringify({ path: "src/test.ts" })

				// Process the complete args as a single chunk for simplicity
				const result = NativeToolCallParser.processStreamingChunk(id, fullArgs)

				expect(result).not.toBeNull()
				expect(result?.nativeArgs).toBeDefined()
				const nativeArgs = result?.nativeArgs as { path: string }
				expect(nativeArgs.path).toBe("src/test.ts")
			})
		})

		describe("spawn_worker tool", () => {
			it("should emit partial nativeArgs for name/message during streaming", () => {
				const id = "toolu_spawn_partial"
				NativeToolCallParser.startStreamingToolCall(id, "spawn_worker")

				const result = NativeToolCallParser.processStreamingChunk(
					id,
					JSON.stringify({
						name: "worker-a",
						message: "Create workers/a/hello.txt",
						api_config_name: "nvidia",
					}),
				)

				expect(result).not.toBeNull()
				expect(result?.nativeArgs).toBeDefined()
				const nativeArgs = result?.nativeArgs as {
					name: string
					message: string
					api_config_name?: string | null
				}
				expect(nativeArgs.name).toBe("worker-a")
				expect(nativeArgs.message).toBe("Create workers/a/hello.txt")
				expect(nativeArgs.api_config_name).toBe("nvidia")
			})
		})
	})

	describe("finalizeStreamingToolCall", () => {
		describe("read_file tool", () => {
			it("should parse read_file args on finalize", () => {
				const id = "toolu_finalize_123"
				NativeToolCallParser.startStreamingToolCall(id, "read_file")

				// Add the complete arguments
				NativeToolCallParser.processStreamingChunk(
					id,
					JSON.stringify({
						path: "finalized.ts",
						mode: "slice",
						offset: 1,
						limit: 10,
					}),
				)

				const result = NativeToolCallParser.finalizeStreamingToolCall(id)

				expect(result).not.toBeNull()
				expect(result?.type).toBe("tool_use")
				if (result?.type === "tool_use") {
					const nativeArgs = result.nativeArgs as { path: string; offset?: number; limit?: number }
					expect(nativeArgs.path).toBe("finalized.ts")
					expect(nativeArgs.offset).toBe(1)
					expect(nativeArgs.limit).toBe(10)
				}
			})
		})

		describe("orchestration tools", () => {
			it("should finalize spawn_worker with nativeArgs (regression for missing nativeArgs)", () => {
				const id = "toolu_spawn_finalize"
				NativeToolCallParser.startStreamingToolCall(id, "spawn_worker")
				NativeToolCallParser.processStreamingChunk(
					id,
					JSON.stringify({
						name: "worker-a-hello",
						mode: "code",
						api_config_name: "nvidia",
						fallback_api_config_names: "xiaomi,vertexstudio,grok xai",
						role: "worker",
						review_target_id: "",
						message: "Create file workers/a/hello.txt containing exactly: HELLO_FROM_A",
					}),
				)

				const result = NativeToolCallParser.finalizeStreamingToolCall(id)
				expect(result).not.toBeNull()
				expect(result?.type).toBe("tool_use")
				if (result?.type === "tool_use") {
					expect(result.nativeArgs).toBeDefined()
					const nativeArgs = result.nativeArgs as {
						name: string
						message: string
						mode?: string | null
						api_config_name?: string | null
						fallback_api_config_names?: string | null
						role?: string | null
						review_target_id?: string | null
					}
					expect(nativeArgs.name).toBe("worker-a-hello")
					expect(nativeArgs.message).toContain("HELLO_FROM_A")
					expect(nativeArgs.api_config_name).toBe("nvidia")
					expect(nativeArgs.fallback_api_config_names).toBe("xiaomi,vertexstudio,grok xai")
					expect(nativeArgs.role).toBe("worker")
					expect(nativeArgs.review_target_id).toBe("")
				}
			})

			it("should finalize list_workers and collect_results with nativeArgs", () => {
				const listId = "toolu_list_workers"
				NativeToolCallParser.startStreamingToolCall(listId, "list_workers")
				NativeToolCallParser.processStreamingChunk(listId, JSON.stringify({ include_completed: "true" }))
				const listResult = NativeToolCallParser.finalizeStreamingToolCall(listId) as any
				expect(listResult?.nativeArgs).toEqual({ include_completed: "true" })

				const collectId = "toolu_collect"
				NativeToolCallParser.startStreamingToolCall(collectId, "collect_results")
				NativeToolCallParser.processStreamingChunk(collectId, JSON.stringify({ unread_only: true }))
				const collectResult = NativeToolCallParser.finalizeStreamingToolCall(collectId) as any
				expect(collectResult?.nativeArgs).toEqual({ unread_only: true })
			})

			it("should finalize write_spec / read_spec / list_specs with nativeArgs (F-004 regression)", () => {
				const writeId = "toolu_write_spec"
				NativeToolCallParser.startStreamingToolCall(writeId, "write_spec")
				NativeToolCallParser.processStreamingChunk(
					writeId,
					JSON.stringify({
						title: "Test Spec",
						spec_id: null,
						doc: "design",
						content: "# Design\n\nHello\n",
					}),
				)
				const writeResult = NativeToolCallParser.finalizeStreamingToolCall(writeId) as any
				expect(writeResult?.type).toBe("tool_use")
				expect(writeResult?.nativeArgs).toEqual({
					title: "Test Spec",
					spec_id: null,
					doc: "design",
					content: "# Design\n\nHello\n",
				})

				const readId = "toolu_read_spec"
				NativeToolCallParser.startStreamingToolCall(readId, "read_spec")
				NativeToolCallParser.processStreamingChunk(readId, JSON.stringify({ spec_id: null, doc: "design" }))
				const readResult = NativeToolCallParser.finalizeStreamingToolCall(readId) as any
				expect(readResult?.nativeArgs).toEqual({ spec_id: null, doc: "design" })

				const listId = "toolu_list_specs"
				NativeToolCallParser.startStreamingToolCall(listId, "list_specs")
				NativeToolCallParser.processStreamingChunk(listId, JSON.stringify({}))
				const listResult = NativeToolCallParser.finalizeStreamingToolCall(listId) as any
				expect(listResult?.nativeArgs).toEqual({})
			})
		})
	})

	describe("ask_followup_question follow_up array coercion (tool-issues Issue 1 + user.txt bug)", () => {
		beforeEach(() => {
			NativeToolCallParser.clearAllStreamingToolCalls()
			NativeToolCallParser.clearRawChunkState()
		})

		it("passes a native array follow_up through unchanged", () => {
			const result = NativeToolCallParser.parseToolCall({
				id: "toolu_afu_native",
				name: "ask_followup_question",
				arguments: JSON.stringify({
					question: "Which option?",
					follow_up: [
						{ text: "Yes", mode: "code" },
						{ text: "No", mode: null },
					],
				}),
			}) as any
			expect(result).not.toBeNull()
			expect(result?.nativeArgs.follow_up).toEqual([
				{ text: "Yes", mode: "code" },
				{ text: "No", mode: null },
			])
		})

		it("coerces a stringified JSON array follow_up into a real array", () => {
			// Models that receive strict-mode ["array","null"] schemas sometimes
			// over-encode follow_up as a JSON STRING containing the array. The parser
			// must decode it so the tool never sees a "must be an array" loop.
			const followUpArray = [
				{ text: "Keep", mode: null },
				{ text: "Remove", mode: null },
			]
			const result = NativeToolCallParser.parseToolCall({
				id: "toolu_afu_string",
				name: "ask_followup_question",
				arguments: JSON.stringify({
					question: "How should I proceed?",
					follow_up: JSON.stringify(followUpArray),
				}),
			}) as any
			expect(result).not.toBeNull()
			expect(Array.isArray(result?.nativeArgs.follow_up)).toBe(true)
			expect(result?.nativeArgs.follow_up).toEqual(followUpArray)
		})

		it("forwards a non-array, non-stringified object so the tool can report the type error", () => {
			// Regression guard: keyed objects must still reach the tool's precise
			// "must be an array" error path (not be silently coerced).
			const result = NativeToolCallParser.parseToolCall({
				id: "toolu_afu_obj",
				name: "ask_followup_question",
				arguments: JSON.stringify({
					question: "How should I proceed?",
					follow_up: { "0": { mode: null, text: "Keep" } },
				}),
			}) as any
			expect(result).not.toBeNull()
			expect(Array.isArray(result?.nativeArgs.follow_up)).toBe(false)
			expect(result?.nativeArgs.follow_up).toEqual({ "0": { mode: null, text: "Keep" } })
		})

		it("forwards a non-JSON string so the tool can report the type error", () => {
			const result = NativeToolCallParser.parseToolCall({
				id: "toolu_afu_plainstr",
				name: "ask_followup_question",
				arguments: JSON.stringify({
					question: "Pick one",
					follow_up: "not-an-array",
				}),
			}) as any
			expect(result).not.toBeNull()
			expect(result?.nativeArgs.follow_up).toBe("not-an-array")
		})
	})

	describe("parseToolCall F-004 specs", () => {
		it("should parse write_spec create payload with nativeArgs", () => {
			const result = NativeToolCallParser.parseToolCall({
				id: "toolu_ws_parse",
				name: "write_spec",
				arguments: JSON.stringify({
					title: "Test Spec",
					spec_id: null,
					doc: "design",
					content: "# Design\n",
				}),
			}) as any
			expect(result).not.toBeNull()
			expect(result?.nativeArgs).toEqual({
				title: "Test Spec",
				spec_id: null,
				doc: "design",
				content: "# Design\n",
			})
		})

		it("always sets nativeArgs for write_spec when doc is present (create-from-markdown / missing content)", () => {
			// Previously: content null + non-search mode left nativeArgs unset → throw →
			// finalize returns null → presentAssistantMessage "missing nativeArgs" →
			// consecutiveMistakeLimit → "Zoo is having trouble…".
			// Now: nativeArgs always built so WriteSpecTool can return a real tool_error.
			const result = NativeToolCallParser.parseToolCall({
				id: "toolu_ws_doc_only",
				name: "write_spec",
				arguments: JSON.stringify({
					title: "Imported From Markdown",
					spec_id: null,
					doc: "design",
					content: null,
					mode: "replace",
					section_heading: null,
					old_string: null,
					new_string: null,
					replace_all: null,
				}),
			}) as any
			expect(result).not.toBeNull()
			expect(result?.nativeArgs).toBeDefined()
			expect(result?.nativeArgs?.doc).toBe("design")
			expect(result?.nativeArgs?.title).toBe("Imported From Markdown")
			expect(result?.nativeArgs?.spec_id).toBeNull()
			expect(result?.nativeArgs?.mode).toBe("replace")
			expect(result?.nativeArgs?.content).toBeUndefined()
		})

		it("preserves empty-string content on write_spec create-from-markdown", () => {
			const result = NativeToolCallParser.parseToolCall({
				id: "toolu_ws_empty_content",
				name: "write_spec",
				arguments: JSON.stringify({
					title: "Empty Body Pack",
					spec_id: null,
					doc: "requirements",
					content: "",
					mode: "replace",
				}),
			}) as any
			expect(result).not.toBeNull()
			expect(result?.nativeArgs).toBeDefined()
			expect(result?.nativeArgs?.content).toBe("")
			expect(result?.nativeArgs?.doc).toBe("requirements")
		})

		it("finalizes write_spec import shape with full markdown content as nativeArgs", () => {
			const markdown = "# Design\n\n## From existing file\n\n- item\n"
			const id = "toolu_ws_import_md"
			NativeToolCallParser.startStreamingToolCall(id, "write_spec")
			NativeToolCallParser.processStreamingChunk(
				id,
				JSON.stringify({
					title: "From Existing Markdown",
					spec_id: null,
					doc: "design",
					content: markdown,
					mode: "replace",
					section_heading: null,
					old_string: null,
					new_string: null,
					replace_all: null,
				}),
			)
			const result = NativeToolCallParser.finalizeStreamingToolCall(id) as any
			expect(result?.type).toBe("tool_use")
			expect(result?.nativeArgs).toBeDefined()
			expect(result?.nativeArgs?.title).toBe("From Existing Markdown")
			expect(result?.nativeArgs?.spec_id).toBeNull()
			expect(result?.nativeArgs?.doc).toBe("design")
			expect(result?.nativeArgs?.content).toBe(markdown)
			expect(result?.nativeArgs?.mode).toBe("replace")
		})

		it('coerces string "null" spec_id to null for write_spec create (F-005e)', () => {
			const result = NativeToolCallParser.parseToolCall({
				id: "toolu_ws_string_null",
				name: "write_spec",
				arguments: JSON.stringify({
					title: "New Pack",
					spec_id: "null",
					doc: "requirements",
					content: "# Requirements\n",
				}),
			}) as any
			expect(result).not.toBeNull()
			expect(result?.nativeArgs).toEqual({
				title: "New Pack",
				spec_id: null,
				doc: "requirements",
				content: "# Requirements\n",
			})
		})

		it("preserves real write_spec / read_spec spec_id strings", () => {
			const write = NativeToolCallParser.parseToolCall({
				id: "toolu_ws_real",
				name: "write_spec",
				arguments: JSON.stringify({
					title: "Existing",
					spec_id: "abc-123-real",
					doc: "design",
					content: "# Design\n",
				}),
			}) as any
			expect(write?.nativeArgs?.spec_id).toBe("abc-123-real")

			const read = NativeToolCallParser.parseToolCall({
				id: "toolu_rs_real",
				name: "read_spec",
				arguments: JSON.stringify({
					spec_id: "abc-123-real",
					doc: "design",
				}),
			}) as any
			expect(read?.nativeArgs?.spec_id).toBe("abc-123-real")
		})

		it("parseToolCall forwards read_spec mode and revision through nativeArgs", () => {
			const result = NativeToolCallParser.parseToolCall({
				id: "toolu_rs_mode",
				name: "read_spec",
				arguments: JSON.stringify({ spec_id: null, doc: "design", mode: "headings" }),
			}) as any
			expect(result).not.toBeNull()
			expect(result?.nativeArgs?.doc).toBe("design")
			expect(result?.nativeArgs?.spec_id).toBeNull()
			expect(result?.nativeArgs?.mode).toBe("headings")

			const history = NativeToolCallParser.parseToolCall({
				id: "toolu_rs_history",
				name: "read_spec",
				arguments: JSON.stringify({ spec_id: "abc-123", doc: "tasks", mode: "history", revision: 3 }),
			}) as any
			expect(history?.nativeArgs?.mode).toBe("history")
			expect(history?.nativeArgs?.revision).toBe(3)
		})

		it("parseToolCall omits mode/revision from read_spec nativeArgs when not provided", () => {
			const result = NativeToolCallParser.parseToolCall({
				id: "toolu_rs_basic",
				name: "read_spec",
				arguments: JSON.stringify({ spec_id: null, doc: "requirements" }),
			}) as any
			expect(result).not.toBeNull()
			expect(result?.nativeArgs?.doc).toBe("requirements")
			expect(result?.nativeArgs?.mode).toBeUndefined()
			expect(result?.nativeArgs?.revision).toBeUndefined()
		})

		it("parseToolCall forwards write_spec dry_run and replacements through nativeArgs", () => {
			const result = NativeToolCallParser.parseToolCall({
				id: "toolu_ws_dry",
				name: "write_spec",
				arguments: JSON.stringify({
					title: "Test",
					spec_id: "abc",
					doc: "design",
					mode: "search_replace",
					old_string: "old",
					new_string: "new",
					dry_run: true,
				}),
			}) as any
			expect(result).not.toBeNull()
			expect(result?.nativeArgs?.dry_run).toBe(true)

			const batch = NativeToolCallParser.parseToolCall({
				id: "toolu_ws_batch",
				name: "write_spec",
				arguments: JSON.stringify({
					title: "Test",
					spec_id: "abc",
					doc: "tasks",
					replacements: [
						{ old_string: "- [ ] A", new_string: "- [x] A" },
						{ old_string: "- [ ] B", new_string: "- [x] B" },
					],
				}),
			}) as any
			expect(batch?.nativeArgs?.replacements).toHaveLength(2)
			expect(batch?.nativeArgs?.replacements[0].old_string).toBe("- [ ] A")
		})
	})

	describe("parseToolCall orchestration", () => {
		it("should parse spawn_worker required name+message only", () => {
			const result = NativeToolCallParser.parseToolCall({
				id: "toolu_spawn_min",
				name: "spawn_worker",
				arguments: JSON.stringify({
					name: "w1",
					message: "do work",
				}),
			})
			expect(result).not.toBeNull()
			expect((result as any)?.nativeArgs).toMatchObject({
				name: "w1",
				message: "do work",
				mode: null,
				api_config_name: null,
				fallback_api_config_names: null,
				role: null,
				review_target_id: null,
			})
		})
	})

	describe("parseArgumentsPayload hardening (truncated / object / double-encoded)", () => {
		it("accepts arguments delivered as an already-parsed object (broken gateway)", () => {
			const result = NativeToolCallParser.parseToolCall({
				id: "call_obj",
				name: "execute_command",
				arguments: { command: "ls -la", timeout: 10 } as any,
			})
			expect(result).not.toBeNull()
			expect((result as any)?.nativeArgs).toEqual({ command: "ls -la", cwd: undefined, timeout: 10 })
		})

		it("double-decodes arguments that are a JSON string containing JSON", () => {
			const inner = JSON.stringify({ path: ".", recursive: true })
			const result = NativeToolCallParser.parseToolCall({
				id: "call_double",
				name: "list_files",
				arguments: JSON.stringify(inner), // "\"{\\\"path\\\":...}\""
			})
			expect(result).not.toBeNull()
			expect((result as any)?.nativeArgs).toMatchObject({ path: ".", recursive: true })
		})

		it("strips a markdown fence around the JSON payload", () => {
			const result = NativeToolCallParser.parseToolCall({
				id: "call_fence",
				name: "list_files",
				arguments: '```json\n{"path": ".", "recursive": false}\n```',
			})
			expect(result).not.toBeNull()
			expect((result as any)?.nativeArgs).toMatchObject({ path: ".", recursive: false })
		})

		it("salvages truncated JSON (max_tokens cut mid-string) instead of failing", () => {
			// Full payload would be {"name":"researcher","message":"...long..."} — the
			// stream was cut inside the message string. partial-json extracts the
			// complete prefix including the in-progress string value.
			const truncated = '{"name":"researcher","message":"Investigate the parser thoroughly. Step 1: read the'
			const result = NativeToolCallParser.parseToolCall({
				id: "call_trunc",
				name: "spawn_worker",
				arguments: truncated,
			})
			expect(result).not.toBeNull()
			expect((result as any)?.nativeArgs).toMatchObject({
				name: "researcher",
				message: "Investigate the parser thoroughly. Step 1: read the",
			})
		})

		it("salvages truncated JSON with a missing closing brace", () => {
			const result = NativeToolCallParser.parseToolCall({
				id: "call_trunc2",
				name: "delete_spec",
				arguments: '{"delete_all":true',
			})
			expect(result).not.toBeNull()
			expect((result as any)?.nativeArgs).toMatchObject({ delete_all: true })
		})

		it("returns null for unrecoverable garbage (graceful failure)", () => {
			const result = NativeToolCallParser.parseToolCall({
				id: "call_garbage",
				name: "list_files",
				arguments: "this is not json at all {{{",
			})
			expect(result).toBeNull()
		})

		it("treats empty string arguments as an empty object", () => {
			const result = NativeToolCallParser.parseToolCall({
				id: "call_empty",
				name: "list_specs",
				arguments: "",
			})
			expect(result).not.toBeNull()
			expect((result as any)?.nativeArgs).toEqual({})
		})
	})

	describe("streaming end-to-end with truncation (MiMo max_tokens scenario)", () => {
		it("finalizes a streamed spawn_worker whose arguments JSON was cut mid-message", () => {
			const id = "call_stream_trunc"
			// Simulate Task.ts wiring: start event initializes streaming state, delta
			// events accumulate arguments. The payload is cut at max_tokens inside the
			// message string — no closing quote/brace ever arrives.
			const fullPrefix =
				'{"name":"researcher","mode":null,"message":"Line 1: gather requirements.\\nLine 2: read src/index.ts and summ'
			const startEvents = NativeToolCallParser.processRawChunk({ index: 0, id, name: "spawn_worker" })
			expect(startEvents.some((e) => e.type === "tool_call_start")).toBe(true)
			NativeToolCallParser.startStreamingToolCall(id, "spawn_worker")
			const mid = Math.floor(fullPrefix.length / 2)
			NativeToolCallParser.processStreamingChunk(id, fullPrefix.slice(0, mid))
			NativeToolCallParser.processStreamingChunk(id, fullPrefix.slice(mid))

			const result = NativeToolCallParser.finalizeStreamingToolCall(id) as any
			expect(result).not.toBeNull()
			expect(result?.type).toBe("tool_use")
			expect(result?.nativeArgs?.name).toBe("researcher")
			expect(result?.nativeArgs?.message).toContain("Line 1: gather requirements.")
		})

		it("processRawChunk tolerates object-valued arguments from broken gateways", () => {
			const id = "call_stream_obj"
			// Non-conformant gateway: arguments arrive as an object, not a string.
			// processRawChunk must normalize (not accumulate "[object Object]").
			const events = NativeToolCallParser.processRawChunk({
				index: 0,
				id,
				name: "execute_command",
				arguments: { command: "ls -la" } as any,
			})
			// Emitted delta event must carry a valid JSON string.
			const delta = events.find((e) => e.type === "tool_call_delta") as any
			expect(delta).toBeDefined()
			expect(typeof delta.delta).toBe("string")
			expect(JSON.parse(delta.delta)).toEqual({ command: "ls -la" })
		})
	})

	describe("stale raw-chunk tracker reaping (user.txt bridge-drop regression)", () => {
		beforeEach(() => {
			NativeToolCallParser.clearAllStreamingToolCalls()
			NativeToolCallParser.clearRawChunkState()
		})

		it("reaps a leftover tracked entry when a NEW tool id reuses the same stream index", () => {
			// Simulate a previous turn whose stream was interrupted WITHOUT the
			// begin-of-turn clear running (dispose/reload/non-abort error path).
			// The tracker still holds index 0 -> old id "toolu_OLD".
			NativeToolCallParser.processRawChunk({ index: 0, id: "toolu_OLD", name: "list_specs" })
			expect((NativeToolCallParser as any).rawChunkTracker.size).toBe(1)

			// A NEW turn reuses index 0 but with a different id (the provider
			// re-issues a new call_id for the same slot). The tracker must END the
			// stale entry and START fresh tracking for the new id — otherwise the
			// new tool call's arguments are appended to the dead id and the block
			// resolves to "Tool not found" for the rest of the session.
			const events = NativeToolCallParser.processRawChunk({
				index: 0,
				id: "toolu_NEW",
				name: "write_spec",
			})

			const endEvent = events.find((e) => e.type === "tool_call_end")
			const startEvent = events.find((e) => e.type === "tool_call_start")
			expect(endEvent).toEqual({ type: "tool_call_end", id: "toolu_OLD" })
			expect(startEvent).toEqual({ type: "tool_call_start", id: "toolu_NEW", name: "write_spec" })

			// Tracker now tracks the new id, not the stale one.
			expect((NativeToolCallParser as any).rawChunkTracker.get(0)?.id).toBe("toolu_NEW")

			// Subsequent args-only chunk (index only — how OpenAI-compatible
			// providers emit argument deltas) must attach to the NEW id.
			const deltaEvents = NativeToolCallParser.processRawChunk({ index: 0, arguments: '{"title":"x"}' })
			const delta = deltaEvents.find((e) => e.type === "tool_call_delta")
			expect(delta).toEqual({ type: "tool_call_delta", id: "toolu_NEW", delta: '{"title":"x"}' })
		})

		it("processFinishReason clears the tracker so a stop-finish leaves no residue", () => {
			// Tracker populated mid-stream.
			NativeToolCallParser.processRawChunk({ index: 0, id: "toolu_FR", name: "read_spec" })
			NativeToolCallParser.processRawChunk({ index: 0, arguments: '{"spec_id":null,"doc":"design"}' })

			// finish_reason === 'tool_calls' — end events are emitted AND the tracker
			// is cleared so the NEXT turn's index reuse cannot pick up stale state.
			const events = NativeToolCallParser.processFinishReason("tool_calls")
			expect(events).toEqual([{ type: "tool_call_end", id: "toolu_FR" }])
			expect((NativeToolCallParser as any).rawChunkTracker.size).toBe(0)

			// A new turn reusing index 0 now starts clean — no end event for the old id.
			const next = NativeToolCallParser.processRawChunk({ index: 0, id: "toolu_FR2", name: "list_specs" })
			const startEvent = next.find((e) => e.type === "tool_call_start")
			expect(startEvent).toEqual({ type: "tool_call_start", id: "toolu_FR2", name: "list_specs" })
			expect(next.some((e) => e.type === "tool_call_end")).toBe(false)
		})
	})

	describe("hallucinated shell-tool alias (user.txt issue 2)", () => {
		it("resolves bash_tool → execute_command so a hallucinated call still lands", () => {
			// Models overfit on other agents' conventions and emit `bash_tool`
			// instead of `execute_command`. Before the alias was added, this fell
			// into the unknown-tool branch ("Tool not found") visible in the live
			// session screenshots.
			const result = NativeToolCallParser.parseToolCall({
				id: "toolu_bash_alias",
				name: "bash_tool" as any,
				arguments: JSON.stringify({ command: 'mkdir "global way"', cwd: null, timeout: null }),
			}) as any
			expect(result).not.toBeNull()
			expect(result.type).toBe("tool_use")
			// Resolved to the canonical tool name for execution...
			expect(result.name).toBe("execute_command")
			// ...and the args passed through.
			expect(result.nativeArgs).toEqual({ command: 'mkdir "global way"', cwd: null, timeout: null })
		})

		it("resolves other hallucinated shell-tool names → execute_command", () => {
			for (const alias of ["bash", "shell_command", "run_command"] as const) {
				const result = NativeToolCallParser.parseToolCall({
					id: `toolu_${alias}`,
					name: alias as any,
					arguments: JSON.stringify({ command: "ls", cwd: null, timeout: null }),
				}) as any
				expect(result, `${alias} should resolve`).not.toBeNull()
				expect(result.name).toBe("execute_command")
			}
		})

		it("resolves hallucinated web-fetch tool names → web_research", () => {
			// Models trained on other assistants (e.g. OpenAI web tool) emit
			// `web_fetch` / `fetch_url` / `read_url` / `browse_url` / `open_url` /
			// `search_web` / `browse` instead of the registered `web_research`.
			const webAliases = [
				"web_fetch",
				"fetch_url",
				"read_url",
				"browse_url",
				"open_url",
				"search_web",
				"browse",
			] as const
			for (const alias of webAliases) {
				const result = NativeToolCallParser.parseToolCall({
					id: `toolu_${alias}`,
					name: alias as any,
					arguments: JSON.stringify({ action: "read_url", url: "https://example.com" }),
				}) as any
				expect(result, `${alias} should resolve`).not.toBeNull()
				expect(result.name).toBe("web_research")
			}
		})

		it("resolves hallucinated file/code tool names to their canonical tools", () => {
			const cases: Array<[string, string]> = [
				["read_file_content", "read_file"],
				["load_file", "read_file"],
				["list_files_recursive", "list_files"],
				["list_files_tree", "list_files"],
				["search_code", "search_files"],
				["grep_code", "search_files"],
				["find_in_codebase", "search_files"],
				["create_file", "write_to_file"],
			]
			for (const [alias, canonical] of cases) {
				const result = NativeToolCallParser.parseToolCall({
					id: `toolu_${alias}`,
					name: alias as any,
					arguments: JSON.stringify({}),
				}) as any
				// Some of these tools may have required params that cause
				// finalize to return null, but the NAME should still resolve.
				if (result) {
					expect(result.name, `${alias} should resolve to ${canonical}`).toBe(canonical)
				} else {
					// If the parser couldn't finalize args, at least verify the
					// alias resolved to the canonical name via resolveToolAlias.
					expect(resolveToolAlias(alias)).toBe(canonical)
				}
			}
		})
	})
})
