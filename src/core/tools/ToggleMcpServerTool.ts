import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
import { getMcpHub, parseScope } from "./helpers/mcpManageTools"

interface ToggleMcpServerParams {
	name: string
	scope: "project" | "global"
	disabled: boolean
}

export class ToggleMcpServerTool extends BaseTool<"toggle_mcp_server"> {
	readonly name = "toggle_mcp_server" as const

	async execute(params: ToggleMcpServerParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { askApproval, handleError, pushToolResult } = callbacks
		const name = params.name?.trim()
		const scope = parseScope(params.scope)
		const disabled = params.disabled

		try {
			if (!name) {
				task.consecutiveMistakeCount++
				task.recordToolError("toggle_mcp_server")
				pushToolResult(await task.sayAndCreateMissingParamError("toggle_mcp_server", "name"))
				return
			}
			if (!scope) {
				task.consecutiveMistakeCount++
				task.recordToolError("toggle_mcp_server")
				pushToolResult(
					formatResponse.toolError(`Invalid scope. Use project | global. Got: ${String(params.scope)}`),
				)
				return
			}
			if (typeof disabled !== "boolean") {
				task.consecutiveMistakeCount++
				task.recordToolError("toggle_mcp_server")
				pushToolResult(formatResponse.toolError("disabled must be a boolean"))
				return
			}

			const hub = getMcpHub(task)
			const existing = await hub.configStore.getServer(scope, name)
			if (!existing) {
				task.recordToolError("toggle_mcp_server")
				pushToolResult(formatResponse.toolError(`Server "${name}" not found in ${scope} MCP config`))
				return
			}

			const approvalPayload = {
				tool: "toggleMcpServer",
				name,
				scope,
				disabled,
				operation: disabled ? "disable" : "enable",
			}

			const didApprove = await askApproval("tool", JSON.stringify(approvalPayload))
			if (!didApprove) {
				return
			}

			await hub.toggleServerDisabled(name, disabled, scope)

			const live = hub.getAllServers().find((s) => s.name === name && (s.source || "global") === scope)

			task.consecutiveMistakeCount = 0
			pushToolResult(
				JSON.stringify(
					{
						ok: true,
						name,
						scope,
						disabled,
						status: live?.status,
					},
					null,
					2,
				),
			)
		} catch (error) {
			task.recordToolError("toggle_mcp_server")
			await handleError("toggling MCP server", error as Error)
			pushToolResult(formatResponse.toolError((error as Error).message))
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"toggle_mcp_server">): Promise<void> {
		const partialMessage = JSON.stringify({
			tool: "toggleMcpServer",
			name: block.params.name ?? "",
			scope: block.params.scope ?? "",
			disabled: block.params.disabled ?? "",
		})
		await task.ask("tool", partialMessage, block.partial).catch(() => {})
	}
}

export const toggleMcpServerTool = new ToggleMcpServerTool()
