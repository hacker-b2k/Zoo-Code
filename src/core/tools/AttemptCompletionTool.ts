import * as vscode from "vscode"

import { RooCodeEventName, type HistoryItem } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { Package } from "../../shared/package"
import type { ToolUse } from "../../shared/tools"
import { t } from "../../i18n"

import { BaseTool, ToolCallbacks } from "./BaseTool"

interface AttemptCompletionParams {
	result: string
	command?: string
}

export interface AttemptCompletionCallbacks extends ToolCallbacks {
	askFinishSubTaskApproval: () => Promise<boolean>
	toolDescription: () => string
}

/**
 * Interface for provider methods needed by AttemptCompletionTool for delegation handling.
 */
interface DelegationProvider {
	log(message: string): void
	getTaskWithId(id: string): Promise<{ historyItem: HistoryItem }>
	reopenParentFromDelegation(params: {
		parentTaskId: string
		childTaskId: string
		completionResultSummary: string
	}): Promise<boolean>
}

export class AttemptCompletionTool extends BaseTool<"attempt_completion"> {
	readonly name = "attempt_completion" as const

	async execute(params: AttemptCompletionParams, task: Task, callbacks: AttemptCompletionCallbacks): Promise<void> {
		const { result } = params
		const { handleError, pushToolResult, askFinishSubTaskApproval } = callbacks

		// Prevent attempt_completion if any tool failed in the current turn
		if (task.didToolFailInCurrentTurn) {
			const errorMsg = t("common:errors.attempt_completion_tool_failed")

			await task.say("error", errorMsg)
			pushToolResult(formatResponse.toolError(errorMsg))
			return
		}

		const preventCompletionWithOpenTodos = vscode.workspace
			.getConfiguration(Package.name)
			.get<boolean>("preventCompletionWithOpenTodos", false)

		const hasIncompleteTodos = task.todoList && task.todoList.some((todo) => todo.status !== "completed")

		if (preventCompletionWithOpenTodos && hasIncompleteTodos) {
			task.consecutiveMistakeCount++
			task.recordToolError("attempt_completion")

			pushToolResult(
				formatResponse.toolError(
					"Cannot complete task while there are incomplete todos. Please finish all todos before attempting completion.",
				),
			)

			return
		}

		try {
			if (!result) {
				task.consecutiveMistakeCount++
				task.recordToolError("attempt_completion")
				pushToolResult(await task.sayAndCreateMissingParamError("attempt_completion", "result"))
				return
			}

			task.consecutiveMistakeCount = 0

			// Main orchestrator must not declare victory while implementer workers still run.
			// Legacy role=reviewer workers (if any) do not block main completion; prefer no LLM reviewer.
			if (!task.isBackgroundWorker) {
				try {
					const { getOrchestrationRuntime } = await import("../orchestration/OrchestrationRuntime")
					const provider = task.providerRef.deref()
					const runtime = getOrchestrationRuntime(() => provider as any)
					const running = runtime.countRunningImplementers(task.taskId)
					if (running > 0) {
						const workers = runtime
							.listWorkers(task.taskId)
							.filter(
								(s) =>
									s.role !== "reviewer" &&
									(s.state === "running" ||
										s.state === "retrying" ||
										s.state === "switched" ||
										s.state === "queued"),
							)
						const lines = workers
							.map(
								(w) =>
									`- "${w.name}" id=${w.workerId} state=${w.state}` +
									(w.mode ? ` mode=${w.mode}` : "") +
									(w.apiConfigName ? ` provider=${w.apiConfigName}` : ""),
							)
							.join("\n")
						const err =
							`Cannot attempt_completion while ${running} worker(s) are still active.\n` +
							`${lines}\n\n` +
							`Wait for workers, use list_workers / get_worker_status / collect_results for evidence, ` +
							`or call cancel_worker(worker_id) to stop a worker. ` +
							`Worker completions are also pushed into this chat automatically. ` +
							`Never guess worker status from silence.`
						task.consecutiveMistakeCount++
						task.recordToolError("attempt_completion")
						await task.say("error", err)
						pushToolResult(formatResponse.toolError(err))
						return
					}
				} catch {
					// If orchestration runtime unavailable, allow normal completion.
				}
			}

			await task.say("completion_result", result, undefined, false)

			// Background multi-agent workers: deliver to ResultInbox, do not reopen parent UI
			// and do not run serial subtask delegation / completion_result ask.
			if (task.isBackgroundWorker) {
				try {
					const { getOrchestrationRuntime } = await import("../orchestration/OrchestrationRuntime")
					const provider = task.providerRef.deref()
					const runtime = getOrchestrationRuntime(() => provider as any)
					const wid = task.workerId ?? task.taskId

					// Always-on reviewer: short digest to main, keep task alive and re-cue watch loop.
					if (task.workerRole === "reviewer") {
						runtime.reportReviewerDigest(wid, result)
						const continueCue =
							"REVIEWER DIGEST DELIVERED to Main (kind=review_digest). " +
							"You are still the always-on reviewer — DO NOT stop. " +
							"Immediately call list_workers (and get_worker_status for any risk), " +
							"then attempt_completion again with the next SHORT evidence-only digest. " +
							"Never invent status. Never edit code or spawn/cancel workers."
						pushToolResult(formatResponse.toolResult(continueCue))
						// Soft re-queue so the agent loop continues without waiting for user click.
						try {
							if (typeof task.messageQueueService?.addMessage === "function") {
								task.messageQueueService.addMessage(
									"[system] Continue watching: list_workers → short digest via attempt_completion. Fleet may have changed.",
								)
							}
							const status = String(task.taskStatus ?? "").toLowerCase()
							if (
								typeof task.processQueuedMessages === "function" &&
								(status === "idle" || status === "resumable" || status === "interactive")
							) {
								task.processQueuedMessages()
							}
						} catch {
							// non-fatal — tool result already instructs continue
						}
						return
					}

					// Emit completion before runtime cleanup/dispose so listeners see a live Task.
					this.emitTaskCompleted(task)
					runtime.completeWorker(wid, result)
					pushToolResult(
						formatResponse.toolResult("Worker task completed. Result delivered to orchestrator inbox."),
					)
					return
				} catch (err) {
					const provider = task.providerRef.deref() as { log?: (m: string) => void } | undefined
					provider?.log?.(
						`[AttemptCompletionTool] background worker complete failed: ${(err as Error)?.message ?? err}`,
					)
					// Still avoid parent delegation for workers.
					pushToolResult(formatResponse.toolError("Worker completion failed to register with orchestrator"))
					return
				}
			}

			// Check for subtask using parentTaskId (metadata-driven delegation)
			if (task.parentTaskId) {
				// Check if this subtask has already completed and returned to parent
				// to prevent duplicate tool_results when user revisits from history
				const provider = task.providerRef.deref() as DelegationProvider | undefined
				if (provider) {
					let historyLookupTaskId = task.taskId
					try {
						const { historyItem } = await provider.getTaskWithId(task.taskId)
						const status = historyItem?.status

						if (status === "completed") {
							// Subtask already completed - skip delegation flow entirely
							// Fall through to normal completion ask flow below (outside this if block)
							// This shows the user the completion result and waits for acceptance
							// without injecting another tool_result to the parent
						} else if (status === "active") {
							historyLookupTaskId = task.parentTaskId
							const { historyItem: parentHistory } = await provider.getTaskWithId(task.parentTaskId)

							if (
								(parentHistory?.status === "delegated" || parentHistory?.status === "active") &&
								parentHistory?.awaitingChildId === task.taskId
							) {
								const delegation = await this.delegateToParent(
									task,
									result,
									provider,
									askFinishSubTaskApproval,
									pushToolResult,
								)
								if (delegation === "delegated") {
									this.emitTaskCompleted(task)
								}
								if (delegation !== "continue") return
							} else {
								// Parent already detached, such as when the user cancelled this child.
								// Fall through to the normal completion ask flow.
								const msg =
									`[AttemptCompletionTool] Skipping delegation for child ${task.taskId}: ` +
									`parent ${task.parentTaskId} is not awaiting this child. ` +
									`Diagnostic: { childStatus: "${status}", parentStatus: "${parentHistory?.status}", awaitingChildId: "${parentHistory?.awaitingChildId}" }`
								provider.log(msg)
								console.warn(msg)
							}
						} else {
							// Unexpected status (undefined or "delegated") - log error and skip delegation
							// undefined indicates a bug in status persistence during child creation
							// "delegated" would mean this child has its own grandchild pending (shouldn't reach attempt_completion)
							provider.log(
								`[AttemptCompletionTool] Unexpected child task status "${status}" for task ${task.taskId}. ` +
									`Expected "active" or "completed". Skipping delegation to prevent data corruption.`,
							)
							// Fall through to normal completion ask flow
						}
					} catch (err) {
						// If we can't get the history, log error and skip delegation
						provider.log(
							`[AttemptCompletionTool] Failed to get history for task ${historyLookupTaskId}: ${(err as Error)?.message ?? String(err)}. ` +
								`Skipping delegation.`,
						)
						// Fall through to normal completion ask flow
					}
				}
			}

			const { response, text, images } = await task.ask("completion_result", "", false)

			if (response === "yesButtonClicked") {
				this.emitTaskCompleted(task)
				return
			}

			// User provided feedback - push tool result to continue the conversation
			await task.say("user_feedback", text ?? "", images)

			const feedbackText = `<user_message>\n${text}\n</user_message>`
			pushToolResult(formatResponse.toolResult(feedbackText, images))
		} catch (error) {
			await handleError("inspecting site", error as Error)
		}
	}

	/**
	 * Handles the common delegation flow when a subtask completes.
	 * Returns:
	 * - "delegated" when completion was approved and parent resumed
	 * - "denied" when user denied finishing the subtask
	 * - "continue" when caller should fall through to normal completion ask flow
	 */
	private async delegateToParent(
		task: Task,
		result: string,
		provider: DelegationProvider,
		askFinishSubTaskApproval: () => Promise<boolean>,
		pushToolResult: (result: string) => void,
	): Promise<"delegated" | "denied" | "continue"> {
		const didApprove = await askFinishSubTaskApproval()

		if (!didApprove) {
			pushToolResult(formatResponse.toolDenied())
			return "denied"
		}

		const didReopen = await provider.reopenParentFromDelegation({
			parentTaskId: task.parentTaskId!,
			childTaskId: task.taskId,
			completionResultSummary: result,
		})

		if (didReopen === false) {
			return "continue"
		}

		pushToolResult("")
		return "delegated"
	}

	override async handlePartial(task: Task, block: ToolUse<"attempt_completion">): Promise<void> {
		const result: string | undefined = block.params.result
		const command: string | undefined = block.params.command

		const lastMessage = task.clineMessages.at(-1)

		if (command) {
			if (lastMessage && lastMessage.ask === "command") {
				await task.ask("command", command ?? "", block.partial).catch(() => {})
			} else {
				await task.say("completion_result", result ?? "", undefined, false)
				await task.ask("command", command ?? "", block.partial).catch(() => {})
			}
		} else {
			await task.say("completion_result", result ?? "", undefined, block.partial)
		}
	}

	private emitTaskCompleted(task: Task): void {
		// Force final token usage update before emitting TaskCompleted.
		// This ensures the latest stats are captured regardless of throttle timer.
		task.emitFinalTokenUsageUpdate()

		TelemetryService.instance.captureTaskCompleted(task.taskId)
		task.emit(RooCodeEventName.TaskCompleted, task.taskId, task.getTokenUsage(), task.toolUsage)
	}
}

export const attemptCompletionTool = new AttemptCompletionTool()
