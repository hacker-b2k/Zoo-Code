import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
import { getMcpHub, parseScope } from "./helpers/mcpManageTools"

interface SetMcpSecretParams {
	name: string
	scope: "project" | "global"
	channel: "env" | "header"
	key: string
	value?: string
}

export class SetMcpSecretTool extends BaseTool<"set_mcp_secret"> {
	readonly name = "set_mcp_secret" as const

	async execute(params: SetMcpSecretParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { askApproval, handleError, pushToolResult } = callbacks
		const name = params.name?.trim()
		const scope = parseScope(params.scope)
		const channel = params.channel
		const key = params.key?.trim()
		const value = params.value

		try {
			if (!name) {
				task.consecutiveMistakeCount++
				task.recordToolError("set_mcp_secret")
				pushToolResult(await task.sayAndCreateMissingParamError("set_mcp_secret", "name"))
				return
			}
			if (!scope) {
				task.consecutiveMistakeCount++
				task.recordToolError("set_mcp_secret")
				pushToolResult(
					formatResponse.toolError(`Invalid scope. Use project | global. Got: ${String(params.scope)}`),
				)
				return
			}
			if (channel !== "env" && channel !== "header") {
				task.consecutiveMistakeCount++
				task.recordToolError("set_mcp_secret")
				pushToolResult(formatResponse.toolError(`Invalid channel. Use env | header. Got: ${String(channel)}`))
				return
			}
			if (!key) {
				task.consecutiveMistakeCount++
				task.recordToolError("set_mcp_secret")
				pushToolResult(await task.sayAndCreateMissingParamError("set_mcp_secret", "key"))
				return
			}

			const hub = getMcpHub(task)
			if (!hub.credentialVault) {
				task.recordToolError("set_mcp_secret")
				pushToolResult(
					formatResponse.toolError(
						"MCP credential vault is not available (SecretStorage missing). Cannot store secrets.",
					),
				)
				return
			}

			const existing = await hub.configStore.getServer(scope, name)
			if (!existing) {
				task.recordToolError("set_mcp_secret")
				pushToolResult(
					formatResponse.toolError(
						`Server "${name}" does not exist in ${scope}. Create it with manage_mcp_server first.`,
					),
				)
				return
			}

			const clear = value === undefined || value === ""
			const approvalPayload = {
				tool: "setMcpSecret",
				name,
				scope,
				channel,
				key,
				operation: clear ? "clear" : "set",
				// NEVER include value
			}

			const didApprove = await askApproval("tool", JSON.stringify(approvalPayload))
			if (!didApprove) {
				return
			}

			if (channel === "env") {
				await hub.credentialVault.setEnvSecret(scope, name, key, clear ? undefined : value)
			} else {
				await hub.credentialVault.setHeaderSecret(scope, name, key, clear ? undefined : value)
			}

			// Keep ref arrays in config JSON (no secret values)
			const refField = channel === "env" ? "envSecretKeys" : "headerSecretKeys"
			const refs = Array.isArray(existing[refField]) ? [...(existing[refField] as string[])] : []
			if (clear) {
				const idx = refs.indexOf(key)
				if (idx >= 0) {
					refs.splice(idx, 1)
				}
			} else if (!refs.includes(key)) {
				refs.push(key)
			}
			await hub.configStore.patchServer(scope, name, { [refField]: refs })

			// If server is connected/enabled, refresh so hydrate picks up new secrets
			const live = hub.getAllServers().find((s) => s.name === name && (s.source || "global") === scope)
			if (live && !live.disabled) {
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
						channel,
						key,
						stored: !clear,
						cleared: clear,
						// NEVER echo value
					},
					null,
					2,
				),
			)
		} catch (error) {
			task.recordToolError("set_mcp_secret")
			await handleError("setting MCP secret", error as Error)
			const msg = (error as Error).message?.includes(String(value))
				? "Failed to set MCP secret"
				: (error as Error).message
			pushToolResult(formatResponse.toolError(msg))
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"set_mcp_secret">): Promise<void> {
		const partialMessage = JSON.stringify({
			tool: "setMcpSecret",
			name: block.params.name ?? "",
			scope: block.params.scope ?? "",
			channel: block.params.channel ?? "",
			key: block.params.key ?? "",
		})
		await task.ask("tool", partialMessage, block.partial).catch(() => {})
	}
}

export const setMcpSecretTool = new SetMcpSecretTool()
