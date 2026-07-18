/**
 * BrowserEngineManager — Singleton managing Playwright lifecycle for Zoo-Code.
 *
 * One BrowserContext per task. Pages share cookies/session like a real user.
 * Lazy initialization — browser launches only when first tool is called.
 *
 * Playwright-core is loaded lazily via dynamic require to avoid esbuild bundling issues.
 * The module is expected to be installed as a dependency.
 */

let playwrightModule: any = null

async function getPlaywright() {
	if (!playwrightModule) {
		// Dynamic require to prevent esbuild from trying to bundle playwright-core
		playwrightModule = require("playwright-core")
	}
	return playwrightModule
}

type Browser = any
type BrowserContext = any
type Page = any

interface TaskContext {
	browser: Browser
	context: BrowserContext
	pages: Map<string, Page>
	nextPageId: number
}

export class BrowserEngineManager {
	private static instance: BrowserEngineManager | null = null
	private taskContexts = new Map<string, TaskContext>()

	private constructor() {}

	static getInstance(): BrowserEngineManager {
		if (!BrowserEngineManager.instance) {
			BrowserEngineManager.instance = new BrowserEngineManager()
		}
		return BrowserEngineManager.instance
	}

	/**
	 * Get or create a BrowserContext for a task.
	 * Lazy — launches Playwright only on first call.
	 */
	async getOrCreateContext(taskId: string): Promise<TaskContext> {
		const existing = this.taskContexts.get(taskId)
		if (existing) {
			return existing
		}

		const pw = await getPlaywright()
		const browser = await pw.chromium.launch({
			headless: true,
			args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"],
		})

		const context = await browser.newContext({
			userAgent:
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
			viewport: { width: 1280, height: 720 },
			locale: "en-US",
			timezoneId: "America/New_York",
		})

		// Stealth: patch navigator.webdriver to false (#3)
		await context.addInitScript(() => {
			Object.defineProperty(navigator, "webdriver", { get: () => false })
		})

		const taskContext: TaskContext = {
			browser,
			context,
			pages: new Map(),
			nextPageId: 1,
		}

		this.taskContexts.set(taskId, taskContext)
		return taskContext
	}

	/**
	 * Open a new page and return its pageId + summary.
	 * Includes stealth mode (#3), retry with backoff (#25), and auto-popup dismissal (#19).
	 */
	async openPage(taskId: string, url: string): Promise<{ pageId: string; summary: string }> {
		const ctx = await this.getOrCreateContext(taskId)
		const page = await ctx.context.newPage()

		// Retry with backoff (#25): 3 attempts with jittered delays
		await this.navigateWithRetry(page, url)

		const pageId = `page_${ctx.nextPageId++}`
		ctx.pages.set(pageId, page)

		// Auto-dismiss popups (#19): hide common popup/overlay patterns
		await this.dismissPopups(page)

		const summary = await this.getSummary(taskId, pageId)
		return { pageId, summary }
	}

	/**
	 * Navigate with retry and jittered backoff (#25).
	 * Retries up to 3 times on transient failures.
	 */
	private async navigateWithRetry(page: Page, url: string, maxRetries = 3): Promise<void> {
		const delays = [0, 350, 900, 1800]
		for (let attempt = 0; attempt < maxRetries; attempt++) {
			try {
				if (attempt > 0) {
					await new Promise((r) => setTimeout(r, delays[attempt] || 1000))
				}
				await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })
				return
			} catch (error) {
				if (attempt === maxRetries - 1) throw error
			}
		}
	}

	/**
	 * Auto-dismiss common popups/overlays (#19).
	 * Removes cookie banners, sign-in prompts, newsletter popups.
	 */
	private async dismissPopups(page: Page): Promise<void> {
		try {
			await page.evaluate(() => {
				// Hide high z-index fixed/absolute overlays
				const elements = Array.from(document.querySelectorAll("*"))
				for (const el of elements) {
					const style = window.getComputedStyle(el)
					const zIndex = parseInt(style.zIndex || "0", 10)
					const isFixedOrAbsolute = style.position === "fixed" || style.position === "absolute"
					if (isFixedOrAbsolute && zIndex > 10000) {
						;(el as HTMLElement).style.display = "none"
					}
				}

				// Hide elements matching common popup patterns
				const popupSelectors = [
					'[class*="cookie-banner"]',
					'[class*="cookie-consent"]',
					'[class*="newsletter-popup"]',
					'[class*="sign-in-modal"]',
					'[id*="cookie"]',
					'[role="dialog"][aria-modal="true"]',
				]
				for (const selector of popupSelectors) {
					document.querySelectorAll(selector).forEach((el) => {
						;(el as HTMLElement).style.display = "none"
					})
				}
			})
		} catch {
			// Silently fail — popup dismissal is best-effort
		}
	}

	/**
	 * Get page text content — main-content extraction (#20/#24).
	 * Tries <article>/<main> first, falls back to full page text.
	 * Strips nav/footer/sidebar/header for compact output.
	 */
	async getSummary(taskId: string, pageId: string): Promise<string> {
		const page = this.getPage(taskId, pageId)
		if (!page) {
			throw new Error(`Page not found: ${pageId}`)
		}

		const text = await page.evaluate(() => {
			// Try <article> or <main> first (most semantic, Issue #24)
			const article = document.querySelector("article")
			const main = document.querySelector("main")
			const target = article || main || document.body
			if (!target) return ""

			const clone = target.cloneNode(true) as HTMLElement
			// Remove non-content elements
			const removeEls = clone.querySelectorAll(
				"script, style, nav, footer, header, noscript, svg, aside, iframe, form",
			)
			Array.from(removeEls).forEach((el) => el.remove())
			return clone.innerText || ""
		})

		return text.trim().slice(0, 15000) || "(empty page)"
	}

	/**
	 * Navigate a page to a URL with retry + popup dismissal + auto-summary.
	 */
	async navigatePage(taskId: string, pageId: string, url: string): Promise<{ success: boolean; summary: string }> {
		const page = this.getPage(taskId, pageId)
		if (!page) {
			throw new Error(`Page not found: ${pageId}`)
		}

		await this.navigateWithRetry(page, url)
		await this.dismissPopups(page)
		const summary = await this.getSummary(taskId, pageId)
		return { success: true, summary }
	}

	/**
	 * Extract all URLs from a page.
	 */
	async extractUrls(
		taskId: string,
		pageId: string,
		options: { sameOriginOnly?: boolean; limit?: number } = {},
	): Promise<Array<{ url: string; text: string }>> {
		const page = this.getPage(taskId, pageId)
		if (!page) {
			throw new Error(`Page not found: ${pageId}`)
		}

		const urls = await page.evaluate(
			({ sameOriginOnly, limit }: { sameOriginOnly: boolean; limit: number }) => {
				const links: Array<{ url: string; text: string }> = []
				const seen = new Set<string>()
				const anchors = Array.from(document.querySelectorAll("a[href]"))

				for (const anchor of anchors) {
					if (links.length >= limit) break
					const href = (anchor as HTMLAnchorElement).href
					if (!href || !href.startsWith("http")) continue
					if (seen.has(href)) continue

					if (sameOriginOnly && !href.startsWith(location.origin)) continue

					seen.add(href)
					const text = (anchor.textContent || "").trim().slice(0, 120)
					links.push({ url: href, text: text || href })
				}

				return links
			},
			{
				sameOriginOnly: options.sameOriginOnly ?? false,
				limit: options.limit ?? 50,
			},
		)

		return urls
	}

	/**
	 * Extract structured data from a page (tables, lists, text).
	 */
	async extractData(
		taskId: string,
		pageId: string,
		options: { selector?: string; extractType?: "table" | "list" | "text" | "auto"; maxRows?: number } = {},
	): Promise<{ type: string; data: unknown; count: number }> {
		const page = this.getPage(taskId, pageId)
		if (!page) {
			throw new Error(`Page not found: ${pageId}`)
		}

		const result = await page.evaluate(
			({
				selector,
				extractType,
				maxRows,
			}: {
				selector: string | undefined
				extractType: string
				maxRows: number
			}) => {
				function extractTable(el: Element) {
					const headers: string[] = []
					const headerRow = el.querySelector("thead tr, tr:first-child")
					if (headerRow) {
						headerRow.querySelectorAll("th, td").forEach((cell) => {
							headers.push((cell.textContent || "").trim())
						})
					}
					const rows: string[][] = []
					const bodyRows = el.querySelectorAll("tbody tr, tr:not(:first-child)")
					bodyRows.forEach((row) => {
						const cells: string[] = []
						row.querySelectorAll("td").forEach((cell) => {
							cells.push((cell.textContent || "").trim())
						})
						if (cells.length > 0) rows.push(cells)
					})
					return { headers, rows: rows.slice(0, maxRows) }
				}

				function extractList(el: Element) {
					const items: string[] = []
					el.querySelectorAll("li").forEach((li) => {
						items.push((li.textContent || "").trim())
					})
					return items.slice(0, maxRows)
				}

				if (selector) {
					const el = document.querySelector(selector)
					if (!el) return { type: "error", data: `Element not found: ${selector}`, count: 0 }

					const type =
						extractType === "auto"
							? el.tagName === "TABLE"
								? "table"
								: el.tagName === "UL" || el.tagName === "OL"
									? "list"
									: "text"
							: extractType

					if (type === "table")
						return {
							type: "table",
							data: extractTable(el),
							count: (el as HTMLTableElement).rows?.length || 0,
						}
					if (type === "list")
						return { type: "list", data: extractList(el), count: el.querySelectorAll("li").length }
					return { type: "text", data: (el.textContent || "").trim().slice(0, maxRows * 200), count: 1 }
				}

				// Auto-detect: find tables and lists on page
				const tables = document.querySelectorAll("table")
				const lists = document.querySelectorAll("ul, ol")
				const results: Array<{ type: string; selector: string; data: unknown }> = []

				tables.forEach((t, i) => {
					if (i >= 3) return
					results.push({ type: "table", selector: `table:nth-of-type(${i + 1})`, data: extractTable(t) })
				})
				lists.forEach((l, i) => {
					if (i >= 3) return
					results.push({
						type: "list",
						selector: `${l.tagName.toLowerCase()}:nth-of-type(${i + 1})`,
						data: extractList(l),
					})
				})

				if (results.length === 0) {
					return { type: "text", data: (document.body?.innerText || "").slice(0, maxRows * 200), count: 1 }
				}
				return { type: "auto", data: results, count: results.length }
			},
			{
				selector: options.selector,
				extractType: options.extractType ?? "auto",
				maxRows: options.maxRows ?? 50,
			},
		)

		return result as { type: string; data: unknown; count: number }
	}

	/**
	 * Click an element on a page.
	 */
	async clickElement(
		taskId: string,
		pageId: string,
		selector: string,
	): Promise<{ success: boolean; summary: string }> {
		const page = this.getPage(taskId, pageId)
		if (!page) {
			throw new Error(`Page not found: ${pageId}`)
		}

		await page.click(selector, { timeout: 10000 })
		await page.waitForLoadState("domcontentloaded").catch(() => {})
		const summary = await this.getSummary(taskId, pageId)
		return { success: true, summary }
	}

	/**
	 * Type text into an element.
	 */
	async typeText(taskId: string, pageId: string, selector: string, text: string): Promise<{ success: boolean }> {
		const page = this.getPage(taskId, pageId)
		if (!page) {
			throw new Error(`Page not found: ${pageId}`)
		}

		await page.fill(selector, text, { timeout: 10000 })
		return { success: true }
	}

	/**
	 * Scroll a page.
	 */
	async scrollPage(
		taskId: string,
		pageId: string,
		direction: "up" | "down" = "down",
		amount: number = 500,
	): Promise<{ success: boolean; summary: string }> {
		const page = this.getPage(taskId, pageId)
		if (!page) {
			throw new Error(`Page not found: ${pageId}`)
		}

		const delta = direction === "down" ? amount : -amount
		await page.evaluate((d: number) => window.scrollBy(0, d), delta)
		await page.waitForTimeout(300)
		const summary = await this.getSummary(taskId, pageId)
		return { success: true, summary }
	}

	/**
	 * Take a screenshot of a page.
	 */
	async screenshotPage(taskId: string, pageId: string): Promise<{ mimeType: string; data: Buffer }> {
		const page = this.getPage(taskId, pageId)
		if (!page) {
			throw new Error(`Page not found: ${pageId}`)
		}

		const buffer = await page.screenshot({ type: "jpeg", quality: 80 })
		return { mimeType: "image/jpeg", data: buffer }
	}

	/**
	 * List all open pages for a task.
	 */
	listPages(taskId: string): Array<{ pageId: string; url: string; title: string }> {
		const ctx = this.taskContexts.get(taskId)
		if (!ctx) return []

		const result: Array<{ pageId: string; url: string; title: string }> = []
		for (const [pageId, page] of ctx.pages) {
			result.push({
				pageId,
				url: page.url(),
				title: "", // Title requires async, use cached or empty
			})
		}
		return result
	}

	/**
	 * Switch to a specific tab (bring to front).
	 */
	async switchTab(taskId: string, pageId: string): Promise<{ success: boolean; url: string }> {
		const page = this.getPage(taskId, pageId)
		if (!page) {
			throw new Error(`Page not found: ${pageId}`)
		}
		await page.bringToFront()
		return { success: true, url: page.url() }
	}

	/**
	 * Close a specific page.
	 */
	async closePage(taskId: string, pageId: string): Promise<{ success: boolean }> {
		const ctx = this.taskContexts.get(taskId)
		if (!ctx) return { success: false }

		const page = ctx.pages.get(pageId)
		if (!page) return { success: false }

		await page.close()
		ctx.pages.delete(pageId)
		return { success: true }
	}

	/**
	 * Close all pages and cleanup for a task.
	 */
	async closeAllForTask(taskId: string): Promise<void> {
		const ctx = this.taskContexts.get(taskId)
		if (!ctx) return

		for (const [, page] of ctx.pages) {
			await page.close().catch(() => {})
		}
		ctx.pages.clear()

		await ctx.context.close().catch(() => {})
		await ctx.browser.close().catch(() => {})
		this.taskContexts.delete(taskId)
	}

	/**
	 * Get a specific page by ID.
	 */
	getPage(taskId: string, pageId: string): Page | undefined {
		return this.taskContexts.get(taskId)?.pages.get(pageId)
	}

	/**
	 * Click an element by visible text (#10).
	 * Finds the first element matching the text and clicks it.
	 */
	async clickElementByText(
		taskId: string,
		pageId: string,
		text: string,
	): Promise<{ success: boolean; summary: string }> {
		const page = this.getPage(taskId, pageId)
		if (!page) {
			throw new Error(`Page not found: ${pageId}`)
		}

		// Try multiple strategies to find the element
		const clicked = await page.evaluate((t: string) => {
			// Strategy 1: exact text match on links and buttons
			const elements = Array.from(document.querySelectorAll("a, button, [role='button'], [onclick]"))
			for (const el of elements) {
				if ((el.textContent || "").trim() === t) {
					;(el as HTMLElement).click()
					return true
				}
			}
			// Strategy 2: partial text match
			for (const el of elements) {
				if ((el.textContent || "").trim().includes(t)) {
					;(el as HTMLElement).click()
					return true
				}
			}
			return false
		}, text)

		if (!clicked) {
			throw new Error(`No element found with text: "${text}"`)
		}

		await page.waitForLoadState("domcontentloaded").catch(() => {})
		const summary = await this.getSummary(taskId, pageId)
		return { success: true, summary }
	}

	/**
	 * Evaluate JavaScript on a page (#28).
	 */
	async evaluateJs(taskId: string, pageId: string, script: string): Promise<unknown> {
		const page = this.getPage(taskId, pageId)
		if (!page) {
			throw new Error(`Page not found: ${pageId}`)
		}

		// Wrap in IIFE to avoid variable conflicts (#13)
		const wrappedScript = script.trim().startsWith("(function") ? script : `(function() { ${script} })()`

		return page.evaluate(wrappedScript)
	}

	/**
	 * Read all open tabs at once (#2).
	 */
	async readAllTabs(taskId: string): Promise<Array<{ pageId: string; url: string; summary: string }>> {
		const ctx = this.taskContexts.get(taskId)
		if (!ctx) return []

		const results: Array<{ pageId: string; url: string; summary: string }> = []
		for (const [pageId, page] of ctx.pages) {
			try {
				const summary = await this.getSummary(taskId, pageId)
				results.push({ pageId, url: page.url(), summary })
			} catch {
				results.push({ pageId, url: page.url(), summary: "(failed to read)" })
			}
		}
		return results
	}

	/**
	 * Batch execute multiple actions on a page (#11).
	 * Actions are executed sequentially without LLM round-trips between them.
	 */
	async batchExecute(
		taskId: string,
		pageId: string,
		actions: Array<{ type: string; selector?: string; text?: string; url?: string; script?: string }>,
	): Promise<Array<{ action: string; result: string }>> {
		const results: Array<{ action: string; result: string }> = []

		for (const action of actions) {
			try {
				switch (action.type) {
					case "click": {
						if (!action.selector) throw new Error("click requires selector")
						const page = this.getPage(taskId, pageId)
						if (!page) throw new Error(`Page not found: ${pageId}`)
						await page.click(action.selector, { timeout: 10000 })
						results.push({ action: `click ${action.selector}`, result: "ok" })
						break
					}
					case "type": {
						if (!action.selector || action.text === undefined)
							throw new Error("type requires selector and text")
						const page = this.getPage(taskId, pageId)
						if (!page) throw new Error(`Page not found: ${pageId}`)
						await page.fill(action.selector, action.text, { timeout: 10000 })
						results.push({ action: `type into ${action.selector}`, result: "ok" })
						break
					}
					case "navigate": {
						if (!action.url) throw new Error("navigate requires url")
						await this.navigatePage(taskId, pageId, action.url)
						results.push({ action: `navigate to ${action.url}`, result: "ok" })
						break
					}
					case "eval": {
						if (!action.script) throw new Error("eval requires script")
						const result = await this.evaluateJs(taskId, pageId, action.script)
						results.push({ action: "eval", result: String(result) })
						break
					}
					default:
						results.push({ action: action.type, result: "unknown action type" })
				}
			} catch (error) {
				results.push({ action: action.type, result: `error: ${error}` })
			}
		}

		return results
	}
}
