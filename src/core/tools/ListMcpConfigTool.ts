import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
import { getMcpHub, redactMcpServerConfig } from "./helpers/mcpManageTools"

interface ListMcpConfigParams {
	scope?: "project" | "global" | "all"
}

export class ListMcpConfigTool extends BaseTool<"list_mcp_config"> {
	readonly name = "list_mcp_config" as const

	async execute(params: ListMcpConfigParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { handleError, pushToolResult } = callbacks

		// Problem A defensive guard: scope must be a real string enum value or
		// undefined. A non-string scope (object/array from broken gateways)
		// would otherwise leak through `String(scopeFilter)` as
		// "[object Object]" into the user-visible error message, hiding the
		// actual failure mode. Coerce cleanly first.
		const scopeRaw = params.scope
		const scopeFilter =
			typeof scopeRaw === "string"
				? ((scopeRaw.trim().toLowerCase() || "all") as "project" | "global" | "all")
				: scopeRaw === undefined || scopeRaw === null
					? "all"
					: "all"

		try {
			const hub = getMcpHub(task)
			const scopes =
				scopeFilter === "all"
					? (["project", "global"] as const)
					: scopeFilter === "project" || scopeFilter === "global"
						? ([scopeFilter] as const)
						: null

			if (!scopes) {
				task.consecutiveMistakeCount++
				task.recordToolError("list_mcp_config")
				pushToolResult(
					formatResponse.toolError(
						`Invalid scope. Use project | global | all. Got: ${typeof scopeRaw === "string" ? scopeRaw : "(non-string)"}`,
					),
				)
				return
			}

			const servers: Array<Record<string, unknown>> = []
			const live = hub.getAllServers()

			for (const scope of scopes) {
				try {
					const listed = await hub.configStore.listServers(scope)
					for (const entry of listed) {
						const raw = await hub.configStore.getServer(scope, entry.name)
						const liveServer = live.find((s) => s.name === entry.name && (s.source || "global") === scope)
						servers.push({
							name: entry.name,
							scope,
							disabled: entry.disabled,
							type: entry.type,
							command: entry.command,
							url: entry.url,
							status: liveServer?.status,
							error: liveServer?.error,
							config: raw ? redactMcpServerConfig(raw) : undefined,
						})
					}
				} catch (err) {
					// Project scope may fail without workspace
					if (scope === "project") {
						continue
					}
					throw err
				}
			}

			task.consecutiveMistakeCount = 0
			pushToolResult(
				JSON.stringify(
					{
						ok: true,
						scope: scopeFilter,
						servers,
					},
					null,
					2,
				),
			)
		} catch (error) {
			await handleError("listing MCP config", error as Error)
			pushToolResult(formatResponse.toolError((error as Error).message))
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"list_mcp_config">): Promise<void> {
		const partialMessage = JSON.stringify({
			tool: "listMcpConfig",
			scope: block.params.scope ?? "all",
		})
		await task.ask("tool", partialMessage, block.partial).catch(() => {})
	}
}

export const listMcpConfigTool = new ListMcpConfigTool()
