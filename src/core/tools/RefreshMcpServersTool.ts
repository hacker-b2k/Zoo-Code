import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
import { getMcpHub } from "./helpers/mcpManageTools"

export class RefreshMcpServersTool extends BaseTool<"refresh_mcp_servers"> {
	readonly name = "refresh_mcp_servers" as const

	async execute(_params: Record<string, never>, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { askApproval, handleError, pushToolResult } = callbacks

		try {
			const hub = getMcpHub(task)

			const didApprove = await askApproval(
				"tool",
				JSON.stringify({ tool: "refreshMcpServers", operation: "refresh_all" }),
			)
			if (!didApprove) {
				return
			}

			await hub.refreshAllConnections()

			const servers = hub.getAllServers().map((s) => ({
				name: s.name,
				source: s.source || "global",
				disabled: s.disabled === true,
				status: s.status,
				error: s.error,
			}))

			task.consecutiveMistakeCount = 0
			pushToolResult(
				JSON.stringify(
					{
						ok: true,
						refreshed: true,
						servers,
					},
					null,
					2,
				),
			)
		} catch (error) {
			task.recordToolError("refresh_mcp_servers")
			await handleError("refreshing MCP servers", error as Error)
			pushToolResult(formatResponse.toolError((error as Error).message))
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"refresh_mcp_servers">): Promise<void> {
		const partialMessage = JSON.stringify({ tool: "refreshMcpServers" })
		await task.ask("tool", partialMessage, block.partial).catch(() => {})
	}
}

export const refreshMcpServersTool = new RefreshMcpServersTool()
