import { describe, it, expect } from "vitest"

import { resolveSelectionContext } from "../resolveSelectionContext"

/**
 * F-024c — host-authoritative selection resolution.
 *
 * These tests lock the guarantee that matters to the user: whatever the webview
 * sends (even a bare word with no offsets, or preview text whose whitespace no
 * longer matches the source), the host always answers with a real location —
 * never an empty context.
 */

const BANKING_DESIGN = [
	"# Banking System Architecture",
	"",
	"## Overview",
	"",
	"The platform is split into independent services.",
	"",
	"## Features",
	"",
	"| Feature | Status |",
	"| Login | Done |",
	"| Payments | Planned |",
	"",
	"## Rollout",
	"",
	"Ship behind a flag.",
].join("\n")

describe("F-024c resolveSelectionContext — the Payments table case", () => {
	it("locates a one-word selection with no offsets and reports its table row", () => {
		const resolved = resolveSelectionContext(BANKING_DESIGN, { selectedText: "Payments" })

		expect(resolved.mappingConfidence).toBe("exact")
		expect(resolved.degraded).toBe(false)
		expect(resolved.headingPath).toEqual(["Banking System Architecture", "Features"])
		expect(resolved.parentHeading).toBe("Features")
		expect(resolved.blockType).toBe("table")
		expect(resolved.tableHeading).toBe("Features")
		expect(resolved.tableColumns).toEqual(["Feature", "Status"])
		expect(resolved.tableColumn).toBe("Feature")
		expect(resolved.tableRowText).toBe("| Payments | Planned |")
	})

	it("indexes data rows below a separator-less header and lists neighbouring rows", () => {
		const resolved = resolveSelectionContext(BANKING_DESIGN, { selectedText: "Payments" })

		// Header is line 1 of the block, "Login" row is data row 0, "Payments" is 1.
		expect(resolved.tableRow).toBe(1)
		expect(resolved.tableRowsNearby).toContain("| Login | Done |")
	})

	it("indexes data rows below a GFM separator row", () => {
		const gfm = [
			"## Features",
			"",
			"| Feature | Status |",
			"| --- | --- |",
			"| Login | Done |",
			"| Payments | Planned |",
		].join("\n")

		const resolved = resolveSelectionContext(gfm, { selectedText: "Payments" })

		expect(resolved.tableColumns).toEqual(["Feature", "Status"])
		expect(resolved.tableRow).toBe(1)
		expect(resolved.tableRowsNearby).toContain("| Login | Done |")
	})

	it("resolves the column from real cell boundaries, not character averages", () => {
		const resolved = resolveSelectionContext(BANKING_DESIGN, { selectedText: "Planned" })

		expect(resolved.tableColumn).toBe("Status")
		expect(resolved.tableRowText).toBe("| Payments | Planned |")
	})

	it("does not treat a lone pipe in prose as a table", () => {
		const prose = ["## Notes", "", "Use the a | b form when piping.", ""].join("\n")

		const resolved = resolveSelectionContext(prose, { selectedText: "piping" })

		expect(resolved.blockType).toBe("paragraph")
		expect(resolved.tableColumns).toBeUndefined()
		expect(resolved.tableRow).toBeUndefined()
	})
})

describe("F-024c resolveSelectionContext — selection shapes", () => {
	it("honours verbatim hint offsets from the source editor", () => {
		const offset = BANKING_DESIGN.indexOf("Payments")
		const resolved = resolveSelectionContext(BANKING_DESIGN, {
			selectedText: "Payments",
			startOffset: offset,
			endOffset: offset + "Payments".length,
		})

		expect(resolved.mappingConfidence).toBe("exact")
		expect(resolved.startOffset).toBe(offset)
		expect(resolved.endOffset).toBe(offset + "Payments".length)
	})

	it("ignores hint offsets that no longer verify and remaps against source", () => {
		const resolved = resolveSelectionContext(BANKING_DESIGN, {
			selectedText: "Payments",
			// Preview-derived lie: offset 0 / line 1.
			startOffset: 0,
			endOffset: 8,
			startLine: 1,
			endLine: 1,
		})

		expect(resolved.degraded).toBe(false)
		expect(BANKING_DESIGN.slice(resolved.startOffset, resolved.endOffset)).toBe("Payments")
		expect(resolved.parentHeading).toBe("Features")
	})

	it("disambiguates repeated words using the hint anchor", () => {
		const repeated = ["## Alpha", "", "status", "", "## Beta", "", "status"].join("\n")
		const secondOffset = repeated.lastIndexOf("status")

		const resolved = resolveSelectionContext(repeated, { selectedText: "status", startOffset: secondOffset })

		expect(resolved.mappingConfidence).toBe("approximate")
		expect(resolved.parentHeading).toBe("Beta")
	})

	it("maps a triple-click whole-line selection", () => {
		const resolved = resolveSelectionContext(BANKING_DESIGN, { selectedText: "| Payments | Planned |" })

		expect(resolved.mappingConfidence).toBe("exact")
		expect(resolved.startLine).toBe(resolved.endLine)
		expect(resolved.blockType).toBe("table")
	})

	it("maps a Ctrl+A whole-document selection", () => {
		const resolved = resolveSelectionContext(BANKING_DESIGN, { selectedText: BANKING_DESIGN })

		expect(resolved.mappingConfidence).toBe("exact")
		expect(resolved.degraded).toBe(false)
		expect(resolved.startLine).toBe(1)
		expect(resolved.endLine).toBe(resolved.totalLines)
	})

	it("recovers preview text whose whitespace no longer matches the source", () => {
		const spaced = ["## Overview", "", "The   platform is split", "into independent services."].join("\n")

		// Preview rendering collapses the run and joins the wrapped line.
		const resolved = resolveSelectionContext(spaced, {
			selectedText: "The platform is split into independent services.",
		})

		expect(resolved.mappingConfidence).toBe("approximate")
		expect(resolved.degraded).toBe(false)
		expect(resolved.parentHeading).toBe("Overview")
	})

	it("maps a selection padded with preview whitespace", () => {
		const resolved = resolveSelectionContext(BANKING_DESIGN, { selectedText: "  Payments  " })

		expect(resolved.degraded).toBe(false)
		expect(resolved.selectedText).toBe("Payments")
	})
})

describe("F-024c resolveSelectionContext — never-empty degradation", () => {
	it("anchors to the nearest section instead of returning empty context", () => {
		const resolved = resolveSelectionContext(BANKING_DESIGN, {
			selectedText: "text that does not exist anywhere",
			startLine: 11,
		})

		expect(resolved.mappingConfidence).toBe("unmapped")
		expect(resolved.degraded).toBe(true)
		expect(resolved.parentHeading).toBe("Features")
		expect(resolved.headingPath).toEqual(["Banking System Architecture", "Features"])
		// The location payload is still real, and the section content is attached.
		expect(resolved.startLine).toBeGreaterThan(0)
		expect(`${resolved.surroundingBefore}${resolved.surroundingAfter}`).toContain("| Payments | Planned |")
	})

	it("still reports a usable location for an empty selection", () => {
		const resolved = resolveSelectionContext(BANKING_DESIGN, { selectedText: "", startLine: 7 })

		expect(resolved.degraded).toBe(true)
		expect(resolved.parentHeading).toBe("Features")
		expect(resolved.anchor).toBeTruthy()
		expect(resolved.documentHash).toBeTruthy()
	})

	it("degrades safely on an empty document without throwing", () => {
		const resolved = resolveSelectionContext("", { selectedText: "anything" })

		expect(resolved.degraded).toBe(true)
		expect(resolved.headingPath).toEqual([])
		expect(resolved.totalLines).toBe(1)
	})
})

describe("F-024c resolveSelectionContext — task, list and mermaid blocks", () => {
	const TASKS = [
		"# Delivery Plan",
		"",
		"## Phase 2 — Ledger",
		"",
		"- [x] 2.1 Ledger schema",
		"- [ ] 2.2 Posting rules",
		"  - [ ] Nested reconciliation",
		"- [ ] 2.3 Statements",
	].join("\n")

	it("keeps the task number on a checkbox line", () => {
		const resolved = resolveSelectionContext(TASKS, { selectedText: "Ledger schema" })

		expect(resolved.blockType).toBe("checkbox")
		expect(resolved.taskNumber).toBe("2.1")
		expect(resolved.taskTitle).toBe("Ledger schema")
		expect(resolved.currentPhase).toBe("Phase 2 — Ledger")
		expect(resolved.documentTaskCount).toBe(4)
	})

	it("reports list position and real indentation depth", () => {
		const resolved = resolveSelectionContext(TASKS, { selectedText: "Nested reconciliation" })

		expect(resolved.parentListType).toBe("checkbox")
		expect(resolved.nestingLevel).toBe(1)
		expect(resolved.listIndex).toBe(0)
	})

	it("counts same-indent siblings for a top-level item", () => {
		const resolved = resolveSelectionContext(TASKS, { selectedText: "Statements" })

		expect(resolved.listIndex).toBe(2)
		expect(resolved.nestingLevel).toBe(0)
	})

	it("identifies a mermaid block and its ordinal", () => {
		const withMermaid = [
			"## Flow",
			"",
			"```mermaid",
			"graph TD",
			"  A --> B",
			"```",
			"",
			"## Sequence",
			"",
			"```mermaid",
			"sequenceDiagram",
			"  A ->> B: ping",
			"```",
		].join("\n")

		const resolved = resolveSelectionContext(withMermaid, { selectedText: "A ->> B: ping" })

		expect(resolved.blockType).toBe("mermaid")
		expect(resolved.mermaidDiagramType).toBe("sequenceDiagram")
		expect(resolved.mermaidFenceIndex).toBe(1)
		expect(resolved.parentHeading).toBe("Sequence")
	})

	it("does not read headings out of fenced code", () => {
		const fenced = ["## Real Heading", "", "```md", "## Fake Heading", "```", "", "Body text."].join("\n")

		const resolved = resolveSelectionContext(fenced, { selectedText: "Body text." })

		expect(resolved.headingPath).toEqual(["Real Heading"])
	})
})

describe("F-024c resolveSelectionContext — document map", () => {
	it("always reports the document map so the model can orient itself", () => {
		const resolved = resolveSelectionContext(BANKING_DESIGN, { selectedText: "Payments" })

		expect(resolved.totalLines).toBe(BANKING_DESIGN.split("\n").length)
		expect(resolved.documentHeadingSummary).toContain("## Features")
		expect(resolved.siblingHeadings).toEqual(expect.arrayContaining(["Overview", "Rollout"]))
		expect(resolved.confidence).toBeGreaterThan(0.9)
	})

	it("extracts requirement identifiers from the enclosing heading", () => {
		const requirements = ["# Requirements", "", "## REQ-14: Audit trail", "", "Every transfer is logged."].join(
			"\n",
		)

		const resolved = resolveSelectionContext(requirements, { selectedText: "Every transfer is logged." })

		expect(resolved.requirementId).toBe("REQ-14")
		expect(resolved.requirementTitle).toBe("Audit trail")
	})

	it("produces a stable anchor for the same selection and a different one across documents", () => {
		const a = resolveSelectionContext(BANKING_DESIGN, { selectedText: "Payments" })
		const b = resolveSelectionContext(BANKING_DESIGN, { selectedText: "Payments" })
		const c = resolveSelectionContext(`${BANKING_DESIGN}\n\nAppendix.`, { selectedText: "Payments" })

		expect(a.anchor).toBe(b.anchor)
		expect(a.anchor).not.toBe(c.anchor)
	})
})
