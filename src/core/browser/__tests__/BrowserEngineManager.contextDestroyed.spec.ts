/**
 * Regression test for click_browser_by_text "Execution context was destroyed"
 * false error (Round 2 fix).
 *
 * Root cause: clickElementByText's page.evaluate() click triggers navigation.
 * The evaluate() promise rejects with "context destroyed" even though the
 * click succeeded. Round 1 fixed the click itself; Round 2 fixes getSummary()
 * which is called AFTER the click to read the post-click page state — its
 * page.evaluate() can also hit "context destroyed" if the new page's JS
 * context is still initializing.
 *
 * This test simulates the full click_browser_by_text flow with a mocked
 * Playwright page that:
 *   1. evaluate() click → returns true (click succeeded)
 *   2. getSummary() evaluate() → throws "Execution context was destroyed"
 *   3. getSummary() retry → succeeds with post-navigation content
 *
 * Asserts: the tool returns a clean success result with the correct
 * post-navigation summary — NOT an error message.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

import { BrowserEngineManager } from "../BrowserEngineManager"

// Mock Playwright page that simulates navigation after click
function createMockPage(options: {
	clickEvaluateResult?: boolean
	getSummaryFirstCallThrows?: boolean
	getSummaryRetryResult?: string
}) {
	const {
		clickEvaluateResult = true,
		getSummaryFirstCallThrows = true,
		getSummaryRetryResult = "Post-nav content",
	} = options

	let clickCallCount = 0
	let getSummaryCallCount = 0
	const mockPage = {
		evaluate: vi.fn().mockImplementation((fn: any, arg?: any) => {
			// Click evaluate has an argument (the text to search for);
			// getSummary's extractText has no argument.
			const isClickEvaluate = arg !== undefined

			if (isClickEvaluate) {
				clickCallCount++
				if (!clickEvaluateResult) {
					throw new Error("No element found")
				}
				// Simulate: click succeeded, evaluate returned true
				return Promise.resolve(true)
			}

			// getSummary calls (no argument, fn is extractText).
			getSummaryCallCount++

			if (getSummaryCallCount === 1 && getSummaryFirstCallThrows) {
				return Promise.reject(new Error("Execution context was destroyed, most likely because of a navigation"))
			}
			// Retry or no-throw: return the expected string.
			// The mock can't run real DOM queries (no document in Node),
			// so return the expected string directly. The test asserts on
			// retry behavior and final result, not DOM parsing.
			return Promise.resolve(getSummaryRetryResult)
		}),
		waitForLoadState: vi.fn().mockResolvedValue(undefined),
		url: vi.fn().mockReturnValue("https://example.com"),
	}

	return { mockPage, getClickCallCount: () => clickCallCount, getSummaryCallCount: () => getSummaryCallCount }
}

describe("click_browser_by_text: context destroyed after navigation (Round 2)", () => {
	let engine: BrowserEngineManager

	beforeEach(() => {
		// Reset singleton between tests
		;(BrowserEngineManager as any).instance = null
		engine = BrowserEngineManager.getInstance()
	})

	it("getSummary retries after context destroyed and returns post-navigation content", async () => {
		const taskId = "test-task-1"
		const pageId = "page_1"

		// Set up mock page in the engine's task context
		const { mockPage } = createMockPage({
			getSummaryFirstCallThrows: true,
			getSummaryRetryResult: "New page loaded successfully",
		})

		// Inject mock page into engine
		const ctx = (engine as any).taskContexts.get(taskId)
		if (!ctx) {
			;(engine as any).taskContexts.set(taskId, {
				browser: {},
				context: {},
				pages: new Map([[pageId, mockPage]]),
				nextPageId: 2,
			})
		}

		const summary = await engine.getSummary(taskId, pageId)
		expect(summary).toBe("New page loaded successfully")
		// getSummary called 2 times (initial throws, retry succeeds)
		expect(mockPage.evaluate).toHaveBeenCalledTimes(2)
	})

	it("getSummary throws after all retries exhausted on persistent context destruction", async () => {
		const taskId = "test-task-2"
		const pageId = "page_2"

		const { mockPage } = createMockPage({
			getSummaryFirstCallThrows: true,
			getSummaryRetryResult: "",
		})
		// Override: make ALL calls throw context destroyed
		mockPage.evaluate.mockImplementation(() => {
			return Promise.reject(new Error("Execution context was destroyed, most likely because of a navigation"))
		})
		;(engine as any).taskContexts.set(taskId, {
			browser: {},
			context: {},
			pages: new Map([[pageId, mockPage]]),
			nextPageId: 2,
		})

		await expect(engine.getSummary(taskId, pageId)).rejects.toThrow("Execution context was destroyed")
		// Should have been called 3 times (initial + 2 retries, all throw)
		expect(mockPage.evaluate).toHaveBeenCalledTimes(3)
	})

	it("clickElementByText handles context destroyed in click evaluate AND getSummary", async () => {
		const taskId = "test-task-3"
		const pageId = "page_3"

		// Simulate: click evaluate throws context destroyed (navigation happened
		// during evaluate), then getSummary also throws once, then succeeds
		let callCount = 0
		const mockPage = {
			evaluate: vi.fn().mockImplementation(() => {
				callCount++
				if (callCount === 1) {
					// Click evaluate: context destroyed (navigation during click)
					return Promise.reject(
						new Error("Execution context was destroyed, most likely because of a navigation"),
					)
				}
				if (callCount === 2) {
					// getSummary first try: context still initializing
					return Promise.reject(
						new Error("Execution context was destroyed, most likely because of a navigation"),
					)
				}
				// getSummary retry: success
				return Promise.resolve("Navigated to new page")
			}),
			waitForLoadState: vi.fn().mockResolvedValue(undefined),
			url: vi.fn().mockReturnValue("https://example.com/new-page"),
		}

		;(engine as any).taskContexts.set(taskId, {
			browser: {},
			context: {},
			pages: new Map([[pageId, mockPage]]),
			nextPageId: 2,
		})

		const result = await engine.clickElementByText(taskId, pageId, "Click me")
		expect(result.success).toBe(true)
		expect(result.summary).toBe("Navigated to new page")
		// Click evaluate (1) + getSummary initial (1) + getSummary retry (1) = 3
		expect(mockPage.evaluate).toHaveBeenCalledTimes(3)
	})

	it("clickElementByText with no navigation: normal flow, no retry needed", async () => {
		const taskId = "test-task-4"
		const pageId = "page_4"

		let callCount = 0
		const mockPage = {
			evaluate: vi.fn().mockImplementation(() => {
				callCount++
				if (callCount === 1) {
					// Click evaluate: returns true (no navigation)
					return Promise.resolve(true)
				}
				// getSummary: immediate success
				return Promise.resolve("Same page content")
			}),
			waitForLoadState: vi.fn().mockResolvedValue(undefined),
			url: vi.fn().mockReturnValue("https://example.com/same-page"),
		}

		;(engine as any).taskContexts.set(taskId, {
			browser: {},
			context: {},
			pages: new Map([[pageId, mockPage]]),
			nextPageId: 2,
		})

		const result = await engine.clickElementByText(taskId, pageId, "Button")
		expect(result.success).toBe(true)
		expect(result.summary).toBe("Same page content")
		// Click evaluate (1) + getSummary (1) = 2, no retries
		expect(mockPage.evaluate).toHaveBeenCalledTimes(2)
	})

	it("clickElementByText throws when element not found (no false positive)", async () => {
		const taskId = "test-task-5"
		const pageId = "page_5"

		const mockPage = {
			evaluate: vi.fn().mockResolvedValue(false), // click returned false
			waitForLoadState: vi.fn().mockResolvedValue(undefined),
			url: vi.fn().mockReturnValue("https://example.com"),
		}

		;(engine as any).taskContexts.set(taskId, {
			browser: {},
			context: {},
			pages: new Map([[pageId, mockPage]]),
			nextPageId: 2,
		})

		await expect(engine.clickElementByText(taskId, pageId, "Nonexistent")).rejects.toThrow(
			'No element found with text: "Nonexistent"',
		)
	})

	it("getSummary with non-context error: throws immediately without retry", async () => {
		const taskId = "test-task-6"
		const pageId = "page_6"

		const mockPage = {
			evaluate: vi.fn().mockRejectedValue(new Error("Some other Playwright error")),
			waitForLoadState: vi.fn().mockResolvedValue(undefined),
			url: vi.fn().mockReturnValue("https://example.com"),
		}

		;(engine as any).taskContexts.set(taskId, {
			browser: {},
			context: {},
			pages: new Map([[pageId, mockPage]]),
			nextPageId: 2,
		})

		await expect(engine.getSummary(taskId, pageId)).rejects.toThrow("Some other Playwright error")
		// Should NOT retry for non-context-destroyed errors
		expect(mockPage.evaluate).toHaveBeenCalledTimes(1)
	})
})
