import { type ClineSayTool } from "@roo-code/types"

import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import type { ToolUse } from "../../shared/tools"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import { openTabs, type PreferredBrowser } from "./helpers/browserLaunch"

interface OpenTabsParams {
	urls: string[]
	browser?: PreferredBrowser
	reuseExisting?: boolean
	visible?: boolean
}

export class OpenTabsTool extends BaseTool<"open_tabs"> {
	readonly name = "open_tabs" as const

	async execute(params: OpenTabsParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { urls, browser = "auto", reuseExisting = true, visible = true } = params
		const { askApproval, handleError, pushToolResult } = callbacks

		try {
			if (!Array.isArray(urls) || urls.length === 0) {
				task.consecutiveMistakeCount++
				task.recordToolError("open_tabs")
				task.didToolFailInCurrentTurn = true
				pushToolResult(await task.sayAndCreateMissingParamError("open_tabs" as any, "urls" as any))
				return
			}

			task.consecutiveMistakeCount = 0

			const toolPayload: ClineSayTool = {
				tool: "openTabs",
				urls,
				browser,
				reuseExisting,
				visible,
				openedCount: urls.length,
				content: urls.join("\n"),
			}

			const didApprove = await askApproval("tool", JSON.stringify(toolPayload))
			if (!didApprove) {
				return
			}

			const result = await openTabs({
				urls,
				browser,
				reuseExisting,
				visible,
			})

			const summary = [
				`Opened ${result.openedCount} tab${result.openedCount === 1 ? "" : "s"}.`,
				`Browser: ${result.browserUsed}.`,
				result.usedExternalFallback
					? `Used system default browser fallback.`
					: `Used direct browser executable launch.`,
				"URLs:",
				...result.urls.map((url) => `- ${url}`),
			].join("\n")

			pushToolResult(summary)
		} catch (error) {
			await handleError("opening browser tabs", error as Error)
		} finally {
			this.resetPartialState()
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"open_tabs">): Promise<void> {
		const urlsRaw = block.params.urls
		if (!this.hasPathStabilized(urlsRaw)) {
			return
		}

		const browser = (block.params.browser ?? "auto") as "auto" | "chrome" | "edge"
		const partialPayload = {
			tool: "openTabs",
			browser,
			content: urlsRaw ?? "",
		} satisfies Partial<ClineSayTool>
		const partialMessage = JSON.stringify(partialPayload)
		await task.ask("tool", partialMessage, block.partial).catch(() => {})
	}
}

export const openTabsTool = new OpenTabsTool()
