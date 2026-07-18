import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
import { getOrchestrationRuntime } from "../orchestration/OrchestrationRuntime"

interface GetWorkerStatusParams {
	worker_id: string
}

/**
 * Evidence-only worker status. Main must use this (or list_workers) instead of guessing.
 */
export class GetWorkerStatusTool extends BaseTool<"get_worker_status"> {
	readonly name = "get_worker_status" as const

	async execute(params: GetWorkerStatusParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { handleError, pushToolResult } = callbacks

		try {
			const workerId = params.worker_id?.trim()
			if (!workerId) {
				task.consecutiveMistakeCount++
				task.recordToolError("get_worker_status")
				pushToolResult(await task.sayAndCreateMissingParamError("get_worker_status", "worker_id"))
				return
			}

			const provider = task.providerRef.deref()
			if (!provider) {
				pushToolResult(formatResponse.toolError("Provider reference lost"))
				return
			}

			const runtime =
				typeof (provider as { getOrchestrationRuntime?: () => ReturnType<typeof getOrchestrationRuntime> })
					.getOrchestrationRuntime === "function"
					? (
							provider as {
								getOrchestrationRuntime: () => ReturnType<typeof getOrchestrationRuntime>
							}
						).getOrchestrationRuntime()
					: getOrchestrationRuntime(() => provider)

			const snapshot = runtime.getWorker(workerId)
			if (!snapshot) {
				pushToolResult(
					JSON.stringify(
						{
							ok: false,
							workerId,
							message:
								"No worker found with this id. Evidence only — do not invent status. Call list_workers.",
						},
						null,
						2,
					),
				)
				return
			}

			const live = runtime.getWorkerLiveState(workerId)
			const parentId = task.isBackgroundWorker ? (task.parentTaskId ?? task.taskId) : task.taskId
			if (snapshot.parentTaskId !== parentId && !task.isBackgroundWorker) {
				// Main may only inspect its own children (evidence isolation).
				pushToolResult(
					formatResponse.toolError(
						`Worker ${workerId} is not under this main task (parent=${snapshot.parentTaskId}).`,
					),
				)
				return
			}

			task.consecutiveMistakeCount = 0
			pushToolResult(
				JSON.stringify(
					{
						ok: true,
						evidenceOnly: true,
						policy: "Report only fields below. Never say stuck/probably/maybe unless healthy===false or lifecycle terminal with lastError.",
						worker: snapshot,
						live: live ?? null,
						derived: live
							? {
									healthy: live.healthy,
									heartbeatAgeMs: live.heartbeatAgeMs,
									activity: live.activity,
									lifecycle: live.lifecycle,
									rateLimitUntil: live.rateLimitUntil ?? null,
									lastError: live.lastError ?? snapshot.lastError ?? null,
									lastToolCall: live.lastToolCall ?? null,
									currentStep: live.currentStep ?? null,
									filesTouched: [...live.filesCreated, ...live.filesModified, ...live.filesDeleted],
								}
							: {
									healthy: null,
									note: "Live state not registered (worker may predate WorkerStateService).",
								},
					},
					null,
					2,
				),
			)
		} catch (error) {
			await handleError("getting worker status", error as Error)
			pushToolResult(formatResponse.toolError((error as Error).message))
		}
	}

	override async handlePartial(_task: Task, _block: ToolUse<"get_worker_status">): Promise<void> {
		// no-op
	}
}

export const getWorkerStatusTool = new GetWorkerStatusTool()
