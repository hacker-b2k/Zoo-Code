/**
 * Web research helper — Tavily API primary search + DuckDuckGo fallback + URL reading.
 * Tavily provides structured results with content snippets, no CAPTCHA issues.
 * DuckDuckGo HTML serves as zero-config fallback.
 */

import * as fs from "fs"
import * as path from "path"

const USER_AGENT =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

const FETCH_TIMEOUT_MS = 15_000

export interface SearchResult {
	title: string
	url: string
	snippet: string
}

export interface SearchResponse {
	query: string
	results: SearchResult[]
	provider: "tavily" | "duckduckgo"
}

export interface ReadUrlResponse {
	url: string
	title: string
	text: string
	truncated: boolean
}

/**
 * Get Tavily API key from local private file (dev/testing only).
 * Returns null if not configured.
 */
function getTavilyApiKey(): string | null {
	try {
		const keyPath = path.resolve(__dirname, "../../../../../temp-sandbox/local-provider-keys.private.json")
		const raw = fs.readFileSync(keyPath, "utf-8")
		const parsed = JSON.parse(raw)
		return parsed.tavilyApiKey || null
	} catch {
		return null
	}
}

/**
 * Search the web. Tries Tavily API first (if key available), falls back to DuckDuckGo.
 */
export async function searchWeb(query: string, maxResults = 8): Promise<SearchResponse> {
	const tavilyKey = getTavilyApiKey()

	if (tavilyKey) {
		try {
			return await searchWithTavily(query, maxResults, tavilyKey)
		} catch (error) {
			console.warn("[webResearch] Tavily search failed, falling back to DuckDuckGo:", error)
		}
	}

	return await searchWithDuckDuckGo(query, maxResults)
}

/**
 * Search using Tavily API. Returns structured results with content snippets.
 */
async function searchWithTavily(query: string, maxResults: number, apiKey: string): Promise<SearchResponse> {
	const controller = new AbortController()
	const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

	try {
		const response = await fetch("https://api.tavily.com/search", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			signal: controller.signal,
			body: JSON.stringify({
				api_key: apiKey,
				query,
				max_results: maxResults,
				include_answer: true,
				include_raw_content: false,
			}),
		})

		if (!response.ok) {
			throw new Error(`Tavily API error: ${response.status} ${response.statusText}`)
		}

		const data = (await response.json()) as {
			results?: Array<{ title: string; url: string; content: string }>
			answer?: string
		}

		const results: SearchResult[] = (data.results || []).map((r) => ({
			title: r.title || "",
			url: r.url || "",
			snippet: r.content || "",
		}))

		// If Tavily provides an answer, prepend it as a special result
		if (data.answer) {
			results.unshift({
				title: "AI Answer",
				url: "",
				snippet: data.answer,
			})
		}

		return { query, results, provider: "tavily" }
	} finally {
		clearTimeout(timeout)
	}
}

/**
 * Search using DuckDuckGo HTML lite endpoint (fallback, no API key needed).
 */
async function searchWithDuckDuckGo(query: string, maxResults: number): Promise<SearchResponse> {
	const encodedQuery = encodeURIComponent(query)
	const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}`

	const controller = new AbortController()
	const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

	try {
		const response = await fetch(url, {
			headers: { "User-Agent": USER_AGENT },
			signal: controller.signal,
		})

		if (!response.ok) {
			throw new Error(`DuckDuckGo request failed: ${response.status} ${response.statusText}`)
		}

		const html = await response.text()
		const results = parseDuckDuckGoResults(html, maxResults)

		return { query, results, provider: "duckduckgo" }
	} finally {
		clearTimeout(timeout)
	}
}

/**
 * Read and extract text content from a URL.
 * Returns the page title and cleaned text content.
 */
export async function readUrl(url: string, maxChars = 12_000): Promise<ReadUrlResponse> {
	const controller = new AbortController()
	const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

	try {
		const response = await fetch(url, {
			headers: {
				"User-Agent": USER_AGENT,
				Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
			},
			signal: controller.signal,
			redirect: "follow",
		})

		if (!response.ok) {
			throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`)
		}

		const contentType = response.headers.get("content-type") || ""
		const html = await response.text()

		const title = extractTitle(html)
		let text = ""

		if (contentType.includes("text/plain")) {
			text = html.trim()
		} else {
			text = extractMainContent(html)
		}

		const truncated = text.length > maxChars
		if (truncated) {
			text = text.slice(0, maxChars) + "\n\n[Content truncated...]"
		}

		return { url, title, text, truncated }
	} finally {
		clearTimeout(timeout)
	}
}

/**
 * Parse DuckDuckGo HTML search results page.
 */
function parseDuckDuckGoResults(html: string, maxResults: number): SearchResult[] {
	const results: SearchResult[] = []

	const resultBlocks = html.split(/class="result\s/)

	for (let i = 1; i < resultBlocks.length && results.length < maxResults; i++) {
		const block = resultBlocks[i]

		const urlMatch = block.match(/class="result__a"[^>]*href="([^"]+)"/)
		if (!urlMatch) continue

		let resultUrl = urlMatch[1]
		const uddgMatch = resultUrl.match(/uddg=([^&]+)/)
		if (uddgMatch) {
			resultUrl = decodeURIComponent(uddgMatch[1])
		}

		const titleMatch = block.match(/class="result__a"[^>]*>([^<]+)</)
		const title = titleMatch ? decodeHtmlEntities(titleMatch[1].trim()) : ""

		const snippetMatch = block.match(/class="result__snippet"[^>]*>([^<]+)/)
		const snippet = snippetMatch ? decodeHtmlEntities(snippetMatch[1].trim()) : ""

		if (title && resultUrl) {
			results.push({ title, url: resultUrl, snippet })
		}
	}

	return results
}

/**
 * Extract the <title> content from HTML.
 */
function extractTitle(html: string): string {
	const match = html.match(/<title[^>]*>([^<]+)<\/title>/i)
	return match ? decodeHtmlEntities(match[1].trim()) : ""
}

/**
 * Extract main content from HTML, skipping nav/footer/sidebar/header.
 * This is Issue #24 fix — read only the main article content.
 */
function extractMainContent(html: string): string {
	// Try to find <article> or <main> first (most semantic)
	let text = ""
	const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)
	const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)

	if (articleMatch) {
		text = articleMatch[1]
	} else if (mainMatch) {
		text = mainMatch[1]
	} else {
		text = html
	}

	// Remove non-content elements
	text = text
		.replace(/<script[\s\S]*?<\/script>/gi, "")
		.replace(/<style[\s\S]*?<\/style>/gi, "")
		.replace(/<nav[\s\S]*?<\/nav>/gi, "")
		.replace(/<footer[\s\S]*?<\/footer>/gi, "")
		.replace(/<header[\s\S]*?<\/header>/gi, "")
		.replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
		.replace(/<svg[\s\S]*?<\/svg>/gi, "")
		.replace(/<aside[\s\S]*?<\/aside>/gi, "")
		.replace(/<form[\s\S]*?<\/form>/gi, "")
		.replace(/<iframe[\s\S]*?<\/iframe>/gi, "")

	// Replace block elements with newlines
	text = text
		.replace(/<\/?(p|div|br|hr|li|h[1-6]|tr|blockquote)[^>]*\/?>/gi, "\n")
		.replace(/<\/?(article|section|main)[^>]*>/gi, "\n")

	// Remove all remaining HTML tags
	text = text.replace(/<[^>]+>/g, " ")

	// Decode HTML entities
	text = decodeHtmlEntities(text)

	// Clean up whitespace
	text = text
		.replace(/&nbsp;/g, " ")
		.replace(/\s+/g, " ")
		.replace(/\n\s*\n/g, "\n")
		.replace(/[ \t]+/g, " ")
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.join("\n")

	return text.trim()
}

/**
 * Decode common HTML entities.
 */
function decodeHtmlEntities(text: string): string {
	return text
		.replace(/&/g, "&")
		.replace(/</g, "<")
		.replace(/>/g, ">")
		.replace(/"/g, '"')
		.replace(/'/g, "'")
		.replace(/'/g, "'")
		.replace(/&#x27;/g, "'")
		.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
}
