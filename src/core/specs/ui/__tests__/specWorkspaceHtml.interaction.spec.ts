/**
 * F-025: Spec Workspace interaction-design regression tests.
 *
 * These lock the production contract for the tab strip and the header action
 * buttons so a future edit cannot silently reintroduce hardcoded colours,
 * invisible idle tabs, layout-shifting hover states, or a hover state that is
 * indistinguishable from the active state.
 */

import { describe, it, expect, beforeAll } from "vitest"

import { buildSpecWorkspaceHtml } from "../specWorkspaceHtml"

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

describe("F-025 Spec Workspace interaction design", () => {
	let html: string
	let css: string

	beforeAll(() => {
		html = buildSpecWorkspaceHtml("test-nonce", "vscode-webview://test")
		css = extractStyle(html)
	})

	it("defines every interaction token from theme variables (no literal colours)", () => {
		const root = ruleBody(css, ":root")
		for (const token of [
			"--accent",
			"--accent-hover",
			"--accent-fg",
			"--surface",
			"--surface-hover",
			"--surface-border",
			"--focus-ring",
			"--elevation-1",
			"--elevation-2",
		]) {
			const decl = new RegExp(token + "\\s*:\\s*([^;]+);").exec(root)
			expect(decl, `${token} must be declared on :root`).toBeTruthy()
			// Every colour token must resolve through a --vscode-* theme variable.
			expect(decl![1]).toContain("--vscode-")
			// And must never carry a literal colour of its own.
			expect(decl![1]).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
			expect(decl![1]).not.toMatch(/\brgba?\(/)
		}
	})

	it("keeps idle tabs on a visible surface rather than plain transparent", () => {
		const tab = ruleBody(css, ".tab")
		expect(tab).toMatch(/background:\s*var\(--surface\)/)
		expect(tab).not.toMatch(/background:\s*transparent/)
	})

	it("drives the active tab from the theme accent and never a hardcoded colour", () => {
		const active = ruleBody(css, "button.tab.active")
		expect(active).toMatch(/background:\s*var\(--accent\)/)
		expect(active).toMatch(/color:\s*var\(--accent-fg\)/)

		// The active badge previously used rgba(255,255,255,0.25).
		const badge = ruleBody(css, ".tab.active .tab-badge")
		expect(badge).not.toMatch(/\brgba?\(/)
		expect(badge).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
		expect(badge).toMatch(/var\(--accent/)
	})

	it("gives hover and active visually distinct backgrounds", () => {
		const hover = ruleBody(css, "button.tab:hover:not(:disabled)")
		const active = ruleBody(css, "button.tab.active")
		const hoverBg = /background:\s*([^;]+);/.exec(hover)?.[1].trim()
		const activeBg = /background:\s*([^;]+);/.exec(active)?.[1].trim()
		expect(hoverBg).toBeTruthy()
		expect(activeBg).toBeTruthy()
		expect(hoverBg).not.toBe(activeBg)
	})

	it("scopes hover to the hovered element and animates it smoothly", () => {
		const tab = ruleBody(css, ".tab")
		expect(tab).toMatch(/transition:/)

		// Hover rules must be anchored on :hover (never a parent/sibling combinator
		// that would restyle unhovered tabs).
		expect(css).toContain("button.tab:hover:not(:disabled)")
		expect(css).toContain("button.tab.active:hover:not(:disabled)")
		expect(css).not.toMatch(/\.tabs:hover\s+\.tab\b/)
	})

	it("never animates geometry, so hovering causes no layout shift", () => {
		const forbidden = /(?:^|[\s,])(?:padding|margin|border-width|width|height|font-size|transform)\b/
		for (const selector of [
			"button:hover:not(:disabled)",
			"button.secondary:hover:not(:disabled)",
			"button.tab:hover:not(:disabled)",
			"button.tab.active:hover:not(:disabled)",
			".view-toggle button:hover:not(:disabled)",
		]) {
			const body = ruleBody(css, selector)
			expect(body, `${selector} must not change geometry on hover`).not.toMatch(forbidden)
		}

		// Weight is pinned on the base rule so activating a tab cannot resize it.
		expect(ruleBody(css, ".tab")).toMatch(/font-weight:/)
		expect(ruleBody(css, "button.tab.active")).not.toMatch(/font-weight:/)

		// A constant 1px border in every state keeps the border box stable.
		expect(ruleBody(css, "button")).toMatch(/border:\s*1px solid transparent/)
		expect(ruleBody(css, ".tab")).toMatch(/border:\s*1px solid/)
	})

	it("expresses elevation purely as a shadow", () => {
		expect(ruleBody(css, "button:hover:not(:disabled)")).toMatch(/box-shadow:\s*var\(--elevation-2\)/)
		expect(ruleBody(css, "button.tab:hover:not(:disabled)")).toMatch(/box-shadow:\s*var\(--elevation-2\)/)
	})

	it("applies the shared hover interaction to every named header action", () => {
		// All six buttons the requirement names must exist and inherit the shared
		// `button` / `button.secondary` hover contract (no per-id overrides).
		for (const id of ["btnRefresh", "btnImport", "btnExport", "btnDelete", "btnCreate", "btnSave"]) {
			expect(html).toContain(`id="${id}"`)
			expect(css, `#${id} must not have a bespoke style override`).not.toContain(`#${id}`)
		}
		expect(css).toContain("button:hover:not(:disabled)")
		expect(css).toContain("button.secondary:hover:not(:disabled)")
	})

	it("suppresses hover affordances on disabled buttons", () => {
		// Delete and Save ship disabled; :not(:disabled) guards keep them inert.
		expect(html).toMatch(/id="btnDelete"[^>]*disabled/)
		expect(html).toMatch(/id="btnSave"[^>]*disabled/)
		expect(ruleBody(css, "button:disabled")).toMatch(/box-shadow:\s*var\(--elevation-0\)/)
	})

	it("honours reduced-motion preferences", () => {
		expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
	})
})
