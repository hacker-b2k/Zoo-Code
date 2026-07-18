import type { ClineSayTool } from "@roo-code/types"

import { Task } from "../task/Task"
import type { ToolUse } from "../../shared/tools"
import { BaseTool, type ToolCallbacks } from "./BaseTool"
import { searchWeb, readUrl } from "./helpers/webResearch"

interface WebResearchParams {
	action: "search" | "read_url"
	query?: string | null
	url?: string | null
	max_results?: number | null
}

export class WebResearchTool extends BaseTool<"web_research"> {
	readonly name = "web_research" as const

	async execute(params: WebResearchParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { action, query, url, max_results } = params
		const { askApproval, handleError, pushToolResult } = callbacks

		try {
			if (!action) {
				task.consecutiveMistakeCount++
				task.recordToolError("web_research")
				task.didToolFailInCurrentTurn = true
				pushToolResult(await task.sayAndCreateMissingParamError("web_research" as any, "action" as any))
				return
			}

			if (action === "search" && !query) {
				task.consecutiveMistakeCount++
				task.recordToolError("web_research")
				task.didToolFailInCurrentTurn = true
				pushToolResult(await task.sayAndCreateMissingParamError("web_research" as any, "query" as any))
				return
			}

			if (action === "read_url" && !url) {
				task.consecutiveMistakeCount++
				task.recordToolError("web_research")
				task.didToolFailInCurrentTurn = true
				pushToolResult(await task.sayAndCreateMissingParamError("web_research" as any, "url" as any))
				return
			}

			task.consecutiveMistakeCount = 0

			// Build the approval message
			const toolPayload: Partial<ClineSayTool> = {
				tool: "openTabs" as any, // Reuse the openTabs UI type for display
				content: action === "search" ? `Search: ${query}` : `Read: ${url}`,
			}

			const didApprove = await askApproval("tool", JSON.stringify(toolPayload))
			if (!didApprove) {
				return
			}

			if (action === "search") {
				const result = await searchWeb(query!, max_results ?? 8)

				if (result.results.length === 0) {
					pushToolResult(`No search results found for: "${query}"`)
					return
				}

				const provider = result.provider === "tavily" ? "Tavily API" : "DuckDuckGo"
				const formatted = [
					`Search results for: "${query}" (${provider})`,
					`Found ${result.results.length} results:\n`,
					...result.results.map((r, i) => `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.snippet}\n`),
				].join("\n")

				pushToolResult(formatted)
			} else {
				// read_url
				const result = await readUrl(url!)

				const formatted = [
					`Page: ${result.title || "(no title)"}`,
					`URL: ${result.url}`,
					result.truncated ? "(Content was truncated due to length)" : "",
					`\n--- Page Content ---\n`,
					result.text,
				]
					.filter(Boolean)
					.join("\n")

				pushToolResult(formatted)
			}
		} catch (error) {
			await handleError(action === "search" ? "searching the web" : "reading URL content", error as Error)
		} finally {
			this.resetPartialState()
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"web_research">): Promise<void> {
		const action = block.params.action
		if (!action) return

		const label =
			action === "search" ? `Searching: ${block.params.query ?? "..."}` : `Reading: ${block.params.url ?? "..."}`

		const partialPayload = {
			tool: "openTabs" as any,
			content: label,
		}
		await task.ask("tool", JSON.stringify(partialPayload), block.partial).catch(() => {})
	}
}

export const webResearchTool = new WebResearchTool()
