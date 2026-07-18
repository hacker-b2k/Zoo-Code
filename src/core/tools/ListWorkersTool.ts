import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import { getOrchestrationRuntime } from "../orchestration/OrchestrationRuntime"

interface ListWorkersParams {
	include_completed?: boolean | string | null
}

export class ListWorkersTool extends BaseTool<"list_workers"> {
	readonly name = "list_workers" as const

	async execute(params: ListWorkersParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { handleError, pushToolResult } = callbacks

		try {
			const provider = task.providerRef.deref()
			if (!provider) {
				pushToolResult(formatResponse.toolError("Provider reference lost"))
				return
			}

			const runtime =
				typeof (provider as { getOrchestrationRuntime?: () => ReturnType<typeof getOrchestrationRuntime> })
					.getOrchestrationRuntime === "function"
					? (
							provider as { getOrchestrationRuntime: () => ReturnType<typeof getOrchestrationRuntime> }
						).getOrchestrationRuntime()
					: getOrchestrationRuntime(() => provider)
			const parentId = task.isBackgroundWorker ? (task.parentTaskId ?? task.taskId) : task.taskId
			let workers = runtime.listWorkersWithLiveState(parentId)

			const includeCompleted =
				params.include_completed === true ||
				params.include_completed === "true" ||
				params.include_completed === "1"

			if (!includeCompleted) {
				workers = workers.filter(
					(w) => w.state !== "completed" && w.state !== "failed" && w.state !== "cancelled",
				)
			}

			const unread = runtime.listResults(parentId, true).length

			// Compact evidence for main agent (no guessing).
			const evidence = workers.map((w) => {
				const live = w.live
				return {
					workerId: w.workerId,
					name: w.name,
					role: w.role,
					lifecycle: w.state,
					mode: w.mode,
					provider: w.apiConfigName,
					attempt: w.attempt,
					lastError: w.lastError ?? live?.lastError,
					live: live
						? {
								activity: live.activity,
								healthy: live.healthy,
								heartbeatAgeMs: live.heartbeatAgeMs,
								lastHeartbeat: live.lastHeartbeat,
								currentStep: live.currentStep,
								lastToolCall: live.lastToolCall,
								rateLimitUntil: live.rateLimitUntil,
								conversationLength: live.conversationLength,
								filesCreated: live.filesCreated,
								filesModified: live.filesModified,
								recentTools: live.recentTools.slice(-5),
								summary: live.summary,
							}
						: null,
				}
			})

			task.consecutiveMistakeCount = 0
			pushToolResult(
				JSON.stringify(
					{
						ok: true,
						evidenceOnly: true,
						policy: "Use only evidence fields. Do not invent stuck/progress. cancel_worker to stop; get_worker_status for one worker; collect_results for finished outputs.",
						parentTaskId: parentId,
						runningCount: runtime.countRunning(parentId),
						unreadResults: unread,
						workers: evidence,
					},
					null,
					2,
				),
			)
		} catch (error) {
			await handleError("listing workers", error as Error)
			pushToolResult(formatResponse.toolError((error as Error).message))
		}
	}
}

export const listWorkersTool = new ListWorkersTool()
