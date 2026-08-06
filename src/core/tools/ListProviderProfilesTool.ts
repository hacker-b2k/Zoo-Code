import type { ProviderSettingsEntry } from "@roo-code/types"

import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import { getClineProvider, summarizeProfileEntry } from "./helpers/providerProfileTools"

export class ListProviderProfilesTool extends BaseTool<"list_provider_profiles"> {
	readonly name = "list_provider_profiles" as const

	async execute(_params: Record<string, never>, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { handleError, pushToolResult } = callbacks

		try {
			const provider = getClineProvider(task)
			const list: ProviderSettingsEntry[] = await provider.providerSettingsManager.listConfig()
			const state = await provider.getState()
			const current = state.currentApiConfigName

			const profiles = list.map((entry) =>
				summarizeProfileEntry({
					...entry,
					active: entry.name === current,
				}),
			)

			task.consecutiveMistakeCount = 0
			pushToolResult(
				JSON.stringify(
					{
						ok: true,
						currentApiConfigName: current,
						profiles,
					},
					null,
					2,
				),
			)
		} catch (error) {
			await handleError("listing provider profiles", error as Error)
			pushToolResult(formatResponse.toolError((error as Error).message))
		}
	}
}

export const listProviderProfilesTool = new ListProviderProfilesTool()
