import { isSecretStateKey, type ProviderSettings } from "@roo-code/types"

import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
import { getClineProvider } from "./helpers/providerProfileTools"

interface SetProviderSecretParams {
	name: string
	key: string
	value?: string
}

export class SetProviderSecretTool extends BaseTool<"set_provider_secret"> {
	readonly name = "set_provider_secret" as const

	async execute(params: SetProviderSecretParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { askApproval, handleError, pushToolResult } = callbacks
		const name = params.name?.trim()
		const key = params.key?.trim()
		const value = params.value

		try {
			if (!name) {
				task.consecutiveMistakeCount++
				task.recordToolError("set_provider_secret")
				pushToolResult(await task.sayAndCreateMissingParamError("set_provider_secret", "name"))
				return
			}

			if (!key) {
				task.consecutiveMistakeCount++
				task.recordToolError("set_provider_secret")
				pushToolResult(await task.sayAndCreateMissingParamError("set_provider_secret", "key"))
				return
			}

			if (!isSecretStateKey(key)) {
				task.recordToolError("set_provider_secret")
				pushToolResult(
					formatResponse.toolError(
						`"${key}" is not a secret field. Use customEndpointApiKey / openAiApiKey / openRouterApiKey / apiKey, or manage_provider_profile for first-time setup.`,
					),
				)
				return
			}

			const provider = getClineProvider(task)
			const exists = await provider.providerSettingsManager.hasConfig(name)
			if (!exists) {
				task.recordToolError("set_provider_secret")
				pushToolResult(
					formatResponse.toolError(
						`Profile "${name}" does not exist. Create it with manage_provider_profile first.`,
					),
				)
				return
			}

			const clear = value === undefined || value === ""
			const approvalPayload = {
				tool: "setProviderSecret",
				name,
				key,
				// Never put value in approval JSON
				operation: clear ? "clear" : "set",
			}

			const didApprove = await askApproval("tool", JSON.stringify(approvalPayload))
			if (!didApprove) {
				return
			}

			const existing = await provider.providerSettingsManager.getProfile({ name })
			const { name: _n, ...rest } = existing
			const next: ProviderSettings = {
				...(rest as ProviderSettings),
				[key]: clear ? undefined : value,
			}

			// Keep current activation status: only update store, do not force activate
			const state = await provider.getState()
			const isActive = state.currentApiConfigName === name
			const id = await provider.upsertProviderProfile(name, next, isActive)

			if (!id) {
				task.recordToolError("set_provider_secret")
				task.didToolFailInCurrentTurn = true
				pushToolResult(formatResponse.toolError(`Failed to store secret on profile "${name}"`))
				return
			}

			task.consecutiveMistakeCount = 0
			pushToolResult(
				JSON.stringify(
					{
						ok: true,
						name,
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
			task.recordToolError("set_provider_secret")
			await handleError("setting provider secret", error as Error)
			// Ensure we never leak the secret via error message paths that might include params
			const msg = (error as Error).message?.includes(String(value))
				? "Failed to set provider secret"
				: (error as Error).message
			pushToolResult(formatResponse.toolError(msg))
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"set_provider_secret">): Promise<void> {
		const partialMessage = JSON.stringify({
			tool: "setProviderSecret",
			name: block.params.name ?? "",
			key: block.params.key ?? "",
			// omit value always
		})
		await task.ask("tool", partialMessage, block.partial).catch(() => {})
	}
}

export const setProviderSecretTool = new SetProviderSecretTool()
