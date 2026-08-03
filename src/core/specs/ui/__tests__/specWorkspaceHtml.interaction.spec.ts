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

	// -----------------------------------------------------------------------
	// Refresh button redesign: icon-only, transparent idle state, subtle hover.
	// The rest of the header actions intentionally keep the legacy text style.
	// -----------------------------------------------------------------------

	it("renders the Refresh action as an icon-only button (no text label)", () => {
		// The button carries the VS Code codicon sync glyph (two curved arrows)
		// inline — no new dependency; the SVG path comes from @vscode/codicons,
		// already a project dependency. Its name is exposed only to assistive tech.
		const btnMatch = /<button id="btnRefresh"([^>]*)>([\s\S]*?)<\/button>/.exec(html)
		expect(btnMatch, "btnRefresh must exist").toBeTruthy()
		const attrs = btnMatch![1]
		const inner = btnMatch![2]
		expect(attrs).toContain('class="icon-button"')
		expect(attrs).not.toContain("secondary")
		expect(attrs).toContain('aria-label="Refresh"')
		expect(attrs).toContain('title="Refresh"')
		expect(inner).toContain("<svg")
		expect(inner).toContain("M2.006 8.267L.78 9.5") // codicon sync (two-arrow) path signature
		expect(inner).not.toMatch(/>\s*Refresh\s*</)
	})

	it("icon-button has no visible box in the idle state", () => {
		const idle = ruleBody(css, "button.icon-button")
		expect(idle).toMatch(/background:\s*transparent/)
		expect(idle).toMatch(/border:\s*1px solid transparent/)
		expect(idle).toMatch(/box-shadow:\s*none/)
		// Glyph colour comes from theme tokens, never a literal colour.
		expect(idle).toMatch(/color:\s*var\(--muted\)/)
		expect(idle).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
	})

	it("icon-button reveals a subtle surface highlight on hover", () => {
		const hover = ruleBody(css, "button.icon-button:hover:not(:disabled)")
		expect(hover).toMatch(/background:\s*var\(--surface-hover\)/)
		expect(hover).toMatch(/color:\s*var\(--fg\)/)
		// Still no border or elevation on hover — feedback is background-only.
		expect(hover).toMatch(/border-color:\s*transparent/)
		expect(hover).toMatch(/box-shadow:\s*none/)
	})

	it("icon-button keeps keyboard focus discoverable", () => {
		const focus = ruleBody(css, "button.icon-button:focus-visible")
		expect(focus).toMatch(/outline:\s*1px solid var\(--focus-ring\)/)
	})

	// -----------------------------------------------------------------------
	// Remaining header buttons: icon-only actions + icon+text primary CTAs.
	// -----------------------------------------------------------------------

	it("renders Import as an icon-only button with cloud-download codicon", () => {
		const match = /<button id="btnImport"([^>]*)>([\s\S]*?)<\/button>/.exec(html)
		expect(match).toBeTruthy()
		expect(match![1]).toContain('class="icon-button"')
		expect(match![1]).toContain('aria-label="Import plans/specs"')
		expect(match![2]).toContain("<svg")
		expect(match![2]).toContain("11.957 6h.05") // cloud-download path signature
		expect(match![2]).not.toMatch(/>\s*Import\s*</)
	})

	it("renders Export as an icon-only button with cloud-upload codicon", () => {
		const match = /<button id="btnExport"([^>]*)>([\s\S]*?)<\/button>/.exec(html)
		expect(match).toBeTruthy()
		expect(match![1]).toContain('class="icon-button"')
		expect(match![1]).toContain('aria-label="Export spec"')
		expect(match![2]).toContain("<svg")
		expect(match![2]).toContain("11.956 6h.05") // cloud-upload path signature
	})

	it("renders Delete as an icon-only button with trash codicon (disabled by default)", () => {
		const match = /<button id="btnDelete"([^>]*)>([\s\S]*?)<\/button>/.exec(html)
		expect(match).toBeTruthy()
		expect(match![1]).toContain('class="icon-button"')
		expect(match![1]).toContain('aria-label="Delete spec"')
		expect(match![1]).toContain("disabled")
		expect(match![2]).toContain("<svg")
		expect(match![2]).toContain("M10 3h3v1h-1v9") // trash path signature
	})

	it("renders New Spec as a primary CTA with add icon + text label", () => {
		const match = /<button id="btnCreate"([^>]*)>([\s\S]*?)<\/button>/.exec(html)
		expect(match).toBeTruthy()
		expect(match![1]).toContain('class="cta-button"')
		expect(match![1]).toContain('aria-label="New Spec"')
		expect(match![2]).toContain("<svg")
		expect(match![2]).toContain("M14 7v1H8v6H7V8H1V7h6V1h1v6h6z") // add path signature
		expect(match![2]).toMatch(/New Spec/)
	})

	it("renders Save as a primary CTA with save icon + text label (disabled by default)", () => {
		const match = /<button id="btnSave"([^>]*)>([\s\S]*?)<\/button>/.exec(html)
		expect(match).toBeTruthy()
		expect(match![1]).toContain('class="cta-button"')
		expect(match![1]).toContain("disabled")
		expect(match![2]).toContain("<svg")
		expect(match![2]).toContain("13.353 1.146l1.5 1.5") // save path signature
		expect(match![2]).toMatch(/Save/)
	})

	it("cta-button aligns icon and text with inline-flex + gap", () => {
		const cta = ruleBody(css, "button.cta-button")
		expect(cta).toMatch(/display:\s*inline-flex/)
		expect(cta).toMatch(/gap:\s*5px/)
		expect(cta).toMatch(/align-items:\s*center/)
	})

	it("icon-button:disabled is clearly off (muted color + no hover)", () => {
		const disabled = ruleBody(css, "button.icon-button:disabled")
		expect(disabled).toMatch(/color:\s*var\(--surface-border\)/)
		expect(disabled).toMatch(/background:\s*transparent/)
		expect(disabled).toMatch(/box-shadow:\s*none/)
		expect(disabled).toMatch(/opacity:\s*0.55/)
	})

	// -----------------------------------------------------------------------
	// Document view toolbar: icon-only Open in Editor + segmented control.
	// -----------------------------------------------------------------------

	it("renders Open in Editor as an icon-only button with go-to-file codicon", () => {
		const match = /<button id="btnOpenEditor"([^>]*)>([\s\S]*?)<\/button>/.exec(html)
		expect(match).toBeTruthy()
		expect(match![1]).toContain('class="icon-button"')
		expect(match![1]).toContain('aria-label="Open in Editor"')
		expect(match![1]).toContain("disabled")
		expect(match![2]).toContain("<svg")
		expect(match![2]).toContain("M6 5.914l2.06") // go-to-file path signature
	})

	it("renders Edit/Split/Preview as a segmented control with codicons + labels", () => {
		const editMatch = /<button id="btnViewEdit"([^>]*)>([\s\S]*?)<\/button>/.exec(html)
		expect(editMatch).toBeTruthy()
		expect(editMatch![2]).toContain("<svg")
		expect(editMatch![2]).toContain("13.23 1h-1.46") // edit path signature
		expect(editMatch![2]).toMatch(/Edit/)

		const splitMatch = /<button id="btnViewSplit"([^>]*)>([\s\S]*?)<\/button>/.exec(html)
		expect(splitMatch).toBeTruthy()
		expect(splitMatch![1]).toContain('class="active"')
		expect(splitMatch![2]).toContain("<svg")
		expect(splitMatch![2]).toContain("M14 1H3L2 2v11") // split-horizontal path signature
		expect(splitMatch![2]).toMatch(/Split/)

		const previewMatch = /<button id="btnViewPreview"([^>]*)>([\s\S]*?)<\/button>/.exec(html)
		expect(previewMatch).toBeTruthy()
		expect(previewMatch![2]).toContain("<svg")
		expect(previewMatch![2]).toContain("3 1h11l1 1v5.3") // open-preview path signature
		expect(previewMatch![2]).toMatch(/Preview/)
	})

	it("segmented control has one shared container border, flush segments", () => {
		const container = ruleBody(css, ".view-toggle")
		expect(container).toMatch(/border:\s*1px solid var\(--border\)/)
		expect(container).toMatch(/border-radius:\s*4px/)
		expect(container).toMatch(/overflow:\s*hidden/)

		const segment = ruleBody(css, ".view-toggle button")
		expect(segment).toMatch(/border:\s*none/)
		expect(segment).toMatch(/border-right:\s*1px solid var\(--border\)/)
		expect(segment).toMatch(/border-radius:\s*0/)
		expect(segment).toMatch(/background:\s*transparent/)
	})

	it("segmented control active segment uses accent, inactive transparent", () => {
		const active = ruleBody(css, ".view-toggle button.active")
		expect(active).toMatch(/background:\s*var\(--accent\)/)
		expect(active).toMatch(/color:\s*var\(--accent-fg\)/)
	})

	it("segmented control has proper ARIA toggle-group semantics", () => {
		// Container has role=group + aria-label for screen reader grouping.
		const toggleMatch = /<div class="view-toggle"[^>]*>/.exec(html)
		expect(toggleMatch).toBeTruthy()
		expect(toggleMatch![0]).toContain('role="group"')
		expect(toggleMatch![0]).toContain('aria-label="Document view mode"')

		// Each segment has aria-pressed reflecting its toggle state.
		const editMatch = /<button id="btnViewEdit"([^>]*)>/.exec(html)
		expect(editMatch![1]).toContain('aria-pressed="false"')

		const splitMatch = /<button id="btnViewSplit"([^>]*)>/.exec(html)
		expect(splitMatch![1]).toContain('aria-pressed="true"') // active by default

		const previewMatch = /<button id="btnViewPreview"([^>]*)>/.exec(html)
		expect(previewMatch![1]).toContain('aria-pressed="false"')
	})

	it("segmented control last segment has no right border divider", () => {
		const last = ruleBody(css, ".view-toggle button:last-child")
		expect(last).toMatch(/border-right:\s*none/)
	})

	// -----------------------------------------------------------------------
	// Tab sizing fix: tight-fit content, visible gap between tabs.
	// -----------------------------------------------------------------------

	it("tabs container has a visible gap between tabs (8px)", () => {
		const tabsContainer = ruleBody(css, ".tabs")
		expect(tabsContainer).toMatch(/gap:\s*8px/)
	})

	it("tab background is tight-fit (no oversized horizontal padding)", () => {
		const tab = ruleBody(css, ".tab")
		// Right padding reduced from 12px to 10px, left from 12px to 6px —
		// comfortable but not oversized.
		expect(tab).toMatch(/padding:\s*3px 10px 3px 6px/)
		expect(tab).toMatch(/width:\s*auto/)
	})
})
