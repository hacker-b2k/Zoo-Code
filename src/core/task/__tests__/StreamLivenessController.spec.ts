import { beforeEach, describe, expect, it } from "vitest"

import { DEFAULT_STREAM_LIVENESS_THRESHOLDS, StreamLivenessController } from "../StreamLivenessController"

describe("StreamLivenessController", () => {
	let now: number

	beforeEach(() => {
		now = 0
	})

	it("starts in the active stage", () => {
		const controller = new StreamLivenessController(undefined, () => now)
		expect(controller.stage).toBe("active")
	})

	it("transitions to expired at the configured threshold", () => {
		const controller = new StreamLivenessController(undefined, () => now)
		now = DEFAULT_STREAM_LIVENESS_THRESHOLDS.expiredMs
		expect(controller.stage).toBe("expired")
	})

	it("resets to active on meaningful activity", () => {
		const controller = new StreamLivenessController(undefined, () => now)
		now = 130_000
		expect(controller.stage).toBe("expired")
		controller.recordActivity()
		expect(controller.stage).toBe("active")
		now = 260_000
		expect(controller.stage).toBe("expired")
	})

	it("computes the remaining ms until expired", () => {
		now = 0
		const controller = new StreamLivenessController(undefined, () => now)
		now = 10_000
		expect(controller.msUntil("expired")).toBe(110_000)
	})

	it("never reports a negative boundary", () => {
		now = 0
		const controller = new StreamLivenessController(undefined, () => now)
		now = 130_000
		expect(controller.msUntil("expired")).toBe(0)
	})
})
