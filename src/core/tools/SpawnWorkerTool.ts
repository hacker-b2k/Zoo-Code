import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
import { getOrchestrationRuntime } from "../orchestration/OrchestrationRuntime"

interface SpawnWorkerParams {
	name: string
	message: string
	mode?: string | null
	api_config_name?: string | null
	fallback_api_config_names?: string | null
	role?: string | null
	review_target_id?: string | null
}

function parseFallbackNames(raw?: string | null): string[] | undefined {
	if (!raw?.trim()) {
		return undefined
	}
	// Accept JSON array or comma-separated list
	const t = raw.trim()
	if (t.startsWith("[")) {
		try {
			const parsed = JSON.parse(t)
			if (Array.isArray(parsed)) {
				return parsed.map(String).filter((s) => s.trim())
			}
		} catch {
			// fall through
		}
	}
	return t
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean)
}

export class SpawnWorkerTool extends BaseTool<"spawn_worker"> {
	readonly name = "spawn_worker" as const

	async execute(params: SpawnWorkerParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { askApproval, handleError, pushToolResult } = callbacks

		try {
			if (task.isBackgroundWorker) {
				pushToolResult(
					formatResponse.toolError(
						"Background workers cannot spawn nested workers. Only the main orchestrator may use spawn_worker.",
					),
				)
				return
			}

			const name = params.name?.trim()
			const message = params.message?.trim()
			if (!name) {
				task.consecutiveMistakeCount++
				task.recordToolError("spawn_worker")
				pushToolResult(await task.sayAndCreateMissingParamError("spawn_worker", "name"))
				return
			}
			if (!message) {
				task.consecutiveMistakeCount++
				task.recordToolError("spawn_worker")
				pushToolResult(await task.sayAndCreateMissingParamError("spawn_worker", "message"))
				return
			}

			const role = params.role === "reviewer" ? "reviewer" : "worker"
			// Default code mode when omitted so workers get file tools under orchestrator main.
			const workerMode = params.mode?.trim() || "code"
			const toolMessage = JSON.stringify({
				tool: "spawnWorker",
				name,
				role,
				mode: workerMode,
				apiConfigName: params.api_config_name ?? null,
				fallback: params.fallback_api_config_names ?? null,
				messagePreview: message.slice(0, 200),
			})

			const didApprove = await askApproval("tool", toolMessage)
			if (!didApprove) {
				return
			}

			const provider = task.providerRef.deref()
			if (!provider) {
				pushToolResult(formatResponse.toolError("Provider reference lost"))
				return
			}

			// Prefer provider.getOrchestrationRuntime so worker-enabled pool is synced from global state.
			const runtime =
				typeof (provider as { getOrchestrationRuntime?: () => ReturnType<typeof getOrchestrationRuntime> })
					.getOrchestrationRuntime === "function"
					? (
							provider as { getOrchestrationRuntime: () => ReturnType<typeof getOrchestrationRuntime> }
						).getOrchestrationRuntime()
					: getOrchestrationRuntime(() => provider)
			runtime.syncWorkerPoolFromProvider?.()
			const snapshot = await runtime.spawnWorker({
				parentTaskId: task.taskId,
				name,
				message,
				mode: workerMode,
				// Runtime always load-balances across worker pool / all profiles.
				// Ignore agent api_config_name — models pin every worker to one provider.
				apiConfigName: undefined,
				fallbackApiConfigNames: parseFallbackNames(params.fallback_api_config_names),
				role,
				reviewTargetId: params.review_target_id ?? undefined,
			})

			// Refresh WorkerSwitcher list without stealing focus from main.
			void provider.postStateToWebview().catch(() => {})

			task.consecutiveMistakeCount = 0
			pushToolResult(
				JSON.stringify(
					{
						ok: true,
						workerId: snapshot.workerId,
						name: snapshot.name,
						role: snapshot.role,
						state: snapshot.state,
						mode: snapshot.mode ?? workerMode,
						apiConfigName: snapshot.apiConfigName,
						fallbackChain: snapshot.fallbackChain,
						message:
							"Worker spawned in background (mode sticky for tools/prompt). Main continues. Completions/errors/questions are pushed to this chat; also use list_workers / collect_results.",
					},
					null,
					2,
				),
			)
		} catch (error) {
			await handleError("spawning worker", error as Error)
			pushToolResult(formatResponse.toolError((error as Error).message))
		}
	}

	override async handlePartial(_task: Task, _block: ToolUse<"spawn_worker">): Promise<void> {
		// no-op
	}
}

export const spawnWorkerTool = new SpawnWorkerTool()
