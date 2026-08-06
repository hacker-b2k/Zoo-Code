/**
 * Result aggregation for background workers.
 * Main agent drains via collect_results; runtime can also push live notifications.
 */

import type { WorkerResult, WorkerResultKind } from "./types"

export class ResultInbox {
	/** parentTaskId → results (newest last) */
	private readonly byParent = new Map<string, WorkerResult[]>()

	push(result: Omit<WorkerResult, "ts" | "unread"> & { ts?: number; unread?: boolean }): WorkerResult {
		const entry: WorkerResult = {
			...result,
			ts: result.ts ?? Date.now(),
			unread: result.unread ?? true,
		}
		const list = this.byParent.get(result.parentTaskId) ?? []
		list.push(entry)
		this.byParent.set(result.parentTaskId, list)
		return entry
	}

	/** Peek without marking read */
	peek(parentTaskId: string, unreadOnly = false): WorkerResult[] {
		const list = this.byParent.get(parentTaskId) ?? []
		return unreadOnly ? list.filter((r) => r.unread) : [...list]
	}

	/** Drain unread (or all) and mark unread as read */
	collect(parentTaskId: string, options?: { unreadOnly?: boolean; markRead?: boolean }): WorkerResult[] {
		const unreadOnly = options?.unreadOnly ?? true
		const markRead = options?.markRead ?? true
		const list = this.byParent.get(parentTaskId) ?? []
		const selected = unreadOnly ? list.filter((r) => r.unread) : [...list]
		if (markRead) {
			for (const r of selected) {
				r.unread = false
			}
		}
		return selected.map((r) => ({ ...r }))
	}

	clear(parentTaskId: string): void {
		this.byParent.delete(parentTaskId)
	}

	formatForAgent(results: WorkerResult[]): string {
		if (results.length === 0) {
			return "No worker results pending."
		}
		return results
			.map((r) => {
				const header = `[${r.kind}] worker="${r.name}" id=${r.workerId} role=${r.role}`
				const provider = r.apiConfigName ? ` provider=${r.apiConfigName}` : ""
				const prev = r.previousApiConfigName ? ` previousProvider=${r.previousApiConfigName}` : ""
				const attempt = ` attempt=${r.attempt}`
				const body =
					r.kind === "completed" || r.kind === "review_digest"
						? (r.summary ?? "(empty summary)")
						: r.kind === "failed" || r.kind === "cancelled"
							? (r.error ?? r.summary ?? "failed")
							: r.kind === "question"
								? (r.summary ?? r.error ?? "worker needs input")
								: (r.summary ?? r.error ?? r.kind)
				return `${header}${provider}${prev}${attempt}\n${body}`
			})
			.join("\n\n---\n\n")
	}

	static kindFromState(state: string): WorkerResultKind {
		switch (state) {
			case "completed":
				return "completed"
			case "failed":
				return "failed"
			case "cancelled":
				return "cancelled"
			case "retrying":
				return "retrying"
			case "switched":
				return "provider_switched"
			default:
				return "failed"
		}
	}
}
