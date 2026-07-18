import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
import { getClineProvider } from "./helpers/providerProfileTools"

interface DeleteProviderProfileParams {
	name: string
}

export class DeleteProviderProfileTool extends BaseTool<"delete_provider_profile"> {
	readonly name = "delete_provider_profile" as const

	async execute(params: DeleteProviderProfileParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { askApproval, handleError, pushToolResult } = callbacks
		const name = params.name?.trim()

		try {
			if (!name) {
				task.consecutiveMistakeCount++
				task.recordToolError("delete_provider_profile")
				pushToolResult(await task.sayAndCreateMissingParamError("delete_provider_profile", "name"))
				return
			}

			const provider = getClineProvider(task)
			const list = await provider.providerSettingsManager.listConfig()

			if (!list.some((e) => e.name === name)) {
				task.recordToolError("delete_provider_profile")
				pushToolResult(formatResponse.toolError(`Profile "${name}" does not exist`))
				return
			}

			if (list.length <= 1) {
				task.recordToolError("delete_provider_profile")
				pushToolResult(formatResponse.toolError("Cannot delete the last remaining provider profile"))
				return
			}

			const didApprove = await askApproval("tool", JSON.stringify({ tool: "deleteProviderProfile", name }))
			if (!didApprove) {
				return
			}

			const remaining = list.filter((c) => c.name !== name)
			const nextName = remaining[0]?.name
			if (!nextName) {
				task.recordToolError("delete_provider_profile")
				pushToolResult(formatResponse.toolError("Cannot delete the last remaining provider profile"))
				return
			}

			// Same path as webview deleteApiConfiguration (deleteConfig + activate to refresh meta)
			await provider.providerSettingsManager.deleteConfig(name)
			const state = await provider.getState()
			const activateName =
				state.currentApiConfigName === name || !remaining.some((r) => r.name === state.currentApiConfigName)
					? nextName
					: (state.currentApiConfigName ?? nextName)
			await provider.activateProviderProfile({ name: activateName })

			task.consecutiveMistakeCount = 0
			pushToolResult(
				JSON.stringify(
					{
						ok: true,
						deleted: name,
						activeProfile: (await provider.getState()).currentApiConfigName,
					},
					null,
					2,
				),
			)
		} catch (error) {
			task.recordToolError("delete_provider_profile")
			await handleError("deleting provider profile", error as Error)
			pushToolResult(formatResponse.toolError((error as Error).message))
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"delete_provider_profile">): Promise<void> {
		const partialMessage = JSON.stringify({
			tool: "deleteProviderProfile",
			name: block.params.name ?? "",
		})
		await task.ask("tool", partialMessage, block.partial).catch(() => {})
	}
}

export const deleteProviderProfileTool = new DeleteProviderProfileTool()
