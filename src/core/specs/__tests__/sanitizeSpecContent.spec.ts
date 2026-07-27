import { describe, it, expect } from "vitest"

import { sanitizeSpecContent, containsInternalSelectionMetadata } from "../sanitizeSpecContent"

describe("F-024d sanitizeSpecContent — internal metadata must never reach a document", () => {
	it("removes the exact leaked anchor marker reported by the user", () => {
		const content = ["# Design", "", "<!-- anchor: 8326fd78e994eb1e -->", "", "The service is stateless."].join(
			"\n",
		)

		const result = sanitizeSpecContent(content)

		expect(result.removed).toBe(true)
		expect(result.content).not.toContain("anchor:")
		expect(result.content).not.toContain("8326fd78e994eb1e")
		// The user's own content survives untouched.
		expect(result.content).toContain("# Design")
		expect(result.content).toContain("The service is stateless.")
	})

	it("removes an anchor marker that shares a line with real content", () => {
		const result = sanitizeSpecContent("Payments are queued. <!-- anchor: 0123456789abcdef -->")

		expect(result.content.trim()).toBe("Payments are queued.")
	})

	it("removes an <anchor id> element copied out of the hidden context", () => {
		const result = sanitizeSpecContent('# Spec\n\n<anchor id="8326fd78e994eb1e" />\n\nBody')

		expect(result.removed).toBe(true)
		expect(result.content).not.toContain("<anchor")
		expect(result.content).toContain("Body")
	})

	it("removes an entire selection_context envelope pasted back verbatim", () => {
		const content = [
			"# Requirements",
			"",
			'<selection_context source="editor" action="rewrite">',
			'<anchor id="8326fd78e994eb1e" />',
			"<selected_text>Payments</selected_text>",
			"</selection_context>",
			"",
			"Real requirement text.",
		].join("\n")

		const result = sanitizeSpecContent(content)

		expect(result.content).not.toContain("selection_context")
		expect(result.content).not.toContain("selected_text")
		expect(result.content).toContain("Real requirement text.")
	})

	it("does not touch legitimate content", () => {
		const content = [
			"# Design",
			"",
			"<!-- TODO: revisit caching -->",
			"",
			"We anchor the modal to the viewport.",
			"",
			"| Feature | Status |",
			"| Login | Done |",
		].join("\n")

		const result = sanitizeSpecContent(content)

		expect(result.removed).toBe(false)
		expect(result.content).toBe(content)
	})

	it("keeps an ordinary comment that merely mentions an anchor", () => {
		// Only a 16-hex-digit id is an internal marker. Prose must survive.
		const content = "<!-- anchor: see the deployment section -->"

		expect(sanitizeSpecContent(content).content).toBe(content)
		expect(containsInternalSelectionMetadata(content)).toBe(false)
	})

	it("detects metadata without rewriting", () => {
		expect(containsInternalSelectionMetadata("<!-- anchor: 8326fd78e994eb1e -->")).toBe(true)
		expect(containsInternalSelectionMetadata("plain markdown")).toBe(false)
	})

	it("does not leave a hole where a whole-line marker was removed", () => {
		const result = sanitizeSpecContent("# A\n\n<!-- anchor: 8326fd78e994eb1e -->\n\n# B")

		expect(result.content).not.toMatch(/\n{3,}/)
		expect(result.content).toContain("# A")
		expect(result.content).toContain("# B")
	})

	it("handles empty and non-string input safely", () => {
		expect(sanitizeSpecContent("").content).toBe("")
		expect(sanitizeSpecContent(undefined as unknown as string).content).toBe("")
	})
})
