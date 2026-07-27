import { NativeToolCallParser } from "../NativeToolCallParser"

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
})
