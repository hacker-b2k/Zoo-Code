import { describe, expect, it } from "vitest"

import { shouldReplaceWithCanonicalCompletion } from "../ResponseReconciler"

describe("shouldReplaceWithCanonicalCompletion", () => {
	it.each([
		["done", "done"],
		["  done\n", "done"],
		["Implemented the fix", "Implemented the fix and verified tests"],
	])("reconciles same-turn duplicate or safe prefix %j / %j", (ordinary, completion) => {
		expect(shouldReplaceWithCanonicalCompletion({ text: ordinary }, { text: completion })).toBe(true)
	})

	it("preserves meaningful progress text", () => {
		expect(
			shouldReplaceWithCanonicalCompletion(
				{ text: "Running the tests now" },
				{ text: "Implemented and verified the fix" },
			),
		).toBe(false)
	})

	it("does not reconcile across turns", () => {
		expect(shouldReplaceWithCanonicalCompletion({ text: "done", turnId: 1 }, { text: "done", turnId: 2 })).toBe(
			false,
		)
	})

	it("does not remove partial progress", () => {
		expect(shouldReplaceWithCanonicalCompletion({ text: "done", partial: true }, { text: "done" })).toBe(false)
	})
})
