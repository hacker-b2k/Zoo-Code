import stringify from "safe-stable-stringify"

import type { ToolUse } from "../../shared/tools"

export type ToolRetryAction = "allow" | "block"

export interface ToolRetryDecision {
	action: ToolRetryAction
	reason?: string
	fingerprint?: string
}

export interface ToolRetryGuardOptions {
	limit?: number
}

export class ToolRetryGuard {
	private readonly limit: number
	private previousFingerprint: string | null = null
	private count = 0

	constructor(options: ToolRetryGuardOptions = {}) {
		this.limit = options.limit ?? 1
	}

	check(tool: Pick<ToolUse, "name" | "params" | "nativeArgs">): ToolRetryDecision {
		const fingerprint = stringify({ name: tool.name, params: tool.params, nativeArgs: tool.nativeArgs }) ?? ""
		if (fingerprint !== this.previousFingerprint) {
			this.previousFingerprint = fingerprint
			this.count = 0
			return { action: "allow", fingerprint }
		}

		this.count++
		if (this.count >= this.limit && this.limit > 0) {
			return {
				action: "block",
				fingerprint,
				reason:
					`Identical ${tool.name} call was already rejected or failed this turn. ` +
					"Change the payload or gather new evidence instead of repeating it.",
			}
		}
		return { action: "allow", fingerprint }
	}

	reset(): void {
		this.previousFingerprint = null
		this.count = 0
	}
}

export class PerTaskToolRetryGuards {
	private readonly guards = new Map<string, ToolRetryGuard>()
	private readonly limit: number

	constructor(limit = 1) {
		this.limit = limit
	}

	check(scope: string, tool: Pick<ToolUse, "name" | "params" | "nativeArgs">): ToolRetryDecision {
		let guard = this.guards.get(scope)
		if (!guard) {
			guard = new ToolRetryGuard({ limit: this.limit })
			this.guards.set(scope, guard)
		}
		return guard.check(tool)
	}

	reset(): void {
		for (const guard of this.guards.values()) guard.reset()
	}

	resetScope(scope: string): void {
		this.guards.get(scope)?.reset()
	}
}
