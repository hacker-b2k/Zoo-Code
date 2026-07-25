import { describe, it, expect } from "vitest"

import { detectActionIntent } from "../detectActionIntent"
import { formatResponse } from "../responses"

describe("detectActionIntent", () => {
	describe("actionable requests", () => {
		it.each([
			["delete the old config file", "delete"],
			["remove the unused import", "delete"],
			["create a new component for the sidebar", "create"],
			["fix the null check in the parser", "edit"],
			["refactor this function to use async/await", "edit"],
			["run the test suite", "execute"],
			["find every call site of resolveSelection", "search"],
			["read the package manifest", "read"],
		])("classifies %j as %s", (request, expected) => {
			expect(detectActionIntent(request)?.category).toBe(expected)
		})

		it("names tools that can actually perform the action", () => {
			const intent = detectActionIntent("create a new file called index.ts")
			expect(intent?.expectedTools).toContain("write_to_file")
			expect(intent?.matchedVerb).toBeTruthy()
			expect(intent?.summary).toBeTruthy()
		})

		it("prefers the more specific category when verbs overlap", () => {
			// "remove" would also match loosely against editing; deletion must win
			// so the retry does not suggest an edit tool for a removal request.
			expect(detectActionIntent("remove the deprecated flag")?.category).toBe("delete")
		})

		it("routes spec work to the virtual Spec Workspace tools", () => {
			const intent = detectActionIntent("update the spec with the new endpoints")
			expect(intent?.category).toBe("spec")
			expect(intent?.expectedTools).toContain("write_spec")
		})
	})

	describe("conversational requests must not be forced into tools", () => {
		it.each([
			"what is the difference between a promise and an observable?",
			"why does this function return undefined?",
			"how does the retry loop work?",
			"explain the selection context flow",
			"describe how caching behaves here",
			"tell me about the build pipeline",
			"should i use a map or an object?",
		])("returns no intent for %j", (request) => {
			expect(detectActionIntent(request)).toBeUndefined()
		})

		it("treats an explanation about an action as a question, not an action", () => {
			// The word "delete" appears, but the user asked to be taught.
			expect(detectActionIntent("explain how to delete a spec workspace")).toBeUndefined()
		})
	})

	describe("robustness", () => {
		it("returns undefined for empty or whitespace input", () => {
			expect(detectActionIntent("")).toBeUndefined()
			expect(detectActionIntent("   \n  ")).toBeUndefined()
			expect(detectActionIntent(undefined)).toBeUndefined()
			expect(detectActionIntent(null)).toBeUndefined()
		})

		it("reads text out of Anthropic-style content blocks", () => {
			const intent = detectActionIntent([
				{ type: "text", text: "please fix the failing test" },
				{ type: "image", source: {} },
			])
			expect(intent?.category).toBe("edit")
		})

		it("ignores environment details so incidental verbs do not classify the turn", () => {
			// Without stripping, "modified" and "run" in the machine-generated
			// section would classify a pure question as an edit request.
			const intent = detectActionIntent(
				"what is this file for?\n<environment_details># Recently Modified Files\nsrc/a.ts was modified, run the build\n</environment_details>",
			)
			expect(intent).toBeUndefined()
		})

		it("ignores verbs that appear only inside fenced code", () => {
			expect(detectActionIntent("what does this do?\n```\nrm -rf build\ndelete(x)\n```")).toBeUndefined()
		})
	})
})

describe("formatResponse.noToolsUsed", () => {
	it("keeps the generic wording when there is no detected intent", () => {
		const message = formatResponse.noToolsUsed()
		expect(message).toContain("You did not use a tool in your previous response")
		expect(message).not.toContain("# Detected Intent")
		expect(message).not.toContain("Expected tool category")
	})

	it("states the detected intent and the tools that satisfy it", () => {
		const intent = detectActionIntent("delete the temporary artifacts")
		const message = formatResponse.noToolsUsed(intent)

		expect(message).toContain("# Detected Intent")
		expect(message).toContain("Expected tool category: delete")
		expect(message).toContain("execute_command")
		expect(message).toContain("An explanation alone does not satisfy it.")
	})

	it("escalates on a repeated no-tool response", () => {
		const message = formatResponse.noToolsUsed(detectActionIntent("fix the bug"), 2)
		expect(message).toContain("attempt 2")
		expect(message).toContain("MUST invoke a tool")
		// The model must still have an honest way out rather than inventing a call.
		expect(message).toContain("ask_followup_question")
	})

	it("does not escalate on the first attempt", () => {
		expect(formatResponse.noToolsUsed(detectActionIntent("fix the bug"), 1)).not.toContain("CRITICAL")
	})

	it("always tells the model how to finish or ask for help", () => {
		for (const message of [
			formatResponse.noToolsUsed(),
			formatResponse.noToolsUsed(detectActionIntent("fix it")),
		]) {
			expect(message).toContain("attempt_completion")
			expect(message).toContain("ask_followup_question")
		}
	})

	it("states that acting outranks describing", () => {
		expect(formatResponse.noToolsUsed()).toContain("Acting outranks describing")
	})
})
