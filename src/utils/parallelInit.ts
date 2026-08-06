/**
 * Parallel execution utility with error handling.
 * Wraps Promise.allSettled to prevent one failure from blocking others.
 * Includes optional timeout protection to prevent hanging.
 *
 * Returns ALL results in positional order — failed tasks get `undefined`
 * so that callers can destructure by index without shifts.
 */
export async function runParallel<T>(
	tasks: Array<() => Promise<T>>,
	options: { logErrors?: boolean; timeoutMs?: number } = {},
): Promise<(T | undefined)[]> {
	const { logErrors = true, timeoutMs } = options

	const wrappedTasks = tasks.map((task) => {
		if (timeoutMs && timeoutMs > 0) {
			return Promise.race([
				task(),
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error(`Task timed out after ${timeoutMs}ms`)), timeoutMs),
				),
			])
		}
		return task()
	})

	const results = await Promise.allSettled(wrappedTasks)

	const values: (T | undefined)[] = []
	const errors: Error[] = []

	results.forEach((result, index) => {
		if (result.status === "fulfilled") {
			values.push(result.value)
		} else {
			values.push(undefined)
			errors.push(new Error(`Task ${index} failed: ${result.reason}`))
			if (logErrors) {
				console.error(`[ParallelInit] Task ${index} failed:`, result.reason)
			}
		}
	})

	if (errors.length > 0 && logErrors) {
		console.warn(`[ParallelInit] ${errors.length} of ${tasks.length} tasks failed`)
	}

	return values
}

/**
 * Performance instrumentation helper
 */
export class PerformanceTimer {
	private startTime: number
	private label: string

	constructor(label: string) {
		this.label = label
		this.startTime = performance.now()
	}

	end(): number {
		const duration = performance.now() - this.startTime
		console.log(`[${this.label}] ${duration.toFixed(2)}ms`)
		return duration
	}
}
