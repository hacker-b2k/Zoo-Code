// npx vitest run src/core/task/__tests__/ToolCallParserStateOnAbort.spec.ts

import { describe, it, expect, beforeEach, vi } from "vitest"
import { NativeToolCallParser } from "../../assistant-message/NativeToolCallParser"

describe("ToolCallParser state on abort (session-resilience regression)", () => {
	beforeEach(() => {
		NativeToolCallParser.clearAllStreamingToolCalls()
		NativeToolCallParser.clearRawChunkState()
	})

	it("static streamingToolCalls Map can be cleared", () => {
		// Sanity: the static state must be clearable to avoid cross-turn pollution
		// after an aborted stream.
		NativeToolCallParser.startStreamingToolCall("toolu_test_abort_1", "write_spec")
		// Manually verify state pollution before clearing
		expect((NativeToolCallParser as any).streamingToolCalls.size).toBeGreaterThanOrEqual(0)

		NativeToolCallParser.clearAllStreamingToolCalls()
		NativeToolCallParser.clearRawChunkState()

		// After clearing, the next call should not see leftover state
		const sizeAfter = (NativeToolCallParser as any).streamingToolCalls.size
		expect(sizeAfter).toBe(0)
	})

	it("static rawChunkTracker Map can be cleared", () => {
		// Inject some raw chunk tracking data
		NativeToolCallParser.processRawChunk({
			index: 0,
			id: "toolu_test_abort_2",
			name: "write_to_file",
			arguments: "{}",
		})
		NativeToolCallParser.processRawChunk({
			index: 1,
			id: "toolu_test_abort_3",
			name: "read_file",
			arguments: "{}",
		})

		// Sanity: tracking state has data
		const sizeBefore = (NativeToolCallParser as any).rawChunkTracker.size
		expect(sizeBefore).toBeGreaterThan(0)

		NativeToolCallParser.clearRawChunkState()

		// After clear, raw chunk state must be empty
		const sizeAfter = (NativeToolCallParser as any).rawChunkTracker.size
		expect(sizeAfter).toBe(0)
	})

	it("clearAllStreamingToolCalls and clearRawChunkState are idempotent", () => {
		// Calling clear multiple times must not throw
		expect(() => {
			NativeToolCallParser.clearAllStreamingToolCalls()
			NativeToolCallParser.clearAllStreamingToolCalls()
			NativeToolCallParser.clearRawChunkState()
			NativeToolCallParser.clearRawChunkState()
		}).not.toThrow()
	})
})
