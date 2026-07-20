import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import { listProviderTypesPayload } from "./helpers/providerProfileTools"

export class ListProviderTypesTool extends BaseTool<"list_provider_types"> {
	readonly name = "list_provider_types" as const

	async execute(_params: Record<string, never>, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { handleError, pushToolResult } = callbacks

		try {
			task.consecutiveMistakeCount = 0
			pushToolResult(JSON.stringify({ ok: true, ...listProviderTypesPayload() }, null, 2))
		} catch (error) {
			await handleError("listing provider types", error as Error)
			pushToolResult(formatResponse.toolError((error as Error).message))
		}
	}
}

export const listProviderTypesTool = new ListProviderTypesTool()
