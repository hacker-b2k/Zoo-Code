/**
 * WorkerStateService — single source of truth for live worker progress.
 *
 * Main agent / UI / history must read this (via OrchestrationRuntime tools),
 * never guess from chat text or silence.
 */

import type { WorkerLifecycleState, WorkerRole } from "./types"

export type WorkerActivity =
	| "idle"
	| "thinking"
	| "waiting_llm"
	| "calling_tool"
	| "editing_file"
	| "running_terminal"
	| "rate_limited"
	| "retrying"
	| "switched_provider"
	| "waiting_user"
	| "completed"
	| "failed"
	| "cancelled"

export type WorkerEventType =
	| "spawned"
	| "started"
	| "heartbeat"
	| "activity"
	| "llm_request"
	| "llm_response"
	| "tool_start"
	| "tool_end"
	| "file_created"
	| "file_modified"
	| "file_deleted"
	| "rate_limited"
	| "retry"
	| "provider_switched"
	| "step"
	| "summary"
	| "completed"
	| "failed"
	| "cancelled"
	| "error"

export interface WorkerEvent {
	type: WorkerEventType
	ts: number
	message?: string
	data?: Record<string, unknown>
}

export interface WorkerToolRecord {
	tool: string
	argsSummary?: string
	startedAt: number
	endedAt?: number
	durationMs?: number
	success?: boolean
	error?: string
}

export interface WorkerFileChange {
	path: string
	action: "created" | "modified" | "deleted" | "renamed"
	ts: number
	fromPath?: string
}

export interface WorkerLiveState {
	workerId: string
	parentTaskId: string
	name: string
	role: WorkerRole
	/** Lifecycle from OrchestrationRuntime snapshot (authoritative). */
	lifecycle: WorkerLifecycleState
	activity: WorkerActivity
	provider?: string
	model?: string
	mode?: string
	taskTitle?: string
	startedAt: number
	updatedAt: number
	lastHeartbeat: number
	lastLlmRequestAt?: number
	lastLlmResponseAt?: number
	lastToolCall?: string
	lastToolAt?: number
	currentStep?: string
	currentObjective?: string
	percentComplete?: number
	waitingReason?: string
	retryCount: number
	providerSwitchCount: number
	lastError?: string
	rateLimitUntil?: number
	estimatedRemaining?: string
	tokenUsage?: { input?: number; output?: number; total?: number }
	cost?: number
	conversationLength: number
	filesCreated: string[]
	filesModified: string[]
	filesDeleted: string[]
	recentTools: WorkerToolRecord[]
	recentEvents: WorkerEvent[]
	/** Short rolling summary for orchestrator without full chat. */
	summary: {
		completed: string[]
		inProgress: string[]
		remaining: string[]
		risks: string[]
		nextAction?: string
	}
	healthy: boolean
	/** Soft health: heartbeat age ms; unhealthy if too old while active. */
	heartbeatAgeMs: number
}

const MAX_EVENTS = 80
const MAX_TOOLS = 40
const MAX_FILES = 100
const MAX_SUMMARY_ITEMS = 20
/** Worker considered unhealthy if no heartbeat while active past this. */
export const WORKER_HEARTBEAT_STALE_MS = 45_000

export class WorkerStateService {
	private readonly states = new Map<string, WorkerLiveState>()

	ensure(params: {
		workerId: string
		parentTaskId: string
		name: string
		role: WorkerRole
		lifecycle: WorkerLifecycleState
		provider?: string
		mode?: string
		taskTitle?: string
	}): WorkerLiveState {
		const existing = this.states.get(params.workerId)
		if (existing) {
			existing.name = params.name
			existing.role = params.role
			existing.lifecycle = params.lifecycle
			if (params.provider !== undefined) existing.provider = params.provider
			if (params.mode !== undefined) existing.mode = params.mode
			if (params.taskTitle !== undefined) existing.taskTitle = params.taskTitle
			existing.updatedAt = Date.now()
			return this.refreshHealth(existing)
		}

		const now = Date.now()
		const state: WorkerLiveState = {
			workerId: params.workerId,
			parentTaskId: params.parentTaskId,
			name: params.name,
			role: params.role,
			lifecycle: params.lifecycle,
			activity: params.lifecycle === "queued" ? "idle" : "thinking",
			provider: params.provider,
			mode: params.mode,
			taskTitle: params.taskTitle ?? params.name,
			startedAt: now,
			updatedAt: now,
			lastHeartbeat: now,
			retryCount: 0,
			providerSwitchCount: 0,
			conversationLength: 0,
			filesCreated: [],
			filesModified: [],
			filesDeleted: [],
			recentTools: [],
			recentEvents: [],
			summary: {
				completed: [],
				inProgress: [],
				remaining: [],
				risks: [],
			},
			healthy: true,
			heartbeatAgeMs: 0,
		}
		this.pushEvent(state, { type: "spawned", message: "Worker registered" })
		this.states.set(params.workerId, state)
		return state
	}

	get(workerId: string): WorkerLiveState | undefined {
		const s = this.states.get(workerId)
		return s ? this.clone(this.refreshHealth(s)) : undefined
	}

	list(parentTaskId?: string): WorkerLiveState[] {
		const all = [...this.states.values()].map((s) => this.clone(this.refreshHealth(s)))
		return parentTaskId ? all.filter((s) => s.parentTaskId === parentTaskId) : all
	}

	/** Full evidence payload for main agent tools (no guessing). */
	getEvidence(workerId: string): WorkerLiveState | undefined {
		return this.get(workerId)
	}

	setLifecycle(workerId: string, lifecycle: WorkerLifecycleState, lastError?: string): void {
		const s = this.states.get(workerId)
		if (!s) return
		s.lifecycle = lifecycle
		s.updatedAt = Date.now()
		if (lastError !== undefined) s.lastError = lastError

		if (lifecycle === "retrying") {
			s.activity = "retrying"
			s.retryCount++
			this.pushEvent(s, { type: "retry", message: lastError })
		} else if (lifecycle === "switched") {
			s.activity = "switched_provider"
			s.providerSwitchCount++
			this.pushEvent(s, { type: "provider_switched", message: lastError })
		} else if (lifecycle === "running") {
			if (s.activity === "idle" || s.activity === "retrying" || s.activity === "switched_provider") {
				s.activity = "thinking"
			}
		} else if (lifecycle === "completed") {
			s.activity = "completed"
			s.percentComplete = 100
			s.healthy = true
			this.pushEvent(s, { type: "completed", message: lastError })
		} else if (lifecycle === "failed") {
			s.activity = "failed"
			s.healthy = false
			this.pushEvent(s, { type: "failed", message: lastError })
		} else if (lifecycle === "cancelled") {
			s.activity = "cancelled"
			this.pushEvent(s, { type: "cancelled", message: lastError })
		}
	}

	setProvider(workerId: string, provider?: string, model?: string): void {
		const s = this.states.get(workerId)
		if (!s) return
		if (provider !== undefined) s.provider = provider
		if (model !== undefined) s.model = model
		s.updatedAt = Date.now()
	}

	heartbeat(
		workerId: string,
		patch?: Partial<
			Pick<
				WorkerLiveState,
				| "activity"
				| "currentStep"
				| "currentObjective"
				| "percentComplete"
				| "waitingReason"
				| "conversationLength"
				| "model"
				| "provider"
			>
		>,
	): void {
		const s = this.states.get(workerId)
		if (!s) return
		const now = Date.now()
		s.lastHeartbeat = now
		s.updatedAt = now
		if (patch) {
			if (patch.activity !== undefined) s.activity = patch.activity
			if (patch.currentStep !== undefined) s.currentStep = patch.currentStep
			if (patch.currentObjective !== undefined) s.currentObjective = patch.currentObjective
			if (patch.percentComplete !== undefined) s.percentComplete = patch.percentComplete
			if (patch.waitingReason !== undefined) s.waitingReason = patch.waitingReason
			if (patch.conversationLength !== undefined) s.conversationLength = patch.conversationLength
			if (patch.model !== undefined) s.model = patch.model
			if (patch.provider !== undefined) s.provider = patch.provider
		}
		this.pushEvent(s, { type: "heartbeat", message: s.activity })
		this.refreshHealth(s)
	}

	setActivity(workerId: string, activity: WorkerActivity, detail?: string): void {
		const s = this.states.get(workerId)
		if (!s) return
		s.activity = activity
		s.updatedAt = Date.now()
		s.lastHeartbeat = s.updatedAt
		if (detail) s.currentStep = detail
		if (activity === "rate_limited") {
			this.pushEvent(s, { type: "rate_limited", message: detail })
		} else if (activity === "waiting_user") {
			s.waitingReason = detail ?? s.waitingReason
		} else {
			this.pushEvent(s, { type: "activity", message: detail ?? activity })
		}
	}

	markLlmRequest(workerId: string, model?: string): void {
		const s = this.states.get(workerId)
		if (!s) return
		const now = Date.now()
		s.lastLlmRequestAt = now
		s.lastHeartbeat = now
		s.updatedAt = now
		s.activity = "waiting_llm"
		if (model) s.model = model
		this.pushEvent(s, { type: "llm_request", message: model })
	}

	markLlmResponse(
		workerId: string,
		usage?: { input?: number; output?: number; total?: number; cost?: number },
	): void {
		const s = this.states.get(workerId)
		if (!s) return
		const now = Date.now()
		s.lastLlmResponseAt = now
		s.lastHeartbeat = now
		s.updatedAt = now
		if (s.activity === "waiting_llm") s.activity = "thinking"
		if (usage) {
			s.tokenUsage = {
				input: (s.tokenUsage?.input ?? 0) + (usage.input ?? 0),
				output: (s.tokenUsage?.output ?? 0) + (usage.output ?? 0),
				total: (s.tokenUsage?.total ?? 0) + (usage.total ?? (usage.input ?? 0) + (usage.output ?? 0)),
			}
			if (usage.cost !== undefined) s.cost = (s.cost ?? 0) + usage.cost
		}
		this.pushEvent(s, { type: "llm_response" })
	}

	markRateLimited(workerId: string, untilMs?: number, reason?: string): void {
		const s = this.states.get(workerId)
		if (!s) return
		s.activity = "rate_limited"
		s.rateLimitUntil = untilMs
		s.waitingReason = reason ?? "rate_limit"
		s.lastError = reason
		s.updatedAt = Date.now()
		s.lastHeartbeat = s.updatedAt
		this.pushEvent(s, { type: "rate_limited", message: reason, data: { untilMs } })
	}

	markToolStart(workerId: string, tool: string, argsSummary?: string): void {
		const s = this.states.get(workerId)
		if (!s) return
		const now = Date.now()
		s.lastToolCall = tool
		s.lastToolAt = now
		s.lastHeartbeat = now
		s.updatedAt = now
		s.activity = tool.includes("command")
			? "running_terminal"
			: tool.includes("write") || tool.includes("edit") || tool.includes("apply") || tool.includes("diff")
				? "editing_file"
				: "calling_tool"
		s.currentStep = `tool:${tool}`
		const rec: WorkerToolRecord = { tool, argsSummary, startedAt: now }
		s.recentTools.push(rec)
		if (s.recentTools.length > MAX_TOOLS) s.recentTools.splice(0, s.recentTools.length - MAX_TOOLS)
		this.pushEvent(s, { type: "tool_start", message: tool, data: argsSummary ? { argsSummary } : undefined })
	}

	markToolEnd(workerId: string, tool: string, success: boolean, error?: string): void {
		const s = this.states.get(workerId)
		if (!s) return
		const now = Date.now()
		s.lastHeartbeat = now
		s.updatedAt = now
		const open = [...s.recentTools].reverse().find((t) => t.tool === tool && t.endedAt === undefined)
		if (open) {
			open.endedAt = now
			open.durationMs = now - open.startedAt
			open.success = success
			open.error = error
		}
		if (!success && error) s.lastError = error
		if (s.activity === "calling_tool" || s.activity === "editing_file" || s.activity === "running_terminal") {
			s.activity = "thinking"
		}
		this.pushEvent(s, { type: "tool_end", message: tool, data: { success, error } })
	}

	recordFileChange(workerId: string, path: string, action: WorkerFileChange["action"]): void {
		const s = this.states.get(workerId)
		if (!s) return
		const list = action === "created" ? s.filesCreated : action === "deleted" ? s.filesDeleted : s.filesModified
		if (!list.includes(path)) {
			list.push(path)
			if (list.length > MAX_FILES) list.splice(0, list.length - MAX_FILES)
		}
		s.updatedAt = Date.now()
		const type: WorkerEventType =
			action === "created" ? "file_created" : action === "deleted" ? "file_deleted" : "file_modified"
		this.pushEvent(s, { type, message: path })
	}

	updateSummary(workerId: string, patch: Partial<WorkerLiveState["summary"]> & { nextAction?: string }): void {
		const s = this.states.get(workerId)
		if (!s) return
		if (patch.completed) s.summary.completed = this.capList(patch.completed, MAX_SUMMARY_ITEMS)
		if (patch.inProgress) s.summary.inProgress = this.capList(patch.inProgress, MAX_SUMMARY_ITEMS)
		if (patch.remaining) s.summary.remaining = this.capList(patch.remaining, MAX_SUMMARY_ITEMS)
		if (patch.risks) s.summary.risks = this.capList(patch.risks, MAX_SUMMARY_ITEMS)
		if (patch.nextAction !== undefined) s.summary.nextAction = patch.nextAction
		s.updatedAt = Date.now()
		this.pushEvent(s, { type: "summary", message: patch.nextAction })
	}

	setConversationLength(workerId: string, length: number): void {
		const s = this.states.get(workerId)
		if (!s) return
		s.conversationLength = length
		s.updatedAt = Date.now()
	}

	remove(workerId: string): void {
		this.states.delete(workerId)
	}

	private pushEvent(s: WorkerLiveState, event: Omit<WorkerEvent, "ts"> & { ts?: number }): void {
		s.recentEvents.push({ ...event, ts: event.ts ?? Date.now() })
		if (s.recentEvents.length > MAX_EVENTS) {
			s.recentEvents.splice(0, s.recentEvents.length - MAX_EVENTS)
		}
	}

	private refreshHealth(s: WorkerLiveState): WorkerLiveState {
		const now = Date.now()
		s.heartbeatAgeMs = now - s.lastHeartbeat
		const terminal = s.lifecycle === "completed" || s.lifecycle === "failed" || s.lifecycle === "cancelled"
		if (terminal) {
			s.healthy = s.lifecycle === "completed" || s.lifecycle === "cancelled"
			return s
		}
		s.healthy = s.heartbeatAgeMs <= WORKER_HEARTBEAT_STALE_MS
		return s
	}

	private capList(items: string[], max: number): string[] {
		return items.length > max ? items.slice(-max) : items
	}

	private clone(s: WorkerLiveState): WorkerLiveState {
		return {
			...s,
			filesCreated: [...s.filesCreated],
			filesModified: [...s.filesModified],
			filesDeleted: [...s.filesDeleted],
			recentTools: s.recentTools.map((t) => ({ ...t })),
			recentEvents: s.recentEvents.map((e) => ({ ...e, data: e.data ? { ...e.data } : undefined })),
			summary: {
				completed: [...s.summary.completed],
				inProgress: [...s.summary.inProgress],
				remaining: [...s.summary.remaining],
				risks: [...s.summary.risks],
				nextAction: s.summary.nextAction,
			},
			tokenUsage: s.tokenUsage ? { ...s.tokenUsage } : undefined,
		}
	}
}
