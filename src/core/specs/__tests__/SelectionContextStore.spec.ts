import { describe, expect, it, vi } from "vitest"

import {
	formatHiddenSelectionContext,
	SelectionContextStore,
	type SelectionContext,
} from "../selection/SelectionContextStore"

const baseContext = {
	action: "rewrite" as const,
	specId: "spec-123",
	specTitle: "Auth & Access",
	documentKind: "requirements",
	documentTitle: "Requirements",
	revision: 7,
	selectedText: "<must> preserve & validate",
	source: "editor" as const,
	startOffset: 12,
	endOffset: 38,
	startLine: 2,
	endLine: 2,
	mappingConfidence: "exact" as const,
}

describe("F-024 SelectionContextStore", () => {
	it("consumes an opaque context token exactly once", () => {
		const store = new SelectionContextStore()
		const token = store.create(baseContext)

		expect(token).not.toContain(baseContext.specId)
		expect(store.consume(token)).toMatchObject(baseContext)
		expect(store.consume(token)).toBeUndefined()
	})

	it("expires stale selection context", () => {
		vi.useFakeTimers()
		const store = new SelectionContextStore()
		const token = store.create(baseContext)

		vi.advanceTimersByTime(10 * 60 * 1000 + 1)
		expect(store.consume(token)).toBeUndefined()
		vi.useRealTimers()
	})

	it("formats model-only selection context with escaped metadata and exact text", () => {
		const context: SelectionContext = { ...baseContext, token: "opaque-token", createdAt: Date.now() }
		const formatted = formatHiddenSelectionContext(context)

		expect(formatted).toContain('<selection_context source="editor" action="rewrite"')
		expect(formatted).toContain('id="spec-123"')
		expect(formatted).toContain("&lt;must&gt; preserve &amp; validate")
		expect(formatted).toContain("CRITICAL RULES")
	})
})

describe("F-024b Enhanced Selection Context Resolution", () => {
	it("stores and passes through heading path and block type", () => {
		const store = new SelectionContextStore()
		const token = store.create({
			...baseContext,
			headingPath: ["UI", "Theme", "Colors"],
			blockType: "bullet",
			parentHeading: "Colors",
			documentHash: "abc123",
			anchor: "def456",
		})

		const ctx = store.consume(token)
		expect(ctx).toBeDefined()
		expect(ctx!.headingPath).toEqual(["UI", "Theme", "Colors"])
		expect(ctx!.blockType).toBe("bullet")
		expect(ctx!.parentHeading).toBe("Colors")
		expect(ctx!.documentHash).toBe("abc123")
		expect(ctx!.anchor).toBe("def456")
	})

	it("stores task context (number, title, phase)", () => {
		const store = new SelectionContextStore()
		const token = store.create({
			...baseContext,
			taskNumber: "12.4",
			taskTitle: "Build admin dashboard",
			currentPhase: "Phase 12",
			blockType: "task",
		})

		const ctx = store.consume(token)
		expect(ctx!.taskNumber).toBe("12.4")
		expect(ctx!.taskTitle).toBe("Build admin dashboard")
		expect(ctx!.currentPhase).toBe("Phase 12")
	})

	it("stores list context (index, type, nesting)", () => {
		const store = new SelectionContextStore()
		const token = store.create({
			...baseContext,
			listIndex: 2,
			parentListType: "checkbox",
			nestingLevel: 1,
			blockType: "checkbox",
		})

		const ctx = store.consume(token)
		expect(ctx!.listIndex).toBe(2)
		expect(ctx!.parentListType).toBe("checkbox")
		expect(ctx!.nestingLevel).toBe(1)
	})

	it("stores table context (heading, column, row)", () => {
		const store = new SelectionContextStore()
		const token = store.create({
			...baseContext,
			tableHeading: "API Endpoints",
			tableColumn: "Method",
			tableRow: 3,
			blockType: "table",
		})

		const ctx = store.consume(token)
		expect(ctx!.tableHeading).toBe("API Endpoints")
		expect(ctx!.tableColumn).toBe("Method")
		expect(ctx!.tableRow).toBe(3)
	})

	it("stores mermaid context (diagram type, fence index)", () => {
		const store = new SelectionContextStore()
		const token = store.create({
			...baseContext,
			mermaidDiagramType: "graph LR",
			mermaidFenceIndex: 1,
			blockType: "mermaid",
		})

		const ctx = store.consume(token)
		expect(ctx!.mermaidDiagramType).toBe("graph LR")
		expect(ctx!.mermaidFenceIndex).toBe(1)
	})

	it("stores surrounding context (before, after)", () => {
		const store = new SelectionContextStore()
		const before = "This is some text before the selection that provides context for the agent."
		const after = "This is some text after the selection that helps the agent understand the full picture."
		const token = store.create({
			...baseContext,
			surroundingBefore: before,
			surroundingAfter: after,
		})

		const ctx = store.consume(token)
		expect(ctx!.surroundingBefore).toBe(before)
		expect(ctx!.surroundingAfter).toBe(after)
	})

	it("formatHiddenSelectionContext includes heading path when provided", () => {
		const context: SelectionContext = {
			...baseContext,
			token: "t",
			createdAt: Date.now(),
			headingPath: ["UI", "Theme", "Colors"],
			blockType: "bullet",
			parentHeading: "Colors",
			documentHash: "abc123",
			anchor: "def456",
		}

		const formatted = formatHiddenSelectionContext(context)
		expect(formatted).toContain("<heading_path>")
		expect(formatted).toContain("UI")
		expect(formatted).toContain("Theme")
		expect(formatted).toContain("Colors")
		expect(formatted).toContain("<block_type>bullet")
		expect(formatted).toContain("<parent_heading>Colors")
		expect(formatted).toContain('doc_hash="abc123"')
		expect(formatted).toContain('<anchor id="def456"')
		expect(formatted).toContain("CRITICAL RULES")
		expect(formatted).toContain("heading_path, block_type, line range")
	})

	it("formatHiddenSelectionContext includes task context when provided", () => {
		const context: SelectionContext = {
			...baseContext,
			token: "t",
			createdAt: Date.now(),
			taskNumber: "12.4",
			taskTitle: "Build admin dashboard",
			currentPhase: "Phase 12",
			blockType: "task",
		}

		const formatted = formatHiddenSelectionContext(context)
		expect(formatted).toContain('<task number="12.4" title="Build admin dashboard" />')
		expect(formatted).toContain("<phase>Phase 12")
		expect(formatted).toContain("<block_type>task")
	})

	it("formatHiddenSelectionContext includes list context when provided", () => {
		const context: SelectionContext = {
			...baseContext,
			token: "t",
			createdAt: Date.now(),
			listIndex: 2,
			parentListType: "checkbox",
			nestingLevel: 1,
		}

		const formatted = formatHiddenSelectionContext(context)
		expect(formatted).toContain('<list type="checkbox" index="2" nesting="1" />')
	})

	it("formatHiddenSelectionContext includes table context when provided", () => {
		const context: SelectionContext = {
			...baseContext,
			token: "t",
			createdAt: Date.now(),
			tableHeading: "API Endpoints",
			tableColumn: "Method",
			tableRow: 3,
		}

		const formatted = formatHiddenSelectionContext(context)
		expect(formatted).toContain('<table heading="API Endpoints" column="Method" row="3"')
	})

	it("formatHiddenSelectionContext includes the containing row and nearby rows", () => {
		const context: SelectionContext = {
			...baseContext,
			token: "t",
			createdAt: Date.now(),
			tableHeading: "Features",
			tableColumn: "Feature",
			tableColumns: ["Feature", "Status"],
			tableRow: 1,
			tableRowText: "| Payments | Planned |",
			tableRowsNearby: ["| Login | Done |"],
		}

		const formatted = formatHiddenSelectionContext(context)
		expect(formatted).toContain('columns="Feature | Status"')
		expect(formatted).toContain("<table_row>| Payments | Planned |</table_row>")
		expect(formatted).toContain("<table_rows_nearby>| Login | Done |</table_rows_nearby>")
	})

	it("formatHiddenSelectionContext explains degraded mapping instead of leaving it empty", () => {
		const context: SelectionContext = {
			...baseContext,
			token: "t",
			createdAt: Date.now(),
			mappingConfidence: "unmapped",
			degradedMapping: true,
			parentHeading: "Features",
			surroundingBefore: "## Features\n",
		}

		const formatted = formatHiddenSelectionContext(context)
		expect(formatted).toContain("<location_note>")
		expect(formatted).toContain("nearest enclosing section")
		expect(formatted).toContain("<parent_heading>Features</parent_heading>")
	})

	it("formatHiddenSelectionContext includes mermaid context when provided", () => {
		const context: SelectionContext = {
			...baseContext,
			token: "t",
			createdAt: Date.now(),
			mermaidDiagramType: "graph LR",
			mermaidFenceIndex: 1,
		}

		const formatted = formatHiddenSelectionContext(context)
		expect(formatted).toContain('<mermaid type="graph LR" fence_index="1" />')
	})

	it("formatHiddenSelectionContext includes surrounding context when provided", () => {
		const context: SelectionContext = {
			...baseContext,
			token: "t",
			createdAt: Date.now(),
			surroundingBefore: "Before text here...",
			surroundingAfter: "...After text here",
		}

		const formatted = formatHiddenSelectionContext(context)
		expect(formatted).toContain("<context_before>")
		expect(formatted).toContain("Before text here...")
		expect(formatted).toContain("<context_after>")
		expect(formatted).toContain("...After text here")
	})

	it("formatHiddenSelectionContext omits optional context fields when not provided", () => {
		const context: SelectionContext = {
			...baseContext,
			token: "t",
			createdAt: Date.now(),
		}

		const formatted = formatHiddenSelectionContext(context)
		expect(formatted).not.toContain("<heading_path>")
		expect(formatted).not.toContain("<block_type>")
		expect(formatted).not.toContain("<task ")
		expect(formatted).not.toContain("<list ")
		expect(formatted).not.toContain("<table ")
		expect(formatted).not.toContain("<mermaid ")
		expect(formatted).not.toContain("<context_before>")
		expect(formatted).not.toContain("<context_after>")
	})

	it("formatHiddenSelectionContext escapes HTML entities in context values", () => {
		const context: SelectionContext = {
			...baseContext,
			token: "t",
			createdAt: Date.now(),
			headingPath: ["Head <1>", 'Sub & "Rich"'],
			parentHeading: '<script>alert("xss")</script>',
			surroundingBefore: "Before & after",
			surroundingAfter: "After <tag>",
		}

		const formatted = formatHiddenSelectionContext(context)
		// Should contain escaped entities, not raw HTML
		expect(formatted).toContain("Head &lt;1&gt;")
		expect(formatted).toContain("Sub &amp; &quot;Rich&quot;")
		expect(formatted).toContain("&lt;script&gt;")
		expect(formatted).toContain("Before &amp; after")
		expect(formatted).toContain("After &lt;tag&gt;")
		// Should NOT contain raw unescaped HTML
		expect(formatted).not.toContain('<script>alert("xss")</script>')
	})
})
