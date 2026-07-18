/**
 * Provider Manager / Resolver
 *
 * Owns provider selection and failover policy.
 * Workers must NOT implement failover — they report failures here.
 */

import type { ProviderSettingsManager } from "../config/ProviderSettingsManager"
import type {
	OrchestrationSettings,
	ProviderFailoverDecision,
	ProviderFailureClass,
	ProviderResolution,
	WorkerSnapshot,
} from "./types"
import { DEFAULT_ORCHESTRATION_SETTINGS } from "./types"

export type ProfileLoader = Pick<ProviderSettingsManager, "getProfile" | "listConfig">

export class ProviderManager {
	/** Monotonic counter so equal-usage spawns still rotate providers (RR). */
	private assignSequence = 0

	constructor(
		private readonly profileLoader: ProfileLoader,
		private settings: OrchestrationSettings = { ...DEFAULT_ORCHESTRATION_SETTINGS },
	) {}

	updateSettings(partial: Partial<OrchestrationSettings>): void {
		this.settings = { ...this.settings, ...partial }
	}

	getSettings(): OrchestrationSettings {
		return { ...this.settings }
	}

	/**
	 * Resolve initial provider for a new worker.
	 *
	 * Runtime ALWAYS owns distribution when 2+ candidate profiles exist:
	 * - Candidate set = worker-enabled pool if non-empty, else all listed profiles.
	 * - Pick least-used (active worker counts). Agent `preferred` is IGNORED for hard pin
	 *   (orchestrators stamp the same api_config_name on every worker).
	 * - Ties break by pool order then round-robin sequence (not preferred name).
	 * - Single candidate: that profile only.
	 * - Preferred outside a non-empty worker pool is never used.
	 */
	async resolveInitial(params: {
		preferredApiConfigName?: string
		fallbackApiConfigNames?: string[]
		currentApiConfigName?: string
		/** Running-worker counts by profile name (for least-used assignment). */
		loadBalanceUsage?: Record<string, number>
	}): Promise<ProviderResolution> {
		const pool = this.settings.workerEnabledProviderNames ?? []
		const preferredRaw = params.preferredApiConfigName?.trim() || undefined
		// Preferred only meaningful when inside pool (or pool empty — still not hard pin if multi).
		const preferredInPool =
			preferredRaw && pool.length > 0 && pool.includes(preferredRaw) ? preferredRaw : undefined
		const usage = params.loadBalanceUsage ?? {}

		const tryLoad = async (name: string): Promise<ProviderResolution | undefined> => {
			try {
				const profile = await this.profileLoader.getProfile({ name })
				const { name: _n, ...settings } = profile as { name: string } & Record<string, unknown>
				return { apiConfigName: name, settings }
			} catch {
				return undefined
			}
		}

		const listAllNames = async (): Promise<string[]> => {
			try {
				const listed = await this.profileLoader.listConfig()
				return listed.map((e) => e.name).filter(Boolean)
			} catch {
				return []
			}
		}

		// Prefer user worker toggles; if none, diversify across every saved profile.
		let diversifyPool = pool.length > 0 ? [...pool] : await listAllNames()
		// De-dupe preserve order
		diversifyPool = diversifyPool.filter((n, i, arr) => n && arr.indexOf(n) === i)

		const pickLeastUsed = async (candidates: string[]): Promise<ProviderResolution | undefined> => {
			if (candidates.length === 0) {
				return undefined
			}
			const seq = this.assignSequence++
			const sorted = [...candidates].sort((a, b) => {
				const ua = usage[a] ?? 0
				const ub = usage[b] ?? 0
				if (ua !== ub) {
					return ua - ub
				}
				// Round-robin on ties so N parallel/serial spawns at usage=0 still spread.
				const ia = candidates.indexOf(a)
				const ib = candidates.indexOf(b)
				const ra = (ia - (seq % candidates.length) + candidates.length) % candidates.length
				const rb = (ib - (seq % candidates.length) + candidates.length) % candidates.length
				if (ra !== rb) {
					return ra - rb
				}
				return ia - ib
			})
			for (const name of sorted) {
				const loaded = await tryLoad(name)
				if (loaded) {
					return loaded
				}
			}
			return undefined
		}

		// 2+ candidates → always load-balance (agent pin ignored).
		if (diversifyPool.length >= 2) {
			const balanced = await pickLeastUsed(diversifyPool)
			if (balanced) {
				return balanced
			}
		}

		// Single candidate in pool / list.
		if (diversifyPool.length === 1) {
			const only = await tryLoad(diversifyPool[0])
			if (only) {
				return only
			}
		}

		// Fallback chain (legacy / broken profile names in pool).
		const candidates = this.buildChain({
			preferred: preferredInPool ?? preferredRaw,
			perWorkerFallback: params.fallbackApiConfigNames,
			current: params.currentApiConfigName,
		})
		const filtered = pool.length === 0 ? candidates : candidates.filter((n) => pool.includes(n))
		const ordered =
			pool.length === 0
				? filtered
				: filtered.length === 0
					? [...pool]
					: [...filtered, ...pool.filter((n) => !filtered.includes(n))]

		if (ordered.length > 1) {
			const balanced = await pickLeastUsed(ordered)
			if (balanced) {
				return balanced
			}
		}

		for (const name of ordered) {
			const loaded = await tryLoad(name)
			if (loaded) {
				return loaded
			}
		}

		if (pool.length > 0) {
			for (const name of pool) {
				const loaded = await tryLoad(name)
				if (loaded) {
					return loaded
				}
			}
			throw new Error(
				`[ProviderManager] No worker-enabled provider profiles available. Enable providers with the worker toggle in the API config selector. Configured: ${pool.join(", ")}`,
			)
		}

		const listed = await this.profileLoader.listConfig()
		if (listed.length > 0) {
			const entry = listed[0]
			const profile = await this.profileLoader.getProfile({ name: entry.name })
			const { name: _n, ...settings } = profile as { name: string } & Record<string, unknown>
			return { apiConfigName: entry.name, settings }
		}

		throw new Error("[ProviderManager] No provider profiles available")
	}

	/**
	 * Policy decision after a worker API failure.
	 * Workers call this instead of switching providers themselves.
	 */
	async resolveOnFailure(params: {
		worker: Pick<WorkerSnapshot, "apiConfigName" | "fallbackChain" | "fallbackIndex" | "attempt">
		error: unknown
		sameProviderRetryCount: number
		providerSwitchCount: number
	}): Promise<ProviderFailoverDecision> {
		const failureClass = classifyProviderFailure(params.error)
		const message = errorMessage(params.error)

		if (failureClass === "non_retryable") {
			return {
				action: "fail",
				reason: message,
				failureClass,
			}
		}

		// Rate limit / quota: switch immediately when another profile exists in the chain
		// so parallel workers do not all hammer the same provider for maxSame retries.
		const hasNextProvider = params.worker.fallbackIndex + 1 < (params.worker.fallbackChain?.length ?? 0)
		const maxSame = failureClass === "rate_limit" && hasNextProvider ? 0 : this.settings.maxSameProviderRetries
		const canRetrySame =
			(failureClass === "transient" || failureClass === "rate_limit" || failureClass === "unknown") &&
			params.sameProviderRetryCount < maxSame

		if (canRetrySame) {
			return {
				action: "retry_same",
				apiConfigName: params.worker.apiConfigName,
				reason: message,
				failureClass,
				backoffMs: computeBackoffMs(params.sameProviderRetryCount, failureClass, params.error),
			}
		}

		if (params.providerSwitchCount >= this.settings.maxProviderSwitches) {
			return {
				action: "fail",
				reason: `Max provider switches (${this.settings.maxProviderSwitches}) reached: ${message}`,
				failureClass,
			}
		}

		const chain = params.worker.fallbackChain
		const nextIndex = params.worker.fallbackIndex + 1
		if (nextIndex >= chain.length) {
			return {
				action: "fail",
				reason: `Provider chain exhausted: ${message}`,
				failureClass,
			}
		}

		const nextName = chain[nextIndex]
		try {
			const profile = await this.profileLoader.getProfile({ name: nextName })
			const { name: _n, ...settings } = profile as { name: string } & Record<string, unknown>
			return {
				action: "switch",
				apiConfigName: nextName,
				settings,
				reason: message,
				failureClass,
			}
		} catch (err) {
			// Skip broken profile: recurse with advanced index via synthetic worker state
			return this.resolveOnFailure({
				...params,
				worker: {
					...params.worker,
					fallbackIndex: nextIndex,
				},
				providerSwitchCount: params.providerSwitchCount + 1,
				error: err,
			})
		}
	}

	/**
	 * Build ordered unique chain of profile names for a worker.
	 * Appends user-enabled worker pool names so multi-provider failover works without manual fallback lists.
	 */
	buildChain(params: { preferred?: string; perWorkerFallback?: string[]; current?: string }): string[] {
		const ordered: string[] = []
		const push = (n?: string) => {
			if (n && n.trim() && !ordered.includes(n.trim())) {
				ordered.push(n.trim())
			}
		}

		push(params.preferred)
		for (const n of params.perWorkerFallback ?? []) {
			push(n)
		}
		for (const n of this.settings.providerFallbackChain) {
			push(n)
		}
		for (const n of this.settings.workerEnabledProviderNames ?? []) {
			push(n)
		}
		// If only one enabled provider, allow reuse (same name already unique).
		if ((this.settings.workerEnabledProviderNames ?? []).length === 1) {
			push(this.settings.workerEnabledProviderNames[0])
		}
		push(params.current)

		return ordered
	}

	/** True when profile name is allowed for workers (empty pool = all). */
	isWorkerEnabled(apiConfigName: string): boolean {
		const pool = this.settings.workerEnabledProviderNames ?? []
		if (pool.length === 0) {
			return true
		}
		return pool.includes(apiConfigName)
	}
}

export function classifyProviderFailure(error: unknown): ProviderFailureClass {
	const msg = errorMessage(error).toLowerCase()
	const status = (error as { status?: number })?.status ?? (error as { statusCode?: number })?.statusCode

	if (status === 401 || status === 403 || msg.includes("invalid api key") || msg.includes("unauthorized")) {
		return "auth"
	}
	if (status === 429 || msg.includes("rate limit") || msg.includes("quota") || msg.includes("too many requests")) {
		return "rate_limit"
	}
	if (status === 404 || (msg.includes("model") && (msg.includes("not found") || msg.includes("unavailable")))) {
		return "model_unavailable"
	}
	if (status === 400 && (msg.includes("context") || msg.includes("max token") || msg.includes("invalid_request"))) {
		// Context/request shape — usually not fixed by switching provider blindly
		return "non_retryable"
	}
	if (
		status === 500 ||
		status === 502 ||
		status === 503 ||
		status === 504 ||
		msg.includes("timeout") ||
		msg.includes("econnreset") ||
		msg.includes("fetch failed") ||
		msg.includes("network")
	) {
		return "transient"
	}
	if (msg.includes("abort")) {
		return "non_retryable"
	}
	return "unknown"
}

function errorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message
	}
	if (typeof error === "string") {
		return error
	}
	try {
		return JSON.stringify(error)
	} catch {
		return String(error)
	}
}

function computeBackoffMs(sameProviderRetryCount: number, failureClass: ProviderFailureClass, error: unknown): number {
	const base = failureClass === "rate_limit" ? 3000 : 1000
	const exp = Math.min(base * Math.pow(2, sameProviderRetryCount), 60_000)

	const retryAfter = (error as { headers?: { get?: (k: string) => string | null } })?.headers?.get?.("retry-after")
	if (retryAfter) {
		const sec = Number(retryAfter)
		if (!Number.isNaN(sec) && sec > 0) {
			return Math.max(exp, sec * 1000)
		}
	}
	return exp
}
