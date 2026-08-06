import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
import { getClineProvider, redactProviderSettings, modelIdFromSettings } from "./helpers/providerProfileTools"

interface GetProviderProfileParams {
	name: string
}

export class GetProviderProfileTool extends BaseTool<"get_provider_profile"> {
	readonly name = "get_provider_profile" as const

	async execute(params: GetProviderProfileParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { handleError, pushToolResult } = callbacks
		const name = params.name?.trim()

		try {
			if (!name) {
				task.consecutiveMistakeCount++
				task.recordToolError("get_provider_profile")
				pushToolResult(await task.sayAndCreateMissingParamError("get_provider_profile", "name"))
				return
			}

			const provider = getClineProvider(task)
			const profile = await provider.providerSettingsManager.getProfile({ name })
			const state = await provider.getState()
			const { name: profileName, id, ...settings } = profile

			task.consecutiveMistakeCount = 0
			pushToolResult(
				JSON.stringify(
					{
						ok: true,
						name: profileName,
						id,
						active: state.currentApiConfigName === profileName,
						modelId: modelIdFromSettings(settings),
						settings: redactProviderSettings(settings as Record<string, unknown>),
					},
					null,
					2,
				),
			)
		} catch (error) {
			task.recordToolError("get_provider_profile")
			await handleError("getting provider profile", error as Error)
			pushToolResult(formatResponse.toolError((error as Error).message))
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"get_provider_profile">): Promise<void> {
		const name = block.params.name ?? ""
		const partialMessage = JSON.stringify({ tool: "getProviderProfile", name })
		await task.ask("tool", partialMessage, block.partial).catch(() => {})
	}
}

export const getProviderProfileTool = new GetProviderProfileTool()
