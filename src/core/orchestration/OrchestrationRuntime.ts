/**
 * OrchestrationRuntime - multi-agent worker registry + lifecycle.
 *
 * Separation of concerns:
 * - Main orchestrator: spawn / list / collect tools
 * - Workers: execute only (isBackgroundWorker Tasks)
 * - ProviderManager: provider resolve + failover policy
 * - ResultInbox: aggregation for main agent
 */

import { EventEmitter } from "events"
import { v7 as uuidv7 } from "uuid"

import type { ProviderSettings } from "@roo-code/types"
import type { Task } from "../task/Task"
import type { ClineProvider } from "../webview/ClineProvider"
import { ProviderManager } from "./ProviderManager"
import { ResultInbox } from "./ResultInbox"
import { WorkerStateService, type WorkerLiveState } from "./WorkerStateService"
import {
	DEFAULT_ORCHESTRATION_SETTINGS,
	type OrchestrationSettings,
	type SpawnWorkerParams,
	type WorkerLifecycleState,
	type WorkerResult,
	type WorkerRole,
	type WorkerSnapshot,
} from "./types"

export type WorkerHandle = {
	snapshot: WorkerSnapshot
	task?: Task
	sameProviderRetryCount: number
	providerSwitchCount: number
	abortRequested: boolean
}

export class OrchestrationRuntime extends EventEmitter {
	readonly inbox = new ResultInbox()
	readonly providerManager: ProviderManager
	/** Single source of truth for live worker progress (heartbeats, tools, files). */
	readonly workerState = new WorkerStateService()

	private readonly workers = new Map<string, WorkerHandle>()
	private settings: OrchestrationSettings = { ...DEFAULT_ORCHESTRATION_SETTINGS }
	private getProvider: () => ClineProvider | undefined

	constructor(getProvider: () => ClineProvider | undefined) {
		super()
		this.getProvider = getProvider
		// Profile loader bound lazily so manager can be constructed before provider ready
		this.providerManager = new ProviderManager({
			getProfile: async (params) => {
				const p = this.requireProvider()
				return p.providerSettingsManager.getProfile(params)
			},
			listConfig: async () => {
				const p = this.requireProvider()
				return p.providerSettingsManager.listConfig()
			},
		})
	}

	/** Rebind provider accessor (singleton may outlive a WeakRef target). */
	setProviderGetter(getProvider: () => ClineProvider | undefined): void {
		this.getProvider = getProvider
	}

	updateSettings(partial: Partial<OrchestrationSettings>): void {
		this.settings = { ...this.settings, ...partial }
		this.providerManager.updateSettings(this.settings)
	}

	/**
	 * Pull worker-enabled API config names from ClineProvider global state into settings.
	 * Safe no-op if provider/context unavailable.
	 */
	syncWorkerPoolFromProvider(): void {
		try {
			const provider = this.getProvider() as ClineProvider | undefined
			const getValue = (provider as { contextProxy?: { getValue?: (k: string) => unknown } })?.contextProxy
				?.getValue
			if (typeof getValue !== "function") {
				return
			}
			const workerMap = (getValue.call(
				(provider as { contextProxy: { getValue: (k: string) => unknown } }).contextProxy,
				"workerEnabledApiConfigs",
			) ?? {}) as Record<string, boolean>
			const enabledNames = Object.keys(workerMap).filter((k) => workerMap[k])
			// Always apply (including empty) so UI un-toggles take effect.
			this.updateSettings({ workerEnabledProviderNames: enabledNames })
		} catch {
			// Non-fatal
		}
	}

	getSettings(): OrchestrationSettings {
		return { ...this.settings }
	}

	/** Lifecycle snapshot for a worker (not the internal handle). */
	getWorker(workerId: string): WorkerSnapshot | undefined {
		const handle = this.workers.get(workerId)
		return handle ? { ...handle.snapshot } : undefined
	}

	listWorkers(parentTaskId?: string): WorkerSnapshot[] {
		const all = [...this.workers.values()].map((w) => ({ ...w.snapshot }))
		return parentTaskId ? all.filter((s) => s.parentTaskId === parentTaskId) : all
	}

	/**
	 * Evidence-based worker listing for the main agent (lifecycle + live state).
	 * Prefer this over guessing from chat silence.
	 */
	listWorkersWithLiveState(parentTaskId?: string): Array<WorkerSnapshot & { live?: WorkerLiveState }> {
		return this.listWorkers(parentTaskId).map((s) => {
			const live = this.workerState.get(s.workerId)
			return live ? { ...s, live } : { ...s }
		})
	}

	getWorkerLiveState(workerId: string): WorkerLiveState | undefined {
		return this.workerState.getEvidence(workerId)
	}

	/** Report live activity from a worker Task (heartbeat / tools / LLM). */
	reportWorkerActivity(
		workerId: string,
		kind:
			| "heartbeat"
			| "llm_request"
			| "llm_response"
			| "tool_start"
			| "tool_end"
			| "rate_limited"
			| "waiting_user"
			| "file"
			| "activity",
		payload?: Record<string, unknown>,
	): void {
		if (!this.workers.has(workerId) && !this.workerState.get(workerId)) {
			return
		}
		switch (kind) {
			case "heartbeat":
				this.workerState.heartbeat(workerId, {
					activity: payload?.activity as any,
					currentStep: payload?.currentStep as string | undefined,
					conversationLength: payload?.conversationLength as number | undefined,
					model: payload?.model as string | undefined,
					provider: payload?.provider as string | undefined,
				})
				break
			case "llm_request":
				this.workerState.markLlmRequest(workerId, payload?.model as string | undefined)
				break
			case "llm_response":
				this.workerState.markLlmResponse(workerId, payload as any)
				break
			case "tool_start":
				this.workerState.markToolStart(
					workerId,
					String(payload?.tool ?? "tool"),
					payload?.argsSummary as string | undefined,
				)
				break
			case "tool_end":
				this.workerState.markToolEnd(
					workerId,
					String(payload?.tool ?? "tool"),
					payload?.success !== false,
					payload?.error as string | undefined,
				)
				break
			case "rate_limited":
				this.workerState.markRateLimited(
					workerId,
					payload?.untilMs as number | undefined,
					payload?.reason as string | undefined,
				)
				break
			case "waiting_user":
				this.workerState.setActivity(workerId, "waiting_user", payload?.reason as string | undefined)
				break
			case "file":
				this.workerState.recordFileChange(
					workerId,
					String(payload?.path ?? ""),
					(payload?.action as "created" | "modified" | "deleted" | "renamed") ?? "modified",
				)
				break
			case "activity":
				this.workerState.setActivity(
					workerId,
					(payload?.activity as any) ?? "thinking",
					payload?.detail as string | undefined,
				)
				break
		}
		this.emit("workerActivity", { workerId, kind, payload })
	}

	countRunning(parentTaskId?: string): number {
		return this.listWorkers(parentTaskId).filter(
			(s) => s.state === "running" || s.state === "retrying" || s.state === "switched" || s.state === "queued",
		).length
	}

	/** Active implementers only (excludes always-on reviewers) - used for parallel limits + main completion gate. */
	countRunningImplementers(parentTaskId?: string): number {
		return this.listWorkers(parentTaskId).filter(
			(s) =>
				s.role !== "reviewer" &&
				(s.state === "running" || s.state === "retrying" || s.state === "switched" || s.state === "queued"),
		).length
	}

	/** Active always-on reviewers for a main task. */
	listActiveReviewers(parentTaskId: string): WorkerSnapshot[] {
		return this.listWorkers(parentTaskId).filter(
			(s) =>
				s.role === "reviewer" &&
				(s.state === "running" || s.state === "retrying" || s.state === "switched" || s.state === "queued"),
		)
	}

	/**
	 * Spawn a background worker without disposing the main (UI) task.
	 */
	async spawnWorker(params: SpawnWorkerParams): Promise<WorkerSnapshot> {
		if (!this.settings.enabled) {
			throw new Error("Orchestration is disabled")
		}

		const provider = this.requireProvider()
		// Prefer the parent Task by id (tool passes main.taskId). getCurrentTask() can
		// briefly be a focused background worker after WorkerSwitcher / focusLiveTask,
		// which incorrectly produced "parent mismatch" instead of one-reviewer errors.
		const parent =
			(typeof provider.findLiveTask === "function" ? provider.findLiveTask(params.parentTaskId) : undefined) ??
			provider.getCurrentTask()
		if (!parent) {
			throw new Error("No current main task to attach workers to")
		}
		if (parent.taskId !== params.parentTaskId) {
			throw new Error(
				`spawn_worker parent mismatch: expected parent ${params.parentTaskId}, got resolved ${parent.taskId}`,
			)
		}
		if (parent.isBackgroundWorker) {
			throw new Error("Background workers cannot spawn nested workers")
		}

		const roleEarly: WorkerRole = params.role === "reviewer" ? "reviewer" : "worker"
		// One always-on reviewer per main task (watch+report only).
		if (roleEarly === "reviewer") {
			const activeReviewers = this.listActiveReviewers(params.parentTaskId)
			if (activeReviewers.length > 0) {
				const r = activeReviewers[0]
				throw new Error(
					`An always-on reviewer is already running: "${r.name}" id=${r.workerId}. ` +
						`Use list_workers / get_worker_status, or cancel_worker before spawning another.`,
				)
			}
		} else if (this.countRunningImplementers(params.parentTaskId) >= this.settings.maxParallelWorkers) {
			throw new Error(
				`Max parallel workers (${this.settings.maxParallelWorkers}) reached for this main task. Collect/cancel some first.`,
			)
		}

		const name = params.name?.trim()
		if (!name) {
			throw new Error("Worker name is required")
		}
		if (!params.message?.trim()) {
			throw new Error("Worker message is required")
		}

		// Always sync worker-enabled pool from global state before resolve (spawn tools
		// may call getOrchestrationRuntime without ClineProvider.getOrchestrationRuntime).
		this.syncWorkerPoolFromProvider()

		const state = await provider.getState()
		const currentApiConfigName =
			(await parent.getTaskApiConfigName?.().catch(() => undefined)) ?? state.currentApiConfigName ?? "default"

		// Load-balance: count active implementers per profile so new spawns spread across pool.
		// Reviewers are excluded so they don't skew provider distribution for builders.
		const loadBalanceUsage: Record<string, number> = {}
		for (const s of this.listWorkers(params.parentTaskId)) {
			if (
				s.role !== "reviewer" &&
				(s.state === "running" || s.state === "retrying" || s.state === "switched" || s.state === "queued")
			) {
				const n = s.apiConfigName
				if (n) {
					loadBalanceUsage[n] = (loadBalanceUsage[n] ?? 0) + 1
				}
			}
		}

		// Never hard-pin from agent apiConfigName - resolveInitial load-balances when 2+ profiles.
		const resolution = await this.providerManager.resolveInitial({
			preferredApiConfigName: undefined,
			fallbackApiConfigNames: params.fallbackApiConfigNames,
			currentApiConfigName,
			loadBalanceUsage,
		})

		const fallbackChain = this.providerManager.buildChain({
			preferred: resolution.apiConfigName,
			perWorkerFallback: params.fallbackApiConfigNames,
			current: currentApiConfigName,
		})

		const workerId = uuidv7()
		const now = Date.now()
		const role: WorkerRole = roleEarly
		// Default workers to code mode so they get read/edit tools even when main is orchestrator.
		// Reviewers default to ask (read-only groups); tools are also stripped by role.
		const workerMode =
			role === "reviewer" ? (params.mode?.trim() || "ask").trim() : (params.mode?.trim() || "code").trim()

		const snapshot: WorkerSnapshot = {
			workerId,
			parentTaskId: params.parentTaskId,
			name,
			role,
			state: "queued",
			mode: workerMode,
			apiConfigName: resolution.apiConfigName,
			fallbackIndex: Math.max(0, fallbackChain.indexOf(resolution.apiConfigName)),
			fallbackChain,
			reviewTargetId: params.reviewTargetId,
			attempt: 0,
			createdAt: now,
			updatedAt: now,
		}

		const handle: WorkerHandle = {
			snapshot,
			sameProviderRetryCount: 0,
			providerSwitchCount: 0,
			abortRequested: false,
		}
		this.workers.set(workerId, handle)

		// Register live state SSOT before task starts so main can list immediately.
		this.workerState.ensure({
			workerId,
			parentTaskId: params.parentTaskId,
			name,
			role,
			lifecycle: "queued",
			provider: resolution.apiConfigName,
			mode: workerMode,
			taskTitle: name,
		})

		const message =
			role === "reviewer" ? this.buildReviewerSpawnMessage(params.message, params.reviewTargetId) : params.message

		// Create Task off the single-open UI stack
		const task = await provider.createBackgroundWorkerTask({
			workerId,
			parentTask: parent,
			message,
			mode: workerMode,
			apiConfiguration: resolution.settings as ProviderSettings,
			apiConfigName: resolution.apiConfigName,
			customTitle: name,
			workerRole: role,
			reviewTargetId: params.reviewTargetId,
		})

		handle.task = task
		this.setState(workerId, "running")
		this.workerState.heartbeat(workerId, {
			activity: "thinking",
			currentStep: "started",
			provider: resolution.apiConfigName,
		})

		// Lifecycle: AttemptCompletionTool.completeWorker is primary; these are backups.
		const { RooCodeEventName } = await import("@roo-code/types")
		task.on(RooCodeEventName.TaskCompleted, (id: string) => {
			if (id === task.taskId) {
				void this.onWorkerTaskCompleted(workerId, task)
			}
		})
		task.on(RooCodeEventName.TaskAborted, () => {
			void this.onWorkerTaskAborted(workerId)
		})

		this.emit("workerSpawned", { ...snapshot })
		return { ...snapshot, state: "running" }
	}

	/**
	 * Called by Task when a background worker hits an API error.
	 * Returns whether the Task should retry the stream (true) or rethrow/fail (false).
	 */
	async handleWorkerApiFailure(
		workerId: string,
		error: unknown,
	): Promise<{
		shouldRetry: boolean
		backoffMs?: number
		appliedProvider?: string
	}> {
		const handle = this.workers.get(workerId)
		if (!handle || handle.abortRequested) {
			return { shouldRetry: false }
		}

		const decision = await this.providerManager.resolveOnFailure({
			worker: handle.snapshot,
			error,
			sameProviderRetryCount: handle.sameProviderRetryCount,
			providerSwitchCount: handle.providerSwitchCount,
		})

		if (decision.action === "retry_same") {
			handle.sameProviderRetryCount++
			handle.snapshot.attempt++
			this.setState(workerId, "retrying", decision.reason)
			this.inbox.push({
				workerId,
				parentTaskId: handle.snapshot.parentTaskId,
				name: handle.snapshot.name,
				role: handle.snapshot.role,
				kind: "retrying",
				error: decision.reason,
				apiConfigName: handle.snapshot.apiConfigName,
				attempt: handle.snapshot.attempt,
			})
			this.emit("workerRetrying", { workerId, reason: decision.reason })
			return { shouldRetry: true, backoffMs: decision.backoffMs }
		}

		if (decision.action === "switch" && decision.apiConfigName && decision.settings && handle.task) {
			const prev = handle.snapshot.apiConfigName
			handle.providerSwitchCount++
			handle.sameProviderRetryCount = 0
			handle.snapshot.apiConfigName = decision.apiConfigName
			handle.snapshot.fallbackIndex = handle.snapshot.fallbackChain.indexOf(decision.apiConfigName)
			handle.snapshot.attempt++
			this.setState(workerId, "switched", decision.reason)
			this.workerState.setProvider(workerId, decision.apiConfigName)

			// Apply provider only on this worker task - never global UI profile
			handle.task.updateApiConfiguration(decision.settings as ProviderSettings)
			handle.task.setTaskApiConfigName(decision.apiConfigName)

			this.inbox.push({
				workerId,
				parentTaskId: handle.snapshot.parentTaskId,
				name: handle.snapshot.name,
				role: handle.snapshot.role,
				kind: "provider_switched",
				summary: `Switched provider ${prev} -> ${decision.apiConfigName}: ${decision.reason}`,
				apiConfigName: decision.apiConfigName,
				previousApiConfigName: prev,
				error: decision.reason,
				attempt: handle.snapshot.attempt,
			})
			this.emit("workerProviderSwitched", {
				workerId,
				from: prev,
				to: decision.apiConfigName,
				reason: decision.reason,
			})

			this.setState(workerId, "running")
			return { shouldRetry: true, appliedProvider: decision.apiConfigName }
		}

		// No retry path available - fail the worker.
		this.failWorker(workerId, decision.reason ?? String(error))
		return { shouldRetry: false }
	}

	/**
	 * Always-on reviewer: push a short digest to main without ending the reviewer task.
	 * Main receives [worker_event kind=review_digest ...] via ResultInbox + auto-inject.
	 */
	reportReviewerDigest(workerId: string, summary: string): void {
		const handle = this.workers.get(workerId)
		if (!handle) {
			return
		}
		if (handle.snapshot.role !== "reviewer") {
			// Non-reviewers must use completeWorker.
			this.completeWorker(workerId, summary)
			return
		}
		if (
			handle.snapshot.state === "completed" ||
			handle.snapshot.state === "failed" ||
			handle.snapshot.state === "cancelled"
		) {
			return
		}
		handle.snapshot.attempt++
		handle.snapshot.updatedAt = Date.now()
		this.workerState.setActivity(workerId, "thinking", {
			currentStep: "review_digest_sent",
			summary: summary.slice(0, 400),
		})
		const entry = this.inbox.push({
			workerId,
			parentTaskId: handle.snapshot.parentTaskId,
			name: handle.snapshot.name,
			role: "reviewer",
			kind: "review_digest",
			summary,
			apiConfigName: handle.snapshot.apiConfigName,
			attempt: handle.snapshot.attempt,
		})
		this.emit("reviewerDigest", { workerId, summary })
		void this.notifyParentAndWake(entry)
		// Intentionally do NOT complete or cleanup - reviewer stays alive.
	}

	/**
	 * Mark worker completed from attempt_completion / TaskCompleted.
	 */
	completeWorker(workerId: string, summary: string): void {
		const handle = this.workers.get(workerId)
		if (!handle) {
			return
		}
		if (handle.snapshot.state === "completed" || handle.snapshot.state === "failed") {
			return
		}
		// Reviewers that still call completeWorker: treat as final report + end (cancel path).
		handle.snapshot.attempt++
		this.setState(workerId, "completed")
		const entry = this.inbox.push({
			workerId,
			parentTaskId: handle.snapshot.parentTaskId,
			name: handle.snapshot.name,
			role: handle.snapshot.role,
			kind: "completed",
			summary,
			apiConfigName: handle.snapshot.apiConfigName,
			attempt: handle.snapshot.attempt,
		})
		this.emit("workerCompleted", { workerId, summary })
		void this.notifyParentAndWake(entry)
		void this.cleanupTask(handle)
	}

	failWorker(workerId: string, error: string): void {
		const handle = this.workers.get(workerId)
		if (!handle) {
			return
		}
		if (handle.snapshot.state === "completed" || handle.snapshot.state === "failed") {
			return
		}
		this.setState(workerId, "failed", error)
		const entry = this.inbox.push({
			workerId,
			parentTaskId: handle.snapshot.parentTaskId,
			name: handle.snapshot.name,
			role: handle.snapshot.role,
			kind: "failed",
			error,
			apiConfigName: handle.snapshot.apiConfigName,
			attempt: handle.snapshot.attempt,
		})
		this.emit("workerFailed", { workerId, error })
		void this.notifyParentAndWake(entry)
		void this.cleanupTask(handle)
	}

	/**
	 * Worker needs user/orchestrator input (followup). Does not end the worker.
	 */
	workerQuestion(workerId: string, question: string): void {
		const handle = this.workers.get(workerId)
		if (!handle) {
			return
		}
		const entry = this.inbox.push({
			workerId,
			parentTaskId: handle.snapshot.parentTaskId,
			name: handle.snapshot.name,
			role: handle.snapshot.role,
			kind: "question",
			summary: question,
			apiConfigName: handle.snapshot.apiConfigName,
			attempt: handle.snapshot.attempt,
		})
		this.emit("workerQuestion", { workerId, question })
		void this.notifyParentAndWake(entry)
	}

	cancelWorker(workerId: string): boolean {
		const handle = this.workers.get(workerId)
		if (!handle) {
			return false
		}
		if (handle.snapshot.state === "completed" || handle.snapshot.state === "failed") {
			return false
		}
		handle.abortRequested = true
		this.setState(workerId, "cancelled")
		try {
			handle.task?.cancelCurrentRequest?.()
			handle.task?.abortTask?.()
		} catch {
			// ignore
		}
		const entry = this.inbox.push({
			workerId,
			parentTaskId: handle.snapshot.parentTaskId,
			name: handle.snapshot.name,
			role: handle.snapshot.role,
			kind: "cancelled",
			error: "Cancelled by orchestrator",
			apiConfigName: handle.snapshot.apiConfigName,
			attempt: handle.snapshot.attempt,
		})
		this.emit("workerCancelled", { workerId })
		void this.notifyParentAndWake(entry)
		void this.cleanupTask(handle)
		return true
	}

	/**
	 * Peek inbox results without draining (used by list_workers / collect_results remaining count).
	 */
	listResults(parentTaskId: string, unreadOnly = false): import("./types").WorkerResult[] {
		return this.inbox.peek(parentTaskId, unreadOnly)
	}

	collectResults(parentTaskId: string, unreadOnly = true): string {
		const results = this.inbox.collect(parentTaskId, { unreadOnly, markRead: true })
		return this.inbox.formatForAgent(results)
	}

	private async notifyParentAndWake(entry: {
		workerId: string
		parentTaskId: string
		name: string
		role: WorkerRole
		kind: string
		summary?: string
		error?: string
		apiConfigName?: string
		attempt: number
	}): Promise<void> {
		if (!this.settings.autoInjectResultsWhenIdle) {
			return
		}

		try {
			const provider = this.getProvider()
			if (!provider) {
				return
			}

			const parent =
				provider.findLiveTask?.(entry.parentTaskId) ??
				(provider.getCurrentTask?.()?.taskId === entry.parentTaskId ? provider.getCurrentTask() : undefined)

			if (!parent || parent.isBackgroundWorker) {
				return
			}

			const body =
				entry.kind === "completed" || entry.kind === "review_digest"
					? (entry.summary ?? "(empty summary)")
					: entry.kind === "failed" || entry.kind === "cancelled"
						? (entry.error ?? entry.summary ?? "failed")
						: (entry.summary ?? entry.error ?? entry.kind)

			const notice =
				`[worker_event kind=${entry.kind} worker="${entry.name}" id=${entry.workerId}` +
				` role=${entry.role}` +
				(entry.apiConfigName ? ` provider=${entry.apiConfigName}` : "") +
				` attempt=${entry.attempt}]\n${body}\n\n` +
				(entry.kind === "review_digest"
					? `(Reviewer digest only - worker still watching. Use list_workers / get_worker_status for evidence; do not treat as final worker completion.)`
					: `(Also stored in ResultInbox - use collect_results to drain unread. ` +
						`Reply to the worker if it asked a question, or continue orchestration.)`)

			// UI breadcrumb when main is focused
			try {
				await parent.say?.("text", notice, undefined, false, undefined, undefined, {
					isNonInteractive: true,
				})
			} catch {
				// non-fatal
			}

			// If main is blocked on an ask (completion_result / followup / idle), fulfill it
			// so the agent loop can continue with the worker notice as user message.
			const ask = parent.taskAsk
			if (ask) {
				try {
					// submitUserMessage answers pending ask and continues the loop (do not also queue).
					await parent.submitUserMessage?.(notice)
					return
				} catch {
					// fall through
				}
			}

			// Not blocked: queue for next drain so main sees it on next turn without stealing focus mid-stream.
			try {
				if (typeof parent.messageQueueService?.addMessage === "function") {
					parent.messageQueueService.addMessage(notice)
				}
				// If main is idle/blocked, process queue when possible
				const status = String(parent.taskStatus ?? "").toLowerCase()
				if (
					typeof parent.processQueuedMessages === "function" &&
					(status === "idle" || status === "resumable" || status === "interactive")
				) {
					parent.processQueuedMessages()
				}
				void provider.postStateToWebview?.()
			} catch {
				// ignore
			}
		} catch (err) {
			console.error(`[OrchestrationRuntime#notifyParentAndWake] failed: ${(err as Error)?.message ?? err}`)
		}
	}

	/**
	 * Legacy always-on reviewer spawn wrap. Not default multi-agent policy —
	 * provider failover is owned by ProviderManager; prefer ResultInbox events.
	 */
	private buildReviewerSpawnMessage(userMessage: string, reviewTargetId?: string): string {
		const targetLine = reviewTargetId
			? `\nOptional focus workerId: ${reviewTargetId} (still watch the whole fleet; dig deeper on this id when relevant).`
			: ""
		return (
			`[ALWAYS-ON REVIEWER ROLE - SYSTEM] (LEGACY / optional — not recommended as default)\n` +
			`You are a legacy fleet watcher. You are NOT the boss and NOT an implementer.\n` +
			`Provider failover is NOT your job — runtime ProviderManager owns retry/switch on 429/503/timeout.\n` +
			`Rules:\n` +
			`1. Watch only: call list_workers and get_worker_status. Use ONLY evidence fields (lifecycle, activity, heartbeat, tools, rate_limited, waiting_user, files, lastError, summary).\n` +
			`2. Never invent stuck/progress from silence. Never spawn_worker, cancel_worker, collect_results, or edit/run code.\n` +
			`3. Prefer rare, state-change digests only (completed/failed/switched). Do NOT spam periodic "both healthy" digests.\n` +
			`4. Digests go to Main via attempt_completion (kind=review_digest); your task may stay alive until cancelled.\n` +
			`5. Prefer brief, actionable reports over long essays.${targetLine}\n\n` +
			`--- Main's brief ---\n` +
			`${userMessage.trim()}`
		)
	}

	private async onWorkerTaskCompleted(workerId: string, task: Task): Promise<void> {
		const handle = this.workers.get(workerId)
		if (!handle || handle.snapshot.state === "completed") {
			return
		}
		// Prefer last completion_result message
		const last = [...(task.clineMessages ?? [])].reverse().find((m) => m.say === "completion_result")
		const summary = last?.text ?? "Worker finished (no summary)"
		// Reviewer should normally stay alive via reportReviewerDigest; if the task
		// still completes (abort path / legacy), treat as final completion.
		this.completeWorker(workerId, summary)
	}

	private requireProvider(): ClineProvider {
		const p = this.getProvider()
		if (!p) {
			throw new Error("ClineProvider not available")
		}
		return p
	}

	private setState(workerId: string, state: WorkerLifecycleState, lastError?: string): void {
		const handle = this.workers.get(workerId)
		if (!handle) {
			return
		}
		handle.snapshot.state = state
		handle.snapshot.updatedAt = Date.now()
		if (lastError !== undefined) {
			handle.snapshot.lastError = lastError
		}
		// Keep WorkerStateService in lockstep with lifecycle (SSOT for main agent).
		this.workerState.setLifecycle(workerId, state, lastError)
		if (handle.snapshot.apiConfigName) {
			this.workerState.setProvider(workerId, handle.snapshot.apiConfigName)
		}
	}

	private async onWorkerTaskAborted(workerId: string): Promise<void> {
		const handle = this.workers.get(workerId)
		if (!handle) {
			return
		}
		if (
			handle.snapshot.state === "completed" ||
			handle.snapshot.state === "failed" ||
			handle.snapshot.state === "cancelled"
		) {
			return
		}
		this.failWorker(workerId, handle.snapshot.lastError ?? "Worker aborted")
	}

	private async cleanupTask(handle: WorkerHandle): Promise<void> {
		const task = handle.task
		if (!task) {
			return
		}
		try {
			// Ensure background worker is not left running
			if (!task.abort) {
				task.abortReason = "user_cancelled"
				await task.abortTask?.(true)
			}
		} catch {
			// non-fatal
		}
		handle.task = undefined
	}
}

/** Singleton accessor attached later on ClineProvider */
let runtimeSingleton: OrchestrationRuntime | undefined

export function getOrchestrationRuntime(getProvider: () => ClineProvider | undefined): OrchestrationRuntime {
	if (!runtimeSingleton) {
		runtimeSingleton = new OrchestrationRuntime(getProvider)
	} else {
		runtimeSingleton.setProviderGetter(getProvider)
	}
	return runtimeSingleton
}

export function resetOrchestrationRuntimeForTests(): void {
	runtimeSingleton = undefined
}
