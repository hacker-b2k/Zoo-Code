import { describe, it, expect } from "vitest"

import { resolveSelectionContext } from "../resolveSelectionContext"
import { formatHiddenSelectionContext, type SelectionContext } from "../SelectionContextStore"

/**
 * The word "is" occurs in every section. A bare indexOf would always return the
 * first hit, silently pointing the agent at the wrong paragraph.
 */
const COMMON_WORD_DOC = [
	"# Platform",
	"",
	"## Overview",
	"",
	"The gateway is stateless.",
	"",
	"## Payments",
	"",
	"Settlement is nightly.",
	"",
	"## Reporting",
	"",
	"The ledger is append-only.",
].join("\n")

const lineOf = (needle: string) => COMMON_WORD_DOC.split("\n").findIndex((l) => l.includes(needle)) + 1

describe("F-024d short/common selections must not resolve to the wrong location", () => {
	it("uses the reported line to pick the right occurrence of a common word", () => {
		// "is" appears three times; the user selected the one under ## Payments.
		const paymentsLine = lineOf("Settlement is nightly.")
		const resolved = resolveSelectionContext(COMMON_WORD_DOC, {
			selectedText: "is",
			startLine: paymentsLine,
			endLine: paymentsLine,
		})

		expect(resolved.startLine).toBe(paymentsLine)
		expect(resolved.parentHeading).toBe("Payments")
		expect(resolved.surroundingAfter).toContain("nightly")
	})

	it("uses the reported offset to disambiguate when no line is given", () => {
		const target = COMMON_WORD_DOC.indexOf("is", COMMON_WORD_DOC.indexOf("## Reporting"))
		const resolved = resolveSelectionContext(COMMON_WORD_DOC, {
			selectedText: "is",
			startOffset: target,
			endOffset: target + 2,
		})

		expect(resolved.startOffset).toBe(target)
		expect(resolved.parentHeading).toBe("Reporting")
	})

	it("flags ambiguity instead of guessing when nothing corroborates the location", () => {
		const resolved = resolveSelectionContext(COMMON_WORD_DOC, { selectedText: "is" })

		expect(resolved.ambiguous).toBe(true)
		expect(resolved.candidateCount).toBeGreaterThan(1)
		// Low confidence must be reported honestly rather than inheriting 0.7.
		expect(resolved.confidence).toBeLessThan(0.5)
	})

	it("still returns a real location even when ambiguous, never an empty context", () => {
		const resolved = resolveSelectionContext(COMMON_WORD_DOC, { selectedText: "is" })

		expect(resolved.startLine).toBeGreaterThan(0)
		expect(resolved.headingPath.length).toBeGreaterThan(0)
		expect(resolved.anchor).toBeTruthy()
	})

	it("does not flag a distinctive phrase as ambiguous", () => {
		const resolved = resolveSelectionContext(COMMON_WORD_DOC, { selectedText: "append-only" })

		expect(resolved.ambiguous).toBe(false)
		expect(resolved.candidateCount).toBe(1)
		expect(resolved.mappingConfidence).toBe("exact")
		expect(resolved.confidence).toBeGreaterThan(0.9)
	})

	it("keeps a unique short word unambiguous", () => {
		// "ledger" is short but occurs once — it must not be penalised.
		const resolved = resolveSelectionContext(COMMON_WORD_DOC, { selectedText: "ledger" })

		expect(resolved.ambiguous).toBe(false)
		expect(resolved.parentHeading).toBe("Reporting")
	})

	it("prefers the hinted section when two occurrences are otherwise equal", () => {
		const doc = ["## Alpha", "", "status: open", "", "## Beta", "", "status: open"].join("\n")
		const betaLine = doc.split("\n").findIndex((l, i) => l.includes("status") && i > 4) + 1

		const resolved = resolveSelectionContext(doc, {
			selectedText: "status",
			startLine: betaLine,
			endLine: betaLine,
		})

		expect(resolved.parentHeading).toBe("Beta")
		expect(resolved.startLine).toBe(betaLine)
	})
})

describe("F-024d ambiguous selections instruct the agent to ask, not guess", () => {
	const baseContext = (overrides: Partial<SelectionContext>): SelectionContext =>
		({
			token: "t",
			createdAt: Date.now(),
			action: "rewrite",
			specId: "s1",
			specTitle: "Platform",
			documentKind: "design",
			documentTitle: "Design",
			revision: 3,
			selectedText: "is",
			source: "editor",
			mappingConfidence: "approximate",
			...overrides,
		}) as SelectionContext

	it("emits an ambiguous_location note telling the model not to edit", () => {
		const formatted = formatHiddenSelectionContext(
			baseContext({ ambiguousLocation: true, candidateCount: 3, confidence: 0.35 }),
		)

		expect(formatted).toContain("<ambiguous_location")
		expect(formatted).toContain('candidates="3"')
		expect(formatted).toContain("Do NOT edit any occurrence")
		expect(formatted).toContain("ask_followup_question")
	})

	it("omits the note when the location is unambiguous", () => {
		expect(formatHiddenSelectionContext(baseContext({ confidence: 0.95 }))).not.toContain("<ambiguous_location")
	})

	it("no longer forbids asking for clarification outright", () => {
		// Rule 1 used to ban "I need more information", which would have blocked
		// the very clarification an ambiguous selection requires.
		const formatted = formatHiddenSelectionContext(baseContext({ ambiguousLocation: true, candidateCount: 2 }))

		expect(formatted).not.toContain('"I need more information."')
		expect(formatted).toContain("do NOT edit. Ask which occurrence the user meant")
	})

	it("forbids writing internal metadata into the document", () => {
		const formatted = formatHiddenSelectionContext(baseContext({}))

		expect(formatted).toContain("never write an anchor id")
		expect(formatted).toContain("Never insert marker comments")
	})
})
