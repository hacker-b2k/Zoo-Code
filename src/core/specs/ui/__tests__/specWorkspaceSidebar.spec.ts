import { describe, it, expect } from "vitest"

import { buildSpecWorkspaceHtml } from "../specWorkspaceHtml"

/**
 * F-026 / F-027 — Spec Workspace sidebar cards.
 *
 * These tests lock the sidebar card contract permanently so a future edit
 * cannot silently regress it back to plain text rows:
 *   - each spec renders as a real card on a theme surface,
 *   - selection uses IDE theme variables only (no hardcoded colours),
 *   - hover enhances only background / border / elevation (no layout shift),
 *   - metadata is secondary to the title,
 *   - selection and refresh behaviours stay wired up.
 *
 * F-027 narrows the card to spec identity only: the document-type badge and
 * the document-type glyph are gone, and the leading element is a numbered
 * circle reflecting list order.
 */

/** Extract the inline stylesheet only, so markup/script noise cannot skew assertions. */
function extractStyle(html: string): string {
	const match = /<style>([\s\S]*?)<\/style>/.exec(html)
	expect(match, "inline <style> block must exist").toBeTruthy()
	return match![1]
}

/** Return the declaration body of the first rule whose selector list matches exactly. */
function ruleBody(css: string, selector: string): string {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
	const re = new RegExp("(?:^|\\})\\s*" + escaped + "\\s*\\{([^}]*)\\}", "m")
	const match = re.exec(css)
	expect(match, `rule "${selector}" must exist`).toBeTruthy()
	return match![1]
}

const html = buildSpecWorkspaceHtml("test-nonce", "vscode-resource:")
const css = extractStyle(html)

/** Properties that change the border box and would therefore reflow the list. */
const GEOMETRY = /padding|margin|border-width|(?<!min-)\bwidth\b|(?<!line-)\bheight\b|font-size|transform|gap/

describe("F-026/F-027 spec workspace sidebar cards", () => {
	it("renders each spec as a card component, not a plain text row", () => {
		// The legacy plain-row class is fully retired.
		expect(css).not.toMatch(/\.spec-item\b/)
		expect(html).not.toMatch(/class="spec-item/)

		// Card structure exists in both the stylesheet and the renderer.
		expect(css).toMatch(/\.spec-card\s*\{/)
		expect(html).toContain('card.className = "spec-card"')
		expect(html).toContain('title.className = "spec-card-title"')
		expect(html).toContain('meta.className = "spec-card-meta"')
	})

	it("gives idle cards a subtle surface, spacing and rounded corners", () => {
		const card = ruleBody(css, ".spec-card")
		expect(card).toMatch(/background:\s*var\(--surface\)/)
		expect(card).toMatch(/border:\s*1px solid var\(--surface-border\)/)
		expect(card).toMatch(/border-radius:\s*6px/)
		expect(card).toMatch(/padding:\s*7px 9px/)
		// Cards are separated by list gap, not by per-card margin, so the
		// spacing cannot drift between the first and last item.
		expect(ruleBody(css, ".spec-list")).toMatch(/gap:\s*6px/)
	})

	it("uses IDE theme variables for the selected card with no hardcoded colours", () => {
		const active = ruleBody(css, ".spec-card.active")
		expect(active).toMatch(/var\(--vscode-list-activeSelectionBackground/)
		expect(active).toMatch(/var\(--vscode-list-activeSelectionForeground/)
		expect(active).toMatch(/border-left-color:\s*var\(--accent\)/)

		// No literal colour anywhere in the card system.
		for (const selector of [
			".spec-card",
			".spec-card:hover",
			".spec-card.active",
			".spec-card.active:hover",
			".spec-card-index",
			".spec-card:hover .spec-card-index",
			".spec-card.active .spec-card-index",
		]) {
			const body = ruleBody(css, selector)
			expect(body, `${selector} must not hardcode a colour`).not.toMatch(/rgba?\(|#[0-9a-fA-F]{3,8}\b/)
		}
	})

	it("makes hover visually distinct from selection", () => {
		const hover = ruleBody(css, ".spec-card:hover")
		const active = ruleBody(css, ".spec-card.active")
		expect(hover).toMatch(/background:\s*var\(--surface-hover\)/)
		// Neutral hover surface must differ from the selection surface.
		expect(hover).not.toMatch(/list-activeSelectionBackground/)
		expect(active).not.toMatch(/background:\s*var\(--surface-hover\)\s*;/)
	})

	it("enhances hover with elevation and animates only non-layout properties", () => {
		// Subtle aesthetic: hover uses elevation-1 (gentler than elevation-2)
		// to match the new icon-button / segmented control design language.
		expect(ruleBody(css, ".spec-card:hover")).toMatch(/box-shadow:\s*var\(--elevation-1\)/)
		expect(ruleBody(css, ".spec-card.active:hover")).toMatch(/box-shadow:\s*var\(--elevation-2\)/)

		const transition = ruleBody(css, ".spec-card").match(/transition:([^;]*);/)
		expect(transition, ".spec-card must declare a transition").toBeTruthy()
		const animated = transition![1]
		for (const prop of ["background", "color", "border-color", "box-shadow"]) {
			expect(animated).toContain(prop)
		}
		expect(animated).not.toMatch(GEOMETRY)
	})

	it("never shifts layout between idle, hover and selected states", () => {
		// The border box is constant: the 1px border and 3px rail are always
		// painted, and no state rule touches geometry.
		const base = ruleBody(css, ".spec-card")
		expect(base).toMatch(/border-left:\s*3px solid transparent/)

		for (const selector of [".spec-card:hover", ".spec-card.active", ".spec-card.active:hover"]) {
			const body = ruleBody(css, selector)
			expect(body, `${selector} must not animate geometry`).not.toMatch(GEOMETRY)
			expect(body, `${selector} must not change font-weight`).not.toMatch(/font-weight/)
		}
	})

	it("prioritises the title over metadata", () => {
		const title = ruleBody(css, ".spec-card-title")
		const meta = ruleBody(css, ".spec-card-meta")
		const titleWeight = Number(/font-weight:\s*(\d+)/.exec(title)?.[1])
		const metaWeight = Number(/font-weight:\s*(\d+)/.exec(meta)?.[1])
		const titleSize = Number(/font-size:\s*(\d+)px/.exec(title)?.[1])
		const metaSize = Number(/font-size:\s*(\d+)px/.exec(meta)?.[1])

		expect(titleWeight).toBeGreaterThan(metaWeight)
		expect(titleSize).toBeGreaterThan(metaSize)
		expect(meta).toMatch(/color:\s*var\(--muted\)/)
		// Long titles clamp instead of stretching the card.
		expect(title).toMatch(/-webkit-line-clamp:\s*2/)
		expect(title).toMatch(/overflow:\s*hidden/)
	})

	it("shows the timestamp in a secondary style", () => {
		expect(html).toContain('when.className = "spec-card-date"')
		expect(html).toContain("new Date(spec.updatedAt).toLocaleString()")
		expect(ruleBody(css, ".spec-card-date")).toMatch(/color:\s*var\(--muted\)/)
	})

	it("F-027: carries no document-type badge or document-type glyph", () => {
		// The stage chip component and its markup are fully removed.
		expect(css).not.toMatch(/\.spec-chip\b/)
		expect(html).not.toContain("spec-chip")
		// The document-type icon tile and its stage-glyph helper are gone.
		expect(css).not.toMatch(/\.spec-card-icon\b/)
		expect(html).not.toContain("spec-card-icon")
		expect(html).not.toContain("specStageIcon")
		expect(html).not.toContain("specStageLabel")
		// No card element derives its content from the spec stage any more.
		expect(html).not.toMatch(/textContent\s*=\s*[^;\n]*spec\.stage/)
	})

	it("F-027: leads each card with a theme-styled numbered circle", () => {
		const index = ruleBody(css, ".spec-card-index")
		// Circle geometry, matching the 20px footprint of the card icon gutter.
		expect(index).toMatch(/border-radius:\s*999px/)
		expect(index).toMatch(/width:\s*20px/)
		expect(index).toMatch(/height:\s*20px/)
		// Styled from IDE theme variables only.
		expect(index).toMatch(/background:\s*var\(--vscode-badge-background/)
		expect(index).toMatch(/color:\s*var\(--vscode-badge-foreground/)
		// Selected cards invert the indicator using the shared accent token.
		const activeIndex = ruleBody(css, ".spec-card.active .spec-card-index")
		expect(activeIndex).toMatch(/background:\s*var\(--accent\)/)
		expect(activeIndex).toMatch(/color:\s*var\(--accent-fg\)/)
		// Decorative: the number is not announced to assistive tech.
		expect(html).toContain('index.className = "spec-card-index"')
		expect(html).toContain('index.setAttribute("aria-hidden", "true")')
	})

	it("F-027: numbers cards by list order starting at 1", () => {
		expect(html).toContain("function buildSpecCard(spec, isActive, orderIndex)")
		expect(html).toContain("index.textContent = String(orderIndex)")
		expect(html).toContain("buildSpecCard(spec, spec.id === activeSpecId, i + 1)")
		expect(html).toMatch(/specs\.forEach\(\(spec, i\) =>/)
	})

	it("keeps selection, refresh and delete-enablement behaviour unchanged", () => {
		expect(html).toContain('card.addEventListener("click", () => selectSpec(spec.id))')
		expect(html).toContain("btnDelete.disabled = !activeSpecId || agentStreaming")
		// Re-render still rebuilds the whole list, so Refresh keeps working.
		expect(html).toContain('listEl.className = "spec-list"')
		expect(html).toContain('listEl.textContent = ""')
		// Empty state is preserved.
		expect(html).toContain('listEl.className = "empty"')
		expect(html).toContain("No specs yet. Click New Spec.")
	})

	it("writes spec titles as text, never as HTML", () => {
		expect(html).toContain("title.textContent = spec.title || spec.id")
		expect(html).not.toMatch(/innerHTML\s*=\s*[^;]*spec\.title/)
		// The only innerHTML on a card is the fixed icon literal.
		expect(html).not.toMatch(/innerHTML\s*=\s*'<div class="spec-card/)
	})

	it("is keyboard reachable and exposes selection to assistive tech", () => {
		expect(html).toContain('card.setAttribute("role", "option")')
		expect(html).toContain('card.setAttribute("tabindex", "0")')
		expect(html).toContain('card.setAttribute("aria-selected", isActive ? "true" : "false")')
		expect(html).toContain('listEl.setAttribute("role", "listbox")')
		expect(ruleBody(css, ".spec-card:focus-visible")).toMatch(/outline:\s*1px solid var\(--focus-ring\)/)
	})

	it("honours reduced-motion preferences", () => {
		expect(css).toMatch(
			/@media \(prefers-reduced-motion: reduce\) \{\s*\.spec-card, \.spec-card-index \{ transition: none; \}/,
		)
	})
})
