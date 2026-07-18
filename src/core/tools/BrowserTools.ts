/**
 * BrowserTools — Unified dispatcher for all browser operations.
 * Each method maps to a Zoo-Code native tool and delegates to BrowserEngineManager.
 */

import { Task } from "../task/Task"
import type { ToolUse } from "../../shared/tools"
import { BaseTool, type ToolCallbacks } from "./BaseTool"
import { BrowserEngineManager } from "../browser/BrowserEngineManager"

// ============================================================
// open_browser_page
// ============================================================
export class OpenBrowserPageTool extends BaseTool<"open_browser_page"> {
	readonly name = "open_browser_page" as const

	async execute(params: { url: string }, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { url } = params
		const { askApproval, handleError, pushToolResult } = callbacks

		try {
			if (!url) {
				task.consecutiveMistakeCount++
				task.recordToolError("open_browser_page")
				task.didToolFailInCurrentTurn = true
				pushToolResult(await task.sayAndCreateMissingParamError("open_browser_page" as any, "url" as any))
				return
			}

			task.consecutiveMistakeCount = 0

			const didApprove = await askApproval("tool", JSON.stringify({ tool: "openTabs", content: url }))
			if (!didApprove) return

			const engine = BrowserEngineManager.getInstance()
			const { pageId, summary } = await engine.openPage(task.taskId, url)

			pushToolResult(`Page ID: ${pageId}\nURL: ${url}\n\n--- Page Content ---\n${summary}`)
		} catch (error) {
			await handleError("opening browser page", error as Error)
		}
	}
}

// ============================================================
// read_browser_page
// ============================================================
export class ReadBrowserPageTool extends BaseTool<"read_browser_page"> {
	readonly name = "read_browser_page" as const

	async execute(params: { pageId: string }, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { pageId } = params
		const { handleError, pushToolResult } = callbacks

		try {
			if (!pageId) {
				task.consecutiveMistakeCount++
				task.recordToolError("read_browser_page")
				task.didToolFailInCurrentTurn = true
				pushToolResult(await task.sayAndCreateMissingParamError("read_browser_page" as any, "pageId" as any))
				return
			}

			task.consecutiveMistakeCount = 0
			const engine = BrowserEngineManager.getInstance()
			const summary = await engine.getSummary(task.taskId, pageId)
			pushToolResult(summary)
		} catch (error) {
			await handleError("reading browser page", error as Error)
		}
	}
}

// ============================================================
// navigate_browser_page
// ============================================================
export class NavigateBrowserPageTool extends BaseTool<"navigate_browser_page"> {
	readonly name = "navigate_browser_page" as const

	async execute(params: { pageId: string; url: string }, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { pageId, url } = params
		const { handleError, pushToolResult } = callbacks

		try {
			if (!pageId || !url) {
				task.consecutiveMistakeCount++
				task.recordToolError("navigate_browser_page")
				task.didToolFailInCurrentTurn = true
				const missing = !pageId ? "pageId" : "url"
				pushToolResult(await task.sayAndCreateMissingParamError("navigate_browser_page" as any, missing as any))
				return
			}

			task.consecutiveMistakeCount = 0
			const engine = BrowserEngineManager.getInstance()
			const { summary } = await engine.navigatePage(task.taskId, pageId, url)
			pushToolResult(`Navigated to ${url}\n\n--- Page Content ---\n${summary}`)
		} catch (error) {
			await handleError("navigating browser page", error as Error)
		}
	}
}

// ============================================================
// extract_browser_urls
// ============================================================
export class ExtractBrowserUrlsTool extends BaseTool<"extract_browser_urls"> {
	readonly name = "extract_browser_urls" as const

	async execute(
		params: { pageId: string; sameOriginOnly?: boolean | null; limit?: number | null },
		task: Task,
		callbacks: ToolCallbacks,
	): Promise<void> {
		const { pageId, sameOriginOnly, limit } = params
		const { handleError, pushToolResult } = callbacks

		try {
			if (!pageId) {
				task.consecutiveMistakeCount++
				task.recordToolError("extract_browser_urls")
				task.didToolFailInCurrentTurn = true
				pushToolResult(await task.sayAndCreateMissingParamError("extract_browser_urls" as any, "pageId" as any))
				return
			}

			task.consecutiveMistakeCount = 0
			const engine = BrowserEngineManager.getInstance()
			const urls = await engine.extractUrls(task.taskId, pageId, {
				sameOriginOnly: sameOriginOnly ?? undefined,
				limit: limit ?? undefined,
			})

			if (urls.length === 0) {
				pushToolResult("No URLs found on this page.")
				return
			}

			const formatted = [
				`URLs found: ${urls.length}\n`,
				...urls.map((u, i) => `${i + 1}. ${u.text}\n   ${u.url}`),
			].join("\n")
			pushToolResult(formatted)
		} catch (error) {
			await handleError("extracting browser URLs", error as Error)
		}
	}
}

// ============================================================
// extract_browser_data
// ============================================================
export class ExtractBrowserDataTool extends BaseTool<"extract_browser_data"> {
	readonly name = "extract_browser_data" as const

	async execute(
		params: { pageId: string; selector?: string | null; extractType?: string | null; maxRows?: number | null },
		task: Task,
		callbacks: ToolCallbacks,
	): Promise<void> {
		const { pageId, selector, extractType, maxRows } = params
		const { handleError, pushToolResult } = callbacks

		try {
			if (!pageId) {
				task.consecutiveMistakeCount++
				task.recordToolError("extract_browser_data")
				task.didToolFailInCurrentTurn = true
				pushToolResult(await task.sayAndCreateMissingParamError("extract_browser_data" as any, "pageId" as any))
				return
			}

			task.consecutiveMistakeCount = 0
			const engine = BrowserEngineManager.getInstance()
			const result = await engine.extractData(task.taskId, pageId, {
				selector: selector ?? undefined,
				extractType: (extractType as any) ?? undefined,
				maxRows: maxRows ?? undefined,
			})

			pushToolResult(JSON.stringify(result, null, 2))
		} catch (error) {
			await handleError("extracting browser data", error as Error)
		}
	}
}

// ============================================================
// list_browser_tabs
// ============================================================
export class ListBrowserTabsTool extends BaseTool<"list_browser_tabs"> {
	readonly name = "list_browser_tabs" as const

	async execute(_params: Record<string, never>, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { pushToolResult } = callbacks
		const engine = BrowserEngineManager.getInstance()
		const tabs = engine.listPages(task.taskId)

		if (tabs.length === 0) {
			pushToolResult("No browser tabs open. Use open_browser_page to open a URL.")
			return
		}

		const formatted = [
			`Open tabs: ${tabs.length}\n`,
			...tabs.map((t, i) => `${i + 1}. [${t.pageId}] ${t.url}`),
		].join("\n")
		pushToolResult(formatted)
	}
}

// ============================================================
// click_browser_element
// ============================================================
export class ClickBrowserElementTool extends BaseTool<"click_browser_element"> {
	readonly name = "click_browser_element" as const

	async execute(params: { pageId: string; selector: string }, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { pageId, selector } = params
		const { handleError, pushToolResult } = callbacks

		try {
			if (!pageId || !selector) {
				task.consecutiveMistakeCount++
				task.recordToolError("click_browser_element")
				task.didToolFailInCurrentTurn = true
				const missing = !pageId ? "pageId" : "selector"
				pushToolResult(await task.sayAndCreateMissingParamError("click_browser_element" as any, missing as any))
				return
			}

			task.consecutiveMistakeCount = 0
			const engine = BrowserEngineManager.getInstance()
			const { summary } = await engine.clickElement(task.taskId, pageId, selector)
			pushToolResult(`Clicked: ${selector}\n\n--- Page Content After Click ---\n${summary}`)
		} catch (error) {
			await handleError("clicking browser element", error as Error)
		}
	}
}

// ============================================================
// type_browser_text
// ============================================================
export class TypeBrowserTextTool extends BaseTool<"type_browser_text"> {
	readonly name = "type_browser_text" as const

	async execute(
		params: { pageId: string; selector: string; text: string },
		task: Task,
		callbacks: ToolCallbacks,
	): Promise<void> {
		const { pageId, selector, text } = params
		const { handleError, pushToolResult } = callbacks

		try {
			if (!pageId || !selector || text === undefined) {
				task.consecutiveMistakeCount++
				task.recordToolError("type_browser_text")
				task.didToolFailInCurrentTurn = true
				const missing = !pageId ? "pageId" : !selector ? "selector" : "text"
				pushToolResult(await task.sayAndCreateMissingParamError("type_browser_text" as any, missing as any))
				return
			}

			task.consecutiveMistakeCount = 0
			const engine = BrowserEngineManager.getInstance()
			await engine.typeText(task.taskId, pageId, selector, text)
			pushToolResult(`Typed text into: ${selector}`)
		} catch (error) {
			await handleError("typing text in browser", error as Error)
		}
	}
}

// Export singleton instances
export const openBrowserPageTool = new OpenBrowserPageTool()
export const readBrowserPageTool = new ReadBrowserPageTool()
export const navigateBrowserPageTool = new NavigateBrowserPageTool()
export const extractBrowserUrlsTool = new ExtractBrowserUrlsTool()
export const extractBrowserDataTool = new ExtractBrowserDataTool()
export const listBrowserTabsTool = new ListBrowserTabsTool()
export const clickBrowserElementTool = new ClickBrowserElementTool()
export const typeBrowserTextTool = new TypeBrowserTextTool()
// ============================================================
// click_browser_by_text
// ============================================================
export class ClickBrowserByTextTool extends BaseTool<"click_browser_by_text"> {
	readonly name = "click_browser_by_text" as const

	async execute(params: { pageId: string; text: string }, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { pageId, text } = params
		const { handleError, pushToolResult } = callbacks

		try {
			if (!pageId || !text) {
				task.consecutiveMistakeCount++
				task.recordToolError("click_browser_by_text")
				task.didToolFailInCurrentTurn = true
				const missing = !pageId ? "pageId" : "text"
				pushToolResult(await task.sayAndCreateMissingParamError("click_browser_by_text" as any, missing as any))
				return
			}

			task.consecutiveMistakeCount = 0
			const engine = BrowserEngineManager.getInstance()
			const { summary } = await engine.clickElementByText(task.taskId, pageId, text)
			pushToolResult(`Clicked element with text: "${text}"\n\n--- Page Content After Click ---\n${summary}`)
		} catch (error) {
			await handleError("clicking element by text", error as Error)
		}
	}
}

// ============================================================
// evaluate_browser_js
// ============================================================
export class EvaluateBrowserJsTool extends BaseTool<"evaluate_browser_js"> {
	readonly name = "evaluate_browser_js" as const

	async execute(params: { pageId: string; script: string }, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { pageId, script } = params
		const { handleError, pushToolResult } = callbacks

		try {
			if (!pageId || !script) {
				task.consecutiveMistakeCount++
				task.recordToolError("evaluate_browser_js")
				task.didToolFailInCurrentTurn = true
				const missing = !pageId ? "pageId" : "script"
				pushToolResult(await task.sayAndCreateMissingParamError("evaluate_browser_js" as any, missing as any))
				return
			}

			task.consecutiveMistakeCount = 0
			const engine = BrowserEngineManager.getInstance()
			const result = await engine.evaluateJs(task.taskId, pageId, script)
			pushToolResult(`JS Result: ${JSON.stringify(result, null, 2)}`)
		} catch (error) {
			await handleError("evaluating JavaScript", error as Error)
		}
	}
}

// ============================================================
// read_all_browser_tabs
// ============================================================
export class ReadAllBrowserTabsTool extends BaseTool<"read_all_browser_tabs"> {
	readonly name = "read_all_browser_tabs" as const

	async execute(_params: Record<string, never>, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { handleError, pushToolResult } = callbacks

		try {
			const engine = BrowserEngineManager.getInstance()
			const tabs = await engine.readAllTabs(task.taskId)

			if (tabs.length === 0) {
				pushToolResult("No browser tabs open. Use open_browser_page to open a URL.")
				return
			}

			const formatted = tabs
				.map((t, i) => `=== Tab ${i + 1}: [${t.pageId}] ${t.url} ===\n${t.summary}`)
				.join("\n\n")
			pushToolResult(formatted)
		} catch (error) {
			await handleError("reading all browser tabs", error as Error)
		}
	}
}

// ============================================================
// batch_browser_actions
// ============================================================
export class BatchBrowserActionsTool extends BaseTool<"batch_browser_actions"> {
	readonly name = "batch_browser_actions" as const

	async execute(
		params: {
			pageId: string
			actions: Array<{ type: string; selector?: string; text?: string; url?: string; script?: string }>
		},
		task: Task,
		callbacks: ToolCallbacks,
	): Promise<void> {
		const { pageId, actions } = params
		const { handleError, pushToolResult } = callbacks

		try {
			if (!pageId || !Array.isArray(actions) || actions.length === 0) {
				task.consecutiveMistakeCount++
				task.recordToolError("batch_browser_actions")
				task.didToolFailInCurrentTurn = true
				pushToolResult(
					await task.sayAndCreateMissingParamError("batch_browser_actions" as any, "actions" as any),
				)
				return
			}

			task.consecutiveMistakeCount = 0
			const engine = BrowserEngineManager.getInstance()
			const results = await engine.batchExecute(task.taskId, pageId, actions)

			const formatted = results.map((r, i) => `${i + 1}. ${r.action}: ${r.result}`).join("\n")
			pushToolResult(`Batch executed ${results.length} actions:\n${formatted}`)
		} catch (error) {
			await handleError("executing batch browser actions", error as Error)
		}
	}
}

export const clickBrowserByTextTool = new ClickBrowserByTextTool()
export const evaluateBrowserJsTool = new EvaluateBrowserJsTool()
export const readAllBrowserTabsTool = new ReadAllBrowserTabsTool()
export const batchBrowserActionsTool = new BatchBrowserActionsTool()
