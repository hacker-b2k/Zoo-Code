import { describe, it, expect } from "vitest"

import {
	applyAppend,
	applySearchReplace,
	applyUpsertSection,
	normalizeWriteSpecMode,
	resolveWriteBody,
} from "../specMerge"

describe("specMerge (F-021)", () => {
	it("normalizes mode aliases", () => {
		expect(normalizeWriteSpecMode(null)).toBe("replace")
		expect(normalizeWriteSpecMode("APPEND")).toBe("append")
		expect(normalizeWriteSpecMode("patch")).toBe("search_replace")
		expect(normalizeWriteSpecMode("section")).toBe("upsert_section")
	})

	it("appends with spacing", () => {
		expect(applyAppend("# A\n", "## B\n")).toContain("# A")
		expect(applyAppend("# A\n", "## B\n")).toContain("## B")
		expect(applyAppend("", "# Only\n")).toBe("# Only\n")
	})

	it("search_replace toggles checkbox without full rewrite", () => {
		const src = "# Tasks\n\n- [ ] Ship login\n- [ ] Ship logout\n"
		const out = applySearchReplace(src, "- [ ] Ship login", "- [x] Ship login", false)
		expect(out).toContain("- [x] Ship login")
		expect(out).toContain("- [ ] Ship logout")
		expect(out).not.toBe(src)
	})

	it("search_replace fails when not found", () => {
		expect(() => applySearchReplace("hello", "missing", "x", false)).toThrow(/not found/)
	})

	it("search_replace fails on ambiguous match without replace_all", () => {
		expect(() => applySearchReplace("aa aa", "aa", "b", false)).toThrow(/matched 2/)
	})

	it("upsert_section replaces existing heading block", () => {
		const src = "# Design\n\n## Auth\nold\n\n## Data\nkeep\n"
		const out = applyUpsertSection(src, "## Auth", "new auth body")
		expect(out).toContain("new auth body")
		expect(out).not.toContain("old")
		expect(out).toContain("## Data")
		expect(out).toContain("keep")
	})

	it("upsert_section appends when heading missing", () => {
		const src = "# Design\n\nintro\n"
		const out = applyUpsertSection(src, "## New", "body")
		expect(out).toContain("## New")
		expect(out).toContain("body")
		expect(out).toContain("intro")
	})

	it("resolveWriteBody replace ignores existing", () => {
		expect(resolveWriteBody({ mode: "replace", existingContent: "old", content: "new" })).toBe("new")
	})

	// Issue B regression: fixing ONE broken Mermaid diagram inside a
	// multi-diagram design doc via a targeted search_replace must leave the
	// rest of the document byte-identical (no full rewrite side-effects).
	it("Issue B: targeted edit of one mermaid block leaves rest byte-identical", () => {
		const diagramA = "```mermaid\nflowchart TD\n  A[Start] --> B[End]\n```"
		const diagramBbroken = "```mermaid\nsequenceDiagram\n  Alice->>Bob: hi\n  deactivate Alice\n```"
		const diagramBfixed = "```mermaid\nsequenceDiagram\n  Alice->>Bob: hi\n```"
		const diagramC = "```mermaid\nclassDiagram\n  Animal <|-- Dog\n```"
		const doc =
			"# Design\n\n## Flow\n\n" +
			diagramA +
			"\n\n## Sequence\n\n" +
			diagramBbroken +
			"\n\n## Classes\n\n" +
			diagramC +
			"\n"

		const out = applySearchReplace(doc, diagramBbroken, diagramBfixed, false)

		// The broken diagram is fixed.
		expect(out).toContain(diagramBfixed)
		expect(out).not.toContain("deactivate Alice")
		// Everything else is byte-identical: replacing the fixed block back
		// must reproduce the original document exactly.
		const roundTrip = out.replace(diagramBfixed, diagramBbroken)
		expect(roundTrip).toBe(doc)
		// Untouched diagrams preserved verbatim.
		expect(out).toContain(diagramA)
		expect(out).toContain(diagramC)
	})

	it("Issue B: upsert_section rewrites only the targeted diagram section", () => {
		const doc =
			"# Design\n\n## Overview\n\nkeep this overview\n\n## Data Model\n\nold broken body\n\n## API\n\nkeep this api\n"
		const out = applyUpsertSection(doc, "## Data Model", "```mermaid\nerDiagram\n  USER ||--o{ POST : writes\n```")
		expect(out).toContain("keep this overview")
		expect(out).toContain("keep this api")
		expect(out).toContain("erDiagram")
		expect(out).not.toContain("old broken body")
	})
})
