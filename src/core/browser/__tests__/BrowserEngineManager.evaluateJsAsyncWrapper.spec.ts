/**
 * Regression test for Issue 1: browser evaluate_js crashes on
 * `await` inside model-supplied snippet.
 *
 * Live-session evidence in user.txt: browser tool calls failed with
 *  `page.evaluate: SyntaxError: await is only valid in async functions and
 *   the top level bodies of modules`
 *
 * Root cause: BrowserEngineManager.evaluateJs() wrapped the model's script
 * in a SYNC IIFE — `(function() { ... })()` (or `"function"` prefix check).
 * Any model code containing `await` (very common for `await fetch`,
 * `await new Promise(r => ...)` etc.) became a SyntaxError inside the
 * sync function body.
 *
 * Fix: wrap in an ASYNC IIFE instead — `(async () => { ... })()` — so
 * `await` is legal. Playwright then resolves the returned Promise and the
 * tool returns the value as normal.
 */
import { describe, it, expect, vi } from "vitest"
import { BrowserEngineManager } from "../BrowserEngineManager"

describe("BrowserEngineManager.evaluateJs wraps model script in an ASYNC IIFE", () => {
	function makeEngineWithMockPage(pages: Map<string, { evaluate: ReturnType<typeof vi.fn> }>) {
		BrowserEngineManager.getInstance()
		const engine = BrowserEngineManager.getInstance()
		;(engine as any).taskContexts.set("taskX", {
			browser: {},
			context: {},
			pages,
			nextPageId: 2,
		})
		return engine
	}

	it("does NOT produce a sync-function wrapper (which would reject `await` snippets)", async () => {
		const page = {
			evaluate: vi.fn().mockImplementation((scriptString: string) => {
				// Simulate V8 behavior: sync function body containing top-level
				// await would throw SyntaxError at parse time (Playwright converts
				// to a "page.evaluate: SyntaxError: await is only valid in..." message).
				// The fixed wrapper must be an ASYNC arrow so that `await` inside it
				// is a valid syntactic form, and we verify the wrapper begins with
				// `(async function` / `(async () =>`.
				const wrapped = scriptString.trim()
				expect(wrapped.startsWith("(async")).toBe(true)
				// return a resolved value so the tool call appears to succeed
				return Promise.resolve(42)
			}),
		}
		makeEngineWithMockPage(new Map([["p1", page as any]]))
		const engine = BrowserEngineManager.getInstance()
		const res = await engine.evaluateJs("taskX", "p1", "await fetch('https://x')")
		expect(res).toBe(42)
	})

	it("respects an already-wrapped IIFE (no double wrap)", async () => {
		const page = {
			evaluate: vi.fn().mockImplementation((scriptString: string) => {
				expect(scriptString.trim().startsWith("(async")).toBe(true)
				expect(scriptString.trim()).toContain("callAsync")
				return Promise.resolve("ok")
			}),
		}
		makeEngineWithMockPage(new Map([["p1", page as any]]))
		const engine = BrowserEngineManager.getInstance()
		const res = await engine.evaluateJs("taskX", "p1", "(async function() { return callAsync(); })()")
		expect(res).toBe("ok")
	})

	it("passes through a plain expression wrapped in async arrow", async () => {
		const page = {
			evaluate: vi.fn().mockImplementation((scriptString: string) => {
				expect(scriptString).toBe("(async () => { return 1 + 1; })()")
				return Promise.resolve(2)
			}),
		}
		makeEngineWithMockPage(new Map([["p1", page as any]]))
		const engine = BrowserEngineManager.getInstance()
		const res = await engine.evaluateJs("taskX", "p1", "return 1 + 1;")
		expect(res).toBe(2)
	})
})
