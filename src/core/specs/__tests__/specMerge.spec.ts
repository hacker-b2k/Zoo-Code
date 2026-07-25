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
})
