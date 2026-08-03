import { describe, it, expect } from "vitest"

import {
	renderSpecMarkdown,
	sanitizePreviewHtml,
	extractMermaidSlots,
	escapeHtml,
	escapeAttr,
	MERMAID_THEME,
	PREVIEW_MAX_CHARS,
} from "../specPreview"

/**
 * Helper: construct an HTML entity string without using a literal ampersand
 * in source (which gets decoded by tooling). `ent("lt")` returns the 4-char
 * string that is the HTML entity for `<`.
 */
const ent = (name: string): string => String.fromCharCode(38) + name + ";"

const LT = ent("lt") // <
const GT = ent("gt") // >
const QUOT = ent("quot") // "
const AMP = ent("amp") // &
const APOS = ent("#39") // '

describe("specPreview — escapeHtml", () => {
	it("escapes HTML special characters", () => {
		const result = escapeHtml('<script>alert("x")</script>')
		expect(result).toBe(LT + "script" + GT + "alert(" + QUOT + "x" + QUOT + ")" + LT + "/script" + GT)
	})

	it("escapes ampersand", () => {
		expect(escapeHtml("a&b")).toBe("a" + AMP + "b")
	})

	it("escapes single quotes", () => {
		expect(escapeHtml("it's")).toBe("it" + APOS + "s")
	})
})

describe("specPreview — escapeAttr", () => {
	it("escapes quotes for attribute context", () => {
		const result = escapeAttr('a"b' + "'c<d>")
		expect(result).toBe("a" + QUOT + "b" + APOS + "c" + LT + "d" + GT)
	})
})

describe("specPreview — renderSpecMarkdown", () => {
	it("renders headings h1-h6", () => {
		const html = renderSpecMarkdown("# Title\n## Subtitle\n### H3")
		expect(html).toContain("<h1>Title</h1>")
		expect(html).toContain("<h2>Subtitle</h2>")
		expect(html).toContain("<h3>H3</h3>")
	})

	it("renders bold and italic", () => {
		const html = renderSpecMarkdown("**bold** and *italic*")
		expect(html).toContain("<strong>bold</strong>")
		expect(html).toContain("<em>italic</em>")
	})

	it("renders strikethrough", () => {
		const html = renderSpecMarkdown("~~deleted~~")
		expect(html).toContain("<del>deleted</del>")
	})

	it("renders inline code", () => {
		const html = renderSpecMarkdown("Use `npm install` to install.")
		expect(html).toContain("<code>npm install</code>")
	})

	it("renders code blocks with language class", () => {
		const html = renderSpecMarkdown("```ts\nconst x = 1\n```")
		expect(html).toContain('<pre><code class="language-ts">')
		expect(html).toContain("const x = 1")
	})

	it("renders unordered lists", () => {
		const html = renderSpecMarkdown("- one\n- two\n- three")
		expect(html).toContain("<ul>")
		expect(html).toContain("<li>one</li>")
		expect(html).toContain("<li>two</li>")
		expect(html).toContain("<li>three</li>")
	})

	it("renders ordered lists", () => {
		const html = renderSpecMarkdown("1. first\n2. second")
		expect(html).toContain("<ol>")
		expect(html).toContain("<li>first</li>")
		expect(html).toContain("<li>second</li>")
	})

	it("renders task list checkboxes", () => {
		const html = renderSpecMarkdown("- [x] done\n- [ ] todo")
		expect(html).toContain("task-list-item")
		expect(html).toContain("checked")
		expect(html).toContain("<input")
	})

	it("renders links", () => {
		const html = renderSpecMarkdown("[docs](https://example.com)")
		expect(html).toContain('<a href="https://example.com"')
		expect(html).toContain('rel="noopener noreferrer"')
		expect(html).toContain(">docs</a>")
	})

	it("renders blockquotes", () => {
		const html = renderSpecMarkdown("> quoted text")
		expect(html).toContain("<blockquote>")
		expect(html).toContain("quoted text")
	})

	it("renders horizontal rules", () => {
		const html = renderSpecMarkdown("---\n")
		expect(html).toContain("<hr />")
	})

	it("renders paragraphs", () => {
		const html = renderSpecMarkdown("hello world")
		expect(html).toContain("<p>hello world</p>")
	})

	it("returns empty string for empty/null input", () => {
		expect(renderSpecMarkdown("")).toBe("")
		// @ts-expect-error testing null input
		expect(renderSpecMarkdown(null)).toBe("")
		// @ts-expect-error testing undefined input
		expect(renderSpecMarkdown(undefined)).toBe("")
	})
})

describe("specPreview — tables", () => {
	it("renders a markdown table", () => {
		const md = "| Col1 | Col2 |\n|------|------|\n| a | b |\n| c | d |"
		const html = renderSpecMarkdown(md)
		expect(html).toContain("<table>")
		expect(html).toContain("<thead>")
		expect(html).toContain("<th>Col1</th>")
		expect(html).toContain("<th>Col2</th>")
		expect(html).toContain("<tbody>")
		expect(html).toContain("<td>a</td>")
		expect(html).toContain("<td>d</td>")
	})
})

describe("specPreview — mermaid blocks", () => {
	it("converts mermaid code blocks into mermaid-slot placeholders", () => {
		const code = "graph TD\nA-->B"
		const html = renderSpecMarkdown("```mermaid\n" + code + "\n```")
		expect(html).toContain('class="mermaid-slot"')
		expect(html).toContain("data-mermaid=")
		// The raw mermaid code should NOT appear as visible HTML text
		expect(html).not.toContain(">graph TD")
	})

	it("extractMermaidSlots finds the encoded code", () => {
		const code = "graph TD\nA-->B"
		const html = renderSpecMarkdown("```mermaid\n" + code + "\n```")
		const slots = extractMermaidSlots(html)
		expect(slots).toHaveLength(1)
		expect(slots[0].index).toBe(0)
		expect(slots[0].code).toBe(code)
	})

	it("extracts multiple mermaid slots", () => {
		const md = "```mermaid\ngraph TD\nA-->B\n```\n\ntext\n\n```mermaid\nsequenceDiagram\nA->>B\n```"
		const html = renderSpecMarkdown(md)
		const slots = extractMermaidSlots(html)
		expect(slots).toHaveLength(2)
		expect(slots[1].index).toBe(1)
	})
})

describe("specPreview — XSS prevention", () => {
	it("escapes raw HTML in text (html: false semantics)", () => {
		const html = renderSpecMarkdown("<script>alert(1)</script>")
		expect(html).not.toContain("<script>")
		expect(html).toContain(LT + "script" + GT)
	})

	it("strips injected script tags from generated HTML", () => {
		const dirty = "<p>safe</p><script>alert(1)</script>"
		const cleaned = sanitizePreviewHtml(dirty)
		expect(cleaned).not.toContain("<script>")
		expect(cleaned).toContain("<p>safe</p>")
	})

	it("removes event handler attributes", () => {
		const dirty = '<p onclick="alert(1)">text</p>'
		const cleaned = sanitizePreviewHtml(dirty)
		expect(cleaned).not.toContain("onclick")
		expect(cleaned).toContain("<p>text</p>")
	})

	it("removes single-quoted event handlers", () => {
		const dirty = "<p onmouseover='evil()'>text</p>"
		const cleaned = sanitizePreviewHtml(dirty)
		expect(cleaned).not.toContain("onmouseover")
	})

	it("neutralizes javascript: URIs in href", () => {
		const dirty = '<a href="javascript:alert(1)">click</a>'
		const cleaned = sanitizePreviewHtml(dirty)
		expect(cleaned.toLowerCase()).not.toContain("javascript:")
	})

	it("mermaid code with HTML entities is safely encoded", () => {
		const html = renderSpecMarkdown("```mermaid\nA[<b>bold</b>]\n```")
		const slots = extractMermaidSlots(html)
		expect(slots[0].code).toContain("<b>bold</b>")
		expect(html).not.toContain("<script>")
	})
})

describe("specPreview — truncation", () => {
	it("adds truncation marker when content exceeds PREVIEW_MAX_CHARS", () => {
		const huge = "# Title\n" + "x".repeat(PREVIEW_MAX_CHARS + 5000)
		const html = renderSpecMarkdown(huge)
		expect(html).toContain("preview-truncated")
		expect(html).toContain("100 KB")
	})

	it("does not add truncation marker for normal content", () => {
		const html = renderSpecMarkdown("# Small doc\nnormal content")
		expect(html).not.toContain("preview-truncated")
	})
})

describe("specPreview — MERMAID_THEME", () => {
	it("contains core theme variables", () => {
		expect(MERMAID_THEME.background).toBe("#1e1e1e")
		expect(MERMAID_THEME.textColor).toBe("#ffffff")
		expect(MERMAID_THEME.primaryColor).toBe("#3c3c3c")
		expect(MERMAID_THEME.linkColor).toBe("#6cb6ff")
		expect(MERMAID_THEME.fontSize).toBe("16px")
	})
})

// ---------------------------------------------------------------------------
// Performance: Mermaid render cache key determinism.
// The browser bundle's mermaidRenderCache is keyed by the exact source text
// (decodeURIComponent of the data-mermaid attribute). These tests confirm the
// markdown renderer produces deterministic, cacheable slot attributes so that
// switching back to a previously-viewed spec always hits the cache (instant
// innerHTML swap, no mermaid.render() re-execution).
// ---------------------------------------------------------------------------

describe("specPreview — Mermaid cache key determinism", () => {
	it("same diagram source produces identical data-mermaid attribute", () => {
		const mermaidSource = "graph TD\n  A[Start] --> B{Decision}\n  B -->|Yes| C[Done]"
		const md1 = "```mermaid\n" + mermaidSource + "\n```"
		const md2 = "# Design\n\n```mermaid\n" + mermaidSource + "\n```\nMore text."
		const html1 = renderSpecMarkdown(md1)
		const html2 = renderSpecMarkdown(md2)
		const slots1 = extractMermaidSlots(html1)
		const slots2 = extractMermaidSlots(html2)
		expect(slots1).toHaveLength(1)
		expect(slots2).toHaveLength(1)
		// Same source → same cache key (decoded code)
		expect(slots1[0].code).toBe(slots2[0].code)
	})

	it("different diagram sources produce different cache keys", () => {
		const md1 = "```mermaid\ngraph TD\n  A --> B\n```"
		const md2 = "```mermaid\ngraph TD\n  A --> C\n```"
		const html1 = renderSpecMarkdown(md1)
		const html2 = renderSpecMarkdown(md2)
		const slots1 = extractMermaidSlots(html1)
		const slots2 = extractMermaidSlots(html2)
		expect(slots1[0].code).not.toBe(slots2[0].code)
	})

	it("multiple diagrams in one doc each get unique cache keys", () => {
		const md = [
			"```mermaid\ngraph TD\n  A --> B\n```",
			"```mermaid\nsequenceDiagram\n  A->>B: Hello\n```",
			"```mermaid\nclassDiagram\n  Animal <|-- Dog\n```",
		].join("\n\n")
		const html = renderSpecMarkdown(md)
		const slots = extractMermaidSlots(html)
		expect(slots).toHaveLength(3)
		const codes = slots.map((s) => s.code)
		expect(new Set(codes).size).toBe(3) // all unique
	})

	it("entity-decoded content produces clean cache keys (no double-encoding)", () => {
		// If entity decoding runs in the parser, the source reaching the
		// renderer is clean <<abstract>> not &lt;&lt;abstract&gt;&gt;.
		// The cache key is the clean source — a revisit with the same
		// clean source is a cache hit.
		const md = "```mermaid\nclassDiagram\n  class A {\n    <<abstract>>\n  }\n```"
		const html = renderSpecMarkdown(md)
		const slots = extractMermaidSlots(html)
		expect(slots[0].code).not.toContain("&lt;")
		expect(slots[0].code).not.toContain("&gt;")
	})
})
