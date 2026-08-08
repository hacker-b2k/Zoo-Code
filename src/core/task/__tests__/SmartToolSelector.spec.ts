/**
 * Tests for SmartToolSelector — Dynamic tool delivery based on turn classification.
 */

import { describe, it, expect } from "vitest"

import { selectToolDeliveryLevel, filterToCoreTools, CORE_TOOL_NAMES } from "../SmartToolSelector"

function makeTool(name: string) {
	return {
		type: "function" as const,
		function: {
			name,
			description: `Tool: ${name}`,
			parameters: { type: "object", properties: {}, required: [] },
		},
	}
}

describe("SmartToolSelector", () => {
	describe("selectToolDeliveryLevel", () => {
		it("returns 'full' for actionable turns", () => {
			expect(selectToolDeliveryLevel(true)).toBe("full")
		})

		it("returns 'core' for conversational turns", () => {
			expect(selectToolDeliveryLevel(false)).toBe("core")
		})
	})

	describe("CORE_TOOL_NAMES", () => {
		it("contains conversation tools", () => {
			expect(CORE_TOOL_NAMES.has("ask_followup_question")).toBe(true)
			expect(CORE_TOOL_NAMES.has("attempt_completion")).toBe(true)
			expect(CORE_TOOL_NAMES.has("list_files")).toBe(true)
			expect(CORE_TOOL_NAMES.has("read_file")).toBe(true)
			expect(CORE_TOOL_NAMES.has("search_files")).toBe(true)
		})

		it("contains worker orchestration tools", () => {
			expect(CORE_TOOL_NAMES.has("spawn_worker")).toBe(true)
			expect(CORE_TOOL_NAMES.has("collect_results")).toBe(true)
			expect(CORE_TOOL_NAMES.has("list_workers")).toBe(true)
			expect(CORE_TOOL_NAMES.has("get_worker_status")).toBe(true)
			expect(CORE_TOOL_NAMES.has("cancel_worker")).toBe(true)
		})

		it("contains editing and command tools", () => {
			expect(CORE_TOOL_NAMES.has("execute_command")).toBe(true)
			expect(CORE_TOOL_NAMES.has("write_to_file")).toBe(true)
			expect(CORE_TOOL_NAMES.has("apply_diff")).toBe(true)
		})

		it("does NOT contain heavy browser tools", () => {
			expect(CORE_TOOL_NAMES.has("open_browser_page")).toBe(false)
			expect(CORE_TOOL_NAMES.has("browser_screenshot")).toBe(false)
			expect(CORE_TOOL_NAMES.has("extract_browser_urls")).toBe(false)
			expect(CORE_TOOL_NAMES.has("navigate_browser_page")).toBe(false)
			expect(CORE_TOOL_NAMES.has("batch_browser_actions")).toBe(false)
		})
	})

	describe("filterToCoreTools", () => {
		it("filters to only core tools", () => {
			const allTools = [
				makeTool("ask_followup_question"),
				makeTool("attempt_completion"),
				makeTool("list_files"),
				makeTool("read_file"),
				makeTool("search_files"),
				makeTool("execute_command"),
				makeTool("write_to_file"),
				makeTool("spawn_worker"),
				makeTool("open_browser_page"),
				makeTool("browser_screenshot"),
				makeTool("batch_browser_actions"),
				makeTool("navigate_browser_page"),
			]

			const coreTools = filterToCoreTools(allTools)
			const names = coreTools.map((t) => (t as any).function.name)

			expect(names).toContain("ask_followup_question")
			expect(names).toContain("execute_command")
			expect(names).toContain("spawn_worker")
			expect(names).toContain("write_to_file")
			expect(names).not.toContain("open_browser_page")
			expect(names).not.toContain("browser_screenshot")
			expect(names).not.toContain("batch_browser_actions")
			expect(names).not.toContain("navigate_browser_page")
		})

		it("returns empty array when only browser tools present", () => {
			const browserTools = [
				makeTool("open_browser_page"),
				makeTool("browser_screenshot"),
				makeTool("extract_browser_urls"),
			]

			const coreTools = filterToCoreTools(browserTools)
			expect(coreTools.length).toBe(0)
		})
	})
})
