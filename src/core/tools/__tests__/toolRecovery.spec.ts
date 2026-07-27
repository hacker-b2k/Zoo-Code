// npx vitest run src/core/tools/__tests__/toolRecovery.spec.ts

import { describe, it, expect } from "vitest"
import { toolNames } from "@roo-code/types"

import { modes } from "../../../shared/modes"
import {
	buildToolUnavailableError,
	formatUnavailableToolRecovery,
	getModeAvailableTools,
	inferRecoveryCategory,
	isRegisteredToolName,
	shouldDiscourageShellFallback,
	suggestToolAlternatives,
} from "../toolRecovery"
import { isValidToolName, validateToolUse } from "../validateToolUse"

const codeMode = modes.find((m) => m.slug === "code")?.slug || "code"
const architectMode = modes.find((m) => m.slug === "architect")?.slug || "architect"

describe("toolRecovery", () => {
	describe("registry awareness", () => {
		it("recognizes registered tools including read_file", () => {
			expect(isRegisteredToolName("read_file")).toBe(true)
			expect(isValidToolName("read_file")).toBe(true)
			expect(toolNames).toContain("read_file")
			expect(toolNames).toContain("list_files")
			expect(toolNames).toContain("execute_command")
		})

		it("rejects completely unknown tool names", () => {
			expect(isRegisteredToolName("nonexistent_tool_xyz")).toBe(false)
			expect(isValidToolName("nonexistent_tool_xyz")).toBe(false)
		})

		it("lists mode-available tools that include file tools in code mode", () => {
			const available = getModeAvailableTools(codeMode)
			expect(available).toContain("read_file")
			expect(available).toContain("list_files")
			expect(available).toContain("search_files")
			expect(available).toContain("ask_followup_question")
		})
	})

	describe("suggestToolAlternatives / correct selection ranking", () => {
		const codeTools = getModeAvailableTools(codeMode)

		it("ranks read_file first when the model asked for a read-like tool", () => {
			const alts = suggestToolAlternatives("read_file_content", codeTools)
			expect(alts[0]).toBe("read_file")
			expect(alts).toContain("list_files")
		})

		it("ranks list_files for directory-list style names", () => {
			const alts = suggestToolAlternatives("list_directory", codeTools)
			expect(alts[0]).toBe("list_files")
		})

		it("ranks search_files for grep-like names", () => {
			const alts = suggestToolAlternatives("grep_code", codeTools)
			expect(alts[0]).toBe("search_files")
		})

		it("prefers write/edit tools for write-like names", () => {
			const alts = suggestToolAlternatives("write_file", codeTools)
			// write_file is an alias of write_to_file — either first or near top
			expect(alts.slice(0, 3)).toEqual(expect.arrayContaining(["write_to_file"]))
		})
	})

	describe("unknown tool recovery message", () => {
		it("states the tool is unavailable and lists alternatives", () => {
			const available = getModeAvailableTools(codeMode)
			const message = formatUnavailableToolRecovery({
				toolName: "fake_read",
				reason: "unknown",
				mode: codeMode,
				availableTools: available,
			})

			expect(message).toContain('Unknown tool "fake_read"')
			expect(message).toContain("This tool is unavailable")
			expect(message).toMatch(/Available alternatives are:/)
			expect(message).toContain("read_file")
			expect(message).not.toMatch(/Please use one of the available tools: read_file, .*execute_command/)
		})

		it("does not dump the entire global registry as a comma blob of every tool", () => {
			const message = buildToolUnavailableError("totally_bogus", "unknown", codeMode)
			// Should not include the old pattern of joining ALL validToolNames without ranking
			const alternativesMatch = message.match(/Available alternatives are: ([^.]+)\./)
			expect(alternativesMatch).toBeTruthy()
			const listed = alternativesMatch![1].split(",").map((s) => s.trim())
			expect(listed.length).toBeLessThanOrEqual(12)
			expect(listed.length).toBeGreaterThan(0)
		})

		it("validateToolUse throws recovery text for unknown tools", () => {
			expect(() => validateToolUse("unknown_tool" as any, architectMode, [])).toThrow(
				/Unknown tool "unknown_tool"/,
			)
			expect(() => validateToolUse("unknown_tool" as any, architectMode, [])).toThrow(
				/Available alternatives are:/,
			)
		})

		it("validateToolUse throws recovery text for mode-disallowed tools", () => {
			expect(() => validateToolUse("execute_command", architectMode, [])).toThrow(
				/Tool "execute_command" is not allowed in architect mode/,
			)
			expect(() => validateToolUse("execute_command", architectMode, [])).toThrow(/Available alternatives are:/)
		})
	})

	describe("discourage shell fallback", () => {
		const codeTools = getModeAvailableTools(codeMode)

		it("discourages execute_command when file tools exist for read-like requests", () => {
			expect(shouldDiscourageShellFallback("read_something", codeTools)).toBe(true)
			expect(shouldDiscourageShellFallback("list_dir", codeTools)).toBe(true)
			expect(shouldDiscourageShellFallback("grep_files", codeTools)).toBe(true)
		})

		it("includes anti-shell guidance in recovery for read-like unknown tools", () => {
			const message = formatUnavailableToolRecovery({
				toolName: "cat_file",
				reason: "unknown",
				mode: codeMode,
				availableTools: codeTools,
			})
			expect(message).toMatch(/Do not fall back to execute_command/)
			expect(message).toContain("read_file")
		})

		it("does not force anti-shell guidance for pure execute intent", () => {
			// execute category alone does not trigger the file-op anti-shell path
			expect(inferRecoveryCategory("run_shell")).toBe("execute")
			expect(shouldDiscourageShellFallback("run_shell", codeTools)).toBe(false)
		})
	})
})
