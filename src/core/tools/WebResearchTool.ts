import type { ClineSayTool } from "@roo-code/types"

import { Task } from "../task/Task"
import type { ToolUse } from "../../shared/tools"
import { BaseTool, type ToolCallbacks } from "./BaseTool"
import { research } from "./helpers/webResearchRequest"

interface WebResearchParams {
	input?: string | null
	action?: "search" | "read_url"
	query?: string | null
	url?: string | null
	max_results?: number | null
	read_top_sources?: number | null
}

export class WebResearchTool extends BaseTool<"web_research"> {
	readonly name = "web_research" as const

	async execute(params: WebResearchParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { action, max_results } = params
		const { askApproval, handleError, pushToolResult } = callbacks

		// Problem A defensive guards: query/url must be real strings. Without
		// this, an object-valued `query={}` from a strict-mode-confused gateway
		// would silently pass `!query` (objects are truthy) and the tool would
		// search the literal string "[object Object]" — silent wrong output,
		// which is worse than failing loudly. Reject non-string values cleanly
		// so the actionable missing-param error surfaces.
		const query = typeof params.query === "string" ? params.query : null
		const url = typeof params.url === "string" ? params.url : null
		const directInput = typeof params.input === "string" ? params.input : null
		const input = directInput ?? query ?? url

		try {
			if (!input) {
				task.consecutiveMistakeCount++
				task.recordToolError("web_research")
				task.didToolFailInCurrentTurn = true
				pushToolResult(await task.sayAndCreateMissingParamError("web_research" as any, "input" as any))
				return
			}

			task.consecutiveMistakeCount = 0

			// Build the approval message
			const toolPayload: Partial<ClineSayTool> = {
				tool: "openTabs" as any, // Reuse the openTabs UI type for display
				content: `Research: ${input}`,
			}

			const didApprove = await askApproval("tool", JSON.stringify(toolPayload))
			if (!didApprove) {
				return
			}

			const result = await research({
				input,
				maxSources: max_results ?? 8,
				readTopSources: params.read_top_sources ?? 0,
			})
			pushToolResult(JSON.stringify(result, null, 2))
		} catch (error) {
			await handleError("researching the web", error as Error)
		} finally {
			this.resetPartialState()
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"web_research">): Promise<void> {
		const input =
			typeof (block.params as any).input === "string"
				? (block.params as any).input
				: typeof block.params.query === "string"
					? block.params.query
					: typeof block.params.url === "string"
						? block.params.url
						: "..."
		const label = `Researching: ${input}`

		const partialPayload = {
			tool: "openTabs" as any,
			content: label,
		}
		await task.ask("tool", JSON.stringify(partialPayload), block.partial).catch(() => {})
	}
}

export const webResearchTool = new WebResearchTool()
