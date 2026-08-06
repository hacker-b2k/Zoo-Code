/**
 * StreamLivenessController — staged liveness tracking for a provider stream.
 *
 * The existing `nextChunkWithAbort` in Task implements a 120s hard timeout plus
 * responsive user cancellation. This controller adds intermediate staged states
 * so a stall produces a visible soft warning before the hard timeout fires,
 * without fabricating progress or altering the hard timeout behavior.
 */

export type StreamLivenessStage = "active" | "quiet" | "stalled" | "expired"

export interface StreamLivenessThresholds {
	/** After this much inactivity the stream is "quiet" (soft informational). */
	quietMs: number
	/** After this much inactivity the stream is "stalled" (visible warning). */
	stalledMs: number
	/** After this much inactivity the stream is "expired" (hard timeout). */
	expiredMs: number
}

export const DEFAULT_STREAM_LIVENESS_THRESHOLDS: StreamLivenessThresholds = {
	quietMs: 30_000,
	stalledMs: 60_000,
	expiredMs: 120_000,
}

/** Events that count as meaningful provider activity. */
export type StreamActivityKind = "text" | "reasoning" | "tool_call" | "usage" | "grounding"

export interface StreamLivenessSnapshot {
	stage: StreamLivenessStage
	lastActivityAt: number
	inactiveMs: number
}

export class StreamLivenessController {
	private lastActivityAt: number

	constructor(
		private readonly thresholds: StreamLivenessThresholds = DEFAULT_STREAM_LIVENESS_THRESHOLDS,
		private readonly now: () => number = () => performance.now(),
	) {
		this.lastActivityAt = this.now()
	}

	get stage(): StreamLivenessStage {
		const inactive = this.inactiveMs
		if (inactive >= this.thresholds.expiredMs) return "expired"
		if (inactive >= this.thresholds.stalledMs) return "stalled"
		if (inactive >= this.thresholds.quietMs) return "quiet"
		return "active"
	}

	get inactiveMs(): number {
		return Math.max(0, this.now() - this.lastActivityAt)
	}

	snapshot(): StreamLivenessSnapshot {
		return { stage: this.stage, lastActivityAt: this.lastActivityAt, inactiveMs: this.inactiveMs }
	}

	/** Records a meaningful provider event. */
	recordActivity(_kind: StreamActivityKind = "text"): void {
		this.lastActivityAt = this.now()
	}

	/** Remaining milliseconds until a stage boundary; null when already past it. */
	msUntil(stage: Exclude<StreamLivenessStage, "active">): number | null {
		const target = this.thresholds[`${stage}Ms` as keyof StreamLivenessThresholds]
		const remaining = target - this.inactiveMs
		return Number.isFinite(remaining) ? Math.max(0, remaining) : null
	}
}
