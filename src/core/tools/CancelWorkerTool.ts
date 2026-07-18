import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
import { getOrchestrationRuntime } from "../orchestration/OrchestrationRuntime"

interface CancelWorkerParams {
	worker_id: string
	reason?: string | null
}

export class CancelWorkerTool extends BaseTool<"cancel_worker"> {
	readonly name = "cancel_worker" as const

	async execute(params: CancelWorkerParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { askApproval, handleError, pushToolResult } = callbacks

		try {
			if (task.isBackgroundWorker) {
				pushToolResult(
					formatResponse.toolError(
						"Background workers cannot cancel other workers. Only the main orchestrator may use cancel_worker.",
					),
				)
				return
			}

			const workerId = params.worker_id?.trim()
			if (!workerId) {
				task.consecutiveMistakeCount++
				task.recordToolError("cancel_worker")
				pushToolResult(await task.sayAndCreateMissingParamError("cancel_worker", "worker_id"))
				return
			}

			const reason = params.reason?.trim() || "Cancelled by main orchestrator"

			const didApprove = await askApproval("tool", JSON.stringify({ tool: "cancelWorker", workerId, reason }))
			if (!didApprove) {
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
					formatResponse.toolError(`No worker with id=${workerId}. Use list_workers for evidence-based ids.`),
				)
				return
			}

			if (snapshot.parentTaskId !== task.taskId) {
				pushToolResult(
					formatResponse.toolError(
						`Worker ${workerId} is not owned by this main task (parent=${snapshot.parentTaskId}).`,
					),
				)
				return
			}

			if (snapshot.state === "completed" || snapshot.state === "failed" || snapshot.state === "cancelled") {
				pushToolResult(
					JSON.stringify(
						{
							ok: false,
							workerId,
							name: snapshot.name,
							state: snapshot.state,
							message: `Worker already terminal (${snapshot.state}); cancel not applied.`,
						},
						null,
						2,
					),
				)
				return
			}

			const cancelled = runtime.cancelWorker(workerId)
			void provider.postStateToWebview().catch(() => {})

			task.consecutiveMistakeCount = 0
			pushToolResult(
				JSON.stringify(
					{
						ok: cancelled,
						workerId,
						name: snapshot.name,
						previousState: snapshot.state,
						state: cancelled ? "cancelled" : snapshot.state,
						reason,
						message: cancelled
							? "Worker cancelled. Evidence: lifecycle set to cancelled and task abort requested."
							: "Cancel failed (worker missing or already terminal).",
					},
					null,
					2,
				),
			)
		} catch (error) {
			await handleError("cancelling worker", error as Error)
			pushToolResult(formatResponse.toolError((error as Error).message))
		}
	}

	override async handlePartial(_task: Task, _block: ToolUse<"cancel_worker">): Promise<void> {
		// no-op
	}
}

export const cancelWorkerTool = new CancelWorkerTool()
