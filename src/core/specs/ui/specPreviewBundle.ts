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

/**
 * Performance fix: SVG render cache, keyed by the exact mermaid source text.
 * Switching specs/tabs re-invokes renderMermaidSlots on every load, and a
 * doc's diagram source is usually unchanged between visits — re-parsing and
 * re-rendering every diagram from scratch on every switch was the actual
 * cost driver (not the DOM/storage read path, which is cheap in comparison).
 * Caching the rendered SVG by source text means an unchanged diagram is
 * reused instantly instead of round-tripping through mermaid.render() again.
 * Unbounded by design within a session — diagram counts per spec are small
 * (tens, not thousands) so memory growth is negligible relative to the
 * webview's other retained state.
 */
const mermaidRenderCache = new Map<string, string>()

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
 * Render a single mermaid slot: cache hit is a synchronous innerHTML swap;
 * cache miss renders via mermaid.render() and populates the cache. Errors
 * are cached by their formatted error message so a re-visit of a broken
 * diagram doesn't re-run mermaid.render()/parse() again either — the error
 * output is deterministic for unchanged source.
 */
async function renderOneSlot(mermaid: MermaidAPI, slot: HTMLElement, code: string, counter: number): Promise<void> {
	const cached = mermaidRenderCache.get(code)
	if (cached !== undefined) {
		slot.innerHTML = cached
		return
	}

	try {
		// Issue 3 fix: render FIRST, parse only for a better error message
		// if render fails. Some valid Mermaid syntax passes render but fails
		// parse (depending on Mermaid version) — calling parse first would
		// falsely flag a successful render as an error.
		const id = `mermaid-svg-${Date.now()}-${counter}`
		const { svg } = await mermaid.render(id, code)
		const sanitized = sanitizePreviewHtml(svg)
		slot.innerHTML = sanitized
		mermaidRenderCache.set(code, sanitized)
	} catch (renderErr) {
		// Render failed — try parse for a more specific error message.
		let message = renderErr instanceof Error ? renderErr.message : String(renderErr)
		try {
			await mermaid.parse(code)
			// Parse succeeded but render failed — use the render error
			// message as-is (it may contain more context than parse).
		} catch (parseErr) {
			// Parse also failed — use the parse error (usually more specific).
			message = parseErr instanceof Error ? parseErr.message : String(parseErr)
		}
		const errorHtml = buildMermaidErrorHtml(message, code)
		slot.innerHTML = errorHtml
		mermaidRenderCache.set(code, errorHtml)
	}
}

/**
 * IntersectionObserver shared across all renderMermaidSlots calls so a
 * single observer instance persists for the life of the webview instead of
 * being created/torn down on every switch.
 */
let mermaidLazyObserver: IntersectionObserver | null = null
let mermaidLazyMermaid: MermaidAPI | null = null
let mermaidLazyCounter = 0

function getMermaidLazyObserver(): IntersectionObserver | null {
	if (typeof IntersectionObserver === "undefined") return null
	if (mermaidLazyObserver) return mermaidLazyObserver
	mermaidLazyObserver = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (!entry.isIntersecting) continue
				const slot = entry.target as HTMLElement
				mermaidLazyObserver?.unobserve(slot)
				if (slot.querySelector("svg") || slot.querySelector(".mermaid-error")) continue
				const encoded = slot.getAttribute("data-mermaid") || ""
				const code = decodeURIComponent(encoded)
				if (mermaidLazyMermaid) {
					void renderOneSlot(mermaidLazyMermaid, slot, code, mermaidLazyCounter++)
				}
			}
		},
		// Root margin extends the trigger zone one viewport ahead/behind so
		// diagrams are ready by the time the user scrolls to them, rather than
		// popping in only once fully visible.
		{ rootMargin: "100% 0px 100% 0px", threshold: 0 },
	)
	return mermaidLazyObserver
}

/**
 * Render `.mermaid-slot` elements inside `container` into SVG diagrams.
 *
 * Performance strategy (spec-switch latency fix):
 * - Cache hits (unchanged diagram source) render synchronously via
 *   innerHTML — no mermaid.render() call at all.
 * - Cache misses that are currently in/near the viewport render immediately
 *   so the visible content appears without waiting on off-screen diagrams.
 * - Cache misses that are off-screen are deferred to an IntersectionObserver
 *   and rendered only when scrolled into view (or near it), so a doc with
 *   many diagrams doesn't block the switch on diagrams the user hasn't
 *   scrolled to yet.
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

	const observer = getMermaidLazyObserver()
	mermaidLazyMermaid = mermaid

	const immediate: Array<{ slot: HTMLElement; code: string }> = []
	const deferred: HTMLElement[] = []

	for (const slot of slots) {
		// Skip slots that are already rendered (have a child svg or error box).
		if (slot.querySelector("svg") || slot.querySelector(".mermaid-error")) continue

		const encoded = slot.getAttribute("data-mermaid") || ""
		const code = decodeURIComponent(encoded)

		// Cache hits always render immediately — it's a synchronous innerHTML
		// swap with no mermaid.render() cost, so there's no benefit to
		// deferring it, and doing so would make previously-viewed diagrams
		// flicker in on scroll instead of appearing instantly.
		if (mermaidRenderCache.has(code)) {
			immediate.push({ slot, code })
			continue
		}

		if (!observer) {
			// No IntersectionObserver support (unexpected in a VS Code webview,
			// but guarded defensively) — fall back to rendering everything
			// immediately rather than silently never rendering off-screen slots.
			immediate.push({ slot, code })
			continue
		}

		deferred.push(slot)
	}

	let counter = 0
	for (const { slot, code } of immediate) {
		await renderOneSlot(mermaid, slot, code, counter++)
		// Yield to the event loop between cache-miss renders so the browser
		// can paint text content and previously-rendered diagrams while
		// subsequent diagrams are still being processed. Without this yield,
		// a doc with 10+ uncached diagrams blocks the UI thread for the full
		// duration of all renders, making the spec switch feel frozen.
		// The yield is zero-delay (setTimeout 0) so it doesn't add latency —
		// it just lets the event loop drain the render queue + paint between
		// iterations.
		if (counter < immediate.length) {
			await new Promise<void>((resolve) => setTimeout(resolve, 0))
		}
	}

	mermaidLazyCounter = counter
	if (observer) {
		for (const slot of deferred) {
			observer.observe(slot)
		}
	}
}

/** Build the error-box HTML for a slot. Pure function so it's cacheable. */
function buildMermaidErrorHtml(message: string, code: string): string {
	return `<div class="mermaid-error">
		<div class="mermaid-error-msg">⚠ Diagram error: ${escapeHtmlText(message)}</div>
		<pre><code>${escapeHtmlText(code)}</code></pre>
	</div>`
}

function renderMermaidErrorFallback(slot: HTMLElement, message: string, code?: string): void {
	const raw = code ?? decodeURIComponent(slot.getAttribute("data-mermaid") || "")
	slot.innerHTML = buildMermaidErrorHtml(message, raw)
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
