/**
 * F-008: Spec preview browser bundle entry.
 *
 * This file is the esbuild entry point that produces `dist/spec-preview.js`.
 * It runs in the Spec Workspace webview (browser context) and provides:
 *
 *   window.__specPreview = {
 *     renderMarkdown(md): string,         // pure HTML (no mermaid)
 *     renderMermaidSlots(container): Promise<void>,
 *     isMermaidReady(): boolean,
 *     setTheme(theme): void,
 *   }
 *
 * Mermaid is loaded as a pre-built UMD script tag (`mermaid.min.js`) injected
 * by the webview HTML, which assigns `window.mermaid`. This avoids bundling
 * 3.5 MB of d3/cytoscape through esbuild and keeps build times fast.
 *
 * The markdown renderer is the pure-TS implementation from specPreview.ts
 * (no npm dependency) to preserve the Spec panel's lightweight isolation.
 */

import {
	renderSpecMarkdown,
	sanitizePreviewHtml,
	extractMermaidSlots,
	MERMAID_THEME,
	type MermaidSlot,
} from "./specPreview"

// --- Mermaid bridge -------------------------------------------------------

let mermaidInitialized = false
let pendingMermaid: Promise<void> | null = null

interface MermaidAPI {
	initialize(config: unknown): void
	parse(text: string): Promise<unknown>
	render(id: string, text: string): Promise<{ svg: string }>
}

function getMermaid(): MermaidAPI | null {
	const m = (globalThis as unknown as { mermaid?: MermaidAPI }).mermaid
	return typeof m === "object" && m ? m : null
}

function ensureMermaid(): MermaidAPI | null {
	const m = getMermaid()
	if (!m) return null
	if (!mermaidInitialized) {
		try {
			m.initialize({
				startOnLoad: false,
				securityLevel: "strict",
				theme: "dark",
				suppressErrorRendering: true,
				themeVariables: { ...MERMAID_THEME },
			} as unknown)
			mermaidInitialized = true
		} catch {
			// ignore — will surface per-block error
		}
	}
	return m
}

function isMermaidReady(): boolean {
	return getMermaid() !== null
}

/**
 * Set mermaid theme ("dark" | "default" | "forest" | "neutral").
 * Re-initializes if already initialized.
 */
function setTheme(theme: string): void {
	const m = getMermaid()
	if (!m) return
	try {
		m.initialize({
			startOnLoad: false,
			securityLevel: "strict",
			theme,
			suppressErrorRendering: true,
			themeVariables: { ...MERMAID_THEME },
		} as unknown)
		mermaidInitialized = true
	} catch {
		// ignore
	}
}

/**
 * Wait for mermaid to load (script tag may still be downloading).
 * Resolves immediately if already loaded. Times out after 5s.
 */
function waitForMermaid(): Promise<MermaidAPI | null> {
	const m = getMermaid()
	if (m) return Promise.resolve(m)
	if (pendingMermaid) return pendingMermaid.then(() => getMermaid())

	pendingMermaid = new Promise<void>((resolve) => {
		let elapsed = 0
		const interval = setInterval(() => {
			elapsed += 100
			if (getMermaid() || elapsed >= 5000) {
				clearInterval(interval)
				pendingMermaid = null
				resolve()
			}
		}, 100)
	})

	return pendingMermaid.then(() => getMermaid())
}

// --- Mermaid slot rendering -----------------------------------------------

/**
 * Render all `.mermaid-slot` elements inside `container` into SVG diagrams.
 *
 * During agent streaming this is NOT called (HTML shows the raw mermaid
 * code as a `<pre>` fallback instead). After `agentWriteFinalized` the host
 * calls `window.__specPreview.renderMermaidSlots(document.getElementById('preview'))`.
 *
 * On parse error: the slot is replaced with an inline error box + original code.
 */
async function renderMermaidSlots(container: HTMLElement): Promise<void> {
	if (!container) return

	const slots = Array.from(container.querySelectorAll<HTMLElement>(".mermaid-slot"))
	if (slots.length === 0) return

	const mermaid = await waitForMermaid()
	ensureMermaid()

	if (!mermaid) {
		// Mermaid unavailable — show code fallback for all slots.
		for (const slot of slots) {
			renderMermaidErrorFallback(slot, "Mermaid library not loaded")
		}
		return
	}

	let counter = 0
	for (const slot of slots) {
		const encoded = slot.getAttribute("data-mermaid") || ""
		const code = decodeURIComponent(encoded)

		// Skip slots that are already rendered (have a child svg or error box).
		if (slot.querySelector("svg") || slot.querySelector(".mermaid-error")) continue

		try {
			await mermaid.parse(code) // throws on invalid syntax
			const id = `mermaid-svg-${Date.now()}-${counter++}`
			const { svg } = await mermaid.render(id, code)
			slot.innerHTML = sanitizePreviewHtml(svg)
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err)
			renderMermaidErrorFallback(slot, message, code)
		}
	}
}

function renderMermaidErrorFallback(slot: HTMLElement, message: string, code?: string): void {
	const raw = code ?? decodeURIComponent(slot.getAttribute("data-mermaid") || "")
	const errorHtml = `<div class="mermaid-error">
		<div class="mermaid-error-msg">⚠ Diagram error: ${escapeHtmlText(message)}</div>
		<pre><code>${escapeHtmlText(raw)}</code></pre>
	</div>`
	slot.innerHTML = errorHtml
}

function escapeHtmlText(s: string): string {
	return s.replace(/&/g, "\x26amp;").replace(/</g, "\x26lt;").replace(/>/g, "\x26gt;")
}

// --- Public API -----------------------------------------------------------

export interface SpecPreviewAPI {
	renderMarkdown: (md: string) => string
	renderMermaidSlots: (container: HTMLElement) => Promise<void>
	isMermaidReady: () => boolean
	setTheme: (theme: string) => void
}

const api: SpecPreviewAPI = {
	renderMarkdown: (md: string): string => renderSpecMarkdown(md),
	renderMermaidSlots,
	isMermaidReady,
	setTheme,
}

// Expose on window for the webview inline script to call.
;(globalThis as unknown as { __specPreview?: SpecPreviewAPI }).__specPreview = api

export { renderSpecMarkdown, extractMermaidSlots, MERMAID_THEME }
export type { MermaidSlot }
