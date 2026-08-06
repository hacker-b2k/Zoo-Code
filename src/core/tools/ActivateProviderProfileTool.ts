import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
import { getClineProvider } from "./helpers/providerProfileTools"

interface ActivateProviderProfileParams {
	name: string
}

export class ActivateProviderProfileTool extends BaseTool<"activate_provider_profile"> {
	readonly name = "activate_provider_profile" as const

	async execute(params: ActivateProviderProfileParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { askApproval, handleError, pushToolResult } = callbacks
		const name = params.name?.trim()

		try {
			if (!name) {
				task.consecutiveMistakeCount++
				task.recordToolError("activate_provider_profile")
				pushToolResult(await task.sayAndCreateMissingParamError("activate_provider_profile", "name"))
				return
			}

			const provider = getClineProvider(task)
			const exists = await provider.providerSettingsManager.hasConfig(name)
			if (!exists) {
				task.recordToolError("activate_provider_profile")
				pushToolResult(formatResponse.toolError(`Profile "${name}" does not exist`))
				return
			}

			const state = await provider.getState()
			if (state.currentApiConfigName === name) {
				pushToolResult(JSON.stringify({ ok: true, name, alreadyActive: true }, null, 2))
				return
			}

			const didApprove = await askApproval("tool", JSON.stringify({ tool: "activateProviderProfile", name }))
			if (!didApprove) {
				return
			}

			await provider.activateProviderProfile({ name })

			task.consecutiveMistakeCount = 0
			pushToolResult(JSON.stringify({ ok: true, name, activated: true }, null, 2))
		} catch (error) {
			task.recordToolError("activate_provider_profile")
			await handleError("activating provider profile", error as Error)
			pushToolResult(formatResponse.toolError((error as Error).message))
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"activate_provider_profile">): Promise<void> {
		const partialMessage = JSON.stringify({
			tool: "activateProviderProfile",
			name: block.params.name ?? "",
		})
		await task.ask("tool", partialMessage, block.partial).catch(() => {})
	}
}

export const activateProviderProfileTool = new ActivateProviderProfileTool()
