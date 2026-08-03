/**
 * Issue C regression: free spec/tab switching during an active agent write.
 *
 * Previously the webview locked the user out of switching specs (selectSpec)
 * and switching Requirements/Design/Tasks tabs (handleTabClick) whenever an
 * agent write was streaming, showing "Wait for agent write to finish". This
 * suite locks the NEW contract:
 *
 *   1. selectSpec / handleTabClick never block on agentStreaming.
 *   2. Stream state is scoped to (streamSpecId, streamDocKind) — not global —
 *      so navigating to a different spec/doc does not cancel or corrupt the
 *      in-flight write.
 *   3. Partials are buffered (bufferedStreamContent) while the user views a
 *      different doc, and flushed on return (enterStreamingView).
 *   4. agentWriteFinalized always commits the write, even when the user is
 *      viewing another doc (background completion path).
 *
 * These are source-contract assertions on the generated inline script, the
 * same approach used by specWorkspaceHtml.interaction.spec.ts (the src test
 * environment is node — no DOM — so we verify the logic structurally).
 */

import { describe, it, expect, beforeAll } from "vitest"

import { buildSpecWorkspaceHtml } from "../specWorkspaceHtml"

/** Extract the main inline <script> body (the last nonce script). */
function extractScript(html: string): string {
	const matches = [...html.matchAll(/<script nonce="[^"]*">([\s\S]*?)<\/script>/g)]
	expect(matches.length, "inline nonce script must exist").toBeGreaterThan(0)
	return matches[matches.length - 1][1]
}

/** Extract the body of a named function declared as `function name(...) { ... }`. */
function functionBody(script: string, name: string): string {
	const start = script.indexOf(`function ${name}(`)
	expect(start, `${name} must be defined`).toBeGreaterThanOrEqual(0)
	// Walk braces from the first `{` after the signature.
	const braceStart = script.indexOf("{", start)
	let depth = 0
	for (let i = braceStart; i < script.length; i++) {
		const ch = script[i]
		if (ch === "{") depth++
		else if (ch === "}") {
			depth--
			if (depth === 0) return script.slice(braceStart + 1, i)
		}
	}
	throw new Error(`could not parse body of ${name}`)
}

describe("Issue C — free spec/tab switching during agent write", () => {
	let script: string

	beforeAll(() => {
		script = extractScript(buildSpecWorkspaceHtml("nonce", "vscode-webview://test"))
	})

	it("selectSpec never blocks on agentStreaming (no 'wait for agent' lock)", () => {
		const body = functionBody(script, "selectSpec")
		expect(body).not.toContain("Wait for agent write to finish")
		expect(body).not.toMatch(/if\s*\(\s*agentStreaming\s*\)\s*\{?\s*return/)
	})

	it("handleTabClick never blocks on agentStreaming", () => {
		const body = functionBody(script, "handleTabClick")
		expect(body).not.toContain("Wait for agent write to finish")
		expect(body).not.toMatch(/if\s*\(\s*agentStreaming\s*\)\s*\{?\s*return/)
	})

	it("scopes stream ownership to (streamSpecId, streamDocKind) via isViewingStreamedDoc", () => {
		const body = functionBody(script, "isViewingStreamedDoc")
		expect(body).toContain("streamSpecId")
		expect(body).toContain("streamDocKind")
		expect(body).toContain("activeSpecId")
		expect(body).toContain("activeKind")
	})

	it("buffers stream content while the user views a different doc", () => {
		const body = functionBody(script, "applyAgentPartial")
		// Maintains the background buffer.
		expect(body).toContain("bufferedStreamContent")
		// Does NOT touch the editor when not viewing the streamed doc.
		expect(body).toMatch(/if\s*\(\s*!isViewingStreamedDoc\(\)\s*\)\s*\{?\s*return/)
		// Does NOT hijack activeSpecId/activeKind from the stream anymore.
		expect(body).not.toContain("activeSpecId = msg.specId")
	})

	it("restores the live streaming view when returning to the streamed doc", () => {
		const body = functionBody(script, "enterStreamingView")
		expect(body).toContain("bufferedStreamContent")
		expect(body).toMatch(/editor\.readOnly\s*=\s*true/)
	})

	it("agentWriteFinalized commits even when the user is on another doc", () => {
		// The finalized handler must have a background-completion branch that
		// does not require the user to be viewing the written doc.
		expect(script).toContain("agentWriteFinalized")
		expect(script).toMatch(/Agent write saved \(background\)/)
		expect(script).toContain("wasViewing")
	})

	it("clears the stream buffer on finalize and abort", () => {
		expect(script).toMatch(/agentWriteFinalized[\s\S]*?bufferedStreamContent\s*=\s*null/)
		expect(script).toMatch(/agentWriteAborted[\s\S]*?bufferedStreamContent\s*=\s*null/)
	})

	it("initializes the stream buffer when a write starts", () => {
		expect(script).toMatch(/agentWriteStarted[\s\S]*?bufferedStreamContent\s*=\s*""/)
	})
})
