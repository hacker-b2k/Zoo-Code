/**
 * Debounced state push batching utility.
 * Batches multiple state push requests into a single push.
 */
export class StatePushDebouncer {
	private timer: ReturnType<typeof setTimeout> | null = null
	private pendingResolvers: Array<{ resolve: () => void; reject: (err: any) => void }> = []
	private pushCount = 0
	private debouncedCount = 0

	constructor(
		private readonly provider: { postStateToWebview: () => Promise<void> },
		private readonly delayMs: number = 16, // One frame (60fps)
	) {}

	/**
	 * Schedule a state push. If called multiple times within delayMs,
	 * only one push will occur.
	 */
	schedule(): Promise<void> {
		this.debouncedCount++

		return new Promise((resolve, reject) => {
			this.pendingResolvers.push({ resolve, reject })

			if (this.timer) {
				clearTimeout(this.timer)
			}

			this.timer = setTimeout(() => {
				this.flush()
			}, this.delayMs)
		})
	}

	/**
	 * Immediately flush pending state push.
	 * Use for critical updates that must be visible immediately.
	 */
	async flush(): Promise<void> {
		if (this.timer) {
			clearTimeout(this.timer)
			this.timer = null
		}

		if (this.pendingResolvers.length === 0) {
			return // Nothing to flush
		}

		const resolvers = this.pendingResolvers.splice(0)

		try {
			await this.provider.postStateToWebview()
			this.pushCount++
			resolvers.forEach((r) => r.resolve())
		} catch (error) {
			console.error(`[StatePushDebouncer] flush() ERROR:`, error)
			resolvers.forEach((r) => r.reject(error))
		}
	}

	/**
	 * Cancel pending state push.
	 * Resolves all pending promises without pushing.
	 */
	cancel(): void {
		if (this.timer) {
			clearTimeout(this.timer)
			this.timer = null
		}

		const resolvers = this.pendingResolvers.splice(0)
		resolvers.forEach((r) => r.resolve()) // Resolve without pushing
	}

	/**
	 * Get statistics
	 */
	getStats(): { pushCount: number; debouncedCount: number; saved: number } {
		return {
			pushCount: this.pushCount,
			debouncedCount: this.debouncedCount,
			saved: this.debouncedCount - this.pushCount,
		}
	}
}
