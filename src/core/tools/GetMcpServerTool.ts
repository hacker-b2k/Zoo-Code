import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
import { getMcpHub, parseScope, redactMcpServerConfig } from "./helpers/mcpManageTools"

interface GetMcpServerParams {
	name: string
	scope: "project" | "global"
}

export class GetMcpServerTool extends BaseTool<"get_mcp_server"> {
	readonly name = "get_mcp_server" as const

	async execute(params: GetMcpServerParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { handleError, pushToolResult } = callbacks
		const name = params.name?.trim()
		const scope = parseScope(params.scope)

		try {
			if (!name) {
				task.consecutiveMistakeCount++
				task.recordToolError("get_mcp_server")
				pushToolResult(await task.sayAndCreateMissingParamError("get_mcp_server", "name"))
				return
			}
			if (!scope) {
				task.consecutiveMistakeCount++
				task.recordToolError("get_mcp_server")
				pushToolResult(
					formatResponse.toolError(`Invalid scope. Use project | global. Got: ${String(params.scope)}`),
				)
				return
			}

			const hub = getMcpHub(task)
			const raw = await hub.configStore.getServer(scope, name)
			if (!raw) {
				task.recordToolError("get_mcp_server")
				pushToolResult(formatResponse.toolError(`Server "${name}" not found in ${scope} MCP config`))
				return
			}

			const live = hub.getAllServers().find((s) => s.name === name && (s.source || "global") === scope)
			const vaultRefs = hub.credentialVault
				? hub.credentialVault.listSecretRefs(raw)
				: { envSecretKeys: [], headerSecretKeys: [] }

			task.consecutiveMistakeCount = 0
			pushToolResult(
				JSON.stringify(
					{
						ok: true,
						name,
						scope,
						disabled: raw.disabled === true,
						status: live?.status,
						error: live?.error,
						tools: live?.tools?.map((t) => t.name),
						config: redactMcpServerConfig(raw),
						vaultRefs,
					},
					null,
					2,
				),
			)
		} catch (error) {
			await handleError("getting MCP server", error as Error)
			pushToolResult(formatResponse.toolError((error as Error).message))
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"get_mcp_server">): Promise<void> {
		const partialMessage = JSON.stringify({
			tool: "getMcpServer",
			name: block.params.name ?? "",
			scope: block.params.scope ?? "",
		})
		await task.ask("tool", partialMessage, block.partial).catch(() => {})
	}
}

export const getMcpServerTool = new GetMcpServerTool()
