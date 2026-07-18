/**
 * Multi-agent orchestration types.
 * Workers execute only; ProviderManager owns failover policy.
 */

export type WorkerRole = "worker" | "reviewer"

export type WorkerLifecycleState = "queued" | "running" | "retrying" | "switched" | "completed" | "failed" | "cancelled"

export type WorkerResultKind =
	| "completed"
	| "failed"
	| "cancelled"
	| "retrying"
	| "provider_switched"
	| "question"
	/** Always-on reviewer short status digest (does not end the reviewer). */
	| "review_digest"

export interface WorkerResult {
	workerId: string
	parentTaskId: string
	name: string
	role: WorkerRole
	kind: WorkerResultKind
	summary?: string
	error?: string
	apiConfigName?: string
	previousApiConfigName?: string
	attempt: number
	ts: number
	/** When true, collect_results should surface this to the main agent. */
	unread: boolean
}

export interface SpawnWorkerParams {
	parentTaskId: string
	name: string
	message: string
	mode?: string
	apiConfigName?: string
	fallbackApiConfigNames?: string[]
	role?: WorkerRole
	reviewTargetId?: string
}

export interface WorkerSnapshot {
	workerId: string
	parentTaskId: string
	name: string
	role: WorkerRole
	state: WorkerLifecycleState
	/** Sticky mode for this worker (defaults to code when spawn omits mode). */
	mode?: string
	apiConfigName?: string
	fallbackIndex: number
	fallbackChain: string[]
	reviewTargetId?: string
	attempt: number
	lastError?: string
	createdAt: number
	updatedAt: number
}

export interface OrchestrationSettings {
	enabled: boolean
	maxParallelWorkers: number
	/** Ordered provider profile names for failover (after preferred). */
	providerFallbackChain: string[]
	/**
	 * Provider profile names the user enabled for the worker pool.
	 * Empty = allow all profiles (backward compatible).
	 * When non-empty, resolveInitial / failover only use these names
	 * (plus any explicit preferred name for that spawn).
	 */
	workerEnabledProviderNames: string[]
	/** Same-provider retries before asking ProviderManager for a switch. */
	maxSameProviderRetries: number
	/** Hard cap on provider switches per worker. */
	maxProviderSwitches: number
	autoInjectResultsWhenIdle: boolean
}

export const DEFAULT_ORCHESTRATION_SETTINGS: OrchestrationSettings = {
	enabled: true,
	maxParallelWorkers: 8,
	providerFallbackChain: [],
	workerEnabledProviderNames: [],
	maxSameProviderRetries: 2,
	maxProviderSwitches: 5,
	// Push worker complete/fail/question into main and wake when idle/blocked.
	autoInjectResultsWhenIdle: true,
}

export type ProviderFailureClass =
	| "transient"
	| "rate_limit"
	| "auth"
	| "model_unavailable"
	| "non_retryable"
	| "unknown"

export interface ProviderResolution {
	apiConfigName: string
	/** Settings object from ProviderSettingsManager (caller builds handler). */
	settings: Record<string, unknown>
}

export interface ProviderFailoverDecision {
	action: "retry_same" | "switch" | "fail"
	apiConfigName?: string
	settings?: Record<string, unknown>
	reason: string
	failureClass: ProviderFailureClass
	backoffMs?: number
}
