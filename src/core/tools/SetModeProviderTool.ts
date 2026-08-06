import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { getModeBySlug } from "../../shared/modes"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
import { getClineProvider } from "./helpers/providerProfileTools"

interface SetModeProviderParams {
	mode_slug: string
	name: string
}

export class SetModeProviderTool extends BaseTool<"set_mode_provider"> {
	readonly name = "set_mode_provider" as const

	async execute(params: SetModeProviderParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { askApproval, handleError, pushToolResult } = callbacks
		const mode_slug = params.mode_slug?.trim()
		const name = params.name?.trim()

		try {
			if (!mode_slug) {
				task.consecutiveMistakeCount++
				task.recordToolError("set_mode_provider")
				pushToolResult(await task.sayAndCreateMissingParamError("set_mode_provider", "mode_slug"))
				return
			}

			if (!name) {
				task.consecutiveMistakeCount++
				task.recordToolError("set_mode_provider")
				pushToolResult(await task.sayAndCreateMissingParamError("set_mode_provider", "name"))
				return
			}

			const provider = getClineProvider(task)
			const state = await provider.getState()
			const mode = getModeBySlug(mode_slug, state.customModes)
			if (!mode) {
				task.recordToolError("set_mode_provider")
				pushToolResult(formatResponse.toolError(`Invalid mode: ${mode_slug}`))
				return
			}

			const profile = await provider.providerSettingsManager.getProfile({ name }).catch(() => null)
			if (!profile?.id) {
				task.recordToolError("set_mode_provider")
				pushToolResult(formatResponse.toolError(`Profile "${name}" does not exist`))
				return
			}

			const didApprove = await askApproval(
				"tool",
				JSON.stringify({ tool: "setModeProvider", mode_slug, name, profileId: profile.id }),
			)
			if (!didApprove) {
				return
			}

			await provider.providerSettingsManager.setModeConfig(mode_slug, profile.id)

			task.consecutiveMistakeCount = 0
			pushToolResult(
				JSON.stringify(
					{
						ok: true,
						mode_slug,
						name,
						profileId: profile.id,
					},
					null,
					2,
				),
			)
		} catch (error) {
			task.recordToolError("set_mode_provider")
			await handleError("setting mode provider", error as Error)
			pushToolResult(formatResponse.toolError((error as Error).message))
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"set_mode_provider">): Promise<void> {
		const partialMessage = JSON.stringify({
			tool: "setModeProvider",
			mode_slug: block.params.mode_slug ?? "",
			name: block.params.name ?? "",
		})
		await task.ask("tool", partialMessage, block.partial).catch(() => {})
	}
}

export const setModeProviderTool = new SetModeProviderTool()
