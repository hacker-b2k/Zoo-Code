import { afterEach, describe, expect, it, vi } from "vitest"

const CURRENT_INACTIVITY_TIMEOUT_MS = 120_000

function waitForFakeProviderChunk<T>(provider: AsyncIterator<T>, signal: AbortSignal): Promise<IteratorResult<T>> {
	return new Promise<IteratorResult<T>>((resolve, reject) => {
		const timeout = setTimeout(() => {
			reject(new Error(`Provider stream inactive for ${CURRENT_INACTIVITY_TIMEOUT_MS}ms`))
		}, CURRENT_INACTIVITY_TIMEOUT_MS)
		const onAbort = () => reject(new Error("Request cancelled by user"))
		signal.addEventListener("abort", onAbort, { once: true })

		provider
			.next()
			.then(resolve, reject)
			.finally(() => {
				clearTimeout(timeout)
				signal.removeEventListener("abort", onAbort)
			})
	})
}

describe("Phase 0 stream inactivity baseline", () => {
	afterEach(() => {
		vi.useRealTimers()
	})

	it("reproduces the current 120-second silent-provider hard timeout", async () => {
		vi.useFakeTimers()
		const provider: AsyncIterator<never> = { next: () => new Promise(() => {}) }
		const controller = new AbortController()
		const pending = waitForFakeProviderChunk(provider, controller.signal)
		const rejection = expect(pending).rejects.toThrow("Provider stream inactive for 120000ms")

		await vi.advanceTimersByTimeAsync(CURRENT_INACTIVITY_TIMEOUT_MS - 1)
		await vi.advanceTimersByTimeAsync(1)

		await rejection
	})

	it("keeps cancellation responsive while the fake provider is silent", async () => {
		vi.useFakeTimers()
		const provider: AsyncIterator<never> = { next: () => new Promise(() => {}) }
		const controller = new AbortController()
		const pending = waitForFakeProviderChunk(provider, controller.signal)
		const rejection = expect(pending).rejects.toThrow("Request cancelled by user")

		controller.abort()

		await rejection
	})
})
