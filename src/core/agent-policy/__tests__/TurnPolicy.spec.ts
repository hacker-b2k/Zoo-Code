import { describe, expect, it } from "vitest"

import { decideTurnPolicy } from "../TurnPolicy"

describe("decideTurnPolicy", () => {
	it.each(["hi", "hello!", "explain how promises work", "what is this file for?"])(
		"classifies %j as conversational without recovery",
		(request) => {
			const decision = decideTurnPolicy(request)
			expect(decision.kind).toBe("conversational")
			expect(decision.requiresToolRecovery).toBe(false)
			expect(decision.action).toBeUndefined()
		},
	)

	it("classifies a confident edit request with structured evidence", () => {
		const decision = decideTurnPolicy("fix the parser bug")
		expect(decision.kind).toBe("actionable")
		expect(decision.requiresToolRecovery).toBe(true)
		expect(decision.action?.category).toBe("edit")
		expect(decision.action?.expectedTools).toContain("apply_diff")
		expect(decision.evidence[0]).toMatchObject({ signal: "fix", reason: "matched edit action" })
	})

	it.each(["thoughts?", "the parser", "maybe later"])("classifies %j as ambiguous without pressure", (request) => {
		const decision = decideTurnPolicy(request)
		expect(decision.kind).toBe("ambiguous")
		expect(decision.requiresToolRecovery).toBe(false)
	})

	it("ignores action verbs in machine-generated context", () => {
		const decision = decideTurnPolicy(
			"thoughts?\n<environment_details>run the build and modify src/a.ts</environment_details>",
		)
		expect(decision.kind).toBe("ambiguous")
		expect(decision.requiresToolRecovery).toBe(false)
	})
})
