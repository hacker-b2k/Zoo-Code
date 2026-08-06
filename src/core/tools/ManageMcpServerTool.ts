import type { McpActivationIntent } from "@roo-code/types"

import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
import {
	extractSecretMapsFromConfig,
	getMcpHub,
	parseScope,
	redactMcpServerConfig,
	validateCwd,
} from "./helpers/mcpManageTools"

interface ManageMcpServerParams {
	action: "admit" | "update" | "patch"
	name: string
	scope: "project" | "global"
	intent?: "install_only" | "start" | "preserve"
	config: Record<string, unknown>
}

const VALID_ACTIONS = new Set(["admit", "update", "patch"])
const VALID_INTENTS = new Set(["install_only", "start", "preserve"])

export class ManageMcpServerTool extends BaseTool<"manage_mcp_server"> {
	readonly name = "manage_mcp_server" as const

	async execute(params: ManageMcpServerParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { askApproval, handleError, pushToolResult } = callbacks
		const action = params.action
		const name = params.name?.trim()
		const scope = parseScope(params.scope)
		const intentRaw = params.intent
		const configIn = params.config ?? {}

		try {
			if (!action || !VALID_ACTIONS.has(action)) {
				task.consecutiveMistakeCount++
				task.recordToolError("manage_mcp_server")
				pushToolResult(
					formatResponse.toolError(`Invalid action. Use admit | update | patch. Got: ${String(action)}`),
				)
				return
			}

			if (!name) {
				task.consecutiveMistakeCount++
				task.recordToolError("manage_mcp_server")
				pushToolResult(await task.sayAndCreateMissingParamError("manage_mcp_server", "name"))
				return
			}

			if (!scope) {
				task.consecutiveMistakeCount++
				task.recordToolError("manage_mcp_server")
				pushToolResult(
					formatResponse.toolError(`Invalid scope. Use project | global. Got: ${String(params.scope)}`),
				)
				return
			}

			if (intentRaw !== undefined && !VALID_INTENTS.has(intentRaw)) {
				task.consecutiveMistakeCount++
				task.recordToolError("manage_mcp_server")
				pushToolResult(
					formatResponse.toolError(
						`Invalid intent. Use install_only | start | preserve. Got: ${String(intentRaw)}`,
					),
				)
				return
			}

			if (!configIn || typeof configIn !== "object" || Array.isArray(configIn)) {
				task.consecutiveMistakeCount++
				task.recordToolError("manage_mcp_server")
				pushToolResult(formatResponse.toolError("config must be an object of non-secret MCP server fields"))
				return
			}

			if ("cwd" in configIn) {
				try {
					validateCwd(configIn.cwd)
				} catch (e) {
					task.recordToolError("manage_mcp_server")
					pushToolResult(formatResponse.toolError((e as Error).message))
					return
				}
			}

			const hub = getMcpHub(task)
			const existing = await hub.configStore.getServer(scope, name)

			if (action === "update" || action === "patch") {
				if (!existing) {
					task.recordToolError("manage_mcp_server")
					pushToolResult(
						formatResponse.toolError(
							`Server "${name}" does not exist in ${scope}. Use action=admit to create.`,
						),
					)
					return
				}
			}

			const { sanitized, envSecrets, headerSecrets } = extractSecretMapsFromConfig(configIn)
			const secretEnvKeys = Object.keys(envSecrets)
			const secretHeaderKeys = Object.keys(headerSecrets)

			const intent: McpActivationIntent | undefined =
				intentRaw ?? (action === "admit" ? "install_only" : "preserve")

			const approvalPayload = {
				tool: "manageMcpServer",
				action,
				name,
				scope,
				intent,
				config: redactMcpServerConfig(sanitized),
				secretEnvKeys,
				secretHeaderKeys,
				// never include secret values
			}

			const didApprove = await askApproval("tool", JSON.stringify(approvalPayload))
			if (!didApprove) {
				return
			}

			// Prefer vault for secrets when available
			let configForStore = { ...sanitized }
			if (hub.credentialVault && (secretEnvKeys.length > 0 || secretHeaderKeys.length > 0)) {
				// Put secrets back briefly for migratePlaintextFromConfig path
				if (secretEnvKeys.length > 0) {
					configForStore.env = {
						...((configForStore.env as Record<string, string>) ?? {}),
						...envSecrets,
					}
				}
				if (secretHeaderKeys.length > 0) {
					configForStore.headers = {
						...((configForStore.headers as Record<string, string>) ?? {}),
						...headerSecrets,
					}
				}
				configForStore = await hub.credentialVault.migratePlaintextFromConfig(scope, name, configForStore)
			}

			if (action === "patch" && existing) {
				// patch: merge without full admit policy unless intent provided
				if (intentRaw) {
					await hub.configStore.admitServer({
						name,
						config: { ...existing, ...configForStore },
						scope,
						sourceKind: "agent",
						intent,
					})
				} else {
					await hub.configStore.patchServer(scope, name, configForStore)
				}
			} else {
				// admit or update via policy-aware admit
				await hub.configStore.admitServer({
					name,
					config: action === "update" && existing ? { ...existing, ...configForStore } : configForStore,
					scope,
					sourceKind: "agent",
					intent,
				})
			}

			// Refresh hub connections for this scope
			const doc = await hub.configStore.read(scope)
			await hub.updateServerConnections(doc.mcpServers, scope)

			const written = await hub.configStore.getServer(scope, name)
			let live = hub.getAllServers().find((s) => s.name === name && (s.source || "global") === scope)

			// Brief settle for connect when intent=start (stdio spawn is async)
			if (intent === "start" && written?.disabled !== true) {
				for (let i = 0; i < 8; i++) {
					if (live?.status === "connected" || live?.status === ("error" as string)) {
						break
					}
					await new Promise((r) => setTimeout(r, 250))
					live = hub.getAllServers().find((s) => s.name === name && (s.source || "global") === scope)
				}
			}

			const configPathHint =
				scope === "project"
					? "project .roo/mcp.json (workspace MCP config — not app source code)"
					: "global mcp_settings.json (user globalStorage — not app source code)"

			const connectNote =
				intent === "install_only"
					? "Server stored disabled (install_only). Use intent=start or toggle_mcp_server disabled=false to connect."
					: intent === "start" && live?.status !== "connected"
						? "Config saved and start attempted. If status is not connected: use a real MCP server (JSON-RPC over stdio/SSE), not a dummy process. Call refresh_mcp_servers then list_mcp_config. Verify with use_mcp_tool only after connected."
						: "Config written only to MCP settings store + optional SecretStorage. Does not modify application source code."

			task.consecutiveMistakeCount = 0
			pushToolResult(
				JSON.stringify(
					{
						ok: true,
						action,
						name,
						scope,
						intent,
						disabled: written?.disabled === true,
						status: live?.status,
						error: live?.error,
						configPath: configPathHint,
						secretEnvKeysStored: secretEnvKeys,
						secretHeaderKeysStored: secretHeaderKeys,
						config: written ? redactMcpServerConfig(written) : undefined,
						note: connectNote,
					},
					null,
					2,
				),
			)
		} catch (error) {
			task.recordToolError("manage_mcp_server")
			await handleError("managing MCP server", error as Error)
			pushToolResult(formatResponse.toolError((error as Error).message))
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"manage_mcp_server">): Promise<void> {
		const partialMessage = JSON.stringify({
			tool: "manageMcpServer",
			action: block.params.action ?? "",
			name: block.params.name ?? "",
			scope: block.params.scope ?? "",
		})
		await task.ask("tool", partialMessage, block.partial).catch(() => {})
	}
}

export const manageMcpServerTool = new ManageMcpServerTool()
