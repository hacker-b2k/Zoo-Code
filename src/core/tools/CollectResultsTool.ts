import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import { getOrchestrationRuntime } from "../orchestration/OrchestrationRuntime"

interface CollectResultsParams {
	unread_only?: boolean | string | null
}

export class CollectResultsTool extends BaseTool<"collect_results"> {
	readonly name = "collect_results" as const

	async execute(params: CollectResultsParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { handleError, pushToolResult } = callbacks

		try {
			if (task.isBackgroundWorker) {
				pushToolResult(
					formatResponse.toolError("Background workers should not collect the main inbox. Use main agent."),
				)
				return
			}

			const provider = task.providerRef.deref()
			if (!provider) {
				pushToolResult(formatResponse.toolError("Provider reference lost"))
				return
			}

			const unreadOnly =
				params.unread_only === undefined ||
				params.unread_only === null ||
				params.unread_only === true ||
				params.unread_only === "true" ||
				params.unread_only === "1"

			const runtime =
				typeof (provider as { getOrchestrationRuntime?: () => ReturnType<typeof getOrchestrationRuntime> })
					.getOrchestrationRuntime === "function"
					? (
							provider as { getOrchestrationRuntime: () => ReturnType<typeof getOrchestrationRuntime> }
						).getOrchestrationRuntime()
					: getOrchestrationRuntime(() => provider)
			const text = runtime.collectResults(task.taskId, unreadOnly)
			const remaining = runtime.listResults(task.taskId, true).length
			const workers = runtime.listWorkers(task.taskId)

			task.consecutiveMistakeCount = 0
			pushToolResult(
				JSON.stringify(
					{
						ok: true,
						unreadOnly,
						remainingUnread: remaining,
						activeWorkers: workers.filter(
							(w) =>
								w.state === "running" ||
								w.state === "queued" ||
								w.state === "retrying" ||
								w.state === "switched",
						).length,
						results: text,
					},
					null,
					2,
				),
			)
		} catch (error) {
			await handleError("collecting worker results", error as Error)
			pushToolResult(formatResponse.toolError((error as Error).message))
		}
	}
}

export const collectResultsTool = new CollectResultsTool()
