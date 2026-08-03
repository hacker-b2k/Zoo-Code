import { beforeEach, describe, expect, it, vi } from "vitest"

import { DEFAULT_STREAM_LIVENESS_THRESHOLDS, StreamLivenessController } from "../StreamLivenessController"

describe("StreamLivenessController", () => {
	let now: number

	beforeEach(() => {
		now = 0
	})

	it("transitions active -> quiet -> stalled -> expired on inactivity", () => {
		const controller = new StreamLivenessController(undefined, () => now)
		expect(controller.stage).toBe("active")
		now = DEFAULT_STREAM_LIVENESS_THRESHOLDS.quietMs
		expect(controller.stage).toBe("quiet")
		now = DEFAULT_STREAM_LIVENESS_THRESHOLDS.stalledMs
		expect(controller.stage).toBe("stalled")
		now = DEFAULT_STREAM_LIVENESS_THRESHOLDS.expiredMs
		expect(controller.stage).toBe("expired")
	})

	it("resets to active on meaningful activity", () => {
		const controller = new StreamLivenessController(undefined, () => now)
		now = 90_000
		expect(controller.stage).toBe("stalled")
		controller.recordActivity("tool_call")
		expect(controller.stage).toBe("active")
		now = 150_000
		expect(controller.stage).toBe("stalled")
	})

	it("computes the remaining ms until each boundary", () => {
		now = 0
		const controller = new StreamLivenessController(undefined, () => now)
		now = 10_000
		expect(controller.msUntil("quiet")).toBe(20_000)
		expect(controller.msUntil("stalled")).toBe(50_000)
		expect(controller.msUntil("expired")).toBe(110_000)
	})

	it("never reports a negative boundary", () => {
		now = 0
		const controller = new StreamLivenessController(undefined, () => now)
		now = 130_000
		expect(controller.msUntil("expired")).toBe(0)
	})
})
