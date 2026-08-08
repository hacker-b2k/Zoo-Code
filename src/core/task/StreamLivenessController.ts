/**
 * StreamLivenessController — wall-clock liveness tracking for a provider stream.
 *
 * The `nextChunkWithAbort` helper in Task uses this to schedule a hard timeout
 * that is anchored to the last MEANINGFUL provider activity. Empty/internal
 * stream events do not reset the timer, so a silent provider is detected even
 * while iterator.next() still resolves.
 */

export type StreamLivenessStage = "active" | "expired"

export interface StreamLivenessThresholds {
	/** After this much inactivity the stream is treated as "expired" (hard timeout). */
	expiredMs: number
}

export const DEFAULT_STREAM_LIVENESS_THRESHOLDS: StreamLivenessThresholds = {
	expiredMs: 120_000,
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
		return this.inactiveMs >= this.thresholds.expiredMs ? "expired" : "active"
	}

	get inactiveMs(): number {
		return Math.max(0, this.now() - this.lastActivityAt)
	}

	/** Records a meaningful provider event. */
	recordActivity(): void {
		this.lastActivityAt = this.now()
	}

	/** Remaining milliseconds until "expired"; null when already past it. */
	msUntil(stage: Exclude<StreamLivenessStage, "active">): number | null {
		const target = this.thresholds[`${stage}Ms` as keyof StreamLivenessThresholds]
		const remaining = target - this.inactiveMs
		return Number.isFinite(remaining) ? Math.max(0, remaining) : null
	}
}
