import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
import { getMcpHub, parseScope } from "./helpers/mcpManageTools"

interface DeleteMcpServerParams {
	name: string
	scope: "project" | "global"
}

export class DeleteMcpServerTool extends BaseTool<"delete_mcp_server"> {
	readonly name = "delete_mcp_server" as const

	async execute(params: DeleteMcpServerParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { askApproval, handleError, pushToolResult } = callbacks
		const name = params.name?.trim()
		const scope = parseScope(params.scope)

		try {
			if (!name) {
				task.consecutiveMistakeCount++
				task.recordToolError("delete_mcp_server")
				pushToolResult(await task.sayAndCreateMissingParamError("delete_mcp_server", "name"))
				return
			}
			if (!scope) {
				task.consecutiveMistakeCount++
				task.recordToolError("delete_mcp_server")
				pushToolResult(
					formatResponse.toolError(`Invalid scope. Use project | global. Got: ${String(params.scope)}`),
				)
				return
			}

			const hub = getMcpHub(task)
			const existing = await hub.configStore.getServer(scope, name)
			if (!existing) {
				task.recordToolError("delete_mcp_server")
				pushToolResult(formatResponse.toolError(`Server "${name}" not found in ${scope} MCP config`))
				return
			}

			const approvalPayload = {
				tool: "deleteMcpServer",
				name,
				scope,
			}

			const didApprove = await askApproval("tool", JSON.stringify(approvalPayload))
			if (!didApprove) {
				return
			}

			// Prefer hub path (vault cleanup + connection teardown)
			try {
				await hub.deleteServer(name, scope)
			} catch {
				// Fallback if not in connections list
				await hub.configStore.removeServer(scope, name)
				if (hub.credentialVault) {
					await hub.credentialVault.deleteServerSecrets(scope, name)
				}
				const doc = await hub.configStore.read(scope)
				await hub.updateServerConnections(doc.mcpServers, scope)
			}

			task.consecutiveMistakeCount = 0
			pushToolResult(
				JSON.stringify(
					{
						ok: true,
						name,
						scope,
						deleted: true,
					},
					null,
					2,
				),
			)
		} catch (error) {
			task.recordToolError("delete_mcp_server")
			await handleError("deleting MCP server", error as Error)
			pushToolResult(formatResponse.toolError((error as Error).message))
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"delete_mcp_server">): Promise<void> {
		const partialMessage = JSON.stringify({
			tool: "deleteMcpServer",
			name: block.params.name ?? "",
			scope: block.params.scope ?? "",
		})
		await task.ask("tool", partialMessage, block.partial).catch(() => {})
	}
}

export const deleteMcpServerTool = new DeleteMcpServerTool()
